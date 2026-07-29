'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {decompileTarget} = require('../../src/lib/textwarp/decompiler');
const {MAX_NESTING_DEPTH} = require('../../src/lib/textwarp/parser');
const {
    adoptImportedRoots,
    applyCompilation,
    captureTargetSnapshot,
    readSourceRecord,
    restoreTargetSnapshot,
    SOURCE_COMMENT_ID,
    SOURCE_MARKER
} = require('../../src/lib/textwarp/vm-adapter');

const options = {
    targetId: 'sprite-regression',
    stageId: 'stage-regression',
    targetName: 'Player',
    isStage: false
};

const makeVm = (initialBlocks = {}) => {
    const target = {
        id: options.targetId,
        isStage: false,
        variables: {},
        comments: {},
        getName: () => 'Player',
        createComment (id, blockId, text, x, y, width, height, minimized) {
            this.comments[id] = {id, blockId, text, x, y, width, height, minimized};
        },
        createVariable (id, name, type, isCloud) {
            this.variables[id] = {id, name, type, isCloud, value: type === 'list' ? [] : 0};
        },
        renameVariable (id, name) {
            this.variables[id].name = name;
        },
        deleteVariable (id) {
            delete this.variables[id];
        },
        blocks: {
            _blocks: Object.assign({}, initialBlocks),
            getBlock (id) {
                return this._blocks[id];
            },
            createBlock (block) {
                this._blocks[block.id] = block;
            },
            deleteBlock (id) {
                delete this._blocks[id];
            },
            resetCache () {},
            updateTargetSpecificBlocks () {}
        }
    };
    const vm = {
        editingTarget: target,
        emitWorkspaceUpdate () {},
        runtime: {
            targets: [target],
            threads: [],
            emitProjectChanged () {},
            getTargetForStage: () => target
        }
    };
    return {vm, target};
};

const projectShape = target => ({
    blocks: target.blocks._blocks,
    comments: target.comments,
    variables: Object.fromEntries(Object.values(target.variables).map(variable => [variable.id, {
        id: variable.id,
        name: variable.name,
        type: variable.type,
        value: variable.value,
        isCloud: Boolean(variable.isCloud)
    }]))
});

test('negative variable and list values remain constant during conversion', () => {
    const compilation = compileText(`actor Player
variable offset = -12.5
list points = [-3, 0, 4]
on green_flag:
    say(offset)`, options);
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    assert.equal(compilation.graph.declarations.find(variable => variable.name === 'offset').initialValue, -12.5);
    assert.deepEqual(compilation.graph.declarations.find(variable => variable.name === 'points').initialValue, [-3, 0, 4]);
});

test('assignments to a Scratch variable named return remain command assignments', () => {
    const compilation = compileText(`actor Player
variable return = "6F"
procedure get_byte() warp:
    return = "FF"
on green_flag:
    get_byte()
    say(return)`, options);
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    assert.equal(compilation.diagnostics.some(item =>
        ['invalid-expression-character', 'return-in-command-procedure'].includes(item.code)
    ), false);
    assert.ok(Object.values(compilation.graph.blocks).some(block =>
        block.opcode === 'data_setvariableto' && block.fields.VARIABLE.value === 'return'
    ));
});

