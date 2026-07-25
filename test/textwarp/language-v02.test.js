'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {decompileTarget} = require('../../src/lib/textwarp/decompiler');
const {buildExtensionCatalog} = require('../../src/lib/textwarp/extension-catalog');
const {applyCompilation, readSourceRecord} = require('../../src/lib/textwarp/vm-adapter');

const actorOptions = {
    targetId: 'sprite-v02',
    stageId: 'stage-v02',
    targetName: 'Player',
    isStage: false
};

const richSource = `actor Player

variable speed = 5
variable health = 100
list hits = []

procedure take_damage(amount):
    health -= amount
    list_add(hits, amount)
    if health <= 0:
        broadcast("player-died")
        delete_clone()

on green_flag:
    go_to(0, 0)
    repeat(10):
        if key_pressed("right") and not touching("Enemy"):
            change_x(speed * 2)
        else:
            take_damage(1)
        wait(0.01)

on receive("start-game"):
    create_clone("_myself_")

on clone_started:
    show()
    forever:
        change_y(-8)
        if touching("_edge_"):
            delete_clone()`;

test('compiles variables, lists, expressions, conditions, procedures, messages, clones and events', () => {
    const result = compileText(richSource, actorOptions);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.equal(result.ir.declarations.length, 3);
    assert.equal(result.ir.procedures.length, 1);
    assert.equal(result.ir.scripts.length, 3);
    assert.deepEqual(new Set(result.ir.broadcasts.map(item => item.name)), new Set(['player-died', 'start-game']));
    assert.deepEqual(
        new Set(result.graph.units.map(unit => unit.unitId)),
        new Set([
            'script:green_flag#0',
            'script:receive#0',
            'script:clone_started#0',
            'procedure:take_damage'
        ])
    );
    const opcodes = new Set(Object.values(result.graph.blocks).map(block => block.opcode));
    [
        'data_variable',
        'data_changevariableby',
        'data_addtolist',
        'operator_multiply',
        'operator_and',
        'operator_not',
        'control_if_else',
        'procedures_definition',
        'procedures_prototype',
        'procedures_call',
        'event_whenbroadcastreceived',
        'event_broadcast',
        'control_create_clone_of',
        'control_start_as_clone',
        'control_delete_this_clone'
    ].forEach(opcode => assert.ok(opcodes.has(opcode), `missing ${opcode}`));

    const definition = Object.values(result.graph.blocks).find(block => block.opcode === 'procedures_definition');
    const prototype = result.graph.blocks[definition.inputs.custom_block.block];
    assert.equal(prototype.mutation.proccode, 'take_damage %s');
    assert.deepEqual(JSON.parse(prototype.mutation.argumentnames), ['amount']);
});

test('builds canonical extensionId.opcode catalog and compiles extension blocks', () => {
    const runtime = {
        _blockInfo: [{
            id: 'physics',
            name: 'Física traduzida',
            color1: '#123456',
            blocks: [
                {
                    info: {
                        opcode: 'setGravity',
                        blockType: 'command',
                        text: 'definir gravidade para [VALUE]',
                        arguments: {VALUE: {type: 'number', defaultValue: 9.8}}
                    },
                    json: {type: 'physics_setGravity'}
                },
                {
                    info: {
                        opcode: 'isGrounded',
                        blockType: 'Boolean',
                        text: 'está no chão?',
                        arguments: {}
                    },
                    json: {type: 'physics_isGrounded'}
                }
            ]
        }]
    };
    const catalog = buildExtensionCatalog(runtime);
    assert.deepEqual(Object.keys(catalog).sort(), ['physics.isGrounded', 'physics.setGravity']);
    assert.equal(catalog['physics.setGravity'].opcode, 'physics_setGravity');

    const result = compileText(`actor Player
on green_flag:
    physics.setGravity(9.8)
    if physics.isGrounded():
        say("ok")`, Object.assign({}, actorOptions, {extensionCatalog: catalog}));
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    const opcodes = new Set(Object.values(result.graph.blocks).map(block => block.opcode));
    assert.ok(opcodes.has('physics_setGravity'));
    assert.ok(opcodes.has('physics_isGrounded'));
});

const makeIncrementalVm = () => {
    const storedBlocks = new Map();
    const target = {
        id: 'sprite-v02',
        isStage: false,
        variables: {},
        comments: {},
        createComment (id, blockId, text, x, y, width, height, minimized) {
            this.comments[id] = {id, blockId, text, x, y, width, height, minimized};
        },
        createVariable (id, name, type) {
            this.variables[id] = {id, name, type, value: type === 'list' ? [] : 0};
        },
        deleteVariable (id) {
            delete this.variables[id];
        },
        blocks: {
            _blocks: {},
            getBlock: id => storedBlocks.get(id),
            createBlock: block => {
                storedBlocks.set(block.id, block);
                target.blocks._blocks[block.id] = block;
            },
            deleteBlock: id => {
                storedBlocks.delete(id);
                delete target.blocks._blocks[id];
            },
            resetCache: () => {},
            updateTargetSpecificBlocks: () => {}
        }
    };
    const vm = {
        editingTarget: target,
        emitWorkspaceUpdate: () => {},
        runtime: {
            targets: [target],
            threads: [],
            emitProjectChanged: () => {},
            getTargetForStage: () => target
        }
    };
    return {vm, target, storedBlocks};
};

