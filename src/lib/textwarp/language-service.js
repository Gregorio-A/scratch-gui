'use strict';

const {
    blockRegistry,
    COLOR_OPTIONS,
    controlRegistry,
    eventRegistry,
    operatorRegistry
} = require('./block-registry');
const {parseText} = require('./parser');
const {canonicalFor, preferredFor, semanticIdsFor} = require('./language-registry');
const {canonicalizeSource, localizeSource} = require('./localized-syntax');

const KEYWORDS = new Set([
    'actor', 'stage', 'on', 'global', 'variable', 'list', 'procedure', 'if', 'else', 'repeat',
    'repeat_until', 'while', 'forever', 'return', 'warp', 'branch', 'pass', 'stack', 'reporter',
    'any', 'number', 'string', 'boolean', 'and', 'or', 'not', 'true', 'false'
]);

const INDEX_CACHE_BYTE_LIMIT = 16 * 1024 * 1024;
const indexCache = new Map();
let indexCacheBytes = 0;

const normalizedSource = source => String(source || '').replace(/\r\n?/g, '\n');
const lineRange = (line, column, text) => ({
    startLineNumber: line,
    startColumn: column,
    endLineNumber: line,
    endColumn: column + Math.max(1, String(text || '').length)
});
const containsPosition = (range, line, column) => (
    line >= range.startLineNumber &&
    line <= range.endLineNumber &&
    (line !== range.startLineNumber || column >= range.startColumn) &&
    (line !== range.endLineNumber || column <= range.endColumn)
);
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const decodeScannedString = (raw, quote, closed) => {
    if (!closed) return raw.slice(1);
    if (quote === '"') {
        try {
            return JSON.parse(raw);
        } catch (error) {
            return raw.slice(1, -1);
        }
    }
    let result = '';
    let escaped = false;
    const escapes = {n: '\n', r: '\r', t: '\t'};
    for (let index = 1; index < raw.length - 1; index++) {
        const character = raw[index];
        if (escaped) {
            result += Object.prototype.hasOwnProperty.call(escapes, character) ? escapes[character] : character;
            escaped = false;
        } else if (character === '\\') {
            escaped = true;
        } else {
            result += character;
        }
    }
    return result;
};

const scanSource = source => {
    const tokens = [];
    normalizedSource(source).split('\n').forEach((text, lineIndex) => {
        let index = 0;
        while (index < text.length) {
            const character = text[index];
            if (/\s/.test(character)) {
                index++;
                continue;
            }
            if (character === '#') {
                tokens.push({
                    type: 'comment',
                    value: text.slice(index + 1),
                    raw: text.slice(index),
                    line: lineIndex + 1,
                    column: index + 1,
                    endColumn: text.length + 1
                });
                break;
            }
            if (character === '"' || character === "'") {
                const quote = character;
                const start = index++;
                let escaped = false;
                while (index < text.length) {
                    const current = text[index++];
                    if (escaped) escaped = false;
                    else if (current === '\\') escaped = true;
                    else if (current === quote) break;
                }
                const raw = text.slice(start, index);
                const closed = raw.length > 1 && raw.endsWith(quote);
                tokens.push({
                    type: 'string',
                    value: decodeScannedString(raw, quote, closed),
                    raw,
                    quote,
                    closed,
                    line: lineIndex + 1,
                    column: start + 1,
                    endColumn: index + 1
                });
                continue;
            }
            const identifier = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/);
            if (identifier) {
                tokens.push({
                    type: KEYWORDS.has(identifier[0]) ? 'keyword' : 'identifier',
                    value: identifier[0],
                    raw: identifier[0],
                    line: lineIndex + 1,
                    column: index + 1,
                    endColumn: index + identifier[0].length + 1
                });
                index += identifier[0].length;
                continue;
            }
            const operator = text.slice(index).match(/^(?:==|!=|<=|>=|\+=|-=|[-+*/%<>=])/);
            if (operator) {
                tokens.push({
                    type: 'operator',
                    value: operator[0],
                    raw: operator[0],
                    line: lineIndex + 1,
                    column: index + 1,
                    endColumn: index + operator[0].length + 1
                });
                index += operator[0].length;
                continue;
            }
            tokens.push({
                type: 'delimiter',
                value: character,
                raw: character,
                line: lineIndex + 1,
                column: index + 1,
                endColumn: index + 2
            });
            index++;
        }
    });
    return tokens;
};

const identifierRanges = (source, modelKey = 'target') =>
    createDocumentIndex(source, modelKey).tokens.filter(token => token.type === 'identifier').map(token => ({
    name: token.value,
    line: token.line,
    column: token.column,
    endColumn: token.endColumn
}));

const findIdentifierAt = (source, line, column, modelKey = 'target') => identifierRanges(source, modelKey).find(range =>
    range.line === line && column >= range.column && column <= range.endColumn
) || null;

const nameRangeOnLine = (lines, line, name, afterPattern = null) => {
    const text = lines[line - 1] || '';
    let start = 0;
    if (afterPattern) {
        const prefix = text.match(afterPattern);
        if (prefix) start = prefix.index + prefix[0].length;
    }
    const match = text.slice(start).match(new RegExp(`\\b${escapeRegExp(name)}\\b`));
    const column = match ? start + match.index + 1 : Math.max(1, text.indexOf(name) + 1);
    return lineRange(line, column, name);
};

const maxStatementLine = statements => {
    let maximum = 0;
    const visit = statement => {
        if (!statement) return;
        if (statement.location) maximum = Math.max(maximum, statement.location.line || 0);
        ['body', 'consequent', 'alternate'].forEach(key => (statement[key] || []).forEach(visit));
        (statement.branches || []).forEach(branch => (branch.body || []).forEach(visit));
    };
    (statements || []).forEach(visit);
    return maximum;
};