test('orphaned procedure reporters and built-in procedure name collisions use lossless syntax', () => {
    const blocks = {
        orphan: {
            id: 'orphan', opcode: 'argument_reporter_boolean',
            inputs: {}, fields: {VALUE: {name: 'VALUE', value: 'is compiled?', id: null}},
            next: null, parent: null, topLevel: true, shadow: false, x: 10, y: 20
        },
        definition: {
            id: 'definition', opcode: 'procedures_definition',
            inputs: {custom_block: {name: 'custom_block', block: 'prototype', shadow: 'prototype'}},
            fields: {}, next: 'call', parent: null, topLevel: true, shadow: false, x: 20, y: 80
        },
        prototype: {
            id: 'prototype', opcode: 'procedures_prototype', inputs: {}, fields: {},
            next: null, parent: 'definition', topLevel: false, shadow: true,
            mutation: {
                proccode: 'move %s',
                argumentids: '["amount-id"]',
                argumentnames: '["amount"]',
                argumentdefaults: '[""]',
                warp: 'false'
            }
        },
        call: {
            id: 'call', opcode: 'procedures_call',
            inputs: {['amount-id']: {name: 'amount-id', block: 'argument', shadow: null}},
            fields: {}, next: null, parent: 'definition', topLevel: false, shadow: false,
            mutation: {
                proccode: 'move %s',
                argumentids: '["amount-id"]',
                argumentnames: '["amount"]',
                argumentdefaults: '[""]',
                warp: 'false'
            }
        },
        argument: {
            id: 'argument', opcode: 'argument_reporter_string_number',
            inputs: {}, fields: {VALUE: {name: 'VALUE', value: 'amount', id: null}},
            next: null, parent: 'call', topLevel: false, shadow: false
        }
    };
    const {target} = makeVm(blocks);
    const decompiled = decompileTarget(target);
    const compilation = compileText(decompiled.source, options);
    assert.equal(decompiled.success, true);
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    assert.match(decompiled.source, /reporter opaque\.reporter/);
    assert.match(decompiled.source, /procedure move_2\(amount\)/);
    assert.match(decompiled.source, /move_2\(amount\)/);
});

test('Scratch-coercible text and number literals retain active and preferred shadow shapes', () => {
    const compilation = compileText(`actor Player
on green_flag:
    say(123)
    move("hello")`, options);
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    assert.equal(compilation.diagnostics.filter(item => item.code === 'scratch-coercion').length, 2);

    const blocks = compilation.graph.blocks;
    const say = Object.values(blocks).find(block => block.opcode === 'looks_say');
    const sayActive = blocks[say.inputs.MESSAGE.block];
    const sayShadow = blocks[say.inputs.MESSAGE.shadow];
    assert.equal(sayActive.opcode, 'math_number');
    assert.equal(sayActive.shadow, false);
    assert.equal(sayShadow.opcode, 'text');
    assert.equal(sayShadow.shadow, true);

    const move = Object.values(blocks).find(block => block.opcode === 'motion_movesteps');
    const moveActive = blocks[move.inputs.STEPS.block];
    const moveShadow = blocks[move.inputs.STEPS.shadow];
    assert.equal(moveActive.opcode, 'text');
    assert.equal(moveActive.shadow, false);
    assert.equal(moveShadow.opcode, 'math_number');
    assert.equal(moveShadow.shadow, true);
});

test('an opaque nested block is adopted and never duplicates the containing root', () => {
    const blocks = {
        root: {
            id: 'root', opcode: 'event_whenflagclicked', inputs: {}, fields: {}, next: 'unknown',
            parent: null, topLevel: true, shadow: false, x: 25, y: 35
        },
        unknown: {
            id: 'unknown', opcode: 'vendor_missing', inputs: {}, fields: {}, next: 'after',
            parent: 'root', topLevel: false, shadow: false
        },
        after: {
            id: 'after', opcode: 'looks_say', fields: {}, next: null, parent: 'unknown',
            topLevel: false, shadow: false,
            inputs: {MESSAGE: {name: 'MESSAGE', block: 'text', shadow: 'text'}}
        },
        text: {
            id: 'text', opcode: 'text', inputs: {}, fields: {TEXT: {name: 'TEXT', value: 'after'}},
            next: null, parent: 'after', topLevel: false, shadow: true
        }
    };
    const {vm, target} = makeVm(blocks);
    const decompiled = decompileTarget(target);
    assert.equal(decompiled.success, true);
    assert.deepEqual(decompiled.importedRootIds, ['root']);
    const compilation = compileText(decompiled.source, options);
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    adoptImportedRoots(vm, target, decompiled.source, decompiled.importedRootIds, decompiled.sourceMap, compilation);
    applyCompilation(vm, target, compilation);
    assert.deepEqual(
        Object.values(target.blocks._blocks).filter(block => block.topLevel && !block.shadow).map(block => block.id),
        ['root']
    );
    assert.equal(Object.values(target.blocks._blocks).filter(block => block.opcode === 'looks_say').length, 1);
});

