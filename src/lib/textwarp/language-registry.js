'use strict';

const enUS = require('./locales/en-US.json');
const ptBR = require('./locales/pt-BR.json');
const {blockRegistry, controlRegistry, eventRegistry, operatorRegistry} = require('./block-registry');

const DEFAULT_CODE_LANGUAGE = 'en-US';
const CODE_LANGUAGES = Object.freeze(['en-US', 'pt-BR']);

const canonicalEntries = Object.freeze(Object.assign(
    {},
    Object.fromEntries(Object.keys(blockRegistry).map(name => [`function.${name}`, name])),
    Object.fromEntries(Object.keys(eventRegistry).map(name => [`event.${name}`, name])),
    Object.fromEntries(Object.keys(controlRegistry).map(name => [`control.${name}`, name])),
    Object.fromEntries(Object.entries(blockRegistry).flatMap(([name, metadata]) =>
        (metadata.arguments || []).map(argument => [`function.${name}.${argument.name}`, argument.name])
    )),
    Object.fromEntries(Object.entries(eventRegistry).flatMap(([name, metadata]) =>
        (metadata.arguments || []).map(argument => [`event.${name}.${argument.name}`, argument.name])
    )),
    Object.fromEntries(Array.from(new Set(
        Object.values(Object.assign({}, blockRegistry, eventRegistry, operatorRegistry))
            .flatMap(metadata => (metadata.arguments || []).map(argument => argument.name))
            .concat(['condition', 'count'])
    )).map(name => [`argument.${name}`, name])),
    {
        'syntax.actor': 'actor', 'syntax.stage': 'stage', 'syntax.on': 'on', 'syntax.global': 'global',
        'syntax.variable': 'variable', 'syntax.list': 'list', 'syntax.procedure': 'procedure',
        'syntax.return': 'return', 'syntax.pass': 'pass', 'syntax.stack': 'stack',
        'syntax.reporter': 'reporter', 'syntax.branch': 'branch', 'syntax.warp': 'warp',
        'control.else': 'else',
        'operator.and': 'and', 'operator.or': 'or', 'operator.not': 'not',
        'literal.true': 'true', 'literal.false': 'false', 'type.any': 'any',
        'type.number': 'number', 'type.string': 'string', 'type.boolean': 'boolean',
        'key.right': 'right arrow', 'key.left': 'left arrow', 'key.up': 'up arrow',
        'key.down': 'down arrow', 'key.space': 'space', 'key.any': 'any'
    }
));

const normalizeCodeLanguage = value => CODE_LANGUAGES.includes(value) ? value : DEFAULT_CODE_LANGUAGE;
const entryFor = (language, semanticId) => {
    const pack = normalizeCodeLanguage(language) === 'pt-BR' ? ptBR : enUS;
    const fallback = enUS[semanticId];
    const canonical = canonicalEntries[semanticId];
    return pack[semanticId] || fallback || (canonical ? {preferred: canonical, aliases: [canonical]} : null);
};

const aliasesFor = (language, semanticId) => {
    const entry = entryFor(language, semanticId);
    if (!entry) return [];
    const canonical = canonicalEntries[semanticId];
    return Array.from(new Set([entry.preferred].concat(entry.aliases || [], canonical || []).filter(Boolean)));
};

const preferredFor = (language, semanticId) => {
    const entry = entryFor(language, semanticId);
    return entry ? entry.preferred : canonicalEntries[semanticId] || semanticId;
};

const buildAliasIndex = language => {
    const index = new Map();
    Object.keys(canonicalEntries).forEach(semanticId => aliasesFor(language, semanticId).forEach(alias => {
        const key = alias.normalize('NFC').toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(semanticId);
    }));
    return index;
};

const indexes = new Map(CODE_LANGUAGES.map(language => [language, buildAliasIndex(language)]));
const semanticIdsFor = (language, token) => indexes.get(normalizeCodeLanguage(language)).get(
    String(token || '').normalize('NFC').toLowerCase()
) || [];
const semanticIdFor = (language, token) => semanticIdsFor(language, token)[0] || null;

const canonicalFor = semanticId => canonicalEntries[semanticId] || null;

module.exports = {
    CODE_LANGUAGES,
    DEFAULT_CODE_LANGUAGE,
    aliasesFor,
    canonicalEntries,
    canonicalFor,
    normalizeCodeLanguage,
    preferredFor,
    semanticIdFor,
    semanticIdsFor
};
