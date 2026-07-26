'use strict';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const isIdentifier = value => IDENTIFIER.test(String(value || ''));

const sanitizeIdentifier = (value, fallback = 'symbol') => {
    const normalized = String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/^([0-9])/, '_$1');
    return isIdentifier(normalized) ? normalized : fallback;
};

const assignSourceNames = values => {
    const used = new Set();
    return (Array.isArray(values) ? values : []).map((value, index) => {
        const base = sanitizeIdentifier(value && value.name, `value_${index + 1}`);
        let sourceName = base;
        let suffix = 2;
        while (used.has(sourceName)) sourceName = `${base}_${suffix++}`;
        used.add(sourceName);
        return Object.assign({}, value, {sourceName});
    });
};

module.exports = {
    assignSourceNames,
    isIdentifier,
    sanitizeIdentifier
};