test('a failed block creation rolls back the complete target transaction', () => {
    const {vm, target} = makeVm();
    applyCompilation(vm, target, compileText('actor Player\non green_flag:\n    move(10)', options));
    const before = JSON.stringify(projectShape(target));
    const originalCreate = target.blocks.createBlock;
    let injected = false;
    target.blocks.createBlock = function (block) {
        if (!injected) {
            injected = true;
            throw new Error('injected create failure');
        }
        return originalCreate.call(this, block);
    };
    assert.throws(
        () => applyCompilation(vm, target, compileText('actor Player\non green_flag:\n    say("changed")', {
            ...options,
            previousUnits: readSourceRecord(target).units
        })),
        /injected create failure/
    );
    assert.equal(JSON.stringify(projectShape(target)), before);
});

test('deletion, variable and source-record failures each roll back the complete transaction', () => {
    const failureCases = [
        {
            name: 'delete',
            prepare: target => {
                const original = target.blocks.deleteBlock;
                let injected = false;
                target.blocks.deleteBlock = function (id) {
                    if (!injected) {
                        injected = true;
                        throw new Error('injected delete failure');
                    }
                    return original.call(this, id);
                };
            },
            source: 'actor Player\non green_flag:\n    say("delete")'
        },
        {
            name: 'variable',
            prepare: target => {
                target.createVariable = () => {
                    throw new Error('injected variable failure');
                };
            },
            source: 'actor Player\nvariable score = 1\non green_flag:\n    say("variable")'
        }
    ];
    failureCases.forEach(failureCase => {
        const {vm, target} = makeVm();
        applyCompilation(vm, target, compileText('actor Player\non green_flag:\n    move(10)', options));
        const before = JSON.stringify(projectShape(target));
        failureCase.prepare(target);
        assert.throws(
            () => applyCompilation(vm, target, compileText(failureCase.source, {
                ...options,
                previousUnits: readSourceRecord(target).units
            })),
            new RegExp(`injected ${failureCase.name}`)
        );
        assert.equal(JSON.stringify(projectShape(target)), before, failureCase.name);
    });

    const {vm, target} = makeVm();
    const before = JSON.stringify(projectShape(target));
    const originalCreateComment = target.createComment;
    target.createComment = function (id, ...args) {
        if (id === SOURCE_COMMENT_ID) throw new Error('injected source record failure');
        return originalCreateComment.call(this, id, ...args);
    };
    assert.throws(
        () => applyCompilation(
            vm,
            target,
            compileText('actor Player\non green_flag:\n    say("record")', options)
        ),
        /injected source record failure/
    );
    assert.equal(JSON.stringify(projectShape(target)), before, 'record');
});

test('an exact target snapshot restores blocks, comments, variables and cloud state', () => {
    const {vm, target} = makeVm();
    applyCompilation(vm, target, compileText('actor Player\nvariable score = 1\non green_flag:\n    move(10)', options));
    const snapshot = captureTargetSnapshot(vm, target);
    const before = JSON.stringify(projectShape(target));
    Object.values(target.variables)[0].value = 99;
    Object.values(target.variables)[0].isCloud = true;
    target.comments.user = {id: 'user', blockId: null, text: 'changed'};
    target.blocks._blocks.extra = {id: 'extra', opcode: 'looks_say', topLevel: true, shadow: false};
    restoreTargetSnapshot(vm, target, snapshot);
    assert.equal(JSON.stringify(projectShape(target)), before);
});

test('durable unit matching preserves unrelated loose roots when one is inserted', () => {
    const {vm, target} = makeVm();
    const first = compileText(`actor Player
stack:
    say("A")
stack:
    say("B")`, options);
    const firstRecord = applyCompilation(vm, target, first);
    const oldRoots = new Map(firstRecord.units.map(unit => [unit.hash, target.blocks.getBlock(unit.rootId)]));
    const second = compileText(`actor Player
stack:
    say("new")
stack:
    say("A")
stack:
    say("B")`, {...options, previousUnits: firstRecord.units});
    const secondRecord = applyCompilation(vm, target, second);
    firstRecord.units.forEach(unit => {
        const current = secondRecord.units.find(candidate => candidate.hash === unit.hash);
        assert.ok(current);
        assert.strictEqual(target.blocks.getBlock(current.rootId), oldRoots.get(unit.hash));
    });
});

