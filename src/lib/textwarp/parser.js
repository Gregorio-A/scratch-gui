'use strict';

const INDENT_SIZE = 4;

const diagnostic = (message, line, column, length = 1, severity = 'error', code = 'syntax') => ({
    message,
    line,
    column,
    endLine: line,
    endColumn: column + Math.max(1, length),
    severity,
    code
});

const stripInlineComment = source => {
    let quote = null;
    let escaped = false;
    for (let index = 0; index < source.length; index++) {
        const character = source[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === '\\' && quote) {
            escaped = true;
            continue;
        }
        if (character === '"' || character === "'") {
            if (quote === character) quote = null;
            else if (!quote) quote = character;
            continue;
        }
        if (character === '#' && !quote) return source.slice(0, index).trimEnd();
    }
    return source.trimEnd();
};

const tokenizeLines = (source, diagnostics) => {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    const tokens = [];
    lines.forEach((rawLine, index) => {
        const lineNumber = index + 1;
        const leading = rawLine.match(/^[ \t]*/)[0];
        if (leading.includes('\t')) {
            diagnostics.push(diagnostic(
                'Use espaços para indentar; tabulações não são permitidas.',
                lineNumber,
                1,
                leading.length,
                'error',
                'indent-tabs'
            ));
        }
        const normalizedLeading = leading.replace(/\t/g, ' '.repeat(INDENT_SIZE));
        const content = stripInlineComment(rawLine.slice(leading.length)).trim();
        if (!content) return;
        tokens.push({
            content,
            indent: normalizedLeading.length,
            line: lineNumber,
            column: normalizedLeading.length + 1,
            raw: rawLine
        });
    });
    return tokens;
};

const decodeString = (raw, quote) => {
    if (quote === '"') return JSON.parse(raw);
    let result = '';
    for (let index = 1; index < raw.length - 1; index++) {
        const character = raw[index];
        if (character !== '\\') {
            result += character;
            continue;
        }
        index++;
        if (index >= raw.length - 1) throw new Error('escape incompleto');
        const escaped = raw[index];
        const escapes = {n: '\n', r: '\r', t: '\t', '\\': '\\', "'": "'", '"': '"'};
        result += Object.prototype.hasOwnProperty.call(escapes, escaped) ? escapes[escaped] : escaped;
    }
    return result;
};

const lexExpression = (source, lineToken, diagnostics, columnOffset = 0) => {
    const tokens = [];
    let index = 0;
    const push = (type, value, start, raw = String(value)) => tokens.push({type, value, start, raw});
    const fail = (message, start, length, code) => diagnostics.push(diagnostic(
        message,
        lineToken.line,
        lineToken.column + columnOffset + start,
        length,
        'error',
        code
    ));

    while (index < source.length) {
        if (/\s/.test(source[index])) {
            index++;
            continue;
        }
        const start = index;
        const two = source.slice(index, index + 2);
        if (['==', '!=', '<=', '>='].includes(two)) {
            push('operator', two, start, two);
            index += 2;
            continue;
        }
        const character = source[index];
        if ('+-*/%<>'.includes(character)) {
            push('operator', character, start, character);
            index++;
            continue;
        }
        if ('(),[]'.includes(character)) {
            push(character, character, start, character);
            index++;
            continue;
        }
        if (character === '"' || character === "'") {
            const quote = character;
            index++;
            let escaped = false;
            while (index < source.length) {
                const current = source[index++];
                if (escaped) {
                    escaped = false;
                } else if (current === '\\') {
                    escaped = true;
                } else if (current === quote) {
                    break;
                }
            }
            const raw = source.slice(start, index);
            if (raw[raw.length - 1] !== quote || raw.length === 1) {
                fail('String não terminada.', start, raw.length, 'unterminated-string');
                push('string', '', start, raw);
                continue;
            }
            try {
                push('string', decodeString(raw, quote), start, raw);
            } catch (error) {
                fail(`String inválida: ${error.message}.`, start, raw.length, 'invalid-string');
                push('string', '', start, raw);
            }
            continue;
        }
        const numberMatch = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
        if (numberMatch) {
            push('number', Number(numberMatch[0]), start, numberMatch[0]);
            index += numberMatch[0].length;
            continue;
        }
        const identifierMatch = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/);
        if (identifierMatch) {
            const value = identifierMatch[0];
            if (value === 'and' || value === 'or' || value === 'not') push('operator', value, start, value);
            else if (value === 'true' || value === 'false') push('boolean', value === 'true', start, value);
            else push('identifier', value, start, value);
            index += value.length;
            continue;
        }
        fail(`Caractere inesperado na expressão: ${character}.`, start, 1, 'invalid-expression-character');
        index++;
    }
    tokens.push({type: 'eof', value: null, start: source.length, raw: ''});
    return tokens;
};

