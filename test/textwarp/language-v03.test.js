'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('scratch-vm');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {TextWarpDebugController} = require('../../src/lib/textwarp/debug-controller');
const {decompileTarget} = require('../../src/lib/textwarp/decompiler');
const {buildExtensionCatalog, buildExtensionInventory} = require('../../src/lib/textwarp/extension-catalog');
const {applyCompilation, SOURCE_MARKER} = require('../../src/lib/textwarp/vm-adapter');

const actorOptions = {
    targetId: 'sprite-v03',
    stageId: 'stage-v03',
    targetName: 'Player',
    isStage: false
};

const emptyProject = () => ({
    targets: [
        {
            isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
            currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0, tempo: 60,
            videoTransparency: 50, videoState: 'on'
        },
        {
            isStage: false, name: 'Player', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
            currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 1, visible: true,
            x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
        }
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '11.3.0', agent: 'TextWarp 0.3 tests'}
});

test('compiles typed parameters, reporter procedures, boolean returns and warp mode', () => {
    const source = `actor Player
variable result = 0
procedure twice(value: number) -> number warp:
    return value * 2
procedure positive(value: number, enabled: boolean) -> boolean:
    if enabled:
        return value > 0
    return false
procedure echo(label: string, data: any) -> string:
    return label
on green_flag:
    if positive(twice(3), true):
        result = twice(7)
        say(echo("ok", result))`;
    const result = compileText(source, actorOptions);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));
    assert.equal(
        result.diagnostics.filter(item => item.code === 'turbowarp-only-return-procedure').length,
        3
    );

    const procedures = Object.fromEntries(result.ir.procedures.map(procedure => [procedure.name, procedure]));
    assert.equal(procedures.twice.proccode, 'twice %s');
    assert.equal(procedures.twice.returnType, 'number');
    assert.equal(procedures.twice.warp, true);
    assert.equal(procedures.positive.proccode, 'positive %s %b');
    assert.equal(procedures.positive.returnType, 'boolean');
    assert.equal(procedures.echo.proccode, 'echo %s %s');
    assert.equal(procedures.echo.returnType, 'string');

    const blocks = Object.values(result.graph.blocks);
    assert.equal(blocks.filter(block => block.opcode === 'procedures_return').length, 4);
    assert.ok(blocks.some(block => block.opcode === 'argument_reporter_boolean'));
    assert.ok(blocks.some(block => block.opcode === 'procedures_call' && block.mutation.return === '1'));
    assert.ok(blocks.some(block => block.opcode === 'procedures_call' && block.mutation.return === '2'));
    const twicePrototype = blocks.find(block =>
        block.opcode === 'procedures_prototype' && block.mutation.proccode === 'twice %s'
    );
    assert.equal(twicePrototype.mutation.warp, 'true');
    assert.equal(twicePrototype.mutation.textwarp_argument_types, '["number"]');
    assert.equal(twicePrototype.mutation.textwarp_return_type, 'number');
    const target = {
        id: actorOptions.targetId,
        isStage: false,
        variables: {},
        getName: () => 'Player',
        blocks: {_blocks: result.graph.blocks, getBlock: id => result.graph.blocks[id]}
    };
    const decompiled = decompileTarget(target);
    assert.match(decompiled.source, /procedure twice\(value: number\) -> number warp:/);
    assert.match(decompiled.source, /procedure positive\(value: number, enabled: boolean\) -> boolean:/);
    assert.match(decompiled.source, /procedure echo\(label: string, data\) -> string:/);
    blocks.filter(block => block.opcode === 'procedures_prototype').forEach(prototype => {
        delete prototype.mutation.textwarp_argument_types;
    });
    const withoutCustomArgumentAttribute = decompileTarget(target);
    assert.match(withoutCustomArgumentAttribute.source, /procedure echo\(label: string, data\) -> string:/);
});

