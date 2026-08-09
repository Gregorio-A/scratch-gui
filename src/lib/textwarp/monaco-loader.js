'use strict';

const {operatorRegistry} = require('./block-registry');
const {aliasesFor, canonicalEntries, CODE_LANGUAGES} = require('./language-registry');
const {
    formatText,
    getCompletions,
    getDefinitionLocations,
    getDiagnosticSuggestion,
    getDocumentSymbols,
    getFoldingRanges,
    getHover,
    getInlayHints,
    getReferenceLocations,
    getRenamePlan,
    getResourceAt,
    getSemanticTokens,
    getSignatureHelp,
    resolveSymbolAt
} = require('./language-service');

let monacoPromise = null;
let loaderScriptPromise = null;
const modelContexts = new WeakMap();
const languageRegistrations = new WeakMap();

const contextForModel = model => modelContexts.get(model) || {};
const setModelContext = (model, context) => {
    if (model && typeof model === 'object') {
        modelContexts.set(model, Object.assign({}, context || {}, {
            modelVersion: typeof model.getVersionId === 'function' ? model.getVersionId() : 0
        }));
    }
};
const clearModelContext = model => {
    if (model && typeof model === 'object') modelContexts.delete(model);
};

const encodedPath = value => encodeURIComponent(String(value || 'target'));
const createModelUri = (monaco, namespace, key) => monaco.Uri.parse(
    `inmemory://textwarp/${encodedPath(namespace || 'primary')}/${encodedPath(key || 'target')}.tw`
);
const uriForModelKey = (monaco, key, context = {}) => createModelUri(
    monaco,
    context.modelNamespace || context.instanceKey || 'primary',
    key
);

