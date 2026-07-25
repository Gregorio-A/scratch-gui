'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    clampMarkerRange,
    configureLanguage,
    createModelUri,
    loadMonaco,
    monacoBaseUrl,
    resetMonacoForTests,
    setModelContext,
    uriForModelKey
} = require('../../src/lib/textwarp/monaco-loader');
const {parseKeybinding} = require('../../src/lib/textwarp/shortcut-service');

const disposable = () => ({dispose: () => {}});

const makeMonaco = () => {
    const providers = {};
    const languages = {
        CompletionItemKind: {
            Array: 1,
            Event: 2,
            Function: 3,
            Keyword: 4,
            Method: 5,
            Operator: 6,
            Reference: 7,
            Snippet: 8,
            Text: 9,
            Value: 10,
            Variable: 11
        },
        CompletionItemInsertTextRule: {InsertAsSnippet: 4},
        DocumentHighlightKind: {Read: 1},
        FoldingRangeKind: {Region: 1},
        IndentAction: {Indent: 1},
        InlayHintKind: {Parameter: 1},
        SymbolKind: {Array: 1, Event: 2, Function: 3, Module: 4, Variable: 5},
        register: () => disposable(),
        setLanguageConfiguration: (id, configuration) => {
            languages.configuration = configuration;
            return disposable();
        },
        setMonarchTokensProvider: (id, monarch) => {
            languages.monarch = monarch;
            return disposable();
        }
    };
    [
        'CompletionItem',
        'Hover',
        'DocumentSymbol',
        'Definition',
        'Reference',
        'Rename',
        'DocumentFormattingEdit',
        'SignatureHelp',
        'DocumentHighlight',
        'FoldingRange',
        'SelectionRange',
        'DocumentSemanticTokens',
        'InlayHints',
        'CodeAction'
    ].forEach(name => {
        languages[`register${name}Provider`] = (selector, provider) => {
            if (!providers[name]) providers[name] = [];
            providers[name].push(provider);
            return disposable();
        };
    });
    const models = new Map();
    class Range {
        constructor (startLineNumber, startColumn, endLineNumber, endColumn) {
            Object.assign(this, {startLineNumber, startColumn, endLineNumber, endColumn});
        }
    }
    return {
        Range,
        Uri: {parse: value => ({toString: () => value, value})},
        editor: {
            getModel: uri => models.get(uri.toString()) || null,
            models
        },
        languages,
        providers
    };
};

test('model URI construction is shared by models and provider locations', () => {
    const monaco = makeMonaco();
    const context = {
        instanceKey: 'secondary',
        modelNamespace: 'secondary:project-a'
    };
    assert.equal(
        createModelUri(monaco, 'secondary:project-a', 'sprite/id').toString(),
        uriForModelKey(monaco, 'sprite/id', context).toString()
    );
    assert.equal(
        createModelUri(monaco, 'secondary:project-a', 'sprite/id').toString(),
        'inmemory://textwarp/secondary%3Aproject-a/sprite%2Fid.tw'
    );
});

test('language registration is idempotent and has one completion provider', () => {
    const monaco = makeMonaco();
    const first = configureLanguage(monaco);
    const second = configureLanguage(monaco);
    assert.equal(first, second);
    assert.equal(monaco.providers.CompletionItem.length, 1);
    assert.equal(monaco.providers.Definition.length, 1);
    assert.equal(monaco.providers.DocumentSemanticTokens.length, 1);
    assert.match('else:', monaco.languages.configuration.indentationRules.decreaseIndentPattern);
    assert.match('branch 2:', monaco.languages.configuration.indentationRules.decreaseIndentPattern);
    assert.ok(monaco.languages.monarch.keywords.includes('actor'));
    assert.ok(monaco.languages.monarch.commands.includes('move'));
    first.dispose();
    resetMonacoForTests(monaco);
});

