'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    createDocumentIndex,
    findDefinitions,
    findReferences,
    formatText,
    getCompletions,
    getContextualValueControl,
    getDefinitionLocations,
    getDiagnosticSuggestion,
    getDocumentSymbols,
    getHover,
    getInlayHints,
    getReferenceLocations,
    getRenamePlan,
    getResourceAt,
    getSemanticTokens,
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
    const languageContext = {
        documents: [{fileName: 'Cat.tw', modelKey: 'cat-id', source}],
        locale: 'en',
        targetId: 'cat-id',
        targetName: 'Cat'
    };
    const hover = getHover(source, 11, 18, languageContext);
    assert.equal(hover.title, 'Variable');
    assert.equal(hover.documentation, 'Variable declared in Cat.tw.');
    assert.equal(getHover(source, 4, 7, languageContext).documentation, 'List declared in Cat.tw.');
    assert.match(getHover(source, 7, 7, {codeLanguage: 'pt-BR'}).documentation, /altera x/i);
    assert.match(getHover(source, 7, 7, {codeLanguage: 'en-US'}).documentation, /TextWarp command/i);
    assert.ok(getSemanticTokens(source).some(token => token.type === 'namespace' && token.line === 1));
    assert.ok(getSemanticTokens(source).some(token => token.type === 'event' && token.line === 10));
});