test('changed units preserve root coordinates and remap attached comments', () => {
    const {vm, target} = makeVm();
    const firstRecord = applyCompilation(
        vm,
        target,
        compileText('actor Player\non green_flag:\n    say("before")', options)
    );
    const root = target.blocks.getBlock(firstRecord.units[0].rootId);
    root.x = 321;
    root.y = 654;
    const oldSay = Object.values(target.blocks._blocks).find(block => block.opcode === 'looks_say');
    target.comments.note = {id: 'note', blockId: oldSay.id, text: 'keep me', x: 5, y: 6, width: 100, height: 40};
    oldSay.comment = 'note';

    const second = compileText('actor Player\non green_flag:\n    say("after")\n    wait(1)', {
        ...options,
        previousUnits: firstRecord.units
    });
    const secondRecord = applyCompilation(vm, target, second);
    const newRoot = target.blocks.getBlock(secondRecord.units[0].rootId);
    const newSay = Object.values(target.blocks._blocks).find(block => block.opcode === 'looks_say');
    assert.equal(newRoot.x, 321);
    assert.equal(newRoot.y, 654);
    assert.equal(target.comments.note.blockId, newSay.id);
    assert.equal(newSay.comment, 'note');
});

test('conversion depth limits return controlled diagnostics instead of RangeError', () => {
    const lines = ['actor Player', 'on green_flag:'];
    for (let index = 0; index < MAX_NESTING_DEPTH + 2; index++) {
        lines.push(`${' '.repeat((index + 1) * 4)}forever:`);
    }
    lines.push(`${' '.repeat((MAX_NESTING_DEPTH + 3) * 4)}pass`);
    const compiled = compileText(lines.join('\n'), options);
    assert.equal(compiled.success, false);
    assert.ok(compiled.diagnostics.some(item => item.code === 'conversion-depth-limit'));

    const blocks = {};
    let parent = null;
    for (let index = 0; index < MAX_NESTING_DEPTH + 2; index++) {
        const id = `control-${index}`;
        const next = `control-${index + 1}`;
        blocks[id] = {
            id,
            opcode: 'control_forever',
            inputs: index === MAX_NESTING_DEPTH + 1 ? {} : {
                SUBSTACK: {name: 'SUBSTACK', block: next, shadow: null}
            },
            fields: {},
            next: null,
            parent,
            topLevel: index === 0,
            shadow: false
        };
        parent = id;
    }
    const {target} = makeVm(blocks);
    const decompiled = decompileTarget(target);
    assert.equal(decompiled.success, false);
    assert.ok(decompiled.diagnostics.some(item => item.code === 'conversion-depth-limit'));
});

test('adapter refuses live mutation and leaves every running-project block untouched', () => {
    const {vm, target} = makeVm();
    const existing = {id: 'manual', opcode: 'looks_say', inputs: {}, fields: {}, topLevel: true, shadow: false};
    target.blocks._blocks.manual = existing;
    vm.runtime.threads = [{target, topBlock: 'manual', stack: ['manual'], status: 0}];
    assert.throws(
        () => applyCompilation(vm, target, compileText('actor Player\non green_flag:\n    move(10)', options)),
        /aguardar o projeto em execução parar/
    );
    assert.strictEqual(target.blocks.getBlock('manual'), existing);
    assert.equal(Object.keys(target.comments).length, 0);
});

test('compact source ownership metadata remains below ten times representative source size', () => {
    const {vm, target} = makeVm();
    const lines = ['actor Player'];
    for (let index = 0; index < 100; index++) {
        lines.push(`on green_flag:\n    say("${index}")`);
    }
    const source = lines.join('\n');
    applyCompilation(vm, target, compileText(source, options));
    const recordText = Object.values(target.comments)
        .find(comment => comment.text.startsWith(SOURCE_MARKER)).text;
    assert.ok(recordText.length < source.length * 10, `${recordText.length} >= ${source.length * 10}`);
});
