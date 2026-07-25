'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    findDefinitions,
    findReferences,
    formatText,
    getCompletions,
    getDocumentSymbols,
    getHover,
    getSignatureHelp,
    renameEdits
} = require('../../src/lib/textwarp/language-service');
const {inspectExpression, inspectTarget} = require('../../src/lib/textwarp/debug-inspector');
const {compileText} = require('../../src/lib/textwarp/compiler');
const {
    buildWorkspace,
    loadHistory,
    rememberRecentTarget,
    replaceWorkspace,
    saveHistorySnapshot,
    searchWorkspace,
    synchronizeStableReferences
} = require('../../src/lib/textwarp/workspace-service');

const source = `actor Cat

variable speed = 5
list hits = []

procedure move_twice(amount: number):
    change_x(amount)
    change_x(amount)

on green_flag:
    move_twice(speed)
`;

test('language service exposes symbols, hover, definitions, references and safe rename edits', () => {
    const symbols = getDocumentSymbols(source);
    assert.deepEqual(symbols.map(symbol => `${symbol.kind}:${symbol.name}`), [
        'actor:Cat', 'variable:speed', 'list:hits', 'procedure:move_twice', 'event:green_flag'
    ]);
    assert.equal(findDefinitions(source, 'speed')[0].range.startLineNumber, 3);
    assert.equal(findReferences(source, 'amount').length, 3);
    assert.equal(renameEdits(source, 'speed', 'velocity').length, 2);
    assert.equal(renameEdits(source, 'amount', 'distance', {line: 7}).length, 3);
    assert.equal(renameEdits(source, 'green_flag', 'start').length, 0);
    const hover = getHover(source, 11, 18);
    assert.equal(hover.title, 'Variável');
    assert.match(getHover(source, 7, 7).documentation, /altera x/i);
});

test('language service offers signatures and project-aware resources', () => {
    const context = {resources: [{id: 'sprite-id', name: 'Enemy', kind: 'actor', kindLabel: 'Ator'}]};
    const completions = getCompletions('actor Cat\n\non green_flag:\n    go_to_target(', 4, 18, context);
    assert.ok(completions.some(item => item.label === 'Enemy' && item.insertText === '"Enemy"'));
    const ownSignature = getSignatureHelp(source, 11, 20);
    assert.equal(ownSignature.label, 'move_twice(amount)');
    const nativeSignature = getSignatureHelp('actor Cat\n\non green_flag:\n    glide_to(', 4, 14);
    assert.match(nativeSignature.label, /^glide_to\(/);
});

test('formatter normalizes indentation while preserving block structure', () => {
    assert.equal(formatText('actor Cat\non green_flag:\n say("hi")\n if true:\n  move(10)\nelse:\n say("no")'),
        'actor Cat\non green_flag:\n    say("hi")\n    if true:\n        move(10)\n    else:\n        say("no")\n');
});

const makeStorage = () => {
    const values = new Map();
    return {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, value)
    };
};

const makeTarget = (id, name, isStage = false) => ({
    id,
    isStage,
    comments: {},
    variables: {
        score: {id: 'score-id', name: 'score', type: '', value: 8},
        items: {id: 'items-id', name: 'items', type: 'list', value: ['a', 'b']}
    },
    sprite: {name, costumes: [{name: 'costume1', assetId: 'costume-id'}], sounds: [{name: 'pop', assetId: 'sound-id'}]},
    getName: () => name,
    x: 10,
    y: 20,
    direction: 90,
    visible: true,
    currentCostume: 0
});

test('workspace exposes editable modules, resources, global search, history and recents', () => {
    const stage = makeTarget('stage-id', 'Stage', true);
    const actor = makeTarget('actor-id', 'Cat');
    const workspace = buildWorkspace({runtime: {targets: [stage, actor]}});
    assert.deepEqual(workspace.editableFiles, ['stage.tw', 'Cat.tw']);
    assert.ok(workspace.resources.some(item => item.id === 'actor-id' && item.kind === 'actor'));
    workspace.modules[1].source = 'actor Cat\n\non green_flag:\n    say("found")';
    assert.equal(searchWorkspace(workspace, 'found')[0].fileName, 'Cat.tw');
    const replaced = replaceWorkspace(workspace, 'FOUND', 'changed');
    assert.equal(replaced.count, 1);
    assert.match(replaced.modules[1].source, /changed/);

    const storage = makeStorage();
    saveHistorySnapshot(storage, 'project', 'actor-id', 'first', 'edit', 1);
    saveHistorySnapshot(storage, 'project', 'actor-id', 'second', 'edit', 2);
    assert.deepEqual(loadHistory(storage, 'project', 'actor-id').map(item => item.source), ['second', 'first']);
    assert.deepEqual(rememberRecentTarget(storage, 'project', 'actor-id'), ['actor-id']);
});

test('debug inspector evaluates safe watches and exposes live target state', () => {
    const stage = makeTarget('stage-id', 'Stage', true);
    const actor = makeTarget('actor-id', 'Cat');
    actor.variables.score.value = 12;
    assert.deepEqual(inspectExpression('score * 2 + 1', actor, stage), {success: true, value: 25});
    assert.equal(inspectExpression('move(10)', actor, stage).success, false);
    const snapshot = inspectTarget(actor, stage);
    assert.equal(snapshot.target.x, 10);
    assert.ok(snapshot.variables.some(variable => variable.id === 'score-id'));
});

test('project resources are validated and stable bindings follow resource renames', () => {
    const options = {
        targetId: 'actor-id',
        stageId: 'stage-id',
        targetName: 'Cat',
        isStage: false,
        resources: [{id: 'sound-id', name: 'pop', kind: 'sound', ownerId: 'actor-id'}]
    };
    const valid = compileText('actor Cat\n\non green_flag:\n    play_sound("pop")', options);
    assert.equal(valid.success, true);
    assert.equal(valid.graph.resourceBindings[0].resourceId, 'sound-id');
    const invalid = compileText('actor Cat\n\non green_flag:\n    play_sound("missing")', options);
    assert.ok(invalid.diagnostics.some(item => item.code === 'missing-project-resource'));

    const rebound = synchronizeStableReferences(
        valid.source,
        {isStage: false, getName: () => 'Hero'},
        valid.graph.resourceBindings,
        [{id: 'sound-id', name: 'laser', kind: 'sound', ownerId: 'actor-id'}]
    );
    assert.equal(rebound.count, 2);
    assert.match(rebound.source, /^actor Hero/m);
    assert.match(rebound.source, /play_sound\("laser"\)/);
});
