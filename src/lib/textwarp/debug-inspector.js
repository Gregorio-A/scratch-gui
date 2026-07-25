'use strict';

const {parseExpression} = require('./parser');

const readVariables = target => Object.values(target && target.variables || {}).map(variable => ({
    id: variable.id,
    name: variable.name,
    type: variable.type === 'list' ? 'list' : variable.type === 'broadcast_msg' ? 'broadcast' : 'variable',
    value: variable.value,
    ownerId: target.id,
    ownerName: target.getName ? target.getName() : ''
}));

const variableMap = (target, stage) => {
    const result = new Map();
    readVariables(stage).forEach(variable => result.set(variable.name, variable));
    readVariables(target).forEach(variable => result.set(variable.name, variable));
    return result;
};

const evaluateNode = (node, variables) => {
    if (!node) throw new Error('Expressão vazia.');
    if (node.type === 'Literal') return node.value;
    if (node.type === 'ListLiteral') return node.elements.map(item => evaluateNode(item, variables));
    if (node.type === 'Identifier') {
        if (!variables.has(node.name)) throw new Error(`Variável "${node.name}" não encontrada.`);
        return variables.get(node.name).value;
    }
    if (node.type === 'UnaryExpression') {
        const value = evaluateNode(node.argument, variables);
        if (node.operator === 'not') return !value;
        if (node.operator === '-') return -Number(value);
    }
    if (node.type === 'BinaryExpression') {
        const left = evaluateNode(node.left, variables);
        const right = evaluateNode(node.right, variables);
        const operations = {
            '+': () => Number(left) + Number(right),
            '-': () => Number(left) - Number(right),
            '*': () => Number(left) * Number(right),
            '/': () => Number(left) / Number(right),
            '%': () => Number(left) % Number(right),
            '<': () => left < right,
            '<=': () => left <= right,
            '>': () => left > right,
            '>=': () => left >= right,
            '==': () => left == right, // Scratch comparison intentionally coerces values.
            '!=': () => left != right,
            and: () => Boolean(left && right),
            or: () => Boolean(left || right)
        };
        if (operations[node.operator]) return operations[node.operator]();
    }
    throw new Error('A inspeção aceita literais, variáveis e operadores seguros; chamadas não são executadas.');
};

const inspectExpression = (expression, target, stage) => {
    const diagnostics = [];
    const location = {line: 1, column: 1, content: expression};
    const ast = parseExpression(String(expression || ''), location, diagnostics);
    if (diagnostics.length) return {success: false, error: diagnostics[0].message};
    try {
        return {success: true, value: evaluateNode(ast, variableMap(target, stage))};
    } catch (error) {
        return {success: false, error: error.message};
    }
};

const inspectTarget = (target, stage) => ({
    variables: Array.from(variableMap(target, stage).values()),
    target: target ? {
        id: target.id,
        name: target.getName ? target.getName() : '',
        x: target.x,
        y: target.y,
        direction: target.direction,
        visible: target.visible,
        currentCostume: target.currentCostume
    } : null
});

module.exports = {
    inspectExpression,
    inspectTarget,
    readVariables,
    variableMap
};