const createDocumentIndex = (source, modelKey = 'target') => {
    const text = normalizedSource(source);
    const cached = indexCache.get(modelKey);
    if (cached && cached.source === text) {
        indexCache.delete(modelKey);
        indexCache.set(modelKey, cached);
        return cached.index;
    }
    if (cached) {
        indexCache.delete(modelKey);
        indexCacheBytes -= cached.bytes;
    }
    const lines = text.split('\n');
    const parsed = parseText(text);
    const ast = parsed.ast;
    const symbols = [];
    const topLevelLines = []
        .concat(ast.declarations, ast.procedures, ast.scripts, ast.stacks || [], ast.reporters || [])
        .map(node => node.location.line)
        .concat(ast.declaration ? [ast.declaration.location.line] : [])
        .sort((left, right) => left - right);
    const scopeEndFor = (line, statements) => {
        const next = topLevelLines.find(candidate => candidate > line);
        return Math.max(maxStatementLine(statements), next ? next - 1 : lines.length, line);
    };
    const append = symbol => {
        const id = [
            modelKey,
            symbol.kind,
            symbol.name,
            symbol.scopeId || 'module',
            symbol.range.startLineNumber,
            symbol.range.startColumn
        ].join(':');
        symbols.push(Object.assign({id, modelKey, global: false, scopeId: 'module'}, symbol));
    };

    if (ast.declaration) {
        const line = ast.declaration.location.line;
        const actor = ast.declaration.type === 'ActorDeclaration';
        const name = actor ? ast.declaration.name : 'stage';
        append({
            name,
            kind: actor ? 'actor' : 'stage',
            detail: actor ? 'Ator' : 'Palco',
            range: nameRangeOnLine(lines, line, name, actor ? /^\s*actor\s+/ : null),
            fullRange: lineRange(line, 1, lines[line - 1] || name)
        });
    }

    ast.declarations.forEach(node => {
        const kind = node.type === 'ListDeclaration' ? 'list' : 'variable';
        append({
            name: node.name,
            kind,
            global: Boolean(node.global),
            detail: `${node.global ? 'Global · ' : ''}${kind === 'list' ? 'Lista' : 'Variável'}`,
            range: nameRangeOnLine(lines, node.location.line, node.name, /^\s*(?:global\s+)?(?:variable|list)\s+/),
            fullRange: lineRange(node.location.line, 1, lines[node.location.line - 1])
        });
    });

    ast.procedures.forEach(node => {
        const line = node.location.line;
        const endLine = scopeEndFor(line, node.body);
        const procedureScope = `procedure:${node.name}:${line}`;
        const procedureRange = nameRangeOnLine(lines, line, node.name, /^\s*procedure\s+/);
        append({
            name: node.name,
            kind: 'procedure',
            detail: `Procedimento (${node.parameters.map(parameter => parameter.name).join(', ')})${
                node.returnType ? ` -> ${node.returnType}` : ''
            }${node.warp ? ' warp' : ''}`,
            parameters: node.parameters.map(parameter => ({
                name: parameter.name,
                valueType: parameter.valueType || 'any'
            })),
            returnType: node.returnType || null,
            range: procedureRange,
            fullRange: {
                startLineNumber: line,
                startColumn: 1,
                endLineNumber: endLine,
                endColumn: (lines[endLine - 1] || '').length + 1
            }
        });
        let searchColumn = (lines[line - 1] || '').indexOf('(') + 2;
        node.parameters.forEach(parameter => {
            const textLine = lines[line - 1] || '';
            const found = textLine.indexOf(parameter.name, Math.max(0, searchColumn - 1));
            const range = lineRange(line, found >= 0 ? found + 1 : searchColumn, parameter.name);
            searchColumn = range.endColumn;
            append({
                name: parameter.name,
                kind: 'parameter',
                detail: `Parâmetro de ${node.name}: ${parameter.valueType || 'any'}`,
                valueType: parameter.valueType || 'any',
                procedure: node.name,
                scopeId: procedureScope,
                scopeRange: {
                    startLineNumber: line,
                    startColumn: 1,
                    endLineNumber: endLine,
                    endColumn: (lines[endLine - 1] || '').length + 1
                },
                range,
                fullRange: range
            });
        });
    });

    ast.scripts.forEach(node => {
        const name = node.event && (node.event.callee || node.event.name) || 'event';
        const line = node.location.line;
        const endLine = scopeEndFor(line, node.body);
        append({
            name,
            kind: 'event',
            detail: 'Evento',
            range: nameRangeOnLine(lines, line, name, /^\s*on\s+/),
            fullRange: {
                startLineNumber: line,
                startColumn: 1,
                endLineNumber: endLine,
                endColumn: (lines[endLine - 1] || '').length + 1
            }
        });
    });

    // Keep navigation useful while a declaration is temporarily incomplete.
    lines.forEach((rawLine, lineIndex) => {
        const line = lineIndex + 1;
        const textLine = rawLine.replace(/#.*$/, '');
        const candidates = [];
        let match = textLine.match(/^\s*(global\s+)?(variable|list)\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (match) candidates.push({
            name: match[3],
            kind: match[2],
            global: Boolean(match[1]),
            detail: `${match[1] ? 'Global · ' : ''}${match[2] === 'list' ? 'Lista' : 'Variável'}`
        });
        match = textLine.match(/^\s*procedure\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (match) candidates.push({name: match[1], kind: 'procedure', detail: 'Procedimento incompleto'});
        match = textLine.match(/^\s*on\s+([A-Za-z_][A-Za-z0-9_.]*)/);
        if (match) candidates.push({name: match[1], kind: 'event', detail: 'Evento incompleto'});
        candidates.forEach(candidate => {
            if (symbols.some(symbol =>
                symbol.kind === candidate.kind &&
                symbol.name === candidate.name &&
                symbol.range.startLineNumber === line
            )) return;
            append(Object.assign({}, candidate, {
                partial: true,
                range: nameRangeOnLine(lines, line, candidate.name),
                fullRange: lineRange(line, 1, rawLine)
            }));
        });
    });

    const index = {
        ast,
        diagnostics: parsed.diagnostics,
        lines,
        modelKey,
        source: text,
        symbols,
        tokens: scanSource(text)
    };
    const bytes = (text.length + lines.reduce((total, line) => total + line.length, 0)) * 2 +
        index.tokens.length * 96 +
        index.symbols.length * 160;
    if (bytes <= INDEX_CACHE_BYTE_LIMIT) {
        indexCache.set(modelKey, {bytes, index, source: text});
        indexCacheBytes += bytes;
        while (indexCacheBytes > INDEX_CACHE_BYTE_LIMIT && indexCache.size > 1) {
            const oldestKey = indexCache.keys().next().value;
            const oldest = indexCache.get(oldestKey);
            indexCache.delete(oldestKey);
            indexCacheBytes -= oldest.bytes;
        }
    }
    return index;
};

const clearDocumentIndexes = modelKeys => {
    const keys = modelKeys ? Array.from(modelKeys) : Array.from(indexCache.keys());
    keys.forEach(modelKey => {
        const cached = indexCache.get(modelKey);
        if (!cached) return;
        indexCache.delete(modelKey);
        indexCacheBytes -= cached.bytes;
    });
};

const getDocumentIndexCacheStats = () => ({
    bytes: indexCacheBytes,
    entries: indexCache.size,
    modelKeys: Array.from(indexCache.keys())
});

const getDocumentSymbols = (source, options = {}) => createDocumentIndex(
    source,
    options.modelKey || 'target'
).symbols.filter(symbol => symbol.kind !== 'parameter');

const getParameterScopes = source => createDocumentIndex(source).symbols
    .filter(symbol => symbol.kind === 'parameter')
    .map(symbol => ({
        name: symbol.name,
        procedure: symbol.procedure,
        startLine: symbol.scopeRange.startLineNumber,
        endLine: symbol.scopeRange.endLineNumber,
        range: symbol.range,
        id: symbol.id
    }));

const contextDocuments = (source, context = {}) => {
    const currentKey = context.targetId || context.modelKey || 'target';
    const documents = (context.documents || []).map(document => ({
        modelKey: document.modelKey || document.targetId || currentKey,
        source: document.modelKey === currentKey || document.targetId === currentKey ? source : document.source || ''
    }));
    if (!documents.some(document => document.modelKey === currentKey)) {
        documents.push({modelKey: currentKey, source});
    }
    return documents;
};

const createWorkspaceIndex = (source, context = {}) => {
    const currentKey = context.targetId || context.modelKey || 'target';
    const documents = contextDocuments(source, context).map(document => ({
        modelKey: document.modelKey,
        index: createDocumentIndex(document.source, document.modelKey),
        source: normalizedSource(document.source)
    }));
    return {
        context,
        currentKey,
        documents,
        byKey: new Map(documents.map(document => [document.modelKey, document]))
    };
};

const parameterAt = (index, name, line) => index.symbols.find(symbol =>
    symbol.kind === 'parameter' &&
    symbol.name === name &&
    containsPosition(symbol.scopeRange, line, 1)
);

const moduleSymbol = (index, name) => index.symbols.find(symbol =>
    symbol.name === name && ['variable', 'list', 'procedure'].includes(symbol.kind)
);

const resolveName = (workspace, document, name, line) => {
    const parameter = parameterAt(document.index, name, line);
    if (parameter) return parameter;
    const local = moduleSymbol(document.index, name);
    if (local) return local;
    const globals = workspace.documents.flatMap(candidate => candidate.index.symbols).filter(symbol =>
        symbol.name === name && symbol.global && ['variable', 'list'].includes(symbol.kind)
    );
    return globals.length === 1 ? globals[0] : null;
};

const tokenAt = (index, line, column, types = ['identifier']) => index.tokens.find(token =>
    types.includes(token.type) &&
    token.line === line &&
    column >= token.column &&
    column <= token.endColumn
) || null;

const resolveSymbolAt = (source, line, column, context = {}) => {
    const workspace = createWorkspaceIndex(source, context);
    const document = workspace.byKey.get(workspace.currentKey) || workspace.documents[0];
    if (!document) return null;
    const token = tokenAt(document.index, line, column);
    if (!token) return null;
    const symbol = resolveName(workspace, document, token.value, line);
    return symbol ? {symbol, token, workspace, document} : null;
};

const referencesForSymbol = (workspace, symbol) => {
    const documents = symbol.global ? workspace.documents : workspace.documents.filter(document =>
        document.modelKey === symbol.modelKey
    );
    const locations = [];
    documents.forEach(document => {
        document.index.tokens.filter(token =>
            token.type === 'identifier' && token.value === symbol.name
        ).forEach(token => {
            const resolved = resolveName(workspace, document, token.value, token.line);
            if (resolved && resolved.id === symbol.id) {
                locations.push({
                    modelKey: document.modelKey,
                    range: lineRange(token.line, token.column, token.raw),
                    symbol
                });
            }
        });
    });
    return locations;
};

const findDefinitions = (source, name, options = {}) => {
    const workspace = createWorkspaceIndex(source, options.context || {
        targetId: options.modelKey || 'target'
    });
    const document = workspace.byKey.get(options.modelKey || workspace.currentKey) || workspace.documents[0];
    const matching = document.index.symbols.filter(symbol => symbol.name === name);
    const symbol = options.line ? resolveName(workspace, document, name, options.line) :
        matching.length === 1 ? matching[0] : resolveName(workspace, document, name, 1);
    return symbol ? [{name, range: symbol.range, modelKey: symbol.modelKey, id: symbol.id}] : [];
};

const findReferences = (source, name, options = {}) => {
    const workspace = createWorkspaceIndex(source, options.context || {
        targetId: options.modelKey || 'target'
    });
    const document = workspace.byKey.get(options.modelKey || workspace.currentKey) || workspace.documents[0];
    const matching = document.index.symbols.filter(symbol => symbol.name === name);
    const symbol = options.line ? resolveName(workspace, document, name, options.line) :
        matching.length === 1 ? matching[0] : resolveName(workspace, document, name, 1);
    if (!symbol) return [];
    return referencesForSymbol(workspace, symbol).map(location => ({
        name,
        range: location.range,
        modelKey: location.modelKey,
        id: symbol.id
    }));
};

const getDefinitionLocations = (source, line, column, context = {}) => {
    const resolved = resolveSymbolAt(source, line, column, context);
    if (!resolved) return [];
    return [{
        modelKey: resolved.symbol.modelKey,
        range: resolved.symbol.range,
        symbol: resolved.symbol
    }];
};

const getReferenceLocations = (source, line, column, context = {}) => {
    const resolved = resolveSymbolAt(source, line, column, context);
    return resolved ? referencesForSymbol(resolved.workspace, resolved.symbol) : [];
};

const canRenameSymbol = symbol => symbol && ['variable', 'list', 'procedure', 'parameter'].includes(symbol.kind);
const validRename = name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !KEYWORDS.has(name);

const getRenamePlan = (source, line, column, newName, context = {}) => {
    const resolved = resolveSymbolAt(source, line, column, context);
    if (!resolved || !canRenameSymbol(resolved.symbol)) {
        return {rejectReason: 'Only declared variables, lists, procedures and parameters can be renamed safely.', edits: []};
    }
    if (!validRename(newName)) {
        return {rejectReason: 'Use a valid identifier that is not a TextWarp keyword.', edits: []};
    }
    const collision = resolved.workspace.documents.some(document => document.index.symbols.some(symbol => {
        if (symbol.id === resolved.symbol.id || symbol.name !== newName) return false;
        if (resolved.symbol.kind === 'parameter') {
            return symbol.modelKey === resolved.symbol.modelKey && (
                symbol.kind !== 'parameter' ||
                symbol.scopeId === resolved.symbol.scopeId
            );
        }
        if (resolved.symbol.global) return true;
        return symbol.global || symbol.modelKey === resolved.symbol.modelKey && symbol.kind !== 'parameter';
    }));
    if (collision) return {rejectReason: `The name "${newName}" is already declared in this scope.`, edits: []};
    return {
        symbol: resolved.symbol,
        edits: referencesForSymbol(resolved.workspace, resolved.symbol).map(location => ({
            modelKey: location.modelKey,
            range: location.range,
            text: newName
        }))
    };
};

const canRename = (source, name, options = {}) => {
    const modelKey = options.modelKey || options.context && options.context.targetId || 'target';
    const ranges = identifierRanges(source, modelKey).filter(range => range.name === name);
    return ranges.some(range => {
        const plan = getRenamePlan(
            source,
            options.line || range.line,
            range.column,
            range.name,
            options.context || {}
        );
        return !plan.rejectReason;
    });
};

const renameEdits = (source, oldName, newName, options = {}) => {
    if (!validRename(newName)) return [];
    const modelKey = options.modelKey || options.context && options.context.targetId || 'target';
    const ranges = identifierRanges(source, modelKey).filter(range => range.name === oldName);
    const selected = ranges.find(range => !options.line || range.line === options.line) || ranges[0];
    if (!selected) return [];
    const plan = getRenamePlan(source, options.line || selected.line, selected.column, newName, options.context || {});
    return plan.rejectReason ? [] : plan.edits.filter(edit =>
        !edit.modelKey || edit.modelKey === (options.modelKey || plan.symbol.modelKey)
    );
};

const offsetAt = (source, line, column) => {
    const lines = normalizedSource(source).split('\n');
    let offset = 0;
    for (let index = 0; index < Math.max(0, line - 1); index++) offset += lines[index].length + 1;
    return Math.min(normalizedSource(source).length, offset + Math.max(0, column - 1));
};

const cursorContext = (source, line, column) => {
    const text = normalizedSource(source);
    const stop = offsetAt(text, line, column);
    const stack = [];
    let index = 0;
    let pendingIdentifier = null;
    let inComment = false;
    let string = null;
    while (index < stop) {
        const character = text[index];
        if (character === '\n') {
            inComment = false;
            pendingIdentifier = null;
            string = null;
            index++;
            continue;
        }
        if (inComment) {
            index++;
            continue;
        }
        if (string) {
            if (character === '\\') {
                index += 2;
                continue;
            }
            if (character === string.quote) {
                string.end = index + 1;
                string.closed = true;
                string = null;
            }
            index++;
            continue;
        }
        if (character === '#') {
            inComment = true;
            index++;
            continue;
        }
        if (character === '"' || character === "'") {
            string = {quote: character, start: index, end: stop, closed: false};
            pendingIdentifier = null;
            index++;
            continue;
        }
        const identifier = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/);
        if (identifier) {
            pendingIdentifier = identifier[0];
            index += identifier[0].length;
            continue;
        }
        if (character === '(') {
            stack.push({type: 'parenthesis', name: pendingIdentifier, argumentIndex: 0, offset: index});
            pendingIdentifier = null;
        } else if (character === '[') {
            stack.push({type: 'bracket', name: null, argumentIndex: 0, offset: index});
            pendingIdentifier = null;
        } else if (character === ',') {
            if (stack.length && stack[stack.length - 1].name) stack[stack.length - 1].argumentIndex++;
            pendingIdentifier = null;
        } else if (character === ')' || character === ']') {
            stack.pop();
            pendingIdentifier = null;
        } else if (!/\s/.test(character) && character !== '.') {
            pendingIdentifier = null;
        }
        index++;
    }
    const currentLine = text.split('\n')[line - 1] || '';
    const prefixText = currentLine.slice(0, Math.max(0, column - 1));
    const prefixMatch = prefixText.match(/[A-Za-z_][A-Za-z0-9_.]*$/);
    const activeString = string && {
        quote: string.quote,
        startColumn: string.start - offsetAt(text, line, 1) + 1,
        endColumn: (() => {
            const lineEnd = text.indexOf('\n', string.start);
            const rawEnd = string.closed ? string.end : (lineEnd < 0 ? text.length : lineEnd);
            return rawEnd - offsetAt(text, line, 1) + 1;
        })()
    };
    return {
        call: stack.slice().reverse().find(entry => entry.name) || null,
        inComment,
        inString: Boolean(activeString),
        prefix: prefixMatch ? prefixMatch[0] : '',
        replaceRange: activeString ? {
            startLineNumber: line,
            startColumn: activeString.startColumn,
            endLineNumber: line,
            endColumn: Math.max(activeString.startColumn + 1, activeString.endColumn)
        } : {
            startLineNumber: line,
            startColumn: column - (prefixMatch ? prefixMatch[0].length : 0),
            endLineNumber: line,
            endColumn: column
        },
        string: activeString
    };
};

const getCatalog = context => Object.assign(
    {},
    blockRegistry,
    controlRegistry,
    operatorRegistry,
    context && context.extensionCatalog || {}
);

const canonicalCallName = (context, name) => {
    const semanticId = semanticIdsFor(context && context.codeLanguage, name).find(id =>
        /^function\.[^.]+$/.test(id) || /^event\.[^.]+$/.test(id) || /^control\.[^.]+$/.test(id)
    );
    return semanticId ? canonicalFor(semanticId) : name;
};

const localizedName = (context, prefix, name) => preferredFor(
    context && context.codeLanguage,
    `${prefix}.${name}`
);

const documentationFor = (context, name, metadata) => {
    if (context && context.codeLanguage === 'pt-BR') {
        return metadata.documentation || `Comando TextWarp ${name}.`;
    }
    const kind = metadata.kind === 'event' || eventRegistry[name] ? 'event' :
        metadata.kind === 'reporter' || metadata.kind === 'boolean' ? 'reporter' :
            metadata.kind === 'conditional' || metadata.kind === 'loop' ? 'control block' : 'command';
    const opcode = metadata.opcode ? ` backed by Scratch opcode ${metadata.opcode}` : '';
    return `${name} — TextWarp ${kind}${opcode}.`;
};

const codeDocumentation = (context, english, portuguese) =>
    context && context.codeLanguage === 'pt-BR' ? portuguese : english;

const SPECIAL_MENU_OPTIONS = Object.freeze({
    motion_pointtowards_menu: ['_mouse_', '_random_'],
    motion_goto_menu: ['_mouse_', '_random_'],
    motion_glideto_menu: ['_mouse_', '_random_'],
    control_create_clone_of_menu: ['_myself_'],
    sensing_touchingobjectmenu: ['_mouse_', '_edge_'],
    event_touchingobjectmenu: ['_mouse_', '_edge_'],
    sensing_distancetomenu: ['_mouse_'],
    sensing_of_object_menu: ['_stage_']
});

const normalizeCompletionOption = option => {
    if (option && typeof option === 'object') {
        const value = Object.prototype.hasOwnProperty.call(option, 'value') ? option.value :
            Object.prototype.hasOwnProperty.call(option, 'text') ? option.text : option.label;
        const label = option.label || option.text || value;
        return {
            value,
            label: String(label),
            detail: option.detail,
            documentation: option.documentation,
            kind: option.kind
        };
    }
    return {value: option, label: String(option)};
};

const visibleArgumentOptions = (context, call) => {
    if (!call) return [];
    const callName = canonicalCallName(context, call.name);
    call = Object.assign({}, call, {name: callName});
    const metadata = getCatalog(context)[callName] || eventRegistry[callName];
    const args = metadata && metadata.arguments || [];
    const argument = args[call.argumentIndex] ||
        (args.length && args[args.length - 1].variadic ? args[args.length - 1] : null);
    if (!argument) return [];
    const options = []
        .concat(argument.options || [])
        .concat(SPECIAL_MENU_OPTIONS[argument.menuOpcode] || []);
    if (argument.shadowOpcode === 'colour_picker' && !options.length) options.push(...COLOR_OPTIONS);
    const seen = new Set();
    return options.map(normalizeCompletionOption).filter(option => {
        if (option.value === undefined || option.value === null) return false;
        const key = `${typeof option.value}:${String(option.value)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map(option => Object.assign(option, {
        argument,
        callName: call.name
    }));
};

const contextualLiteralAt = (source, line, column) => {
    const text = normalizedSource(source);
    const lineText = text.split('\n')[line - 1] || '';
    const scanned = scanSource(text).filter(token => token.line === line);
    const comment = scanned.find(token => token.type === 'comment');
    const codeEnd = comment ? comment.column - 1 : lineText.length;
    if (column > codeEnd + 1) return null;
    const candidates = scanned.filter(token => ['identifier', 'keyword', 'string'].includes(token.type));
    const numberPattern = /-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/ig;
    let match = null;
    while ((match = numberPattern.exec(lineText.slice(0, codeEnd)))) {
        const start = match.index;
        const end = start + match[0].length;
        const before = start > 0 ? lineText[start - 1] : '';
        const after = end < codeEnd ? lineText[end] : '';
        if (/[A-Za-z0-9_.]/.test(before) || /[A-Za-z0-9_.]/.test(after)) continue;
        candidates.push({
            type: 'number',
            value: Number(match[0]),
            raw: match[0],
            line,
            column: start + 1,
            endColumn: end + 1
        });
    }
    const token = candidates.find(candidate =>
        column >= candidate.column && column < candidate.endColumn
    );
    if (!token) return null;
    return Object.assign({}, token, {
        range: lineRange(token.line, token.column, token.raw)
    });
};

const quoteContextualString = (value, quote = '"') => {
    const string = String(value);
    if (quote === '"') return JSON.stringify(string);
    return `'${string.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
};

const contextualReplacement = (token, value, context, kind) => {
    if (kind === 'boolean') {
        return preferredFor(context && context.codeLanguage, value ? 'literal.true' : 'literal.false');
    }
    if (kind === 'number') return String(value);
    return quoteContextualString(value, token.quote || '"');
};

/*
 * Resolve Blockly-like field controls without taking text editing away from Monaco.
 * A control is only returned for a literal whose active argument has useful type
 * metadata (colour, finite options, boolean or number).
 */
const getContextualValueControl = (source, line, column, context = {}) => {
    const token = contextualLiteralAt(source, line, column);
    if (!token) return null;
    const cursor = cursorContext(source, line, token.column);
    const call = cursor.call;
    const callName = call && canonicalCallName(context, call.name);
    const metadata = callName && (getCatalog(context)[callName] || eventRegistry[callName]);
    const args = metadata && metadata.arguments || [];
    const argument = call && (args[call.argumentIndex] ||
        (args.length && args[args.length - 1].variadic ? args[args.length - 1] : null));
    const options = visibleArgumentOptions(context, call);
    const base = {
        argumentIndex: call ? call.argumentIndex : null,
        argumentName: argument && argument.name || '',
        callName: callName || '',
        range: token.range,
        raw: token.raw,
        value: token.value
    };
    if (argument && argument.shadowOpcode === 'colour_picker' && token.type === 'string') {
        const color = String(token.value || '');
        if (!/^#[0-9a-f]{6}$/i.test(color)) return null;
        return Object.assign(base, {
            kind: 'color',
            value: color.toLowerCase(),
            replacement: value => contextualReplacement(token, value, context, 'color')
        });
    }
    if (argument && options.length && ['string', 'identifier', 'keyword', 'number'].includes(token.type)) {
        return Object.assign(base, {
            kind: 'select',
            options: options.map(option => ({
                label: option.label,
                value: option.value,
                replacement: contextualReplacement(token, option.value, context, 'select')
            }))
        });
    }
    const semanticIds = ['identifier', 'keyword'].includes(token.type) ?
        semanticIdsFor(context && context.codeLanguage, token.raw) : [];
    const booleanValue = semanticIds.includes('literal.true') ? true :
        semanticIds.includes('literal.false') ? false : null;
    if (booleanValue !== null && (!argument || argument.valueType === 'boolean')) {
        return Object.assign(base, {
            kind: 'boolean',
            value: booleanValue,
            values: [false, true].map(value => ({
                value,
                replacement: contextualReplacement(token, value, context, 'boolean')
            }))
        });
    }
    if (argument && argument.valueType === 'number' && token.type === 'number' && Number.isFinite(token.value)) {
        const decimal = token.raw.match(/\.(\d+)/);
        const step = argument.shadowOpcode === 'math_angle' ? 15 :
            decimal ? Math.pow(10, -decimal[1].length) : 1;
        return Object.assign(base, {
            kind: 'number',
            step,
            replacement: value => contextualReplacement(token, value, context, 'number')
        });
    }
    return null;
};

const signature = (name, metadata) => {
    const args = (metadata.arguments || []).map(argument => {
        const optional = argument.optional ? '?' : '';
        const variadic = argument.variadic ? '...' : '';
        return `${variadic}${argument.name}${optional}: ${argument.valueType || argument.role || 'any'}`;
    });
    return `${name}(${args.join(', ')})${metadata.returnType ? ` -> ${metadata.returnType}` : ''}`;
};

const argumentKinds = (metadata, argumentIndex) => {
    const args = metadata && metadata.arguments || [];
    const argument = args[argumentIndex] || (args.length && args[args.length - 1].variadic ? args[args.length - 1] : null);
    if (!argument) return [];
    const role = argument.role;
    const name = String(argument.name || '').toLowerCase();
    if (role === 'broadcast' || /message|broadcast/.test(name)) return ['broadcast'];
    if (role === 'variable') return ['variable'];
    if (role === 'list') return ['list'];
    if (metadata && metadata.opcode === 'sensing_of' && argumentIndex === 0) return ['variable'];
    if (role === 'costume' || /costume|backdrop/.test(name)) return ['costume'];
    if (role === 'sound' || /sound/.test(name)) return ['sound'];
    if (/actor|target|object/.test(name)) return ['actor', 'stage'];
    return [];
};

const visibleResources = (context, call) => {
    if (!call) return [];
    const callName = canonicalCallName(context, call.name);
    call = Object.assign({}, call, {name: callName});
    const metadata = getCatalog(context)[callName] || eventRegistry[callName];
    const kinds = argumentKinds(metadata, call.argumentIndex);
    if (!kinds.length) return [];
    const argument = metadata && (metadata.arguments || [])[call.argumentIndex] || {};
    const name = String(argument.name || '').toLowerCase();
    const stage = (context.resources || []).find(item => item.kind === 'stage');
    return (context.resources || []).filter(item => kinds.includes(item.kind) && (
        !['costume', 'sound'].includes(item.kind) || item.ownerId === (
            /backdrop/.test(name) && stage ? stage.id : context.targetId
        )
    ));
};

const availableHere = (metadata, context) => !(
    context.isStage && metadata.allowStage === false ||
    !context.isStage && metadata.allowSprite === false
);

const snippetForMetadata = (name, metadata, context = {}, prefix = 'function') => {
    const visibleName = localizedName(context, prefix, name);
    const placeholders = (metadata.arguments || []).map((argument, index) => {
        const firstOption = argument.options && argument.options.length ?
            normalizeCompletionOption(argument.options[0]).value : undefined;
        const example = firstOption !== undefined ? JSON.stringify(firstOption) :
            argument.role === 'list' ? 'items' :
            argument.role === 'variable' ? 'value' :
                argument.valueType === 'boolean' ? 'true' :
                    argument.valueType === 'string' || ['menu', 'broadcast', 'field'].includes(argument.role) ?
                        JSON.stringify(
                            Object.prototype.hasOwnProperty.call(argument, 'defaultValue') ?
                                argument.defaultValue : 'value'
                        ) : argument.name === 'seconds' ? '1' : '10';
        const argumentName = preferredFor(context.codeLanguage, `${prefix}.${name}.${argument.name}`);
        return `\${${index + 1}:${argumentName}: ${example}}`;
    });
    const body = placeholders.length + 1;
    let insertText = `${visibleName}(${placeholders.join(', ')})`;
    if (metadata.kind === 'hat' || metadata.kind === 'event') {
        const eventCall = placeholders.length ? insertText : visibleName;
        insertText = `${preferredFor(context.codeLanguage, 'syntax.on')} ${eventCall}:\n    ` +
            `\${${body}:${localizedName(context, 'function', 'wait')}(0)}`;
    } else if (['conditional', 'loop'].includes(metadata.kind)) {
        insertText += `:\n    \${${body}:${localizedName(context, 'function', 'wait')}(0)}`;
        for (let branch = 2; branch <= Math.max(1, Number(metadata.branchCount) || 1); branch++) {
            insertText += `\n${preferredFor(context.codeLanguage, 'syntax.branch')} ${branch}:\n    ` +
                `\${${body + branch - 1}:${localizedName(context, 'function', 'wait')}(0)}`;
        }
    }
    return insertText;
};

const COMMAND_CATEGORY_COLORS = Object.freeze({
    control: '#ffab19',
    events: '#ffbf00',
    extensions: '#0fbd8c',
    functions: '#ff6680',
    looks: '#9966ff',
    motion: '#4c97ff',
    operators: '#59c059',
    sensing: '#5cb1d6',
    sound: '#cf63cf',
    variables: '#ff8c1a'
});

const commandCategory = metadata => {
    const opcode = String(metadata && metadata.opcode || '');
    if (/^motion_/.test(opcode)) return 'motion';
    if (/^looks_/.test(opcode)) return 'looks';
    if (/^sound_/.test(opcode)) return 'sound';
    if (/^event_/.test(opcode)) return 'events';
    if (/^control_/.test(opcode)) return 'control';
    if (/^sensing_/.test(opcode)) return 'sensing';
    if (/^operator_/.test(opcode)) return 'operators';
    if (/^(?:data|procedures)_/.test(opcode)) return /^data_/.test(opcode) ? 'variables' : 'functions';
    return 'extensions';
};

const PORTUGUESE_OPTION_LABELS = Object.freeze({
    '_edge_': 'borda',
    '_mouse_': 'ponteiro do mouse',
    '_myself_': 'este ator',
    '_random_': 'posição aleatória',
    '_stage_': 'palco',
    'all around': 'rotação completa',
    'left-right': 'esquerda e direita',
    'don\'t rotate': 'não girar',
    'front': 'frente',
    'back': 'trás',
    'forward': 'para frente',
    'backward': 'para trás'
});

const ARGUMENT_TYPE_LABELS = Object.freeze({
    'broadcast-field': ['Broadcast', 'Mensagem'],
    'field': ['Option', 'Opção'],
    'input': ['Value', 'Valor'],
    'list': ['List', 'Lista'],
    'menu': ['Option', 'Opção'],
    'variable': ['Variable', 'Variável']
});

const localizedOption = (context, option) => {
    const normalized = normalizeCompletionOption(option);
    const keyId = semanticIdsFor('en-US', normalized.value).find(id => id.startsWith('key.'));
    const translated = keyId ? preferredFor(context.codeLanguage, keyId) :
        context.codeLanguage === 'pt-BR' && PORTUGUESE_OPTION_LABELS[normalized.value];
    return Object.assign({}, normalized, {label: translated || normalized.label});
};

const commandArguments = (context, name, metadata, prefix = 'function') =>
    (metadata && metadata.arguments || []).map((argument, argumentIndex) => {
        const optionValues = []
            .concat(argument.options || [])
            .concat(SPECIAL_MENU_OPTIONS[argument.menuOpcode] || [])
            .map(option => localizedOption(context, option));
        const resourceValues = visibleResources(context, {name, argumentIndex}).map(resource => ({
            label: resource.name,
            value: resource.name
        }));
        const seen = new Set();
        const options = optionValues.concat(resourceValues).filter(option => {
            const key = String(option.value);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const valueType = argument.valueType || argument.role || 'any';
        const typeLabels = ARGUMENT_TYPE_LABELS[valueType];
        const specificArgumentId = `${prefix}.${name}.${argument.name}`;
        const argumentId = canonicalFor(specificArgumentId) ? specificArgumentId : `argument.${argument.name}`;
        return {
            name: preferredFor(context.codeLanguage, argumentId),
            options,
            type: typeLabels ? typeLabels[context.codeLanguage === 'pt-BR' ? 1 : 0] :
                preferredFor(context.codeLanguage, `type.${valueType}`),
            valueType
        };
    });

const previewSnippet = snippet => {
    let preview = String(snippet || '');
    let previous;
    do {
        previous = preview;
        preview = preview.replace(/\$\{\d+:([^{}]*)\}/g, '$1');
    } while (preview !== previous);
    return preview.replace(/\$\{\d+\}/g, '');
};

const getCommandCatalog = (context = {}) => {
    const items = [];
    const add = item => items.push(Object.assign({color: COMMAND_CATEGORY_COLORS[item.category]}, item));
    const word = semanticId => preferredFor(context.codeLanguage, semanticId);
    const pass = word('syntax.pass');
    const trueWord = word('literal.true');

    Object.entries(eventRegistry).forEach(([name, metadata]) => {
        if (!availableHere(metadata, context)) return;
        const visibleName = localizedName(context, 'event', name);
        const snippet = snippetForMetadata(name, Object.assign({}, metadata, {kind: 'event'}), context, 'event');
        add({
            id: `event.${name}`,
            category: 'events',
            label: `${word('syntax.on')} ${visibleName}`,
            searchText: `${name} ${visibleName}`,
            documentation: documentationFor(context, name, metadata),
            arguments: commandArguments(context, name, metadata, 'event'),
            preview: previewSnippet(snippet),
            snippet
        });
    });

    [
        ['if', `${word('control.if')} \${1:${trueWord}}:\n    \${2:${pass}}`],
        ['repeat', `${word('control.repeat')}(\${1:10}):\n    \${2:${pass}}`],
        ['repeat_until', `${word('control.repeat_until')}(\${1:${trueWord}}):\n    \${2:${pass}}`],
        ['while', `${word('control.while')}(\${1:${trueWord}}):\n    \${2:${pass}}`],
        ['forever', `${word('control.forever')}:\n    \${1:${pass}}`],
        ['return', `${word('syntax.return')} \${1:value}`],
        ['pass', pass]
    ].forEach(([name, snippet]) => {
        const controlArguments = {
            if: [{name: 'condition', valueType: 'boolean'}],
            repeat: [{name: 'count', valueType: 'number'}],
            repeat_until: [{name: 'condition', valueType: 'boolean'}],
            return: [{name: 'value', valueType: 'any'}],
            while: [{name: 'condition', valueType: 'boolean'}]
        };
        const metadata = Object.assign({}, controlRegistry[name], {arguments: controlArguments[name] || []});
        add({
            id: `control.${name}`,
            category: 'control',
            label: snippet.split(/[\s(:]/)[0],
            searchText: name,
            documentation: controlRegistry[name] ? documentationFor(context, name, controlRegistry[name]) :
                `TextWarp ${name}.`,
            arguments: commandArguments(context, name, metadata, 'control'),
            preview: previewSnippet(snippet),
            snippet
        });
    });

    Object.entries(Object.assign({}, blockRegistry, context.extensionCatalog || {})).forEach(([name, metadata]) => {
        if (!metadata || !availableHere(metadata, context)) return;
        const label = metadata.displayName || metadata.canonicalName || localizedName(context, 'function', name);
        const category = commandCategory(metadata);
        const snippet = snippetForMetadata(name, metadata, context);
        add({
            id: metadata.semanticId || `function.${name}`,
            category,
            label,
            searchText: `${name} ${label}`,
            documentation: documentationFor(context, name, metadata),
            arguments: commandArguments(context, name, metadata),
            preview: previewSnippet(snippet),
            snippet
        });
    });

    const operatorSnippets = {
        '+': '\${1:a} + \${2:b}', '-': '\${1:a} - \${2:b}', '*': '\${1:a} * \${2:b}',
        '/': '\${1:a} / \${2:b}', '%': '\${1:a} % \${2:b}', '<': '\${1:a} < \${2:b}',
        '==': '\${1:a} == \${2:b}', '>': '\${1:a} > \${2:b}',
        and: `\${1:${trueWord}} ${word('operator.and')} \${2:${trueWord}}`,
        or: `\${1:${trueWord}} ${word('operator.or')} \${2:${trueWord}}`,
        not: `${word('operator.not')} \${1:${trueWord}}`
    };
    Object.entries(operatorRegistry).forEach(([name, metadata]) => {
        const snippet = operatorSnippets[name] || name;
        add({
            id: `operator.${name}`,
            category: 'operators',
            label: ['and', 'or', 'not'].includes(name) ? word(`operator.${name}`) : name,
            searchText: name,
            documentation: documentationFor(context, name, metadata),
            arguments: commandArguments(context, name, metadata, 'operator'),
            preview: previewSnippet(snippet),
            snippet
        });
    });

    [
        ['variables', 'syntax.variable', `${word('syntax.variable')} \${1:name} = \${2:0}`],
        ['variables', 'syntax.list', `${word('syntax.list')} \${1:items} = [\${2}]`],
        ['functions', 'syntax.procedure',
            `${word('syntax.procedure')} \${1:name}(\${2:value: ${word('type.any')}}):\n    \${3:${pass}}`]
    ].forEach(([category, semanticId, snippet]) => add({
        id: semanticId,
        category,
        label: word(semanticId),
        searchText: semanticId,
        documentation: `TextWarp ${semanticId.split('.')[1]}.`,
        arguments: [],
        preview: previewSnippet(snippet),
        snippet
    }));

    (context.resources || []).filter(resource => ['variable', 'list'].includes(resource.kind)).forEach(resource => add({
        id: `resource.${resource.kind}.${resource.id}`,
        category: 'variables',
        label: resource.name,
        searchText: `${resource.name} ${resource.ownerName || ''}`,
        documentation: resource.detail,
        snippet: resource.name
    }));

    const seen = new Set();
    return items.filter(item => {
        const key = `${item.id}:${item.snippet}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label));
};

const getCompletions = (source, line, column, context = {}) => {
    const cursor = cursorContext(source, line, column);
    if (cursor.inComment) return [];
    const canonicalSource = canonicalizeSource(source, context.codeLanguage).source;
    const index = createDocumentIndex(canonicalSource, context.targetId || 'target');
    const stringToken = tokenAt(index, line, column, ['string']);
    if (cursor.inString && stringToken) {
        cursor.replaceRange = lineRange(stringToken.line, stringToken.column, stringToken.raw);
        cursor.prefix = stringToken.raw.slice(
            1,
            Math.max(1, Math.min(stringToken.raw.length - (stringToken.closed ? 1 : 0), column - stringToken.column))
        );
    }
    const currentLine = normalizedSource(source).split('\n')[line - 1] || '';
    const baseIndent = currentLine.match(/^\s*/)[0];
    const suggestions = [];
    const append = item => {
        if (cursor.prefix) {
            const prefix = cursor.prefix.toLowerCase();
            const candidate = `${item.label || ''} ${item.filterText || ''}`.toLowerCase();
            const terms = candidate.split(/[^a-z0-9_.]+/).flatMap(term => term.split(/[._]+/));
            if (!candidate.startsWith(prefix) && !terms.some(term => term.startsWith(prefix))) return;
        }
        const adjusted = Object.assign({range: cursor.replaceRange}, item);
        if (adjusted.callName && currentLine[column - 1] === '(') {
            adjusted.insertText = adjusted.callName;
            adjusted.snippet = false;
        }
        if (adjusted.snippet && baseIndent && adjusted.insertText.includes('\n')) {
            adjusted.insertText = adjusted.insertText.replace(/\n/g, `\n${baseIndent}`);
        }
        suggestions.push(adjusted);
    };

    visibleArgumentOptions(context, cursor.call).forEach(option => append({
        id: `option:${option.callName}:${cursor.call.argumentIndex}:${String(option.value)}`,
        label: option.label,
        kind: option.kind || (option.argument.shadowOpcode === 'colour_picker' ? 'color' : 'option'),
        detail: option.detail || `${option.argument.name} option · ${option.callName}`,
        documentation: option.documentation || `Valid value for ${option.callName}(${option.argument.name}).`,
        insertText: JSON.stringify(option.value),
        sortText: `00-option-${option.label}`
    }));
    visibleResources(context, cursor.call).forEach(item => append({
        id: `resource:${item.kind}:${item.id}`,
        label: item.name,
        kind: 'resource',
        detail: `${item.kindLabel || item.kind} · ${item.ownerName || 'project'}`,
        documentation: item.detail || `Project resource ${item.id}.`,
        insertText: JSON.stringify(item.name),
        sortText: `00-${item.name}`
    }));
    if (cursor.inString) return suggestions;

    index.symbols.filter(symbol => ['variable', 'list', 'procedure'].includes(symbol.kind)).forEach(symbol => append({
        id: symbol.id,
        label: symbol.name,
        kind: symbol.kind,
        detail: symbol.detail,
        documentation: `${symbol.detail} in the current module.`,
        callName: symbol.kind === 'procedure' ? symbol.name : null,
        insertText: symbol.kind === 'procedure' ?
            `${symbol.name}(${(symbol.parameters || []).map((parameter, parameterIndex) =>
                `\${${parameterIndex + 1}:${parameter.name}}`
            ).join(', ')})` : symbol.name,
        snippet: symbol.kind === 'procedure',
        sortText: `10-${symbol.name}`
    }));
    index.symbols.filter(symbol =>
        symbol.kind === 'parameter' && containsPosition(symbol.scopeRange, line, column)
    ).forEach(symbol => append({
        id: symbol.id,
        label: symbol.name,
        kind: 'parameter',
        detail: symbol.detail,
        documentation: symbol.detail,
        insertText: symbol.name,
        sortText: `01-${symbol.name}`
    }));

    const ownNames = new Set(index.symbols.map(symbol => symbol.name));
    const stageResource = (context.resources || []).find(item => item.kind === 'stage');
    (context.resources || []).filter(item =>
        ['variable', 'list'].includes(item.kind) &&
        !ownNames.has(item.name) &&
        (
            item.ownerId === context.targetId ||
            stageResource && item.ownerId === stageResource.id ||
            item.global
        )
    ).forEach(item => append({
        id: `resource-symbol:${item.kind}:${item.id}`,
        label: item.name,
        kind: item.kind,
        detail: `${item.kindLabel || item.kind} · ${item.ownerName || 'project'}`,
        documentation: item.detail || `Project symbol ${item.id}.`,
        insertText: item.name,
        sortText: `11-${item.ownerName || ''}-${item.name}`
    }));

    const topLevel = baseIndent.length === 0;
    if (topLevel) {
        const word = semanticId => preferredFor(context.codeLanguage, semanticId);
        const declarations = [
            [word('syntax.variable'), `${word('syntax.variable')} \${1:name} = \${2:0}`,
                codeDocumentation(context, 'Declare a variable.', 'Declare uma variável.')],
            [word('syntax.list'), `${word('syntax.list')} \${1:items} = [\${2}]`,
                codeDocumentation(context, 'Declare a list.', 'Declare uma lista.')],
            [word('syntax.stack'), `${word('syntax.stack')}:\n    \${1:${word('syntax.pass')}}`,
                codeDocumentation(context, 'Preserve a command stack without an event.',
                    'Preserve uma pilha de comandos sem evento.')],
            [word('syntax.reporter'), `${word('syntax.reporter')} \${1:expression}`,
                codeDocumentation(context, 'Preserve a disconnected reporter block.',
                    'Preserve um bloco repórter desconectado.')],
            [word('syntax.procedure'), `${word('syntax.procedure')} \${1:name}(\${2:value: ${word('type.any')}}):\n    \${3:${word('syntax.pass')}}`,
                codeDocumentation(context, 'Declare a procedure.', 'Declare um procedimento.')],
            [
                'procedure with return',
                `${word('syntax.procedure')} \${1:name}(\${2:value: ${word('type.number')}}) -> ` +
                    `\${3:${word('type.number')}}:\n    ${word('syntax.return')} \${4:value}`,
                codeDocumentation(context, 'Declare a reporter procedure.', 'Declare um procedimento repórter.')
            ]
        ];
        if (!index.symbols.some(symbol => ['actor', 'stage'].includes(symbol.kind))) {
            declarations.unshift(context.isStage ?
                [word('syntax.stage'), word('syntax.stage'),
                    codeDocumentation(context, 'Declare the stage module.', 'Declare o módulo do palco.')] :
                [word('syntax.actor'), `${word('syntax.actor')} \${1:name}`,
                    codeDocumentation(context, 'Declare an actor module.', 'Declare um módulo de ator.')]);
        }
        if (context.isStage) {
            declarations.splice(2, 0, [
                'global variable',
                `${word('syntax.global')} ${word('syntax.variable')} \${1:name} = \${2:0}`,
                codeDocumentation(context, 'Declare a project variable on the stage.',
                    'Declare uma variável do projeto no palco.')
            ]);
        }
        declarations.forEach(([label, insertText, documentation], snippetIndex) => append({
            id: `declaration:${label}`,
            label,
            kind: 'snippet',
            documentation,
            insertText,
            snippet: true,
            sortText: `20-${snippetIndex}`
        }));
        Object.entries(eventRegistry).forEach(([name, metadata]) => {
            if (!availableHere(metadata, context)) return;
            append({
                id: `event:${name}`,
                label: `${word('syntax.on')} ${localizedName(context, 'event', name)}`,
                filterText: `${word('syntax.on')} ${localizedName(context, 'event', name)} on ${name}`,
                kind: 'event',
                documentation: documentationFor(context, name, metadata),
                insertText: snippetForMetadata(name, Object.assign({}, metadata, {kind: 'event'}), context, 'event'),
                snippet: true,
                sortText: `21-${name}`
            });
        });
    } else {
        const controlWord = name => preferredFor(context.codeLanguage, `control.${name}`);
        const pass = preferredFor(context.codeLanguage, 'syntax.pass');
        const trueWord = preferredFor(context.codeLanguage, 'literal.true');
        [
            ['if', `${controlWord('if')} \${1:${trueWord}}:\n    \${2:${pass}}`],
            ['repeat', `${controlWord('repeat')}(\${1:10}):\n    \${2:${pass}}`],
            ['repeat_until', `${controlWord('repeat_until')}(\${1:${trueWord}}):\n    \${2:${pass}}`],
            ['while', `${controlWord('while')}(\${1:${trueWord}}):\n    \${2:${pass}}`],
            ['forever', `${controlWord('forever')}:\n    \${1:${pass}}`],
            ['return', `${preferredFor(context.codeLanguage, 'syntax.return')} \${1:value}`],
            ['pass', pass]
        ].forEach(([name, insertText], snippetIndex) => append({
            id: `control:${name}`,
            label: name === 'return' || name === 'pass' ? insertText.split(/\s/)[0] : controlWord(name),
            kind: 'snippet',
            documentation: controlRegistry[name] ? documentationFor(context, name, controlRegistry[name]) :
                `TextWarp ${name}.`,
            insertText,
            snippet: true,
            sortText: `20-${snippetIndex}`
        }));
        Object.entries(Object.assign({}, blockRegistry, operatorRegistry, context.extensionCatalog || {}))
            .forEach(([name, metadata]) => {
                if (!metadata || !availableHere(metadata, context)) return;
                const label = metadata.displayName || metadata.canonicalName || localizedName(context, 'function', name);
                append({
                    id: metadata.semanticId || `catalog:${name}`,
                    label,
                    filterText: `${label} ${name}`,
                    kind: metadata.kind || 'function',
                    detail: signature(label, metadata),
                    documentation: documentationFor(context, name, metadata),
                    callName: label,
                    insertText: snippetForMetadata(name, metadata, context),
                    snippet: true,
                    sortText: `30-${label}`
                });
            });
        [
            ['and', 'operator.and'],
            ['or', 'operator.or'],
            ['not', 'operator.not'],
            ['true', 'literal.true'],
            ['false', 'literal.false']
        ].forEach(([keyword, semanticId], keywordIndex) => append({
            id: `keyword:${semanticId}`,
            label: preferredFor(context.codeLanguage, semanticId),
            kind: 'keyword',
            documentation: `TextWarp ${keyword}.`,
            insertText: preferredFor(context.codeLanguage, semanticId),
            sortText: `40-${keywordIndex}`
        }));
    }

    const seen = new Set();
    return suggestions.filter(item => {
        const key = item.id || `${item.label}:${item.insertText}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const localizedSymbolDetail = (symbol, locale) => {
    if (/^pt(?:-|$)/i.test(String(locale || 'pt'))) return symbol.detail;
    const labels = {
        actor: 'Actor',
        event: 'Event',
        list: 'List',
        parameter: `Parameter of ${symbol.procedure}`,
        procedure: 'Procedure',
        stage: 'Stage',
        variable: 'Variable'
    };
    return `${symbol.global ? 'Global · ' : ''}${labels[symbol.kind] || symbol.detail}`;
};

const documentDisplayName = (modelKey, context = {}) => {
    const document = (context.documents || []).find(candidate =>
        (candidate.modelKey || candidate.targetId) === modelKey
    );
    if (document) return document.fileName || document.name || modelKey;
    if (
        modelKey === (context.targetId || context.modelKey) &&
        (context.targetName || context.isStage)
    ) {
        return context.isStage ? 'stage.tw' : `${context.targetName}.tw`;
    }
    return modelKey;
};

const getHover = (source, line, column, context = {}) => {
    const localizedToken = scanSource(source).find(token =>
        token.line === line && column >= token.column && column <= token.endColumn
    );
    if (localizedToken && localizedToken.type === 'identifier') {
        const semanticId = semanticIdsFor(context.codeLanguage, localizedToken.value).find(id =>
            /^function\.[^.]+$/.test(id) || /^event\.[^.]+$/.test(id) || /^control\.[^.]+$/.test(id)
        );
        const canonicalName = semanticId && canonicalFor(semanticId);
        const metadata = canonicalName && (getCatalog(context)[canonicalName] || eventRegistry[canonicalName]);
        if (metadata) return {
            range: lineRange(localizedToken.line, localizedToken.column, localizedToken.raw),
            title: metadata.kind || 'TextWarp command',
            code: signature(preferredFor(context.codeLanguage, semanticId), Object.assign({}, metadata, {
                arguments: (metadata.arguments || []).map(argument => Object.assign({}, argument, {
                    name: preferredFor(context.codeLanguage, `${semanticId}.${argument.name}`)
                }))
            })),
            documentation: documentationFor(context, canonicalName, metadata)
        };
    }
    const resource = getResourceAt(source, line, column, context);
    if (resource) {
        const index = createDocumentIndex(source, context.targetId || 'target');
        const stringToken = tokenAt(index, line, column, ['string']);
        return {
            range: lineRange(stringToken.line, stringToken.column, stringToken.raw),
            title: resource.kindLabel || resource.kind,
            code: resource.name,
            documentation: resource.detail || `Project resource ${resource.id}.`
        };
    }
    const resolved = resolveSymbolAt(source, line, column, context);
    if (resolved) {
        const symbol = resolved.symbol;
        const detail = localizedSymbolDetail(symbol, context.locale);
        return {
            range: lineRange(resolved.token.line, resolved.token.column, resolved.token.raw),
            title: detail,
            code: symbol.kind === 'procedure' ?
                `${symbol.name}(${(symbol.parameters || []).map(parameter =>
                    `${parameter.name}: ${parameter.valueType || 'any'}`
                ).join(', ')})${symbol.returnType ? ` -> ${symbol.returnType}` : ''}` :
                symbol.name,
            documentation: `${detail} declared in ${documentDisplayName(symbol.modelKey, context)}.`
        };
    }
    const index = createDocumentIndex(source, context.targetId || 'target');
    const identifier = tokenAt(index, line, column);
    if (!identifier) return null;
    const metadata = getCatalog(context)[identifier.value] || eventRegistry[identifier.value];
    if (metadata) return {
        range: lineRange(identifier.line, identifier.column, identifier.raw),
        title: metadata.kind || 'TextWarp command',
        code: signature(metadata.displayName || identifier.value, metadata),
        documentation: documentationFor(context, identifier.value, metadata)
    };
    const matchingResources = (context.resources || []).filter(item => item.name === identifier.value);
    if (matchingResources.length === 1) {
        const resource = matchingResources[0];
        return {
            range: lineRange(identifier.line, identifier.column, identifier.raw),
            title: resource.kindLabel || resource.kind,
            code: resource.name,
            documentation: resource.detail || `Project resource ${resource.id}.`
        };
    }
    return null;
};

const getSignatureHelp = (source, line, column, context = {}) => {
    const cursor = cursorContext(source, line, column);
    const call = cursor.call;
    if (!call) return null;
    const index = createDocumentIndex(source, context.targetId || 'target');
    const own = index.symbols.find(symbol => symbol.kind === 'procedure' && symbol.name === call.name);
    if (own) {
        const parameters = own.parameters.map(parameter => ({
            label: parameter.name,
            documentation: `${parameter.name}: ${parameter.valueType}`
        }));
        const entry = {
            label: `${own.name}(${own.parameters.map(parameter =>
                `${parameter.name}: ${parameter.valueType}`
            ).join(', ')})${own.returnType ? ` -> ${own.returnType}` : ''}`,
            documentation: `Procedure declared in ${documentDisplayName(own.modelKey, context)}.`,
            parameters
        };
        return Object.assign({}, entry, {
            activeParameter: Math.min(call.argumentIndex, Math.max(0, parameters.length - 1)),
            activeSignature: 0,
            signatures: [entry]
        });
    }
    const callName = canonicalCallName(context, call.name);
    const metadata = getCatalog(context)[callName] || eventRegistry[callName];
    if (!metadata) return null;
    const semanticId = `${eventRegistry[callName] ? 'event' : 'function'}.${callName}`;
    const localizedArgumentType = argument => {
        const type = argument.valueType || argument.role || 'any';
        return ['any', 'number', 'string', 'boolean'].includes(type) ?
            preferredFor(context.codeLanguage, `type.${type}`) : type;
    };
    const variants = Array.isArray(metadata.overloads) && metadata.overloads.length ?
        metadata.overloads.map(overload => Object.assign({}, metadata, overload)) : [metadata];
    const signatures = variants.map(variant => {
        const localizedArguments = (variant.arguments || []).map(argument => Object.assign({}, argument, {
            name: preferredFor(context.codeLanguage, `${semanticId}.${argument.name}`),
            valueType: localizedArgumentType(argument)
        }));
        return {
            label: signature(
                localizedName(context, eventRegistry[callName] ? 'event' : 'function', callName),
                Object.assign({}, variant, {arguments: localizedArguments})
            ),
            documentation: documentationFor(context, callName, variant),
            parameters: localizedArguments.map(argument => ({
                label: argument.name,
                documentation: `${argument.valueType}${
                    argument.optional ? ' (optional)' : ''
                }${argument.variadic ? ' (variadic)' : ''}${
                    Object.prototype.hasOwnProperty.call(argument, 'defaultValue') ?
                        ` · default ${argument.defaultValue}` : ''
                }`
            }))
        };
    });
    const activeSignature = Math.max(0, variants.findIndex(variant => {
        const args = variant.arguments || [];
        return call.argumentIndex < args.length || Boolean(args.length && args[args.length - 1].variadic);
    }));
    const selected = signatures[activeSignature] || signatures[0];
    const lastParameter = Math.max(0, selected.parameters.length - 1);
    return Object.assign({}, selected, {
        activeParameter: Math.min(call.argumentIndex, lastParameter),
        activeSignature,
        signatures
    });
};

const getResourceAt = (source, line, column, context = {}) => {
    const cursor = cursorContext(source, line, column);
    const index = createDocumentIndex(source, context.targetId || 'target');
    const stringToken = tokenAt(index, line, column, ['string']);
    if (!stringToken || !cursor.call) return null;
    const candidates = visibleResources(context, cursor.call).filter(resource => resource.name === stringToken.value);
    return candidates.length === 1 ? candidates[0] : null;
};

const codeBeforeComment = line => {
    let quote = null;
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (quote && character === '\\') {
            escaped = true;
            continue;
        }
        if (character === '"' || character === "'") {
            if (quote === character) quote = null;
            else if (!quote) quote = character;
            continue;
        }
        if (character === '#' && !quote) return line.slice(0, index).trimEnd();
    }
    return line.trimEnd();
};

const formatCanonicalText = source => {
    const text = normalizedSource(source);
    const lines = text.split('\n');
    const reparableCodes = new Set(['empty-block', 'indent-tabs', 'invalid-indent', 'top-level-indent']);
    const unsafe = parseText(text).diagnostics.some(item => (
        !reparableCodes.has(item.code) &&
        !(
            item.code === 'unknown-top-level' &&
            /^(?:(?:else|branch\s+\d+|if\b.*|repeat\b.*|repeat_until\b.*|while\b.*|forever)\s*:|return\b|pass$|[A-Za-z_][A-Za-z0-9_.]*\s*(?:\(|[+\-]?=))/
                .test((lines[item.line - 1] || '').trim())
        )
    ));
    if (unsafe) return text;
    const stack = [];
    const output = lines.map(rawLine => {
        const trimmed = rawLine.trim();
        if (!trimmed) return '';
        const code = codeBeforeComment(trimmed);
        const topLevel = /^(?:actor|stage|global\s+(?:variable|list)|variable|list|procedure|on|stack|reporter)\b/
            .test(code);
        const originalIndent = rawLine.match(/^[ \t]*/)[0]
            .replace(/\t/g, '    ')
            .length;
        const branch = code.match(/^(else|branch\s+\d+)\s*:/);
        let level;
        if (topLevel) {
            stack.length = 0;
            level = 0;
        } else if (branch) {
            const expectedKind = branch[1] === 'else' ? 'if' : 'flow';
            let matchingIndex = -1;
            for (let index = stack.length - 1; index >= 0; index--) {
                if (stack[index].kind === expectedKind) {
                    matchingIndex = index;
                    break;
                }
            }
            if (matchingIndex >= 0) {
                const matching = stack[matchingIndex];
                level = matching.level;
                stack.splice(matchingIndex);
                stack.push({
                    kind: branch[1] === 'else' ? 'else' : 'branch',
                    level,
                    originalIndent
                });
            } else {
                level = Math.max(0, stack.length - 1);
            }
        } else {
            while (
                stack.length &&
                (
                    originalIndent < stack[stack.length - 1].originalIndent ||
                    originalIndent === stack[stack.length - 1].originalIndent && stack.length > 1
                )
            ) stack.pop();
            level = stack.length;
        }
        const rendered = `${' '.repeat(level * 4)}${trimmed}`;
        if (!branch && /:\s*$/.test(code)) {
            const kind = /^if\b/.test(code) ? 'if' :
                /^(?:actor|stage|procedure|on|stack|repeat|repeat_until|while|forever)\b/.test(code) ?
                    'block' : 'flow';
            stack.push({kind, level, originalIndent});
        }
        return rendered;
    });
    return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
};

const formatText = (source, context = {}) => {
    const canonical = canonicalizeSource(source, context.codeLanguage).source;
    return localizeSource(formatCanonicalText(canonical), context.codeLanguage).source;
};

const getOutline = source => getDocumentSymbols(source);

const DIAGNOSTIC_SUGGESTIONS = {
    en: {
        indent: 'Use blocks of four spaces. Format Document can repair the structure.',
        resource: 'Choose an existing resource from Project or insert it with the plus button.',
        unknownCall: 'Check the spelling, open the integrated reference, or choose an autocomplete suggestion.',
        unknownVariable: 'Declare the name at the start of the module or select an existing variable/list.',
        argument: 'Open signature help to check parameter names, types, and optional arguments.',
        delimiter: 'Close the indicated delimiter; the editor also provides automatic closing.',
        target: 'Update the reference from the current project state.'
    },
    pt: {
        indent: 'Use blocos de quatro espaços; Formatar documento pode corrigir a estrutura.',
        resource: 'Escolha um recurso existente em Projeto ou insira-o pelo botão de adição.',
        unknownCall: 'Confira a grafia, abra a referência integrada ou escolha uma sugestão do autocompletar.',
        unknownVariable: 'Declare o nome no início do módulo ou selecione uma variável/lista existente.',
        argument: 'Abra a ajuda de assinatura para conferir nomes, tipos e parâmetros opcionais.',
        delimiter: 'Feche o delimitador indicado; o editor também oferece fechamento automático.',
        target: 'Atualize a referência a partir do estado atual do projeto.'
    }
};

const getDiagnosticSuggestion = (diagnostic, locale = 'pt') => {
    const messages = DIAGNOSTIC_SUGGESTIONS[/^pt(?:-|$)/i.test(locale) ? 'pt' : 'en'];
    const code = diagnostic && diagnostic.code || '';
    if (/indent/.test(code)) return messages.indent;
    if (code === 'missing-project-resource') return messages.resource;
    if (/unknown-call|unknown-event/.test(code)) return messages.unknownCall;
    if (/unknown-variable|expected-variable|expected-list|invalid-symbol-type/.test(code)) {
        return messages.unknownVariable;
    }
    if (/arity|argument|parameter/.test(code)) return messages.argument;
    if (/parenthesis|string|bracket/.test(code)) return messages.delimiter;
    if (/target-kind|project-resource/.test(code)) return messages.target;
    return '';
};

const getFoldingRanges = source => {
    const lines = normalizedSource(source).split('\n');
    const ranges = [];
    const stack = [];
    lines.forEach((line, index) => {
        const code = codeBeforeComment(line).trim();
        if (!code) return;
        const indent = line.match(/^\s*/)[0].replace(/\t/g, '    ').length;
        while (stack.length && indent <= stack[stack.length - 1].indent) {
            const entry = stack.pop();
            if (index > entry.line + 1) ranges.push({start: entry.line + 1, end: index});
        }
        if (/:\s*$/.test(code)) stack.push({indent, line: index});
    });
    while (stack.length) {
        const entry = stack.pop();
        if (lines.length > entry.line + 1) ranges.push({start: entry.line + 1, end: lines.length});
    }
    return ranges;
};

const getSemanticTokens = (source, context = {}) => {
    const index = createDocumentIndex(source, context.targetId || 'target');
    const workspace = createWorkspaceIndex(source, context);
    const document = workspace.byKey.get(workspace.currentKey) || {index, modelKey: index.modelKey};
    const symbolTypes = {
        variable: 'variable',
        list: 'variable',
        procedure: 'function',
        parameter: 'parameter',
        event: 'event',
        actor: 'namespace',
        stage: 'namespace'
    };
    return index.tokens.filter(token => token.type === 'identifier').map(token => {
        const declaration = index.symbols.find(symbol =>
            symbol.name === token.value && containsPosition(symbol.range, token.line, token.column)
        );
        const symbol = declaration || resolveName(workspace, document, token.value, token.line);
        const metadata = getCatalog(context)[token.value] || eventRegistry[token.value];
        const type = symbol ? symbolTypes[symbol.kind] : metadata ? 'function' : null;
        return type ? {
            line: token.line,
            column: token.column,
            length: token.raw.length,
            type,
            declaration: Boolean(symbol && containsPosition(symbol.range, token.line, token.column))
        } : null;
    }).filter(Boolean);
};

const getInlayHints = (source, context = {}) => {
    const hints = [];
    const index = createDocumentIndex(source, context.targetId || 'target');
    const tokens = scanSource(source);
    tokens.forEach((callToken, tokenIndex) => {
        const opening = tokens[tokenIndex + 1];
        if (callToken.type !== 'identifier' || !opening || opening.value !== '(') return;
        const previous = tokens[tokenIndex - 1];
        if (
            previous &&
            previous.line === callToken.line &&
            previous.type === 'keyword' &&
            ['on', 'procedure'].includes(previous.value)
        ) return;
        const procedure = index.symbols.find(symbol =>
            symbol.kind === 'procedure' && symbol.name === callToken.value
        );
        const metadata = getCatalog(context)[callToken.value] || eventRegistry[callToken.value] ||
            (procedure ? {
                arguments: procedure.parameters.map(parameter => ({
                    name: parameter.name,
                    valueType: parameter.valueType
                }))
            } : null);
        const parameters = metadata && metadata.arguments || [];
        if (!parameters.length) return;
        let argumentIndex = 0;
        let parenthesisDepth = 0;
        let bracketDepth = 0;
        let expectingArgument = true;
        for (let index = tokenIndex + 2; index < tokens.length; index++) {
            const token = tokens[index];
            if (token.type === 'comment') continue;
            if (token.value === '(') {
                if (expectingArgument) {
                    const parameter = parameters[argumentIndex] ||
                        (parameters[parameters.length - 1].variadic ? parameters[parameters.length - 1] : null);
                    if (parameter) hints.push({
                        line: token.line,
                        column: token.column,
                        label: `${parameter.name}:`
                    });
                    expectingArgument = false;
                }
                parenthesisDepth++;
                continue;
            }
            if (token.value === ')') {
                if (parenthesisDepth === 0 && bracketDepth === 0) break;
                parenthesisDepth = Math.max(0, parenthesisDepth - 1);
                continue;
            }
            if (token.value === '[') {
                if (expectingArgument) {
                    const parameter = parameters[argumentIndex] ||
                        (parameters[parameters.length - 1].variadic ? parameters[parameters.length - 1] : null);
                    if (parameter) hints.push({
                        line: token.line,
                        column: token.column,
                        label: `${parameter.name}:`
                    });
                    expectingArgument = false;
                }
                bracketDepth++;
                continue;
            }
            if (token.value === ']') {
                bracketDepth = Math.max(0, bracketDepth - 1);
                continue;
            }
            if (token.value === ',' && parenthesisDepth === 0 && bracketDepth === 0) {
                argumentIndex++;
                expectingArgument = true;
                continue;
            }
            if (expectingArgument) {
                const parameter = parameters[argumentIndex] ||
                    (parameters[parameters.length - 1].variadic ? parameters[parameters.length - 1] : null);
                if (parameter) hints.push({
                    line: token.line,
                    column: token.column,
                    label: `${parameter.name}:`
                });
                expectingArgument = false;
            }
        }
    });
    return hints.sort((left, right) =>
        left.line - right.line || left.column - right.column
    );
};

const clearLanguageServiceCache = () => {
    indexCache.clear();
    indexCacheBytes = 0;
};

module.exports = {
    clearDocumentIndexes,
    KEYWORDS,
    canRename,
    clearLanguageServiceCache,
    createDocumentIndex,
    createWorkspaceIndex,
    cursorContext,
    findDefinitions,
    findIdentifierAt,
    findReferences,
    formatText,
    getCompletions,
    getCommandCatalog,
    getContextualValueControl,
    getDefinitionLocations,
    getDiagnosticSuggestion,
    getDocumentIndexCacheStats,
    getDocumentSymbols,
    getFoldingRanges,
    getHover,
    getInlayHints,
    getOutline,
    getParameterScopes,
    getReferenceLocations,
    getRenamePlan,
    getResourceAt,
    getSemanticTokens,
    getSignatureHelp,
    identifierRanges,
    renameEdits,
    resolveSymbolAt,
    scanSource,
    signature
};