test('executes reporter procedures in scratch-vm', async () => {
    const vm = new VM();
    await vm.loadProject(emptyProject());
    const target = vm.runtime.targets.find(item => !item.isStage);
    const stage = vm.runtime.getTargetForStage();
    vm.setEditingTarget(target.id);
    const source = `actor Player
variable result = 0
procedure twice(value: number) -> number warp:
    return value * 2
procedure positive(value: number, enabled: boolean) -> boolean:
    if enabled:
        return value > 0
    return false
on green_flag:
    if positive(3, true):
        result = twice(7)`;
    const compilation = compileText(source, {
        targetId: target.id,
        stageId: stage.id,
        targetName: target.getName(),
        isStage: false
    });
    applyCompilation(vm, target, compilation);
    vm.greenFlag();
    for (let index = 0; index < 30; index++) vm.runtime._step();
    assert.equal(Object.values(target.variables).find(variable => variable.name === 'result').value, 14);
});

test('recovers exact parameter and return types from an SB3 without embedded TextWarp source', async () => {
    const vm = new VM();
    await vm.loadProject(emptyProject());
    const target = vm.runtime.targets.find(item => !item.isStage);
    const stage = vm.runtime.getTargetForStage();
    const source = `actor Player
procedure convert(amount: number, label: string, extra: any, enabled: boolean) -> string:
    return label
on green_flag:
    say(convert(1, "ok", 0, true))`;
    applyCompilation(vm, target, compileText(source, {
        targetId: target.id,
        stageId: stage.id,
        targetName: target.getName(),
        isStage: false
    }));
    Object.keys(target.comments).forEach(id => {
        if (target.comments[id].text.startsWith(SOURCE_MARKER)) delete target.comments[id];
    });

    const saved = await vm.saveProjectSb3('arraybuffer');
    const restoredVm = new VM();
    await restoredVm.loadProject(saved);
    const restoredTarget = restoredVm.runtime.targets.find(item => !item.isStage);
    const decompiled = decompileTarget(restoredTarget);
    assert.match(
        decompiled.source,
        /procedure convert\(amount: number, label: string, extra, enabled: boolean\) -> string:/
    );
});

test('compiles and decompiles extension conditionals with multiple branches', () => {
    const runtime = {
        _blockInfo: [{
            id: 'flow',
            name: 'Flow',
            blocks: [{
                info: {
                    opcode: 'choose', blockType: 'conditional', text: 'choose [INDEX]', branchCount: 3,
                    arguments: {INDEX: {type: 'number', defaultValue: 1}}
                },
                json: {type: 'flow_choose'},
                xml: '<block type="flow_choose"></block>'
            }, {
                info: {blockType: 'label', text: 'Helpers'},
                xml: '<label text="Helpers"></label>'
            }, {
                info: {blockType: 'button', text: 'Reset', func: 'reset'},
                xml: '<button text="Reset"></button>'
            }, {
                info: {blockType: 'xml', xml: '<block type="motion_movesteps"></block>'},
                xml: '<block type="motion_movesteps"></block>'
            }]
        }]
    };
    const inventory = buildExtensionInventory(runtime);
    const catalog = buildExtensionCatalog(runtime);
    assert.equal(inventory.palette.filter(entry => ['label', 'button', 'xml'].includes(entry.kind)).length, 3);

    const source = `actor Player
on green_flag:
    flow.choose(2):
        say("one")
    branch 2:
        say("two")
    branch 3:
        say("three")`;
    const compilation = compileText(source, Object.assign({}, actorOptions, {extensionCatalog: catalog}));
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    const flow = Object.values(compilation.graph.blocks).find(block => block.opcode === 'flow_choose');
    assert.ok(flow.inputs.SUBSTACK.block);
    assert.ok(flow.inputs.SUBSTACK2.block);
    assert.ok(flow.inputs.SUBSTACK3.block);

    const target = {
        id: actorOptions.targetId,
        isStage: false,
        variables: {},
        getName: () => 'Player',
        blocks: { _blocks: compilation.graph.blocks, getBlock: id => compilation.graph.blocks[id] }
    };
    const decompiled = decompileTarget(target, {extensionCatalog: catalog});
    assert.equal(decompiled.success, true);
    assert.match(decompiled.source, /flow\.choose\(2\):/);
    assert.match(decompiled.source, /branch 3:/);
});