const BINARY_PRECEDENCE = Object.freeze({
    or: 1,
    and: 2,
    '==': 3,
    '!=': 3,
    '<': 4,
    '<=': 4,
    '>': 4,
    '>=': 4,
    '+': 5,
    '-': 5,
    '*': 6,
    '/': 6,
    '%': 6
});

const parseExpression = (source, lineToken, diagnostics, columnOffset = 0) => {
    const tokens = lexExpression(source, lineToken, diagnostics, columnOffset);
    let cursor = 0;
    const current = () => tokens[cursor];
    const consume = type => {
        if (current().type !== type) return null;
        return tokens[cursor++];
    };
    const expressionDiagnostic = (message, token, code = 'invalid-expression') => diagnostics.push(diagnostic(
        message,
        lineToken.line,
        lineToken.column + columnOffset + token.start,
        Math.max(1, token.raw.length),
        'error',
        code
    ));
    const location = lineToken;

    const parsePrimary = () => {
        const token = current();
        if (consume('number')) return {type: 'Literal', value: token.value, valueType: 'number', location};
        if (consume('string')) return {type: 'Literal', value: token.value, valueType: 'string', location};
        if (consume('boolean')) return {type: 'Literal', value: token.value, valueType: 'boolean', location};
        if (consume('(')) {
            const value = parseBinary(0);
            if (!consume(')')) expressionDiagnostic('Esperado ")" para fechar a expressão.', current(), 'missing-parenthesis');
            return value;
        }
        if (consume('[')) {
            const elements = [];
            if (current().type !== ']') {
                while (current().type !== 'eof') {
                    elements.push(parseBinary(0));
                    if (!consume(',')) break;
                }
            }
            if (!consume(']')) expressionDiagnostic('Esperado "]" para fechar a lista.', current(), 'missing-list-bracket');
            return {type: 'ListLiteral', elements, location};
        }
        if (consume('identifier')) {
            if (!consume('(')) return {type: 'Identifier', name: token.value, location};
            const args = [];
            if (current().type !== ')') {
                while (current().type !== 'eof') {
                    args.push(parseBinary(0));
                    if (!consume(',')) break;
                }
            }
            if (!consume(')')) expressionDiagnostic(`Esperado ")" após ${token.value}(...).`, current(), 'missing-call-parenthesis');
            return {type: 'CallExpression', callee: token.value, arguments: args, location};
        }
        expressionDiagnostic('Esperado um valor, variável ou chamada de função.', token);
        if (token.type !== 'eof') cursor++;
        return {type: 'Literal', value: 0, valueType: 'number', location, invalid: true};
    };

    const parseUnary = () => {
        const token = current();
        if (token.type === 'operator' && ['+', '-', 'not'].includes(token.value)) {
            cursor++;
            return {type: 'UnaryExpression', operator: token.value, argument: parseUnary(), location};
        }
        return parsePrimary();
    };

    const parseBinary = minimumPrecedence => {
        let left = parseUnary();
        while (current().type === 'operator') {
            const operator = current().value;
            const precedence = BINARY_PRECEDENCE[operator];
            if (!precedence || precedence < minimumPrecedence) break;
            cursor++;
            const right = parseBinary(precedence + 1);
            left = {type: 'BinaryExpression', operator, left, right, location};
        }
        return left;
    };

    const result = parseBinary(0);
    if (current().type !== 'eof') {
        expressionDiagnostic(`Trecho inesperado na expressão: ${current().raw || current().type}.`, current());
    }
    return result;
};