test('cross-file definition and rename providers return loaded workspace models', async () => {
    const monaco = makeMonaco();
    configureLanguage(monaco);
    const stageSource = 'stage\n\nglobal variable score = 0\n';
    const catSource = 'actor Cat\n\non green_flag:\n    score += 1\n';
    const context = {
        instanceKey: 'primary',
        targetId: 'cat',
        documents: [
            {modelKey: 'stage', source: stageSource},
            {modelKey: 'cat', source: catSource}
        ]
    };
    const model = (key, source) => ({
        uri: createModelUri(monaco, 'primary', key),
        getValue: () => source,
        getVersionId: () => 1
    });
    const stageModel = model('stage', stageSource);
    const catModel = model('cat', catSource);
    monaco.editor.models.set(stageModel.uri.toString(), stageModel);
    monaco.editor.models.set(catModel.uri.toString(), catModel);
    setModelContext(catModel, context);
    const definition = await monaco.providers.Definition[0].provideDefinition(
        catModel,
        {lineNumber: 4, column: 5},
        {isCancellationRequested: false}
    );
    assert.equal(definition.length, 1);
    assert.equal(definition[0].uri.toString(), stageModel.uri.toString());
    const rename = await monaco.providers.Rename[0].provideRenameEdits(
        catModel,
        {lineNumber: 4, column: 5},
        'points',
        {isCancellationRequested: false}
    );
    assert.equal(rename.edits.length, 2);
    assert.ok(rename.edits.every(edit => monaco.editor.getModel(edit.resource)));
    resetMonacoForTests(monaco);
});

test('marker ranges are clamped to the current Monaco model', () => {
    const model = {
        getLineCount: () => 2,
        getLineMaxColumn: line => line === 1 ? 4 : 1
    };
    assert.deepEqual(clampMarkerRange(model, {
        line: 99,
        column: 99,
        endLine: 120,
        endColumn: 120
    }), {
        line: 2,
        endLine: 2,
        startColumn: 1,
        endColumn: 1
    });
    assert.deepEqual(clampMarkerRange({
        getLineCount: () => 1,
        getLineMaxColumn: () => 6
    }, {
        line: 1,
        column: 99,
        endLine: 1,
        endColumn: 99
    }), {
        line: 1,
        endLine: 1,
        startColumn: 5,
        endColumn: 6
    });
});

test('providers discard cancelled requests and shortcuts use the complete Monaco key map', () => {
    const monaco = makeMonaco();
    configureLanguage(monaco);
    const source = 'actor Cat\n\non green_flag:\n    mo';
    const model = {
        uri: createModelUri(monaco, 'primary', 'cat'),
        getValue: () => source,
        getVersionId: () => 1
    };
    setModelContext(model, {instanceKey: 'primary', targetId: 'cat'});
    assert.deepEqual(monaco.providers.CompletionItem[0].provideCompletionItems(
        model,
        {lineNumber: 4, column: 7},
        {},
        {isCancellationRequested: true}
    ), {suggestions: []});

    monaco.KeyMod = {CtrlCmd: 1 << 11, Shift: 1 << 10, Alt: 1 << 9};
    monaco.KeyCode = {
        Enter: 3,
        Digit7: 28,
        KeyI: 39,
        F7: 65,
        Equal: 86,
        LeftArrow: 15
    };
    assert.equal(
        parseKeybinding(monaco, 'Ctrl+Shift+I', 0),
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI
    );
    assert.equal(
        parseKeybinding(monaco, 'Ctrl++', 0),
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal
    );
    assert.equal(parseKeybinding(monaco, 'Alt+Left', 0), monaco.KeyMod.Alt | monaco.KeyCode.LeftArrow);
    let invalid = null;
    const previousWarn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(parseKeybinding(monaco, 'Ctrl+NoSuchKey', 123, value => {
            invalid = value;
        }), 123);
    } finally {
        console.warn = previousWarn;
    }
    assert.equal(invalid, 'Ctrl+NoSuchKey');
    resetMonacoForTests(monaco);
});

