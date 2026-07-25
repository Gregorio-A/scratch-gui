'use strict';

const {blockRegistry, controlRegistry, eventRegistry, operatorRegistry} = require('./block-registry');
const {parseText} = require('./parser');

const KEYWORDS = new Set([
    'actor', 'stage', 'on', 'global', 'variable', 'list', 'procedure', 'if', 'else', 'repeat',
    'repeat_until', 'while', 'forever', 'return', 'warp', 'branch', 'pass', 'any', 'number',
    'string', 'boolean', 'and', 'or', 'not', 'true', 'false'
]);

const INDEX_CACHE_LIMIT = 80;
const indexCache = new Map();

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

const identifierRanges = source => scanSource(source).filter(token => token.type === 'identifier').map(token => ({
    name: token.value,
    line: token.line,
    column: token.column,
    endColumn: token.endColumn
}));

const findIdentifierAt = (source, line, column) => identifierRanges(source).find(range =>
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
    const cacheKey = `${modelKey}\u0000${text}`;
    if (indexCache.has(cacheKey)) return indexCache.get(cacheKey);
    const lines = text.split('\n');
    const parsed = parseText(text);
    const ast = parsed.ast;
    const symbols = [];
    const topLevelLines = []
        .concat(ast.declarations, ast.procedures, ast.scripts)
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
    indexCache.set(cacheKey, index);
    if (indexCache.size > INDEX_CACHE_LIMIT) indexCache.delete(indexCache.keys().next().value);
    return index;
};

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
    const ranges = identifierRanges(source).filter(range => range.name === name);
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
    const ranges = identifierRanges(source).filter(range => range.name === oldName);
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
    if (role === 'costume' || /costume|backdrop/.test(name)) return ['costume'];
    if (role === 'sound' || /sound/.test(name)) return ['sound'];
    if (/actor|target|object/.test(name)) return ['actor', 'stage'];
    return [];
};

