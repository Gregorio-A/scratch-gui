'use strict';

const {
    DEFAULT_CODE_LANGUAGE,
    canonicalFor,
    normalizeCodeLanguage,
    preferredFor,
    semanticIdsFor
} = require('./language-registry');

const identifierAt = text => text.match(/^[\p{L}_][\p{L}\p{N}_]*/u);
const nextNonSpace = (line, index) => {
    while (index < line.length && /\s/.test(line[index])) index++;
    return line[index] || '';
};

const chooseSemanticId = (ids, context) => {
    const syntax = ids.find(id => /^(?:syntax|control|operator|literal|type)\./.test(id));
    const argument = context.callName && ids.find(id => id.startsWith(`function.${context.callName}.`) ||
        id.startsWith(`event.${context.callName}.`));
    const callable = context.followedByCall && ids.find(id => /^function\.[^.]+$/.test(id));
    const event = context.afterOn && ids.find(id => /^event\.[^.]+$/.test(id));
    const menuValue = context.inCall && ids.find(id => id.startsWith('key.'));
    return argument || callable || event || syntax || menuValue || null;
};

const scanCodeIdentifiers = line => {
    const tokens = [];
    let index = 0;
    let quote = null;
    let escaped = false;
    while (index < line.length) {
        const character = line[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            index++;
            continue;
        }
        if (character === '#') break;
        if (character === '"' || character === "'") {
            quote = character;
            index++;
            continue;
        }
        const match = identifierAt(line.slice(index));
        if (!match) {
            index++;
            continue;
        }
        tokens.push({raw: match[0], start: index, end: index + match[0].length});
        index += match[0].length;
    }
    return tokens;
};

const codeBeforeComment = line => {
    let quote = null;
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (escaped) {
            escaped = false;
        } else if (quote && character === '\\') {
            escaped = true;
        } else if (character === '"' || character === "'") {
            quote = quote === character ? null : quote || character;
        } else if (character === '#' && !quote) {
            return line.slice(0, index);
        }
    }
    return line;
};

const callArity = (line, openIndex) => {
    if (line[openIndex] !== '(') return null;
    let depth = 0;
    let count = 0;
    let hasValue = false;
    let quote = null;
    let escaped = false;
    for (let index = openIndex; index < line.length; index++) {
        const character = line[index];
        if (quote) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === quote) quote = null;
            if (depth === 1) hasValue = true;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            if (depth === 1) hasValue = true;
            continue;
        }
        if (character === '(' || character === '[' || character === '{') {
            depth++;
            if (depth > 1) hasValue = true;
            continue;
        }
        if (character === ')' || character === ']' || character === '}') {
            depth--;
            if (depth === 0) return hasValue ? count + 1 : 0;
            continue;
        }
        if (depth === 1 && character === ',') count++;
        else if (depth === 1 && !/\s/.test(character)) hasValue = true;
    }
    return null;
};