test('Monaco base URL follows a nested deployment base URI', () => {
    assert.equal(
        monacoBaseUrl({baseURI: 'https://example.com/apps/textwarp/index.html'}),
        'https://example.com/apps/textwarp/static/monaco/vs'
    );
});

test('concurrent Monaco loads share one validated AMD loader request', async () => {
    const previousWindow = global.window;
    const previousDocument = global.document;
    const monaco = makeMonaco();
    let appended = 0;
    let loaderScript = null;
    try {
        global.window = {
            require: Object.assign((modules, resolve) => {
                global.window.monaco = monaco;
                resolve();
            }, {config: () => {}})
        };
        global.document = {
            baseURI: 'https://example.com/textwarp/',
            createElement: () => {
                const listeners = {};
                loaderScript = {
                    dataset: {},
                    addEventListener: (name, listener) => {
                        listeners[name] = listener;
                    },
                    listeners,
                    src: ''
                };
                return loaderScript;
            },
            querySelector: () => loaderScript,
            head: {
                appendChild: script => {
                    appended++;
                    setImmediate(() => script.listeners.load());
                }
            }
        };
        const [first, second] = await Promise.all([loadMonaco(), loadMonaco()]);
        assert.equal(first, monaco);
        assert.equal(second, monaco);
        assert.equal(appended, 1);
    } finally {
        resetMonacoForTests(monaco);
        global.window = previousWindow;
        global.document = previousDocument;
    }
});

test('a failed AMD validation can be retried without duplicating the loader script', async () => {
    const previousWindow = global.window;
    const previousDocument = global.document;
    const monaco = makeMonaco();
    let appended = 0;
    let loaderScript = null;
    try {
        global.window = {require: () => {}};
        global.document = {
            baseURI: 'https://example.com/textwarp/',
            createElement: () => {
                const listeners = {};
                loaderScript = {
                    dataset: {},
                    addEventListener: (name, listener) => {
                        listeners[name] = listener;
                    },
                    listeners,
                    src: ''
                };
                return loaderScript;
            },
            querySelector: () => loaderScript,
            head: {
                appendChild: script => {
                    appended++;
                    setImmediate(() => script.listeners.load());
                }
            }
        };
        await assert.rejects(loadMonaco(), /AMD loader/);
        global.window.require = Object.assign((modules, resolve) => {
            global.window.monaco = monaco;
            resolve();
        }, {config: () => {}});
        assert.equal(await loadMonaco(), monaco);
        assert.equal(appended, 1);
    } finally {
        resetMonacoForTests(monaco);
        global.window = previousWindow;
        global.document = previousDocument;
    }
});

test('a failed loader request is removed and retried with a fresh script', async () => {
    const previousWindow = global.window;
    const previousDocument = global.document;
    const monaco = makeMonaco();
    let appended = 0;
    let loaderScript = null;
    try {
        global.window = {
            require: Object.assign((modules, resolve) => {
                global.window.monaco = monaco;
                resolve();
            }, {config: () => {}})
        };
        global.document = {
            baseURI: 'https://example.com/textwarp/',
            createElement: () => {
                const listeners = {};
                const script = {
                    dataset: {},
                    addEventListener: (name, listener) => {
                        listeners[name] = listener;
                    },
                    listeners,
                    remove: () => {
                        if (loaderScript === script) loaderScript = null;
                    },
                    src: ''
                };
                return script;
            },
            querySelector: () => loaderScript,
            head: {
                appendChild: script => {
                    appended++;
                    loaderScript = script;
                    setImmediate(() => script.listeners[appended === 1 ? 'error' : 'load']());
                }
            }
        };
        await assert.rejects(loadMonaco(), /Could not load/);
        assert.equal(loaderScript, null);
        assert.equal(await loadMonaco(), monaco);
        assert.equal(appended, 2);
    } finally {
        resetMonacoForTests(monaco);
        global.window = previousWindow;
        global.document = previousDocument;
    }
});