const visibleResources = (context, call) => {
    if (!call) return [];
    const metadata = getCatalog(context)[call.name] || eventRegistry[call.name];
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

const snippetForMetadata = (name, metadata) => {
    const placeholders = (metadata.arguments || []).map((argument, index) => {
        const example = argument.role === 'list' ? 'items' :
            argument.role === 'variable' ? 'value' :
                argument.valueType === 'boolean' ? 'true' :
                    argument.valueType === 'string' || ['menu', 'broadcast', 'field'].includes(argument.role) ?
                        '"value"' : argument.name === 'seconds' ? '1' : '10';
        return `\${${index + 1}:${example}}`;
    });
    const body = placeholders.length + 1;
    let insertText = `${name}(${placeholders.join(', ')})`;
    if (metadata.kind === 'hat' || metadata.kind === 'event') {
        const eventCall = placeholders.length ? insertText : name;
        insertText = `on ${eventCall}:\n    \${${body}:wait(0)}`;
    } else if (['conditional', 'loop'].includes(metadata.kind)) {
        insertText += `:\n    \${${body}:wait(0)}`;
        for (let branch = 2; branch <= Math.max(1, Number(metadata.branchCount) || 1); branch++) {
            insertText += `\nbranch ${branch}:\n    \${${body + branch - 1}:wait(0)}`;
        }
    }
    return insertText;
};

const getCompletions = (source, line, column, context = {}) => {
    const cursor = cursorContext(source, line, column);
    if (cursor.inComment) return [];
    const index = createDocumentIndex(source, context.targetId || 'target');
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
        const declarations = [
            ['variable', 'variable ${1:name} = ${2:0}', 'Declare a variable.'],
            ['list', 'list ${1:items} = [${2}]', 'Declare a list.'],
            ['procedure', 'procedure ${1:name}(${2:value: any}):\n    ${3:pass}', 'Declare a procedure.'],
            [
                'procedure with return',
                'procedure ${1:name}(${2:value: number}) -> ${3:number}:\n    return ${4:value}',
                'Declare a reporter procedure.'
            ]
        ];
        if (!index.symbols.some(symbol => ['actor', 'stage'].includes(symbol.kind))) {
            declarations.unshift(context.isStage ?
                ['stage', 'stage', 'Declare the stage module.'] :
                ['actor', 'actor ${1:name}', 'Declare an actor module.']);
        }
        if (context.isStage) {
            declarations.splice(2, 0, [
                'global variable',
                'global variable ${1:name} = ${2:0}',
                'Declare a project variable on the stage.'
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
                label: `on ${name}`,
                filterText: `on ${name}`,
                kind: 'event',
                documentation: metadata.documentation,
                insertText: snippetForMetadata(name, Object.assign({}, metadata, {kind: 'event'})),
                snippet: true,
                sortText: `21-${name}`
            });
        });
    } else {
        [
            ['if', 'if ${1:true}:\n    ${2:pass}'],
            ['repeat', 'repeat(${1:10}):\n    ${2:pass}'],
            ['repeat_until', 'repeat_until(${1:true}):\n    ${2:pass}'],
            ['while', 'while(${1:true}):\n    ${2:pass}'],
            ['forever', 'forever:\n    ${1:pass}'],
            ['return', 'return ${1:value}'],
            ['pass', 'pass']
        ].forEach(([label, insertText], snippetIndex) => append({
            id: `control:${label}`,
            label,
            kind: 'snippet',
            documentation: controlRegistry[label] && controlRegistry[label].documentation || `TextWarp ${label}.`,
            insertText,
            snippet: true,
            sortText: `20-${snippetIndex}`
        }));
        Object.entries(Object.assign({}, blockRegistry, operatorRegistry, context.extensionCatalog || {}))
            .forEach(([name, metadata]) => {
                if (!metadata || !availableHere(metadata, context)) return;
                const label = metadata.displayName || metadata.canonicalName || name;
                append({
                    id: metadata.semanticId || `catalog:${name}`,
                    label,
                    filterText: `${label} ${name}`,
                    kind: metadata.kind || 'function',
                    detail: signature(label, metadata),
                    documentation: metadata.documentation,
                    callName: name,
                    insertText: snippetForMetadata(name, metadata),
                    snippet: true,
                    sortText: `30-${label}`
                });
            });
        ['and', 'or', 'not', 'true', 'false'].forEach((keyword, keywordIndex) => append({
            id: `keyword:${keyword}`,
            label: keyword,
            kind: 'keyword',
            documentation: `TextWarp ${keyword}.`,
            insertText: keyword,
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

const getHover = (source, line, column, context = {}) => {
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
            documentation: `${detail} declared in ${symbol.modelKey}.`
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
        documentation: metadata.documentation || 'Available in the current TextWarp catalog.'
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
            documentation: `Procedure declared in ${own.modelKey}.`,
            parameters
        };
        return Object.assign({}, entry, {
            activeParameter: Math.min(call.argumentIndex, Math.max(0, parameters.length - 1)),
            activeSignature: 0,
            signatures: [entry]
        });
    }
    const metadata = getCatalog(context)[call.name] || eventRegistry[call.name];
    if (!metadata) return null;
    const variants = Array.isArray(metadata.overloads) && metadata.overloads.length ?
        metadata.overloads.map(overload => Object.assign({}, metadata, overload)) : [metadata];
    const signatures = variants.map(variant => ({
        label: signature(call.name, variant),
        documentation: variant.documentation || metadata.documentation || '',
        parameters: (variant.arguments || []).map(argument => ({
            label: argument.name,
            documentation: `${argument.valueType || argument.role || 'any'}${
                argument.optional ? ' (optional)' : ''
            }${argument.variadic ? ' (variadic)' : ''}${
                Object.prototype.hasOwnProperty.call(argument, 'defaultValue') ?
                    ` · default ${argument.defaultValue}` : ''
            }`
        }))
    }));
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

const formatText = source => {
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
        const topLevel = /^(?:actor|stage|global\s+(?:variable|list)|variable|list|procedure|on)\b/.test(code);
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
                /^(?:actor|stage|procedure|on|repeat|repeat_until|while|forever)\b/.test(code) ?
                    'block' : 'flow';
            stack.push({kind, level, originalIndent});
        }
        return rendered;
    });
    return `${output.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
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

const clearLanguageServiceCache = () => indexCache.clear();

module.exports = {
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
    getDefinitionLocations,
    getDiagnosticSuggestion,
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