const parseText = source => {
    const diagnostics = [];
    const tokens = tokenizeLines(source, diagnostics);
    let cursor = 0;
    let declaration = null;
    const declarations = [];
    const procedures = [];
    const scripts = [];

    if (tokens.length > 0 && tokens[0].indent === 0) {
        const first = tokens[0];
        const actorMatch = first.content.match(/^actor\s+(.+)$/);
        if (actorMatch) {
            declaration = {type: 'ActorDeclaration', name: actorMatch[1].trim(), location: first};
            cursor++;
        } else if (first.content === 'stage') {
            declaration = {type: 'StageDeclaration', location: first};
            cursor++;
        }
    }

    const requireBody = (nodeName, token, nested) => {
        if (nested.statements.length === 0) diagnostics.push(diagnostic(
            `${nodeName} precisa de pelo menos um comando indentado.`,
            token.line,
            token.column,
            token.content.length,
            'error',
            'empty-block'
        ));
    };

    const parseBlock = (start, parentIndent) => {
        const statements = [];
        const expectedIndent = parentIndent + INDENT_SIZE;
        let index = start;
        while (index < tokens.length) {
            const token = tokens[index];
            if (token.indent <= parentIndent) break;
            if (token.indent !== expectedIndent) {
                diagnostics.push(diagnostic(
                    `Indentação inválida. Use exatamente ${expectedIndent} espaços neste nível.`,
                    token.line,
                    1,
                    Math.max(1, token.indent),
                    'error',
                    'invalid-indent'
                ));
                index++;
                continue;
            }
            if (/^(?:else|branch\s+\d+)\s*:\s*$/.test(token.content)) break;

            const ifMatch = token.content.match(/^if\s+(.+)\s*:\s*$/);
            if (ifMatch) {
                const condition = parseExpression(ifMatch[1], token, diagnostics, token.content.indexOf(ifMatch[1]));
                const consequent = parseBlock(index + 1, expectedIndent);
                requireBody('if', token, consequent);
                index = consequent.cursor;
                let alternate = [];
                if (index < tokens.length && tokens[index].indent === expectedIndent && /^else\s*:\s*$/.test(tokens[index].content)) {
                    const elseToken = tokens[index];
                    const parsedElse = parseBlock(index + 1, expectedIndent);
                    requireBody('else', elseToken, parsedElse);
                    alternate = parsedElse.statements;
                    index = parsedElse.cursor;
                }
                statements.push({type: 'IfStatement', condition, consequent: consequent.statements, alternate, location: token});
                continue;
            }

            const controlMatch = token.content.match(/^(repeat|repeat_until|while)\s*\((.*)\)\s*:\s*$/);
            if (controlMatch) {
                const argument = parseExpression(controlMatch[2], token, diagnostics, token.content.indexOf(controlMatch[2]));
                const nested = parseBlock(index + 1, expectedIndent);
                requireBody(controlMatch[1], token, nested);
                statements.push({
                    type: 'ControlStatement',
                    control: controlMatch[1],
                    argument,
                    body: nested.statements,
                    location: token
                });
                index = nested.cursor;
                continue;
            }

            if (/^forever\s*:\s*$/.test(token.content)) {
                const nested = parseBlock(index + 1, expectedIndent);
                requireBody('forever', token, nested);
                statements.push({type: 'ControlStatement', control: 'forever', argument: null, body: nested.statements, location: token});
                index = nested.cursor;
                continue;
            }

            const returnMatch = token.content.match(/^return(?:\s+(.+))?$/);
            if (returnMatch) {
                statements.push({
                    type: 'ReturnStatement',
                    value: returnMatch[1] ? parseExpression(
                        returnMatch[1],
                        token,
                        diagnostics,
                        token.content.indexOf(returnMatch[1])
                    ) : {type: 'Literal', value: '', valueType: 'string', location: token},
                    location: token
                });
                index++;
                continue;
            }

            if (token.content === 'pass') {
                statements.push({type: 'PassStatement', location: token});
                index++;
                continue;
            }

            // Extension conditionals and loops use the same indentation model as
            // native control blocks. Extra arms are written as `branch 2:`,
            // `branch 3:`, and so on; semantic analysis validates branchCount.
            const flowMatch = token.content.match(/^(.+)\s*:\s*$/);
            if (flowMatch) {
                const header = parseExpression(flowMatch[1], token, diagnostics, token.content.indexOf(flowMatch[1]));
                if (header.type === 'CallExpression') {
                    const firstBranch = parseBlock(index + 1, expectedIndent);
                    const branches = [{index: 1, body: firstBranch.statements, location: token}];
                    index = firstBranch.cursor;
                    while (index < tokens.length && tokens[index].indent === expectedIndent) {
                        const branchMatch = tokens[index].content.match(/^branch\s+(\d+)\s*:\s*$/);
                        if (!branchMatch) break;
                        const branchToken = tokens[index];
                        const branchIndex = Number(branchMatch[1]);
                        const nested = parseBlock(index + 1, expectedIndent);
                        if (branchIndex < 2) diagnostics.push(diagnostic(
                            'Braços adicionais começam em "branch 2:".',
                            branchToken.line,
                            branchToken.column,
                            branchToken.content.length,
                            'error',
                            'invalid-branch-index'
                        ));
                        if (branches.some(branch => branch.index === branchIndex)) diagnostics.push(diagnostic(
                            `O braço ${branchIndex} foi declarado mais de uma vez.`,
                            branchToken.line,
                            branchToken.column,
                            branchToken.content.length,
                            'error',
                            'duplicate-branch'
                        ));
                        branches.push({index: branchIndex, body: nested.statements, location: branchToken});
                        index = nested.cursor;
                    }
                    statements.push({type: 'ExtensionFlowStatement', expression: header, branches, location: token});
                    continue;
                }
            }

            const assignmentMatch = token.content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|-=|=(?!=))\s*(.+)$/);
            if (assignmentMatch) {
                statements.push({
                    type: 'AssignmentStatement',
                    name: assignmentMatch[1],
                    operator: assignmentMatch[2],
                    value: parseExpression(
                        assignmentMatch[3],
                        token,
                        diagnostics,
                        token.content.indexOf(assignmentMatch[3])
                    ),
                    location: token
                });
                index++;
                continue;
            }

            const expression = parseExpression(token.content, token, diagnostics);
            if (expression.type === 'CallExpression') {
                statements.push({type: 'CallStatement', expression, location: token});
            } else {
                diagnostics.push(diagnostic(
                    'Uma instrução deve ser uma atribuição, controle ou chamada de função.',
                    token.line,
                    token.column,
                    token.content.length,
                    'error',
                    'invalid-statement'
                ));
            }
            index++;
        }
        return {statements, cursor: index};
    };

    while (cursor < tokens.length) {
        const token = tokens[cursor];
        if (token.indent !== 0) {
            diagnostics.push(diagnostic(
                'Declarações, eventos e procedimentos devem começar sem indentação.',
                token.line,
                1,
                Math.max(1, token.indent),
                'error',
                'top-level-indent'
            ));
            cursor++;
            continue;
        }

        const variableMatch = token.content.match(/^(global\s+)?(variable|list)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
        if (variableMatch) {
            declarations.push({
                type: variableMatch[2] === 'list' ? 'ListDeclaration' : 'VariableDeclaration',
                global: Boolean(variableMatch[1]),
                name: variableMatch[3],
                initialValue: parseExpression(
                    variableMatch[4],
                    token,
                    diagnostics,
                    token.content.indexOf(variableMatch[4])
                ),
                location: token
            });
            cursor++;
            continue;
        }

        const procedureMatch = token.content.match(/^procedure\s+([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*(.*?)\s*:\s*$/);
        if (procedureMatch) {
            const modifierText = procedureMatch[3].trim();
            const modifierMatch = modifierText.match(/^(?:(?:->\s*(any|number|string|boolean))(?:\s+(warp))?|(warp)(?:\s+->\s*(any|number|string|boolean))?)?$/);
            if (!modifierMatch) diagnostics.push(diagnostic(
                `Modificadores de procedimento inválidos: ${modifierText || '(vazio)'}. Use "-> tipo" e/ou "warp".`,
                token.line,
                token.column,
                token.content.length,
                'error',
                'invalid-procedure-modifiers'
            ));
            const returnType = modifierMatch ? modifierMatch[1] || modifierMatch[4] || null : null;
            const warp = Boolean(modifierMatch && (modifierMatch[2] || modifierMatch[3]));
            const rawParams = procedureMatch[2].trim() ? procedureMatch[2].split(',').map(item => item.trim()) : [];
            const params = [];
            rawParams.forEach(param => {
                const parameterMatch = param.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s*:\s*(any|number|string|boolean))?$/);
                if (!parameterMatch) diagnostics.push(diagnostic(
                    `Parâmetro inválido: ${param || '(vazio)'}.`,
                    token.line,
                    token.column,
                    token.content.length,
                    'error',
                    'invalid-parameter'
                ));
                else params.push({
                    name: parameterMatch[1],
                    valueType: parameterMatch[2] || 'any',
                    location: token
                });
            });
            const nested = parseBlock(cursor + 1, 0);
            requireBody(`procedure ${procedureMatch[1]}`, token, nested);
            procedures.push({
                type: 'ProcedureDeclaration',
                name: procedureMatch[1],
                parameters: params,
                returnType,
                warp,
                body: nested.statements,
                location: token
            });
            cursor = nested.cursor;
            continue;
        }

        const eventMatch = token.content.match(/^on\s+(.+)\s*:\s*$/);
        if (eventMatch) {
            const expression = parseExpression(eventMatch[1], token, diagnostics, token.content.indexOf(eventMatch[1]));
            if (expression.type !== 'Identifier' && expression.type !== 'CallExpression') diagnostics.push(diagnostic(
                'Evento inválido. Use, por exemplo, on green_flag: ou on receive("start"):.',
                token.line,
                token.column,
                token.content.length,
                'error',
                'invalid-event'
            ));
            const nested = parseBlock(cursor + 1, 0);
            requireBody('O evento', token, nested);
            scripts.push({type: 'Script', event: expression, body: nested.statements, location: token});
            cursor = nested.cursor;
            continue;
        }

        diagnostics.push(diagnostic(
            `Declaração desconhecida: ${token.content}.`,
            token.line,
            token.column,
            token.content.length,
            'error',
            'unknown-top-level'
        ));
        cursor++;
    }

    return {
        ast: {type: 'ActorModule', declaration, declarations, procedures, scripts},
        diagnostics
    };
};

module.exports = {
    INDENT_SIZE,
    diagnostic,
    parseExpression,
    parseText
};