test('updates only the changed procedure and preserves unrelated script objects', () => {
    const {vm, target, storedBlocks} = makeIncrementalVm();
    const first = compileText(`actor Player
variable score = 0
procedure add(amount):
    score += amount
on green_flag:
    add(1)
on receive("again"):
    add(2)`, actorOptions);
    const firstRecord = applyCompilation(vm, target, first);
    const greenUnit = firstRecord.units.find(unit => unit.unitId === 'script:green_flag#0');
    const greenRootObject = storedBlocks.get(greenUnit.rootId);

    const second = compileText(`actor Player
variable score = 0
procedure add(amount):
    score += amount * 2
on green_flag:
    add(1)
on receive("again"):
    add(2)`, Object.assign({}, actorOptions, {
        variables: Object.values(target.variables).map(variable => ({
            id: variable.id,
            name: variable.name,
            variableType: variable.type,
            owner: 'target',
            generated: true
        }))
    }));
    const secondRecord = applyCompilation(vm, target, second);
    assert.equal(secondRecord.lastApply.updatedUnits, 1);
    assert.equal(secondRecord.lastApply.unchangedUnits, 2);
    assert.strictEqual(storedBlocks.get(greenUnit.rootId), greenRootObject);
});

test('remaps source locations after SB3 ID optimization and still updates one unit', () => {
    const {vm, target, storedBlocks} = makeIncrementalVm();
    const firstSource = `actor Player
variable score = 0
procedure add(amount):
    score += amount
on green_flag:
    add(1)
on receive("again"):
    add(2)`;
    applyCompilation(vm, target, compileText(firstSource, actorOptions));

    const oldBlocks = Array.from(storedBlocks.values());
    const idMap = new Map(oldBlocks.map((block, index) => [block.id, `optimized_${index}`]));
    storedBlocks.clear();
    target.blocks._blocks = {};
    oldBlocks.forEach(block => {
        const remapped = Object.assign({}, block, {
            id: idMap.get(block.id),
            parent: idMap.get(block.parent) || block.parent,
            next: idMap.get(block.next) || block.next,
            inputs: Object.fromEntries(Object.entries(block.inputs || {}).map(([name, input]) => [name, Object.assign({}, input, {
                block: idMap.get(input.block) || input.block,
                shadow: idMap.get(input.shadow) || input.shadow
            })]))
        });
        storedBlocks.set(remapped.id, remapped);
        target.blocks._blocks[remapped.id] = remapped;
    });
    Object.values(target.comments).forEach(comment => {
        if (comment.blockId && idMap.has(comment.blockId)) comment.blockId = idMap.get(comment.blockId);
    });

    const optimizedRecord = readSourceRecord(target);
    assert.equal(optimizedRecord.generatedBlockIds.every(id => id.startsWith('optimized_')), true);
    assert.equal(Object.keys(optimizedRecord.sourceMap).every(id => id.startsWith('optimized_')), true);
    const optimizedGreen = optimizedRecord.units.find(unit => unit.unitId === 'script:green_flag#0');
    const optimizedGreenObject = storedBlocks.get(optimizedGreen.rootId);

    const second = compileText(firstSource.replace('score += amount', 'score += amount * 2'), Object.assign({}, actorOptions, {
        variables: Object.values(target.variables).map(variable => ({
            id: variable.id,
            name: variable.name,
            variableType: variable.type,
            owner: 'target',
            generated: true
        }))
    }));
    const secondRecord = applyCompilation(vm, target, second);
    assert.equal(secondRecord.lastApply.updatedUnits, 1);
    assert.equal(secondRecord.lastApply.unchangedUnits, 2);
    assert.strictEqual(storedBlocks.get(optimizedGreen.rootId), optimizedGreenObject);
    assert.ok(secondRecord.sourceMap[optimizedGreen.rootId]);
});

test('decompiles generated Scratch blocks back to compilable text', () => {
    const compilation = compileText(richSource, actorOptions);
    const blocks = compilation.graph.blocks;
    const variables = Object.fromEntries(compilation.graph.declarations.map(variable => [variable.id, {
        id: variable.id,
        name: variable.name,
        type: variable.variableType,
        value: Array.isArray(variable.initialValue) ? variable.initialValue.slice() : variable.initialValue
    }]));
    const target = {
        id: actorOptions.targetId,
        isStage: false,
        variables,
        getName: () => 'Player',
        blocks: {
            _blocks: blocks,
            getBlock: id => blocks[id]
        }
    };
    const decompiled = decompileTarget(target);
    assert.equal(decompiled.success, true, decompiled.unsupportedOpcodes.join(', '));
    assert.equal(decompiled.importedRootIds.length, compilation.graph.rootIds.length);
    assert.match(decompiled.source, /procedure take_damage\(amount\):/);
    assert.match(decompiled.source, /on receive\("start-game"\):/);
    const recompiled = compileText(decompiled.source, Object.assign({}, actorOptions, {
        variables: Object.values(variables).map(variable => ({
            id: variable.id,
            name: variable.name,
            variableType: variable.type,
            owner: 'target',
            generated: true
        }))
    }));
    assert.equal(recompiled.success, true, JSON.stringify(recompiled.diagnostics));
    assert.deepEqual(
        new Set(Object.values(recompiled.graph.blocks).map(block => block.opcode)),
        new Set(Object.values(compilation.graph.blocks).map(block => block.opcode))
    );
});

test('source record exposes incremental statistics', () => {
    const {vm, target} = makeIncrementalVm();
    applyCompilation(vm, target, compileText('actor Player\non green_flag:\n    move(10)', actorOptions));
    const record = readSourceRecord(target);
    assert.equal(record.formatVersion, 3);
    assert.equal(record.languageVersion, '0.3');
    assert.equal(record.units.length, 1);
    assert.equal(record.lastApply.createdUnits, 1);
});
