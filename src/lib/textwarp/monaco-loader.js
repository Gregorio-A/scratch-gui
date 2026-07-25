'use strict';

const {blockRegistry, controlRegistry, eventRegistry} = require('./block-registry');
const {
    findDefinitions,
    findReferences,
    formatText,
    getCompletions,
    getDocumentSymbols,
    getHover,
    getParameterScopes,
    getSignatureHelp,
    renameEdits
} = require('./language-service');

let monacoPromise = null;
let languageRegistered = false;
const modelContexts = new Map();

const modelKey = modelOrUri => String(modelOrUri && (modelOrUri.uri || modelOrUri));
const getModelContext = model => modelContexts.get(modelKey(model)) || {};
const setModelContext = (modelOrUri, context) => modelContexts.set(modelKey(modelOrUri), context || {});
const clearModelContext = modelOrUri => modelContexts.delete(modelKey(modelOrUri));

const asRange = (monaco, range) => new monaco.Range(
    range.startLineNumber,
    range.startColumn,
    range.endLineNumber,
    range.endColumn
);
const uriForModelKey = (monaco, key) => monaco.Uri.parse(`inmemory://textwarp/${encodeURIComponent(key || 'target')}.tw`);
const documentsForSymbol = (model, name, line) => {
    const context = getModelContext(model);
    const documents = context.documents || [];
    const parameter = getParameterScopes(model.getValue()).some(item =>
        item.name === name && line >= item.startLine && line <= item.endLine
    );
    if (parameter) return [{modelKey: context.targetId, source: model.getValue()}];
    const globalDefinition = documents.some(document => getDocumentSymbols(document.source).some(symbol =>
        symbol.name === name && symbol.global
    ));
    return globalDefinition ? documents : [{modelKey: context.targetId, source: model.getValue()}];
};
const isGlobalSymbol = (model, name, line) => documentsForSymbol(model, name, line).some(document =>
    getDocumentSymbols(document.source).some(symbol => symbol.name === name && symbol.global)
);