test('language service offers signatures and project-aware resources', () => {
    const context = {resources: [{id: 'sprite-id', name: 'Enemy', kind: 'actor', kindLabel: 'Ator'}]};
    const completions = getCompletions('actor Cat\n\non green_flag:\n    go_to_target(', 4, 18, context);
    assert.ok(completions.some(item => item.label === 'Enemy' && item.insertText === '"Enemy"'));
    const ownSignature = getSignatureHelp(source, 11, 20, {
        documents: [{fileName: 'Cat.tw', modelKey: 'cat-id', source}],
        targetId: 'cat-id'
    });
    assert.equal(ownSignature.label, 'move_twice(amount: number)');
    assert.equal(ownSignature.documentation, 'Procedure declared in Cat.tw.');
    const nativeSignature = getSignatureHelp('actor Cat\n\non green_flag:\n    glide_to(', 4, 14);
    assert.match(nativeSignature.label, /^glide_to\(/);
    const portugueseSignature = getSignatureHelp(
        'ator Gato\n\nao bandeira_verde:\n    mude_x(',
        4,
        12,
        {codeLanguage: 'pt-BR'}
    );
    assert.equal(portugueseSignature.label, 'mude_x(valor: numero)');
    assert.equal(portugueseSignature.parameters[0].label, 'valor');
    const overloaded = getSignatureHelp('actor Cat\n\non green_flag:\n    extension.mix(1, ', 4, 22, {
        extensionCatalog: {
            'extension.mix': {
                kind: 'command',
                documentation: 'Mix values.',
                overloads: [{
                    arguments: [{name: 'value', valueType: 'number'}]
                }, {
                    arguments: [
                        {name: 'left', valueType: 'number'},
                        {name: 'right', valueType: 'number', optional: true}
                    ]
                }]
            }
        }
    });
    assert.equal(overloaded.signatures.length, 2);
    assert.equal(overloaded.activeSignature, 1);
    assert.equal(overloaded.activeParameter, 1);
});

test('contextual value controls reuse block metadata while preserving text replacements', () => {
    const number = getContextualValueControl('move(-10)', 1, 7);
    assert.equal(number.kind, 'number');
    assert.equal(number.argumentName, 'steps');
    assert.equal(number.step, 1);
    assert.deepEqual(number.range, {
        startLineNumber: 1,
        startColumn: 6,
        endLineNumber: 1,
        endColumn: 9
    });
    assert.equal(number.replacement(12), '12');

    const angle = getContextualValueControl('point_in_direction(90)', 1, 21);
    assert.equal(angle.kind, 'number');
    assert.equal(angle.step, 15);

    const boolean = getContextualValueControl('espere_ate(verdadeiro)', 1, 13, {codeLanguage: 'pt-BR'});
    assert.equal(boolean.kind, 'boolean');
    assert.equal(boolean.value, true);
    assert.equal(boolean.values.find(item => item.value === false).replacement, 'falso');

    const color = getContextualValueControl('touching_color("#ff0000")', 1, 18);
    assert.equal(color.kind, 'color');
    assert.equal(color.replacement('#00ff00'), '"#00ff00"');

    const option = getContextualValueControl('key_pressed("space")', 1, 14);
    assert.equal(option.kind, 'select');
    assert.equal(option.argumentName, 'key');
    assert.equal(
        option.options.find(item => item.value === 'right arrow').replacement,
        '"right arrow"'
    );

    assert.equal(getContextualValueControl('say("#ff0000")', 1, 8), null);
    assert.equal(getContextualValueControl('# move(10)', 1, 8), null);
});

test('workspace index resolves global symbols without crossing local module boundaries', () => {
    const stage = 'stage\n\nglobal variable score = 0\n\non green_flag:\n    score += 1\n';
    const cat = 'actor Cat\n\nvariable lives = 3\n\non green_flag:\n    score += lives\n';
    const dog = 'actor Dog\n\nvariable lives = 5\n\non green_flag:\n    score += lives\n';
    const context = {
        locale: 'en',
        targetId: 'cat',
        documents: [
            {fileName: 'stage.tw', modelKey: 'stage', source: stage},
            {fileName: 'Cat.tw', modelKey: 'cat', source: cat},
            {fileName: 'Dog.tw', modelKey: 'dog', source: dog}
        ]
    };
    assert.equal(getHover(cat, 6, 5, context).documentation, 'Global · Variable declared in stage.tw.');
    assert.deepEqual(
        getDefinitionLocations(cat, 6, 5, context).map(location => location.modelKey),
        ['stage']
    );
    assert.deepEqual(
        getReferenceLocations(cat, 6, 5, context).map(location => location.modelKey).sort(),
        ['cat', 'dog', 'stage', 'stage']
    );
    assert.deepEqual(
        getReferenceLocations(cat, 6, 14, context).map(location => location.modelKey),
        ['cat', 'cat']
    );
    const globalRename = getRenamePlan(cat, 6, 5, 'points', context);
    assert.equal(globalRename.edits.length, 4);
    assert.deepEqual(Array.from(new Set(globalRename.edits.map(edit => edit.modelKey))).sort(), [
        'cat', 'dog', 'stage'
    ]);
    const localRename = getRenamePlan(cat, 6, 14, 'health', context);
    assert.equal(localRename.edits.length, 2);
    assert.ok(localRename.edits.every(edit => edit.modelKey === 'cat'));
    assert.match(getRenamePlan(cat, 6, 5, 'lives', context).rejectReason, /already declared/);
    assert.match(getRenamePlan(cat, 6, 14, 'score', context).rejectReason, /already declared/);
});

test('parameters shadow module symbols and rename only inside their procedure', () => {
    const shadowed = `actor Cat

variable value = 1

procedure set_value(value: number):
    change_x(value)

on green_flag:
    change_y(value)
`;
    const parameterPlan = getRenamePlan(shadowed, 6, 14, 'amount');
    assert.equal(parameterPlan.edits.length, 2);
    assert.deepEqual(parameterPlan.edits.map(edit => edit.range.startLineNumber), [5, 6]);
    const variablePlan = getRenamePlan(shadowed, 9, 14, 'speed');
    assert.equal(variablePlan.edits.length, 2);
    assert.deepEqual(variablePlan.edits.map(edit => edit.range.startLineNumber), [3, 9]);
    assert.match(getRenamePlan(shadowed, 6, 14, 'value').rejectReason, /already declared/);
});

test('partial index preserves incomplete declarations while the user is typing', () => {
    const incomplete = 'actor Cat\n\nvariable speed\n\nprocedure move_twice(amount: number)\n';
    const symbols = getDocumentSymbols(incomplete);
    assert.ok(symbols.some(symbol => symbol.name === 'speed' && symbol.partial));
    assert.ok(symbols.some(symbol => symbol.name === 'move_twice' && symbol.partial));
});

test('document index is cached by model and exact source version', () => {
    const first = createDocumentIndex(source, 'cat');
    assert.equal(createDocumentIndex(source, 'cat'), first);
    assert.notEqual(createDocumentIndex(`${source}\n# changed`, 'cat'), first);
    assert.notEqual(createDocumentIndex(source, 'dog'), first);
});

test('completion is context-aware, deduplicated and range-safe', () => {
    const context = {
        targetId: 'cat',
        isStage: false,
        resources: [{
            id: 'enemy',
            name: 'Enemy',
            kind: 'actor',
            kindLabel: 'Actor',
            ownerId: 'enemy',
            ownerName: 'Enemy'
        }]
    };
    assert.deepEqual(getCompletions('actor Cat\n\n# mo', 3, 5, context), []);
    assert.ok(getCompletions('actor Cat\n\non green_flag:\n    say(\"unfinished\n    wa', 5, 7, context)
        .some(item => item.label === 'wait'));
    const commands = getCompletions('actor Cat\n\non green_flag:\n    mo', 4, 7, context);
    assert.ok(commands.some(item => item.label === 'move'));
    const portugueseCommands = getCompletions(
        'ator Gato\n\nao bandeira_verde:\n    ',
        4,
        5,
        Object.assign({}, context, {codeLanguage: 'pt-BR'})
    );
    assert.ok(portugueseCommands.some(item => item.label === 'verdadeiro'));
    assert.ok(portugueseCommands.some(item => item.label === 'e'));
    assert.equal(new Set(commands.map(item => item.id)).size, commands.length);
    assert.deepEqual(commands.find(item => item.label === 'move').range, {
        startLineNumber: 4,
        startColumn: 5,
        endLineNumber: 4,
        endColumn: 7
    });
    const beforeParenthesis = getCompletions(
        'actor Cat\n\non green_flag:\n    move(10)',
        4,
        9,
        context
    ).find(item => item.label === 'move');
    assert.equal(beforeParenthesis.insertText, 'move');
    assert.equal(beforeParenthesis.snippet, false);
    const events = getCompletions('actor Cat\n\non', 3, 3, context);
    assert.equal(
        events.find(item => item.label === 'on green_flag').insertText,
        'on green_flag:\n    ${1:wait(0)}'
    );
    assert.equal(getCompletions('actor Cat\n\n', 3, 1, context)
        .some(item => item.label === 'global variable'), false);
    const looseBlocks = getCompletions('actor Cat\n\n', 3, 1, context);
    assert.ok(looseBlocks.some(item => item.label === 'stack'));
    assert.ok(looseBlocks.some(item => item.label === 'reporter'));
    assert.ok(getCompletions('stage\n\n', 3, 1, Object.assign({}, context, {isStage: true}))
        .some(item => item.label === 'global variable'));
    const resources = getCompletions(
        'actor Cat\n\non green_flag:\n    go_to_target("En")',
        4,
        21,
        context
    );
    const enemy = resources.find(item => item.label === 'Enemy');
    assert.equal(enemy.insertText, '"Enemy"');
    assert.deepEqual(enemy.range, {
        startLineNumber: 4,
        startColumn: 18,
        endLineNumber: 4,
        endColumn: 22
    });
    assert.equal(getResourceAt(
        'actor Cat\n\non green_flag:\n    go_to_target("Enemy")',
        4,
        21,
        context
    ).id, 'enemy');
    assert.equal(getHover(
        'actor Cat\n\non green_flag:\n    go_to_target("Enemy")',
        4,
        21,
        context
    ).code, 'Enemy');

    const keyOptions = getCompletions(
        'actor Cat\n\non green_flag:\n    if key_pressed("ri"):\n        pass',
        4,
        23,
        context
    );
    assert.ok(keyOptions.some(item =>
        item.label === 'right arrow' &&
        item.insertText === '"right arrow"' &&
        item.kind === 'option'
    ));
    assert.equal(keyOptions.some(item => item.label === 'right'), false);
    assert.equal(
        getCompletions('actor Cat\n\non green_flag:\n    key_', 4, 9, context)
            .find(item => item.label === 'key_pressed').insertText,
        'key_pressed(${1:key: "space"})'
    );

    const eventKeyOptions = getCompletions(
        'actor Cat\n\non key_pressed("le"):\n    wait(0)',
        3,
        19,
        context
    );
    assert.ok(eventKeyOptions.some(item => item.label === 'left arrow'));

    const mathOptions = getCompletions(
        'actor Cat\n\non green_flag:\n    math("sq")',
        4,
        13,
        context
    );
    assert.ok(mathOptions.some(item => item.label === 'sqrt' && item.kind === 'option'));

    const colorOptions = getCompletions(
        'actor Cat\n\non green_flag:\n    touching_color("#ff")',
        4,
        24,
        context
    );
    assert.ok(colorOptions.some(item => item.label === '#ff0000' && item.kind === 'color'));
});

test('signature help tracks nested and multiline calls', () => {
    const nested = getSignatureHelp(
        'actor Cat\n\non green_flag:\n    glide_to(\n        1,\n        add(2, 3),\n        ',
        7,
        9
    );
    assert.match(nested.label, /^glide_to\(/);
    assert.equal(nested.activeParameter, 2);
    const listArgument = getSignatureHelp(
        'actor Cat\n\non green_flag:\n    glide_to([1, 2], 3, ',
        4,
        25
    );
    assert.equal(listArgument.activeParameter, 2);
    const hints = getInlayHints(
        'actor Cat\n\nprocedure turn(amount: number):\n    turn_right(amount)\n\n' +
        'on green_flag:\n    glide_to(\n        1,\n        round(2),\n        3)\n    say("glide_to(1, 2, 3)")\n    turn(90)'
    );
    assert.deepEqual(hints.map(hint => hint.label), [
        'degrees:', 'seconds:', 'x:', 'value:', 'y:', 'message:', 'amount:'
    ]);
});

test('formatter is idempotent and ignores colons inside strings and comments', () => {
    const input = 'actor Cat\non green_flag: # event\n say("value: yes")\n # comment:\n wait(1)\n';
    const once = formatText(input);
    assert.equal(formatText(once), once);
    assert.match(once, /    say\("value: yes"\)/);
    assert.match(once, /    # comment:/);
    assert.equal(
        formatText('actor Cat\non green_flag:\n\nsay("after blank")'),
        'actor Cat\non green_flag:\n\n    say("after blank")\n'
    );
    assert.equal(
        formatText('actor Cat\non green_flag:\n    if true:\n        move(10)\n    say("done")'),
        'actor Cat\non green_flag:\n    if true:\n        move(10)\n    say("done")\n'
    );
    const incompleteString = 'actor Cat\non green_flag:\n    say("unfinished)\n';
    assert.equal(formatText(incompleteString), incompleteString);
    assert.equal(
        formatText('actor Cat\n stack:\n  move(10)\n reporter x_position()'),
        'actor Cat\nstack:\n    move(10)\nreporter x_position()\n'
    );
});

test('diagnostic suggestions follow the active interface language', () => {
    assert.match(getDiagnosticSuggestion({code: 'invalid-indent'}, 'pt-BR'), /quatro espaços/);
    assert.match(getDiagnosticSuggestion({code: 'invalid-indent'}, 'en'), /four spaces/);
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
    workspace.modules[1].source = 'actor Cat\n\non green_flag:\n    say("found found")';
    assert.equal(searchWorkspace(workspace, 'found').length, 2);
    workspace.modules[1].source = 'actor Cat\n# Árvore árvore';
    assert.deepEqual(searchWorkspace(workspace, 'árvore').map(item => [item.column, item.endColumn]), [
        [3, 9],
        [10, 16]
    ]);

    const fallbackAssets = makeTarget('fallback-id', 'Fallback');
    fallbackAssets.sprite.costumes = [{name: 'before'}];
    fallbackAssets.sprite.sounds = [{name: 'before'}];
    const beforeRename = buildWorkspace({runtime: {targets: [fallbackAssets]}}).resources
        .filter(item => ['costume', 'sound'].includes(item.kind))
        .map(item => item.id);
    fallbackAssets.sprite.costumes[0].name = 'after';
    fallbackAssets.sprite.sounds[0].name = 'after';
    const afterRename = buildWorkspace({runtime: {targets: [fallbackAssets]}}).resources
        .filter(item => ['costume', 'sound'].includes(item.kind))
        .map(item => item.id);
    assert.deepEqual(afterRename, beforeRename);

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
    assert.equal(invalid.success, true);
    assert.ok(invalid.diagnostics.some(item =>
        item.code === 'missing-project-resource' && item.severity === 'warning'
    ));

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