const collectIdentifierContext = (lines, language) => {
    const protectedRanges = new Map();
    const structuralRanges = new Map();
    const userNames = new Set();
    const procedures = new Map();
    const addRange = (map, line, token) => {
        if (!map.has(line)) map.set(line, []);
        map.get(line).push([token.start, token.end]);
    };
    const semantic = token => semanticIdsFor(language, token.raw);
    lines.forEach((line, lineIndex) => {
        const tokens = scanCodeIdentifiers(line);
        if (!tokens.length) return;
        const indent = line.match(/^\s*/)[0].length;
        const firstIds = semantic(tokens[0]);
        const firstId = firstIds.find(id => /^(?:syntax|control)\./.test(id));
        const trimmedCode = codeBeforeComment(line.slice(indent)).trimEnd();
        const assignmentAfterFirst = /^\s*(?:\+=|-=|=(?!=))/.test(line.slice(tokens[0].end));
        const topLevelSyntax = indent === 0 && [
            'syntax.actor', 'syntax.stage', 'syntax.global', 'syntax.variable', 'syntax.list',
            'syntax.procedure', 'syntax.on', 'syntax.stack', 'syntax.reporter'
        ].includes(firstId);
        const blockSyntax = /:\s*$/.test(trimmedCode) && [
            'control.if', 'control.else', 'control.repeat', 'control.repeat_until',
            'control.while', 'control.forever', 'syntax.branch'
        ].includes(firstId);
        const statementSyntax = !assignmentAfterFirst && (
            firstId === 'syntax.return' || (firstId === 'syntax.pass' && tokens.length === 1)
        );
        if (topLevelSyntax || blockSyntax || statementSyntax) addRange(structuralRanges, lineIndex, tokens[0]);

        let declarationIndex = 0;
        if (firstId === 'syntax.global') {
            const secondId = tokens[1] && semantic(tokens[1]).find(id =>
                id === 'syntax.variable' || id === 'syntax.list'
            );
            if (secondId) {
                addRange(structuralRanges, lineIndex, tokens[1]);
                declarationIndex = 1;
            }
        }
        const declarationId = tokens[declarationIndex] && semantic(tokens[declarationIndex]).find(id =>
            ['syntax.actor', 'syntax.variable', 'syntax.list', 'syntax.procedure'].includes(id)
        );
        if (!declarationId || !tokens[declarationIndex + 1]) return;
        if (declarationId === 'syntax.actor') {
            tokens.slice(declarationIndex + 1).forEach(token => addRange(protectedRanges, lineIndex, token));
            return;
        }
        const nameToken = tokens[declarationIndex + 1];
        addRange(protectedRanges, lineIndex, nameToken);
        if (declarationId === 'syntax.variable' || declarationId === 'syntax.list') {
            userNames.add(nameToken.raw);
            return;
        }
        const openIndex = line.indexOf('(', nameToken.end);
        procedures.set(nameToken.raw, callArity(line, openIndex));
        const closeIndex = line.lastIndexOf(')');
        tokens
            .filter(token => token.start > openIndex && token.end <= closeIndex)
            .forEach((token, index, parameters) => {
                const previousEnd = index ? parameters[index - 1].end : openIndex + 1;
                const separator = line.slice(previousEnd, token.start);
                if (index === 0 || separator.includes(',')) addRange(protectedRanges, lineIndex, token);
            });
    });
    const contains = (map, line, start, end) => (map.get(line) || []).some(range =>
        range[0] === start && range[1] === end
    );
    return {
        containsProtected: (line, start, end) => contains(protectedRanges, line, start, end),
        containsStructural: (line, start, end) => contains(structuralRanges, line, start, end),
        procedures,
        userNames
    };
};

const transformSource = (source, fromLanguage, toLanguage, options = {}) => {
    const input = String(source || '').replace(/\r\n?/g, '\n');
    const from = normalizeCodeLanguage(fromLanguage);
    const to = normalizeCodeLanguage(toLanguage);
    const ranges = [];
    const lines = input.split('\n');
    const identifierContext = collectIdentifierContext(lines, from);
    const output = lines.map((line, lineIndex) => {
        let result = '';
        let index = 0;
        let quote = null;
        let escaped = false;
        let afterOn = false;
        const calls = [];
        while (index < line.length) {
            const character = line[index];
            if (quote) {
                result += character;
                index++;
                if (escaped) escaped = false;
                else if (character === '\\') escaped = true;
                else if (character === quote) quote = null;
                continue;
            }
            if (character === '#' && !quote) {
                result += line.slice(index);
                break;
            }
            if (character === '"' || character === "'") {
                const closing = (() => {
                    let cursor = index + 1;
                    let escapedString = false;
                    while (cursor < line.length) {
                        const current = line[cursor];
                        if (escapedString) escapedString = false;
                        else if (current === '\\') escapedString = true;
                        else if (current === character) return cursor;
                        cursor++;
                    }
                    return -1;
                })();
                const currentCall = calls.length ? calls[calls.length - 1] : null;
                if (closing > index && currentCall === 'key_pressed' && to !== DEFAULT_CODE_LANGUAGE) {
                    const value = line.slice(index + 1, closing);
                    const keyId = semanticIdsFor(from, value).find(id => id.startsWith('key.'));
                    if (keyId) {
                        const replacement = preferredFor(to, keyId);
                        result += replacement;
                        ranges.push({
                            semanticId: keyId,
                            line: lineIndex + 1,
                            startColumn: index + 1,
                            endColumn: closing + 2,
                            original: line.slice(index, closing + 1),
                            replacement
                        });
                        index = closing + 1;
                        continue;
                    }
                }
                quote = character;
                result += character;
                index++;
                continue;
            }
            const match = identifierAt(line.slice(index));
            if (!match) {
                result += character;
                if (character === '(') calls.push(null);
                else if (character === ')') calls.pop();
                index++;
                continue;
            }
            const raw = match[0];
            const end = index + raw.length;
            const followedByCall = nextNonSpace(line, end) === '(';
            const ids = semanticIdsFor(from, raw);
            const currentCall = calls.length ? calls[calls.length - 1] : null;
            let semanticId = chooseSemanticId(ids, {
                afterOn,
                callName: currentCall,
                followedByCall,
                inCall: calls.length > 0
            });
            const openIndex = followedByCall ? (() => {
                let cursor = end;
                while (cursor < line.length && /\s/.test(line[cursor])) cursor++;
                return cursor;
            })() : -1;
            const procedureArity = identifierContext.procedures.get(raw);
            const currentArity = followedByCall ? callArity(line, openIndex) : null;
            const isUserProcedureCall = followedByCall && identifierContext.procedures.has(raw) && (
                procedureArity === null || currentArity === null || procedureArity === currentArity
            );
            const isNamedArgument = calls.length > 0 && nextNonSpace(line, end) === ':';
            const isProtectedName = (
                identifierContext.containsProtected(lineIndex, index, end) ||
                isUserProcedureCall || (
                    identifierContext.userNames.has(raw) &&
                    !identifierContext.containsStructural(lineIndex, index, end) &&
                    !followedByCall && !isNamedArgument
                )
            );
            if (isProtectedName) semanticId = null;
            let replacement = raw;
            if (semanticId) {
                const canonical = canonicalFor(semanticId);
                if (semanticId.startsWith('key.') && options.semanticValues !== false) {
                    replacement = JSON.stringify(canonical);
                } else {
                    replacement = to === DEFAULT_CODE_LANGUAGE ? canonical : preferredFor(to, semanticId);
                }
                ranges.push({
                    semanticId,
                    line: lineIndex + 1,
                    startColumn: index + 1,
                    endColumn: end + 1,
                    original: raw,
                    replacement
                });
            }
            result += replacement;
            const canonicalValue = semanticId ? canonicalFor(semanticId) : raw;
            if (semanticId === 'syntax.on') afterOn = true;
            else if (afterOn && !/^event\./.test(semanticId || '')) afterOn = false;
            index = end;
            if (followedByCall) {
                let cursor = index;
                while (cursor < line.length && /\s/.test(line[cursor])) {
                    result += line[cursor];
                    cursor++;
                }
                if (line[cursor] === '(') {
                    result += '(';
                    calls.push(canonicalValue);
                    index = cursor + 1;
                }
            }
        }
        return result;
    });
    return {source: output.join('\n'), ranges};
};