const configureLanguage = monaco => {
    if (languageRegistered) return;
    languageRegistered = true;
    monaco.languages.register({id: 'textwarp'});
    monaco.languages.setLanguageConfiguration('textwarp', {
        comments: {lineComment: '#'},
        brackets: [['(', ')'], ['[', ']']],
        autoClosingPairs: [
            {open: '"', close: '"'},
            {open: "'", close: "'"},
            {open: '(', close: ')'},
            {open: '[', close: ']'}
        ],
        indentationRules: {
            increaseIndentPattern: /:\s*(?:#.*)?$/,
            decreaseIndentPattern: /^\s*$/
        }
    });
    monaco.languages.setMonarchTokensProvider('textwarp', {
        keywords: [
            'actor', 'stage', 'on', 'global', 'variable', 'list', 'procedure',
            'if', 'else', 'repeat', 'repeat_until', 'while', 'forever',
            'return', 'warp', 'branch', 'pass', 'any', 'number', 'string', 'boolean',
            'and', 'or', 'not', 'true', 'false'
        ].concat(Object.keys(eventRegistry)),
        commands: Object.keys(blockRegistry),
        tokenizer: {
            root: [
                [/#.*$/, 'comment'],
                [/[a-zA-Z_][\w]*/, {
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
    });
    monaco.languages.registerCompletionItemProvider('textwarp', {
        provideCompletionItems: model => {
            const context = getModelContext(model);
            const availableHere = metadata => !(
                context.isStage && metadata.allowStage === false ||
                !context.isStage && metadata.allowSprite === false
            );
            const snippet = monaco.languages.CompletionItemKind.Snippet;
            const suggestions = [
                {
                    label: 'repeat',
                    kind: snippet,
                    documentation: controlRegistry.repeat.documentation,
                    insertText: 'repeat(${1:10}):\n    ${2:move(10)}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                },
                {
                    label: 'forever',
                    kind: snippet,
                    documentation: controlRegistry.forever.documentation,
                    insertText: 'forever:\n    ${1:move(10)}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                },
                {
                    label: 'repeat_until',
                    kind: snippet,
                    documentation: controlRegistry.repeat_until.documentation,
                    insertText: 'repeat_until(${1:true}):\n    ${2:wait(0)}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                },
                {
                    label: 'while',
                    kind: snippet,
                    documentation: controlRegistry.while.documentation,
                    insertText: 'while(${1:true}):\n    ${2:wait(0)}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                },
                {
                    label: 'if',
                    kind: snippet,
                    documentation: 'Condição com ramificações opcionais.',
                    insertText: 'if ${1:key_pressed("space")}:\n    ${2:say("sim")}\nelse:\n    ${3:say("não")}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                },
                {
                    label: 'procedure',
                    kind: snippet,
                    documentation: 'Declara um procedimento local do ator.',
                    insertText: 'procedure ${1:name}(${2:amount: number}):\n    ${3:change_x(amount)}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                },
                {
                    label: 'procedure com retorno',
                    kind: snippet,
                    documentation: 'Declara um procedimento repórter; acrescente warp para executar sem atualização de tela.',
                    insertText: 'procedure ${1:name}(${2:value: number}) -> ${3:number}:\n    return ${4:value}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                },
                {
                    label: 'variable',
                    kind: snippet,
                    documentation: 'Declara uma variável.',
                    insertText: 'variable ${1:name} = ${2:0}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                },
                {
                    label: 'list',
                    kind: snippet,
                    documentation: 'Declara uma lista.',
                    insertText: 'list ${1:items} = [${2}]',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                }
            ];
            Object.entries(eventRegistry).forEach(([name, metadata]) => {
                if (!availableHere(metadata)) return;
                const examples = (metadata.arguments || []).map((argument, index) =>
                    `\${${index + 1}:${argument.name === 'value' ? '10' : '"value"'}}`
                );
                suggestions.push({
                    label: `on ${name}`,
                    kind: snippet,
                    documentation: metadata.documentation,
                    insertText: `on ${name}${examples.length ? `(${examples.join(', ')})` : ''}:\n    \${${examples.length + 1}:wait(0)}`,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                });
            });
            Object.entries(blockRegistry).forEach(([name, metadata]) => {
                if (!availableHere(metadata)) return;
                const placeholders = metadata.arguments.map((argument, index) => {
                    const example = argument.role === 'list' ? 'items' : argument.role === 'variable' ? 'value' :
                        argument.valueType === 'boolean' ? 'true' :
                            argument.valueType === 'string' || ['menu', 'broadcast', 'field'].includes(argument.role) ?
                                '"value"' : argument.name === 'seconds' ? '1' : '10';
                    return `\${${index + 1}:${example}}`;
                });
                const bodyPlaceholder = placeholders.length + 1;
                let insertText = `${name}(${placeholders.join(', ')})`;
                if (['conditional', 'loop'].includes(metadata.kind)) {
                    insertText += `:\n    \${${bodyPlaceholder}:wait(0)}`;
                    for (let branch = 2; branch <= Math.max(1, Number(metadata.branchCount) || 1); branch++) {
                        insertText += `\nbranch ${branch}:\n    \${${bodyPlaceholder + branch - 1}:wait(0)}`;
                    }
                }
                suggestions.push({
                    label: name,
                    kind: monaco.languages.CompletionItemKind.Function,
                    documentation: metadata.documentation,
                    insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                });
            });
            Object.values(context.extensionCatalog || {}).forEach(metadata => {
                if (!availableHere(metadata)) return;
                const placeholders = (metadata.arguments || []).map((argument, index) => {
                    const example = argument.valueType === 'number' ? '1' :
                        argument.valueType === 'boolean' ? 'true' : '"value"';
                    return `\${${index + 1}:${example}}`;
                });
                const bodyPlaceholder = placeholders.length + 1;
                let insertText = `${metadata.canonicalName}(${placeholders.join(', ')})`;
                if (metadata.kind === 'hat' || metadata.kind === 'event') {
                    insertText = `on ${insertText}:\n    \${${bodyPlaceholder}:wait(0)}`;
                } else if (['conditional', 'loop'].includes(metadata.kind)) {
                    insertText += `:\n    \${${bodyPlaceholder}:wait(0)}`;
                    for (let branch = 2; branch <= Math.max(1, Number(metadata.branchCount) || 1); branch++) {
                        insertText += `\nbranch ${branch}:\n    \${${bodyPlaceholder + branch - 1}:wait(0)}`;
                    }
                }
                suggestions.push({
                    label: metadata.canonicalName,
                    kind: metadata.kind === 'hat' || metadata.kind === 'event' ? snippet :
                        monaco.languages.CompletionItemKind.Function,
                    documentation: metadata.documentation,
                    insertText,
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
                });
            });
            return {suggestions};
        }
    });
    monaco.languages.registerCompletionItemProvider('textwarp', {
        triggerCharacters: ['(', ',', '.'],
        provideCompletionItems: (model, position) => ({
            suggestions: getCompletions(
                model.getValue(),
                position.lineNumber,
                position.column,
                getModelContext(model)
            ).map(item => ({
                label: item.label,
                kind: item.kind === 'procedure' ? monaco.languages.CompletionItemKind.Method :
                    item.kind === 'variable' ? monaco.languages.CompletionItemKind.Variable :
                        item.kind === 'list' ? monaco.languages.CompletionItemKind.Value :
                            item.kind === 'resource' ? monaco.languages.CompletionItemKind.Reference :
                                monaco.languages.CompletionItemKind.Text,
                detail: item.detail,
                documentation: item.documentation,
                insertText: item.insertText,
                sortText: item.sortText
            }))
        })
    });
    monaco.languages.registerHoverProvider('textwarp', {
        provideHover: (model, position) => {
            const hover = getHover(model.getValue(), position.lineNumber, position.column, getModelContext(model));
            if (!hover) return null;
            return {
                range: asRange(monaco, hover.range),
                contents: [
                    {value: `**${hover.title}**`},
                    {value: `\`\`\`textwarp\n${hover.code}\n\`\`\``},
                    {value: hover.documentation}
                ]
            };
        }
    });
    monaco.languages.registerDocumentSymbolProvider('textwarp', {
        provideDocumentSymbols: model => getDocumentSymbols(model.getValue()).map(symbol => ({
            name: symbol.name,
            detail: symbol.detail,
            kind: symbol.kind === 'procedure' ? monaco.languages.SymbolKind.Function :
                symbol.kind === 'event' ? monaco.languages.SymbolKind.Event :
                    symbol.kind === 'list' ? monaco.languages.SymbolKind.Array :
                        symbol.kind === 'actor' || symbol.kind === 'stage' ? monaco.languages.SymbolKind.Module :
                            monaco.languages.SymbolKind.Variable,
            range: asRange(monaco, symbol.range),
            selectionRange: asRange(monaco, symbol.range),
            children: []
        }))
    });
    monaco.languages.registerDefinitionProvider('textwarp', {
        provideDefinition: (model, position) => {
            const word = model.getWordAtPosition(position);
            if (!word) return null;
            return documentsForSymbol(model, word.word, position.lineNumber).flatMap(document =>
                findDefinitions(document.source, word.word, {
                    line: document.modelKey === getModelContext(model).targetId ? position.lineNumber : undefined
                }).map(definition => ({
                    uri: document.modelKey ? uriForModelKey(monaco, document.modelKey) : model.uri,
                    range: asRange(monaco, definition.range)
                }))
            );
        }
    });
    monaco.languages.registerReferenceProvider('textwarp', {
        provideReferences: (model, position) => {
            const word = model.getWordAtPosition(position);
            if (!word) return [];
            return documentsForSymbol(model, word.word, position.lineNumber).flatMap(document =>
                findReferences(document.source, word.word, {
                    line: document.modelKey === getModelContext(model).targetId ? position.lineNumber : undefined
                }).map(reference => ({
                    uri: document.modelKey ? uriForModelKey(monaco, document.modelKey) : model.uri,
                    range: asRange(monaco, reference.range)
                }))
            );
        }
    });
    monaco.languages.registerRenameProvider('textwarp', {
        resolveRenameLocation: (model, position) => {
            const word = model.getWordAtPosition(position);
            if (!word || !renameEdits(model.getValue(), word.word, '__valid_name__', {
                allowUndeclared: word && isGlobalSymbol(model, word.word, position.lineNumber),
                line: position.lineNumber
            }).length) {
                return {rejectReason: 'Somente variáveis, listas e procedimentos declarados podem ser renomeados com segurança.'};
            }
            return {
                text: word.word,
                range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
            };
        },
        provideRenameEdits: (model, position, newName) => {
            const word = model.getWordAtPosition(position);
            if (!word) return {edits: []};
            const global = isGlobalSymbol(model, word.word, position.lineNumber);
            return {
                edits: documentsForSymbol(model, word.word, position.lineNumber).flatMap(document => {
                    const resource = document.modelKey ? uriForModelKey(monaco, document.modelKey) : model.uri;
                    const documentModel = monaco.editor.getModel(resource);
                    return renameEdits(document.source, word.word, newName, {
                        allowUndeclared: global,
                        line: document.modelKey === getModelContext(model).targetId ? position.lineNumber : undefined
                    }).map(edit => ({
                        resource,
                        textEdit: {range: asRange(monaco, edit.range), text: edit.text},
                        versionId: documentModel ? documentModel.getVersionId() : undefined
                    }));
                })
            };
        }
    });
    monaco.languages.registerDocumentFormattingEditProvider('textwarp', {
        provideDocumentFormattingEdits: model => [{
            range: model.getFullModelRange(),
            text: formatText(model.getValue())
        }]
    });
    monaco.languages.registerSignatureHelpProvider('textwarp', {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp: (model, position) => {
            const signature = getSignatureHelp(
                model.getValue(),
                position.lineNumber,
                position.column,
                getModelContext(model)
            );
            if (!signature) return null;
            return {
                value: {
                    signatures: [{
                        label: signature.label,
                        documentation: signature.documentation,
                        parameters: signature.parameters
                    }],
                    activeSignature: 0,
                    activeParameter: signature.activeParameter
                },
                dispose: () => {}
            };
        }
    });
};

const loadMonaco = () => {
    if (monacoPromise) return monacoPromise;
    monacoPromise = new Promise((resolve, reject) => {
        if (window.monaco && window.monaco.editor) {
            configureLanguage(window.monaco);
            resolve(window.monaco);
            return;
        }

        const baseUrl = new URL('static/monaco/vs', document.baseURI).href.replace(/\/$/, '');
        const script = document.createElement('script');
        script.src = `${baseUrl}/loader.js`;
        script.onload = () => {
            const amdRequire = window.require;
            if (!amdRequire || typeof amdRequire.config !== 'function') {
                reject(new Error('O carregador AMD do Monaco não foi inicializado.'));
                return;
            }
            amdRequire.config({paths: {vs: baseUrl}});
            amdRequire(['vs/editor/editor.main'], () => {
                configureLanguage(window.monaco);
                resolve(window.monaco);
            }, reject);
        };
        script.onerror = () => reject(new Error(`Não foi possível carregar ${script.src}.`));
        document.head.appendChild(script);
    });
    return monacoPromise;
};

module.exports = {
    clearModelContext,
    getModelContext,
    loadMonaco,
    setModelContext
};
