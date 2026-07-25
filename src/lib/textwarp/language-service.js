'use strict';

const {blockRegistry, controlRegistry, eventRegistry, operatorRegistry} = require('./block-registry');

const KEYWORDS = new Set([
    'actor', 'stage', 'on', 'global', 'variable', 'list', 'procedure', 'if', 'else', 'repeat',
    'repeat_until', 'while', 'forever', 'return', 'warp', 'branch', 'pass', 'any', 'number',
    'string', 'boolean', 'and', 'or', 'not', 'true', 'false'
]);

const identifierRanges = source => {
    const ranges = [];
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    lines.forEach((line, lineIndex) => {
        let quote = null;
        let escaped = false;
        for (let index = 0; index < line.length;) {
            const character = line[index];
            if (escaped) {
                escaped = false;
                index++;
                continue;
            }
            if (quote) {
                if (character === '\\') escaped = true;
                else if (character === quote) quote = null;
                index++;
                continue;
            }
            if (character === '#' ) break;
            if (character === '"' || character === "'") {
                quote = character;
                index++;
                continue;
            }
            const match = line.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
            if (!match) {
                index++;
                continue;
            }
            ranges.push({
                name: match[0],
                line: lineIndex + 1,
                column: index + 1,
                endColumn: index + match[0].length + 1
            });
            index += match[0].length;
        }
    });
    return ranges;
};

const lineRange = (line, column, text) => ({
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: column + text.length
});