const canonicalizeSource = (source, codeLanguage = DEFAULT_CODE_LANGUAGE) =>
    transformSource(source, codeLanguage, DEFAULT_CODE_LANGUAGE);

const localizeSource = (source, codeLanguage = DEFAULT_CODE_LANGUAGE) =>
    transformSource(source, DEFAULT_CODE_LANGUAGE, codeLanguage);

const switchCodeLanguage = (source, fromLanguage, toLanguage, validate) => {
    const canonical = canonicalizeSource(source, fromLanguage);
    const validation = typeof validate === 'function' ? validate(canonical.source) : {success: true, diagnostics: []};
    if (!validation || !validation.success) return {
        success: false,
        source,
        diagnostics: validation && validation.diagnostics || []
    };
    const localized = localizeSource(canonical.source, toLanguage);
    return {
        success: true,
        source: localized.source,
        diagnostics: [],
        ranges: canonical.ranges.concat(localized.ranges)
    };
};

const mapColumnThroughRanges = (ranges, line, column) => {
    let delta = 0;
    (ranges || []).filter(range => range.line === line).sort((left, right) =>
        left.startColumn - right.startColumn
    ).forEach(range => {
        if (column >= range.endColumn) {
            delta += range.replacement.length - range.original.length;
        } else if (column > range.startColumn) {
            delta += Math.min(column - range.startColumn, range.replacement.length) -
                (column - range.startColumn);
        }
    });
    return Math.max(1, column + delta);
};

const mapColumnBackThroughRanges = (ranges, line, column) => {
    let sourceColumn = column;
    let delta = 0;
    (ranges || []).filter(range => range.line === line).sort((left, right) =>
        left.startColumn - right.startColumn
    ).forEach(range => {
        const translatedStart = range.startColumn + delta;
        const translatedEnd = translatedStart + range.replacement.length;
        if (column >= translatedEnd) {
            sourceColumn += range.original.length - range.replacement.length;
            delta += range.replacement.length - range.original.length;
        } else if (column > translatedStart) {
            sourceColumn = range.startColumn + Math.min(
                column - translatedStart,
                range.original.length
            );
        }
    });
    return Math.max(1, sourceColumn);
};

const mapSourceMapThroughRanges = (sourceMap, ranges) => Object.fromEntries(
    Object.entries(sourceMap || {}).map(([blockId, location]) => [blockId, Object.assign({}, location, {
        startColumn: mapColumnThroughRanges(ranges, location.startLine, location.startColumn),
        endColumn: mapColumnThroughRanges(ranges, location.endLine, location.endColumn)
    })])
);

module.exports = {
    canonicalizeSource,
    localizeSource,
    mapColumnBackThroughRanges,
    mapColumnThroughRanges,
    mapSourceMapThroughRanges,
    switchCodeLanguage,
    transformSource
};