test('never writes raw syntax for an unavailable historical or third-party opcode', () => {
    const blocks = {
        root: {
            id: 'root', opcode: 'legacy_when_magic', inputs: {}, fields: {}, next: 'command', parent: null,
            topLevel: true, shadow: false, x: 40, y: 80
        },
        command: {
            id: 'command', opcode: 'vendor_do_thing', fields: {}, next: null, parent: 'root', topLevel: false,
            shadow: false, inputs: {VALUE: {name: 'VALUE', block: 'reporter', shadow: null}}
        },
        reporter: {
            id: 'reporter', opcode: 'vendor_value', inputs: {}, fields: {MODE: {name: 'MODE', value: 'x'}},
            next: null, parent: 'command', topLevel: false, shadow: false
        }
    };
    const target = {
        id: actorOptions.targetId,
        isStage: false,
        variables: {},
        runtime: {_hats: {legacy_when_magic: {}}},
        getName: () => 'Player',
        blocks: {_blocks: blocks, getBlock: id => blocks[id]}
    };
    const decompiled = decompileTarget(target);
    assert.equal(decompiled.success, false);
    assert.doesNotMatch(decompiled.source, /\braw\./);
    assert.match(decompiled.source, /Stack não importado: bloco indisponível legacy_when_magic/);
    assert.deepEqual(decompiled.importedRootIds, []);
    assert.deepEqual(decompiled.unsupportedRootIds, ['root']);
    assert.deepEqual(decompiled.unsupportedOpcodes, ['legacy_when_magic']);
});

test('round-trips the complete motion category and resolves stage variables from actors', () => {
    const sharedVariables = [{
        id: 'global-direction', name: 'directionp1', variableType: '', owner: 'stage'
    }];
    const source = `actor Player
variable speed = 5
on green_flag:
    point_in_direction(90)
    point_towards("ball")
    go_to_target("_mouse_")
    glide_to(1, 10, 20)
    glide_to_target(2, "ball")
    if_on_edge_bounce()
    set_rotation_style("don't rotate")
    point_in_direction(directionp1)
    directionp1 = direction()`;
    const compilation = compileText(source, Object.assign({}, actorOptions, {variables: sharedVariables}));
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));

    const expectedOpcodes = [
        'motion_pointindirection',
        'motion_pointtowards',
        'motion_goto',
        'motion_glidesecstoxy',
        'motion_glideto',
        'motion_ifonedgebounce',
        'motion_setrotationstyle'
    ];
    const compiledOpcodes = new Set(Object.values(compilation.graph.blocks).map(block => block.opcode));
    expectedOpcodes.forEach(opcode => assert.ok(compiledOpcodes.has(opcode), `missing ${opcode}`));

    const stage = {
        id: actorOptions.stageId,
        isStage: true,
        variables: {
            'global-direction': {id: 'global-direction', name: 'directionp1', type: '', value: 90}
        }
    };
    const localVariables = Object.fromEntries(compilation.graph.declarations.map(variable => [variable.id, {
        id: variable.id,
        name: variable.name,
        type: variable.variableType,
        value: variable.initialValue
    }]));
    const target = {
        id: actorOptions.targetId,
        isStage: false,
        variables: localVariables,
        runtime: {getTargetForStage: () => stage},
        getName: () => 'Player',
        blocks: {
            _blocks: compilation.graph.blocks,
            getBlock: id => compilation.graph.blocks[id]
        }
    };
    const decompiled = decompileTarget(target);
    assert.equal(decompiled.success, true, JSON.stringify(decompiled));
    assert.deepEqual(decompiled.unsupportedOpcodes, []);
    assert.match(decompiled.source, /point_towards\("ball"\)/);
    assert.match(decompiled.source, /set_rotation_style\("don't rotate"\)/);
    assert.match(decompiled.source, /point_in_direction\(directionp1\)/);
    assert.match(decompiled.source, /directionp1 = direction\(\)/);
    assert.doesNotMatch(decompiled.source, /raw\.command/);
    assert.doesNotMatch(decompiled.source, /variable directionp1 =/);

    const recompiled = compileText(decompiled.source, Object.assign({}, actorOptions, {variables: sharedVariables}));
    assert.equal(recompiled.success, true, JSON.stringify(recompiled.diagnostics));
    const recompiledOpcodes = new Set(Object.values(recompiled.graph.blocks).map(block => block.opcode));
    expectedOpcodes.forEach(opcode => assert.ok(recompiledOpcodes.has(opcode), `round-trip lost ${opcode}`));
});