const getDocumentSymbols = source => {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    const symbols = [];
    lines.forEach((raw, index) => {
        const line = index + 1;
        const text = raw.replace(/#.*$/, '');
        let match = text.match(/^\s*(?:global\s+)?(variable|list)\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (match) {
            const column = text.indexOf(match[2]) + 1;
            symbols.push({
                name: match[2],
                kind: match[1],
                global: /^\s*global\s+/.test(text),
                detail: `${/^\s*global\s+/.test(text) ? 'Global · ' : ''}${match[1] === 'list' ? 'Lista' : 'Variável'}`,
                range: lineRange(line, column, match[2])
            });
            return;
        }
        match = text.match(/^\s*procedure\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(.*?)\s*:/);
        if (match) {
            const column = text.indexOf(match[1]) + 1;
            const parameters = match[2].split(',').map(value => value.trim()).filter(Boolean).map(value => value.split(':')[0].trim());
            symbols.push({
                name: match[1],
                kind: 'procedure',
                detail: `Procedimento (${parameters.join(', ')})${match[3] ? ` ${match[3].trim()}` : ''}`,
                parameters,
                range: lineRange(line, column, match[1])
            });
            return;
        }
        match = text.match(/^\s*on\s+([A-Za-z_][A-Za-z0-9_.]*)/);
        if (match) {
            const column = text.indexOf(match[1]) + 1;
            symbols.push({name: match[1], kind: 'event', detail: 'Evento', range: lineRange(line, column, match[1])});
            return;
        }
        match = text.match(/^\s*(actor|stage)(?:\s+(.+))?$/);
        if (match) {
            const name = match[2] || match[1];
            const column = match[2] ? text.indexOf(match[2]) + 1 : text.indexOf(match[1]) + 1;
            symbols.push({name, kind: match[1], detail: match[1] === 'stage' ? 'Palco' : 'Ator', range: lineRange(line, column, name)});
        }
    });
    return symbols;
};

const getParameterScopes = source => {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    const scopes = [];
    lines.forEach((text, index) => {
        const match = text.match(/^\s*procedure\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
        if (!match) return;
        let endLine = lines.length;
        for (let next = index + 1; next < lines.length; next++) {
            if (/^(?=\S)/.test(lines[next]) && lines[next].trim()) {
                endLine = next;
                break;
            }
        }
        match[2].split(',').map(value => value.trim()).filter(Boolean).forEach(value => {
            const name = value.split(':')[0].trim();
            const column = text.indexOf(name, text.indexOf('(')) + 1;
            scopes.push({
                name,
                procedure: match[1],
                startLine: index + 1,
                endLine,
                range: lineRange(index + 1, column, name)
            });
        });
    });
    return scopes;
};

const findIdentifierAt = (source, line, column) => identifierRanges(source).find(range =>
    range.line === line && column >= range.column && column <= range.endColumn
) || null;

const getCatalog = context => Object.assign(
    {},
    blockRegistry,
    controlRegistry,
    operatorRegistry,
    context && context.extensionCatalog || {}
);

const signature = (name, metadata) => {
    const args = (metadata.arguments || []).map(argument => {
        const optional = argument.optional ? '?' : '';
        return `${argument.name}${optional}: ${argument.valueType || argument.role || 'any'}`;
    });
    return `${name}(${args.join(', ')})${metadata.returnType ? ` -> ${metadata.returnType}` : ''}`;
};

const getHover = (source, line, column, context = {}) => {
    const identifier = findIdentifierAt(source, line, column);
    if (!identifier) return null;
    const symbols = getDocumentSymbols(source);
    const parameter = getParameterScopes(source).find(item =>
        item.name === identifier.name && line >= item.startLine && line <= item.endLine
    );
    if (parameter) return {
        range: lineRange(identifier.line, identifier.column, identifier.name),
        title: 'Parâmetro',
        code: parameter.name,
        documentation: `Parâmetro do procedimento ${parameter.procedure}.`
    };
    const symbol = symbols.find(item => item.name === identifier.name);
    if (symbol) return {
        range: lineRange(identifier.line, identifier.column, identifier.name),
        title: symbol.detail,
        code: symbol.kind === 'procedure' ? `${symbol.name}(${(symbol.parameters || []).join(', ')})` : symbol.name,
        documentation: symbol.kind === 'procedure' ? 'Procedimento declarado neste módulo TextWarp.' : `${symbol.detail} declarada neste módulo.`
    };
    const metadata = getCatalog(context)[identifier.name] || eventRegistry[identifier.name];
    if (metadata) return {
        range: lineRange(identifier.line, identifier.column, identifier.name),
        title: metadata.kind || 'Comando TextWarp',
        code: signature(identifier.name, metadata),
        documentation: metadata.documentation || 'Elemento disponível no catálogo TextWarp atual.'
    };
    const resource = (context.resources || []).find(item => item.name === identifier.name);
    if (resource) return {
        range: lineRange(identifier.line, identifier.column, identifier.name),
        title: resource.kindLabel || resource.kind,
        code: resource.name,
        documentation: resource.detail || `Recurso do projeto atual. ID estável: ${resource.id}`
    };
    return null;
};

const findDefinitions = (source, name, options = {}) => {
    const parameter = getParameterScopes(source).find(item =>
        item.name === name && options.line >= item.startLine && options.line <= item.endLine
    );
    if (parameter) return [{name, range: parameter.range}];
    return getDocumentSymbols(source).filter(symbol => symbol.name === name).map(symbol => ({name, range: symbol.range}));
};

const findReferences = (source, name, options = {}) => {
    const parameter = getParameterScopes(source).find(item =>
        item.name === name && options.line >= item.startLine && options.line <= item.endLine
    );
    return identifierRanges(source).filter(range =>
        range.name === name && (!parameter || range.line >= parameter.startLine && range.line <= parameter.endLine)
    ).map(range => ({name, range: lineRange(range.line, range.column, range.name)}));
};

const canRename = (source, name, options = {}) => !KEYWORDS.has(name) && (
    getDocumentSymbols(source).some(symbol => symbol.name === name && ['variable', 'list', 'procedure'].includes(symbol.kind)) ||
    getParameterScopes(source).some(parameter =>
        parameter.name === name && options.line >= parameter.startLine && options.line <= parameter.endLine
    )
);

const renameEdits = (source, oldName, newName, options = {}) => {
    if (
        (!options.allowUndeclared && !canRename(source, oldName, options)) ||
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName) || KEYWORDS.has(newName)
    ) return [];
    return findReferences(source, oldName, options).map(reference => ({range: reference.range, text: newName}));
};

const argumentContext = (source, line, column) => {
    const current = String(source || '').split(/\r?\n/)[line - 1] || '';
    const prefix = current.slice(0, Math.max(0, column - 1));
    const match = prefix.match(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(([^()]*)$/);
    if (!match) return null;
    return {name: match[1], argumentIndex: match[2].split(',').length - 1};
};

const resourceSuggestions = (context, call) => {
    if (!call) return [];
    const metadata = getCatalog(context)[call.name] || eventRegistry[call.name];
    const argument = metadata && (metadata.arguments || [])[call.argumentIndex];
    if (!argument) return [];
    const role = argument.role;
    const name = String(argument.name || '').toLowerCase();
    const kinds = role === 'broadcast' || /message|broadcast/.test(name) ? ['broadcast'] :
        role === 'variable' ? ['variable'] : role === 'list' ? ['list'] :
            role === 'costume' || /costume|backdrop/.test(name) ? ['costume'] :
                role === 'sound' || /sound/.test(name) ? ['sound'] :
                    /actor|target|object/.test(name) ? ['actor', 'stage'] : [];
    const stage = (context.resources || []).find(item => item.kind === 'stage');
    return (context.resources || []).filter(item => kinds.includes(item.kind) && (
        !['costume', 'sound'].includes(item.kind) || item.ownerId === (
            /backdrop/.test(name) && stage ? stage.id : context.targetId
        )
    )).map(item => ({
        label: item.name,
        kind: 'resource',
        detail: item.kindLabel || item.kind,
        documentation: item.detail || `Recurso ${item.kind} do projeto atual.`,
        insertText: JSON.stringify(item.name),
        sortText: `0-${item.name}`
    }));
};

const getCompletions = (source, line, column, context = {}) => {
    const suggestions = [];
    resourceSuggestions(context, argumentContext(source, line, column)).forEach(item => suggestions.push(item));
    getDocumentSymbols(source).filter(symbol => ['variable', 'list', 'procedure'].includes(symbol.kind)).forEach(symbol => {
        suggestions.push({
            label: symbol.name,
            kind: symbol.kind,
            detail: symbol.detail,
            documentation: `${symbol.detail} do módulo atual.`,
            insertText: symbol.kind === 'procedure' ? `${symbol.name}()` : symbol.name,
            sortText: `1-${symbol.name}`
        });
    });
    getParameterScopes(source).filter(parameter => line >= parameter.startLine && line <= parameter.endLine).forEach(parameter => {
        suggestions.push({
            label: parameter.name,
            kind: 'variable',
            detail: `Parâmetro de ${parameter.procedure}`,
            documentation: `Parâmetro disponível somente dentro de ${parameter.procedure}.`,
            insertText: parameter.name,
            sortText: `0-${parameter.name}`
        });
    });
    (context.resources || []).filter(item => ['variable', 'list'].includes(item.kind)).forEach(item => {
        suggestions.push({
            label: item.name,
            kind: item.kind,
            detail: `${item.kindLabel || item.kind} · ${item.ownerName || 'projeto'}`,
            documentation: item.detail || `ID estável: ${item.id}`,
            insertText: item.name,
            sortText: `1-${item.name}`
        });
    });
    return suggestions;
};

const getSignatureHelp = (source, line, column, context = {}) => {
    const call = argumentContext(source, line, column);
    if (!call) return null;
    const own = getDocumentSymbols(source).find(symbol => symbol.kind === 'procedure' && symbol.name === call.name);
    if (own) return {
        label: `${own.name}(${own.parameters.join(', ')})`,
        documentation: 'Procedimento declarado neste módulo.',
        parameters: own.parameters.map(name => ({label: name, documentation: `Parâmetro ${name}.`})),
        activeParameter: Math.min(call.argumentIndex, Math.max(0, own.parameters.length - 1))
    };
    const metadata = getCatalog(context)[call.name] || eventRegistry[call.name];
    if (!metadata) return null;
    const parameters = (metadata.arguments || []).map(argument => ({
        label: argument.name,
        documentation: `${argument.valueType || argument.role || 'any'}${argument.optional ? ' (opcional)' : ''}`
    }));
    return {
        label: signature(call.name, metadata),
        documentation: metadata.documentation || '',
        parameters,
        activeParameter: Math.min(call.argumentIndex, Math.max(0, parameters.length - 1))
    };
};

const formatText = source => {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    let indent = 0;
    let previousOpened = false;
    const output = lines.map(rawLine => {
        const trimmed = rawLine.trim();
        if (!trimmed) {
            previousOpened = false;
            return '';
        }
        if (/^(else|branch\s+\d+)\s*:/.test(trimmed)) indent = Math.max(0, indent - 1);
        else if (/^(actor|stage|global\s+(?:variable|list)|variable|list|procedure|on)\b/.test(trimmed)) indent = 0;
        else if (previousOpened) indent++;
        const rendered = `${' '.repeat(indent * 4)}${trimmed.replace(/\s+$/g, '')}`;
        previousOpened = /:\s*(?:#.*)?$/.test(trimmed);
        if (/^(else|branch\s+\d+)\s*:/.test(trimmed)) previousOpened = true;
        return rendered;
    });
    return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
};

const getOutline = source => getDocumentSymbols(source);

const getDiagnosticSuggestion = diagnostic => {
    const code = diagnostic && diagnostic.code || '';
    if (/indent/.test(code)) return 'Use blocos de quatro espaços; o comando Formatar pode corrigir a estrutura.';
    if (code === 'missing-project-resource') return 'Escolha um recurso existente no painel Projeto ou use o botão ＋ para inseri-lo.';
    if (/unknown-call|unknown-event/.test(code)) return 'Confira a grafia, abra a referência integrada ou escolha uma sugestão do autocompletar.';
    if (/unknown-variable|expected-variable|expected-list/.test(code)) return 'Declare o nome no início do módulo ou selecione uma variável/lista existente.';
    if (/arity|argument|parameter/.test(code)) return 'Passe o mouse sobre a chamada para conferir assinatura, parâmetros e tipos.';
    if (/parenthesis|string|bracket/.test(code)) return 'Feche o delimitador indicado; o editor também oferece fechamento automático.';
    if (/target-kind|project-resource/.test(code)) return 'Atualize a referência a partir do estado atual do projeto.';
    return '';
};

module.exports = {
    KEYWORDS,
    canRename,
    findDefinitions,
    findIdentifierAt,
    findReferences,
    formatText,
    getCompletions,
    getDocumentSymbols,
    getDiagnosticSuggestion,
    getHover,
    getOutline,
    getParameterScopes,
    getSignatureHelp,
    identifierRanges,
    renameEdits,
    signature
};