const asRange = (monaco, range) => new monaco.Range(
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn
);
const clampMarkerRange = (model, diagnostic) => {
    const line = Math.min(Math.max(1, diagnostic.line || 1), model.getLineCount());
    const endLine = Math.min(Math.max(line, diagnostic.endLine || line), model.getLineCount());
    const lineMaxColumn = model.getLineMaxColumn(line);
    const startColumn = Math.min(
        Math.max(1, diagnostic.column || 1),
        endLine === line && lineMaxColumn > 1 ? lineMaxColumn - 1 : lineMaxColumn
    );
    const endLineMaxColumn = model.getLineMaxColumn(endLine);
    const endColumn = Math.min(
        Math.max(endLine === line ? startColumn + 1 : 1, diagnostic.endColumn || startColumn + 1),
        endLineMaxColumn
    );
    return {line, endLine, startColumn, endColumn};
};
const markdownEscape = value => String(value || '').replace(/[\\`*_{}[\]()<>#+\-.!|]/g, '\\$&');
const completionKind = (monaco, kind) => {
    const kinds = monaco.languages.CompletionItemKind;
    return {
        boolean: kinds.Keyword,
        color: kinds.Color,
        command: kinds.Function,
        conditional: kinds.Function,
        event: kinds.Event,
        function: kinds.Function,
        keyword: kinds.Keyword,
        list: kinds.Array || kinds.Value,
        loop: kinds.Function,
        operator: kinds.Operator,
        option: kinds.EnumMember || kinds.Value,
        parameter: kinds.Variable,
        procedure: kinds.Method,
        reporter: kinds.Function,
        resource: kinds.Reference,
        snippet: kinds.Snippet,
        variable: kinds.Variable
    }[kind] || kinds.Text;
};
const symbolKind = (monaco, kind) => ({
    actor: monaco.languages.SymbolKind.Module,
    event: monaco.languages.SymbolKind.Event,
    list: monaco.languages.SymbolKind.Array,
    procedure: monaco.languages.SymbolKind.Function,
    stage: monaco.languages.SymbolKind.Module,
    variable: monaco.languages.SymbolKind.Variable
}[kind] || monaco.languages.SymbolKind.Variable);

const providerSnapshot = model => {
    const storedContext = contextForModel(model);
    return {
        context: Object.assign({}, storedContext, {modelKey: storedContext.targetId}),
        contextVersion: storedContext.modelVersion,
        version: typeof model.getVersionId === 'function' ? model.getVersionId() : 0
    };
};
const cancelledOrStale = (model, snapshot, token) => (
    token && token.isCancellationRequested ||
    typeof model.getVersionId === 'function' && model.getVersionId() !== snapshot.version ||
    contextForModel(model).modelVersion !== snapshot.contextVersion
);

const configureLanguage = monaco => {
    if (languageRegistrations.has(monaco)) return languageRegistrations.get(monaco);
    const disposables = [];
    const register = disposable => {
        if (disposable && typeof disposable.dispose === 'function') disposables.push(disposable);
        return disposable;
    };

    const localizedTokens = predicate => Array.from(new Set(
        Object.keys(canonicalEntries)
            .filter(predicate)
            .flatMap(semanticId => CODE_LANGUAGES.flatMap(language => aliasesFor(language, semanticId)))
    ));
    const keywords = localizedTokens(semanticId => /^(?:syntax|control|operator|literal|type|event)\./.test(
        semanticId
    ));
    const commands = localizedTokens(semanticId => /^function\./.test(semanticId) &&
        semanticId.split('.').length === 2
    ).concat(Object.keys(operatorRegistry));

    register(monaco.languages.register({id: 'textwarp'}));
    register(monaco.languages.setLanguageConfiguration('textwarp', {
        comments: {lineComment: '#'},
        brackets: [['(', ')'], ['[', ']']],
        autoClosingPairs: [
            {open: '"', close: '"', notIn: ['string', 'comment']},
            {open: "'", close: "'", notIn: ['string', 'comment']},
            {open: '(', close: ')', notIn: ['string', 'comment']},
            {open: '[', close: ']', notIn: ['string', 'comment']}
        ],
        surroundingPairs: [
            {open: '"', close: '"'},
            {open: "'", close: "'"},
            {open: '(', close: ')'},
            {open: '[', close: ']'}
        ],
        indentationRules: {
            increaseIndentPattern: /:\s*(?:#.*)?$/,
            decreaseIndentPattern: /^\s*(?:(?:else|sen[aã]o)|(?:branch|ramo)\s+\d+)\s*:/i
        },
        onEnterRules: [{
            beforeText: /:\s*(?:#.*)?$/,
            action: {indentAction: monaco.languages.IndentAction.Indent}
        }, {
            beforeText: /^\s*(?:(?:else|sen[aã]o)|(?:branch|ramo)\s+\d+)\s*:\s*(?:#.*)?$/i,
            action: {indentAction: monaco.languages.IndentAction.Indent}
        }]
    }));
    register(monaco.languages.setMonarchTokensProvider('textwarp', {
        ignoreCase: true,
        keywords,
        commands,
        tokenizer: {
            root: [
                [/#.*$/, 'comment'],
                [/[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*(?:\.[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*)*/, {
                    cases: {
                        '@keywords': 'keyword',
                        '@commands': 'type.identifier',
                        '@default': 'identifier'
                    }
                }],
                [/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i, 'number'],
                [/"([^"\\]|\\.)*$/, 'string.invalid'],
                [/'([^'\\]|\\.)*$/, 'string.invalid'],
                [/"/, 'string', '@doubleQuotedString'],
                [/'/, 'string', '@singleQuotedString'],
                [/[()[\]:,]/, 'delimiter'],
                [/[+\-*\/%<>=!]+/, 'operator']
            ],
            doubleQuotedString: [
                [/[^\\"]+/, 'string'],
                [/\\./, 'string.escape'],
                [/"/, 'string', '@pop']
            ],
            singleQuotedString: [
                [/[^\\']+/, 'string'],
                [/\\./, 'string.escape'],
                [/'/, 'string', '@pop']
            ]
        }
    }));

    register(monaco.languages.registerCompletionItemProvider('textwarp', {
        triggerCharacters: ['(', ',', '.', '"', "'"],
        provideCompletionItems: (model, position, completionContext, token) => {
            const snapshot = providerSnapshot(model);
            const suggestions = getCompletions(
                model.getValue(),
                position.lineNumber,
                position.column,
                snapshot.context
            );
            if (cancelledOrStale(model, snapshot, token)) return {suggestions: []};
            return {
                incomplete: false,
                suggestions: suggestions.map(item => ({
                    label: item.label,
                    filterText: item.filterText || item.label,
                    kind: completionKind(monaco, item.kind),
                    detail: item.detail,
                    documentation: item.documentation,
                    insertText: item.insertText,
                    insertTextRules: item.snippet ?
                        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                    range: asRange(monaco, item.range),
                    sortText: item.sortText
                }))
            };
        }
    }));

    register(monaco.languages.registerHoverProvider('textwarp', {
        provideHover: (model, position, token) => {
            const snapshot = providerSnapshot(model);
            const hover = getHover(
                model.getValue(),
                position.lineNumber,
                position.column,
                snapshot.context
            );
            if (!hover || cancelledOrStale(model, snapshot, token)) return null;
            return {
                range: asRange(monaco, hover.range),
                contents: [
                    {value: `**${markdownEscape(hover.title)}**`, isTrusted: false},
                    {value: markdownEscape(hover.code), isTrusted: false},
                    {value: markdownEscape(hover.documentation), isTrusted: false}
                ]
            };
        }
    }));

    register(monaco.languages.registerDocumentSymbolProvider('textwarp', {
        provideDocumentSymbols: (model, token) => {
            const snapshot = providerSnapshot(model);
            const symbols = getDocumentSymbols(model.getValue(), {
                modelKey: snapshot.context.targetId
            }).map(symbol => ({
                name: symbol.name,
                detail: symbol.detail,
                kind: symbolKind(monaco, symbol.kind),
                range: asRange(monaco, symbol.fullRange || symbol.range),
                selectionRange: asRange(monaco, symbol.range),
                children: []
            }));
            return cancelledOrStale(model, snapshot, token) ? [] : symbols;
        }
    }));

    register(monaco.languages.registerDefinitionProvider('textwarp', {
        provideDefinition: (model, position, token) => {
            const snapshot = providerSnapshot(model);
            const context = snapshot.context;
            const locations = getDefinitionLocations(
                model.getValue(),
                position.lineNumber,
                position.column,
                context
            );
            const resource = getResourceAt(
                model.getValue(),
                position.lineNumber,
                position.column,
                context
            );
            if (resource && resource.ownerId) locations.push({
                modelKey: resource.ownerId,
                range: {startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1}
            });
            if (cancelledOrStale(model, snapshot, token)) return [];
            return locations.map(location => ({
                uri: uriForModelKey(monaco, location.modelKey, context),
                range: asRange(monaco, location.range)
            })).filter(location => Boolean(monaco.editor.getModel(location.uri)));
        }
    }));

    register(monaco.languages.registerReferenceProvider('textwarp', {
        provideReferences: (model, position, referenceContext, token) => {
            const snapshot = providerSnapshot(model);
            const context = snapshot.context;
            const locations = getReferenceLocations(
                model.getValue(),
                position.lineNumber,
                position.column,
                context
            );
            if (cancelledOrStale(model, snapshot, token)) return [];
            return locations.map(location => ({
                uri: uriForModelKey(monaco, location.modelKey, context),
                range: asRange(monaco, location.range)
            })).filter(location => Boolean(monaco.editor.getModel(location.uri)));
        }
    }));

    register(monaco.languages.registerRenameProvider('textwarp', {
        resolveRenameLocation: (model, position, token) => {
            const snapshot = providerSnapshot(model);
            const context = snapshot.context;
            const resolved = resolveSymbolAt(
                model.getValue(),
                position.lineNumber,
                position.column,
                context
            );
            const plan = getRenamePlan(
                model.getValue(),
                position.lineNumber,
                position.column,
                resolved ? resolved.symbol.name : '',
                context
            );
            if (cancelledOrStale(model, snapshot, token)) {
                return {rejectReason: 'The document changed while rename was being prepared.'};
            }
            if (!resolved || plan.rejectReason) return {
                rejectReason: plan.rejectReason || 'The selected symbol cannot be renamed.'
            };
            return {text: resolved.symbol.name, range: asRange(monaco, {
                startLineNumber: resolved.token.line,
                startColumn: resolved.token.column,
                endLineNumber: resolved.token.line,
                endColumn: resolved.token.endColumn
            })};
        },
        provideRenameEdits: (model, position, newName, token) => {
            const snapshot = providerSnapshot(model);
            const context = snapshot.context;
            const plan = getRenamePlan(
                model.getValue(),
                position.lineNumber,
                position.column,
                newName,
                context
            );
            if (plan.rejectReason) return {rejectReason: plan.rejectReason, edits: []};
            if (cancelledOrStale(model, snapshot, token)) return {edits: []};
            return {
                edits: plan.edits.map(edit => {
                    const resource = uriForModelKey(monaco, edit.modelKey, context);
                    const documentModel = monaco.editor.getModel(resource);
                    return {
                        resource,
                        textEdit: {range: asRange(monaco, edit.range), text: edit.text},
                        versionId: documentModel ? documentModel.getVersionId() : undefined
                    };
                }).filter(edit => typeof edit.versionId === 'number')
            };
        }
    }));

    register(monaco.languages.registerDocumentFormattingEditProvider('textwarp', {
        provideDocumentFormattingEdits: (model, options, token) => {
            const snapshot = providerSnapshot(model);
            const formatted = formatText(model.getValue(), snapshot.context);
            if (cancelledOrStale(model, snapshot, token) || formatted === model.getValue()) return [];
            return [{
                range: model.getFullModelRange(),
                text: formatted
            }];
        }
    }));

    register(monaco.languages.registerSignatureHelpProvider('textwarp', {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [','],
        provideSignatureHelp: (model, position, token) => {
            const snapshot = providerSnapshot(model);
            const result = getSignatureHelp(
                model.getValue(),
                position.lineNumber,
                position.column,
                snapshot.context
            );
            if (!result || cancelledOrStale(model, snapshot, token)) return null;
            return {
                value: {
                    signatures: result.signatures || [{
                        label: result.label,
                        documentation: result.documentation,
                        parameters: result.parameters
                    }],
                    activeSignature: result.activeSignature || 0,
                    activeParameter: result.activeParameter
                },
                dispose: () => {}
            };
        }
    }));

    register(monaco.languages.registerDocumentHighlightProvider('textwarp', {
        provideDocumentHighlights: (model, position, token) => {
            const snapshot = providerSnapshot(model);
            const highlights = getReferenceLocations(
                model.getValue(),
                position.lineNumber,
                position.column,
                snapshot.context
            ).filter(location => location.modelKey === snapshot.context.targetId).map(location => ({
                range: asRange(monaco, location.range),
                kind: monaco.languages.DocumentHighlightKind.Read
            }));
            return cancelledOrStale(model, snapshot, token) ? [] : highlights;
        }
    }));

    register(monaco.languages.registerFoldingRangeProvider('textwarp', {
        provideFoldingRanges: (model, foldingContext, token) => {
            const snapshot = providerSnapshot(model);
            const ranges = getFoldingRanges(model.getValue()).map(range => ({
                start: range.start,
                end: range.end,
                kind: monaco.languages.FoldingRangeKind.Region
            }));
            return cancelledOrStale(model, snapshot, token) ? [] : ranges;
        }
    }));

    register(monaco.languages.registerSelectionRangeProvider('textwarp', {
        provideSelectionRanges: (model, positions, token) => {
            const snapshot = providerSnapshot(model);
            const ranges = positions.map(position => {
                const word = model.getWordAtPosition(position);
                const lineRange = {
                    startLineNumber: position.lineNumber,
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: model.getLineMaxColumn(position.lineNumber)
                };
                return {
                    range: word ? new monaco.Range(
                        position.lineNumber,
                        word.startColumn,
                        position.lineNumber,
                        word.endColumn
                    ) : asRange(monaco, lineRange),
                    parent: {range: asRange(monaco, lineRange)}
                };
            });
            return cancelledOrStale(model, snapshot, token) ? [] : ranges;
        }
    }));

    const semanticLegend = {
        tokenTypes: ['namespace', 'event', 'function', 'parameter', 'variable'],
        tokenModifiers: ['declaration']
    };
    register(monaco.languages.registerDocumentSemanticTokensProvider('textwarp', {
        getLegend: () => semanticLegend,
        provideDocumentSemanticTokens: (model, lastResultId, token) => {
            const snapshot = providerSnapshot(model);
            const tokens = getSemanticTokens(model.getValue(), snapshot.context).sort((left, right) =>
                left.line - right.line || left.column - right.column
            );
            const data = [];
            let previousLine = 0;
            let previousColumn = 0;
            tokens.forEach(item => {
                const line = item.line - 1;
                const column = item.column - 1;
                const deltaLine = line - previousLine;
                const deltaColumn = deltaLine === 0 ? column - previousColumn : column;
                data.push(
                    deltaLine,
                    deltaColumn,
                    item.length,
                    semanticLegend.tokenTypes.indexOf(item.type),
                    item.declaration ? 1 : 0
                );
                previousLine = line;
                previousColumn = column;
            });
            if (cancelledOrStale(model, snapshot, token)) {
                return {data: new Uint32Array(0), resultId: String(snapshot.version)};
            }
            return {data: new Uint32Array(data), resultId: String(model.getVersionId())};
        },
        releaseDocumentSemanticTokens: () => {}
    }));

    register(monaco.languages.registerInlayHintsProvider('textwarp', {
        provideInlayHints: (model, range, token) => {
            if (token && token.isCancellationRequested) return {hints: [], dispose: () => {}};
            const snapshot = providerSnapshot(model);
            const hints = getInlayHints(model.getValue(), snapshot.context).filter(hint =>
                hint.line >= range.startLineNumber && hint.line <= range.endLineNumber
            ).map(hint => ({
                position: {lineNumber: hint.line, column: hint.column},
                label: hint.label,
                kind: monaco.languages.InlayHintKind.Parameter,
                paddingRight: true
            }));
            if (cancelledOrStale(model, snapshot, token)) return {hints: [], dispose: () => {}};
            return {
                hints,
                dispose: () => {}
            };
        }
    }));

    register(monaco.languages.registerCodeActionProvider('textwarp', {
        providedCodeActionKinds: ['quickfix'],
        provideCodeActions: (model, range, actionContext, token) => {
            const snapshot = providerSnapshot(model);
            const locale = snapshot.context.locale || 'en';
            const actions = (actionContext.markers || []).map(marker => {
                const suggestion = getDiagnosticSuggestion({code: marker.code}, locale);
                if (!suggestion) return null;
                const format = /indent/.test(String(marker.code || ''));
                return {
                    title: suggestion,
                    kind: 'quickfix',
                    diagnostics: [marker],
                    isPreferred: format,
                    command: {
                        id: format ? 'editor.action.formatDocument' : 'editor.action.triggerSuggest',
                        title: suggestion
                    }
                };
            }).filter(Boolean);
            return {
                actions: cancelledOrStale(model, snapshot, token) ? [] : actions,
                dispose: () => {}
            };
        }
    }));

    const registration = {
        dispose: () => {
            disposables.splice(0).forEach(disposable => disposable.dispose());
            languageRegistrations.delete(monaco);
        },
        disposables
    };
    languageRegistrations.set(monaco, registration);
    return registration;
};

const monacoBaseUrl = documentObject => new URL(
    'static/monaco/vs',
    documentObject.baseURI
).href.replace(/\/$/, '');

const ensureLoaderScript = (documentObject, baseUrl) => {
    if (loaderScriptPromise) return loaderScriptPromise;
    loaderScriptPromise = new Promise((resolve, reject) => {
        const selector = 'script[data-textwarp-monaco-loader="true"]';
        const existing = documentObject.querySelector && documentObject.querySelector(selector);
        const script = existing || documentObject.createElement('script');
        const finish = () => {
            if (script.dataset) script.dataset.loaded = 'true';
            resolve();
        };
        const fail = () => {
            loaderScriptPromise = null;
            if (typeof script.remove === 'function') script.remove();
            else if (script.parentNode) script.parentNode.removeChild(script);
            reject(new Error(`Could not load ${script.src}.`));
        };
        if (existing && existing.dataset.loaded === 'true') {
            finish();
            return;
        }
        if (script.addEventListener) {
            script.addEventListener('load', finish, {once: true});
            script.addEventListener('error', fail, {once: true});
        } else {
            script.onload = finish;
            script.onerror = fail;
        }
        if (!existing) {
            script.dataset.textwarpMonacoLoader = 'true';
            script.src = `${baseUrl}/loader.js`;
            documentObject.head.appendChild(script);
        }
    });
    return loaderScriptPromise;
};

const loadMonaco = () => {
    if (monacoPromise) return monacoPromise;
    monacoPromise = Promise.resolve().then(() => {
        if (window.monaco && window.monaco.editor) return window.monaco;
        const baseUrl = monacoBaseUrl(document);
        return ensureLoaderScript(document, baseUrl).then(() => new Promise((resolve, reject) => {
            const amdRequire = window.require;
            if (!amdRequire || typeof amdRequire.config !== 'function') {
                reject(new Error('The Monaco AMD loader was not initialized.'));
                return;
            }
            amdRequire.config({paths: {vs: baseUrl}});
            amdRequire(['vs/editor/editor.main'], () => {
                if (!window.monaco || !window.monaco.editor) {
                    reject(new Error('Monaco loaded without exposing its editor API.'));
                    return;
                }
                resolve(window.monaco);
            }, reject);
        }));
    }).then(monaco => {
        configureLanguage(monaco);
        return monaco;
    }).catch(error => {
        monacoPromise = null;
        throw error;
    });
    return monacoPromise;
};

const retryMonaco = () => {
    monacoPromise = null;
    return loadMonaco();
};

const resetMonacoForTests = monaco => {
    const registration = monaco && languageRegistrations.get(monaco);
    if (registration) registration.dispose();
    monacoPromise = null;
    loaderScriptPromise = null;
};

module.exports = {
    clearModelContext,
    clampMarkerRange,
    configureLanguage,
    contextForModel,
    createModelUri,
    loadMonaco,
    monacoBaseUrl,
    resetMonacoForTests,
    retryMonaco,
    setModelContext,
    uriForModelKey
};
