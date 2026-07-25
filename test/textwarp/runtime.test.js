'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VM = require('scratch-vm');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {TextWarpDebugController} = require('../../src/lib/textwarp/debug-controller');
const {applyCompilation} = require('../../src/lib/textwarp/vm-adapter');

const project = () => ({
    targets: [
        {
            isStage: true,
            name: 'Stage',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'on'
        },
        {
            isStage: false,
            name: 'Player',
            variables: {},
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [],
            sounds: [],
            volume: 100,
            layerOrder: 1,
            visible: true,
            x: 0,
            y: 0,
            size: 100,
            direction: 90,
            draggable: false,
            rotationStyle: 'all around'
        }
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '11.3.0', agent: 'TextWarp tests'}
});

const setup = async () => {
    const vm = new VM();
    await vm.loadProject(project());
    const target = vm.runtime.targets.find(item => !item.isStage);
    vm.setEditingTarget(target.id);
    return {vm, target, stage: vm.runtime.getTargetForStage()};
};

const options = (target, stage) => ({
    targetId: target.id,
    stageId: stage.id,
    targetName: target.getName(),
    isStage: false
});

test('executes procedures, parameters, variables, lists and conditions in scratch-vm', async () => {
    const {vm, target, stage} = await setup();
    const source = `actor Player
variable score = 0
list values = []
procedure add_score(amount):
    score += amount
on green_flag:
    repeat(3):
        add_score(2)
        list_add(values, score)
    if score == 6:
        change_x(score)`;
    const compilation = compileText(source, options(target, stage));
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    applyCompilation(vm, target, compilation);
    vm.greenFlag();
    for (let index = 0; index < 20; index++) vm.runtime._step();
    const score = Object.values(target.variables).find(variable => variable.name === 'score');
    const values = Object.values(target.variables).find(variable => variable.name === 'values');
    assert.equal(score.value, 6);
    assert.deepEqual(values.value, [2, 4, 6]);
    assert.equal(target.x, 6);
});

test('pauses concurrent Scratch threads on independent source breakpoints', async () => {
    const {vm, target, stage} = await setup();
    const source = `actor Player
variable score = 0
on green_flag:
    score += 1
on green_flag:
    score += 2`;
    const compilation = compileText(source, options(target, stage));
    applyCompilation(vm, target, compilation);
    const debuggerController = new TextWarpDebugController(vm);
    debuggerController.setBreakpoints(target, [4, 6]);
    debuggerController.setEnabled(true);

    vm.greenFlag();
    vm.runtime._step();
    const paused = debuggerController.snapshot();
    assert.equal(paused.threads.length, 2);
    assert.equal(paused.threads.every(thread => thread.paused), true);
    assert.deepEqual(new Set(paused.threads.map(thread => thread.line)), new Set([4, 6]));
    assert.equal(paused.executionState, 'paused');
    assert.ok(paused.threads.every(thread => thread.callStack.length > 0));
    assert.ok(paused.threads.every(thread => thread.inspector.variables.some(variable => variable.name === 'score')));
    assert.equal(Object.values(target.variables).find(variable => variable.name === 'score').value, 0);

    debuggerController.log('output', 'mensagem de teste', target);
    assert.equal(debuggerController.snapshot().consoleEntries.at(-1).message, 'mensagem de teste');
    debuggerController.clearConsole();
    assert.equal(debuggerController.snapshot().consoleEntries.length, 0);

    debuggerController.resumeAll();
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let index = 0; index < 4; index++) vm.runtime._step();
    assert.equal(Object.values(target.variables).find(variable => variable.name === 'score').value, 3);
    debuggerController.setEnabled(false);
});

test('global pause freezes an existing JIT thread and steps one compiled frame', async () => {
    const {vm, target, stage} = await setup();
    const source = `actor Player
on green_flag:
    forever:
        change_x(1)`;
    const compilation = compileText(source, options(target, stage));
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    applyCompilation(vm, target, compilation);
    vm.runtime.setCompilerOptions({enabled: true});
    vm.greenFlag();
    const thread = vm.runtime.threads.find(item => item.target === target);
    assert.ok(thread);
    assert.equal(thread.isCompiled, true);
    vm.runtime._step();

    const debuggerController = new TextWarpDebugController(vm);
    debuggerController.pauseAll();
    const beforePause = target.x;
    vm.runtime._step();
    assert.equal(target.x, beforePause);
    const paused = debuggerController.snapshot().threads.find(item => item.id === thread.getId());
    assert.equal(paused.paused, true);
    assert.equal(paused.executionMode, 'jit');
    assert.equal(paused.stepGranularity, 'frame');

    debuggerController.stepThread(thread.getId());
    vm.runtime._step();
    assert.ok(target.x > beforePause);
    const afterStep = target.x;
    vm.runtime._step();
    assert.equal(target.x, afterStep);

    debuggerController.resumeAll();
    vm.runtime._step();
    assert.ok(target.x > afterStep);
    debuggerController.setEnabled(false);
    vm.stopAll();
});