test('keeps JIT enabled for observation and switches to interpreter only for pausing', () => {
    const listeners = {};
    const runtime = {
        _primitives: {},
        threads: [],
        compilerOptions: {enabled: true},
        _pushThread (id, target) {
            return {id, target, compiled: this.compilerOptions.enabled};
        },
        on (name, listener) { listeners[name] = listener; },
        setCompilerOptions (options) { Object.assign(this.compilerOptions, options); }
    };
    const controller = new TextWarpDebugController({runtime});
    const target = {id: 'sprite'};
    controller.setEnabled(true);
    assert.equal(runtime.compilerOptions.enabled, true);
    assert.equal(controller.snapshot().interpreterRequired, false);
    controller.setBreakpoints(target, [4]);
    assert.equal(runtime.compilerOptions.enabled, true);
    assert.equal(controller.snapshot().interpreterRequired, true);
    assert.equal(controller.snapshot().selectiveInterpreter, true);
    assert.equal(runtime._pushThread('hat', target).compiled, false);
    assert.equal(runtime._pushThread('hat', {id: 'other'}).compiled, true);
    controller.pauseAll();
    assert.equal(runtime.compilerOptions.enabled, false);
    assert.equal(controller.snapshot().selectiveInterpreter, false);
    controller.resumeAll();
    assert.equal(runtime.compilerOptions.enabled, true);
    controller.setBreakpoints(target, []);
    assert.equal(runtime.compilerOptions.enabled, true);
    controller.setEnabled(false);
});

test('pauses an already compiled thread without losing its generator state', () => {
    const listeners = {};
    let executedFrames = 0;
    const target = {
        id: 'compiled-sprite',
        getName: () => 'Compiled sprite',
        blocks: {getBlock: () => null}
    };
    const thread = {
        isCompiled: true,
        status: 0,
        target,
        getId: () => 'compiled-thread',
        peekStack: () => 'compiled-hat'
    };
    const runtime = {
        _primitives: {},
        threads: [thread],
        compilerOptions: {enabled: true},
        sequencer: {
            stepThread (activeThread) {
                assert.equal(activeThread, thread);
                executedFrames++;
            }
        },
        on (name, listener) { listeners[name] = listener; },
        setCompilerOptions (options) { Object.assign(this.compilerOptions, options); }
    };
    const controller = new TextWarpDebugController({runtime});
    controller.setEnabled(true);
    runtime.sequencer.stepThread(thread);
    assert.equal(executedFrames, 1);

    controller.pauseAll();
    runtime.sequencer.stepThread(thread);
    assert.equal(executedFrames, 1);
    assert.equal(thread.status, 1);
    let snapshot = controller.snapshot();
    assert.equal(snapshot.threads[0].paused, true);
    assert.equal(snapshot.threads[0].executionMode, 'jit');
    assert.equal(snapshot.threads[0].stepGranularity, 'frame');

    controller.stepThread('compiled-thread');
    assert.equal(thread.status, 0);
    runtime.sequencer.stepThread(thread);
    assert.equal(executedFrames, 2);
    runtime.sequencer.stepThread(thread);
    assert.equal(executedFrames, 2);
    assert.equal(thread.status, 1);

    controller.resumeThread('compiled-thread');
    runtime.sequencer.stepThread(thread);
    assert.equal(executedFrames, 3);
    assert.equal(thread.status, 0);
    controller.pauseAll();
    runtime.sequencer.stepThread(thread);
    assert.equal(thread.status, 1);
    controller.resumeAll();
    assert.equal(thread.status, 0);
    assert.equal(runtime.compilerOptions.enabled, true);
    controller.setEnabled(false);
});

test('changing a reporter procedure body invalidates only that procedure unit', () => {
    const first = compileText(`actor Player
procedure twice(value: number) -> number:
    return value * 2
on green_flag:
    say(twice(4))`, actorOptions);
    const second = compileText(`actor Player
procedure twice(value: number) -> number:
    return value * 3
on green_flag:
    say(twice(4))`, actorOptions);
    const firstUnits = Object.fromEntries(first.graph.units.map(unit => [unit.unitId, unit.hash]));
    const secondUnits = Object.fromEntries(second.graph.units.map(unit => [unit.unitId, unit.hash]));
    assert.equal(firstUnits['script:green_flag#0'], secondUnits['script:green_flag#0']);
    assert.notEqual(firstUnits['procedure:twice'], secondUnits['procedure:twice']);
});
