'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {getCommandCatalog} = require('../../src/lib/textwarp/language-service');
const {canonicalEntries} = require('../../src/lib/textwarp/language-registry');
const portugueseSyntax = require('../../src/lib/textwarp/locales/pt-BR.json');

test('command catalog shares semantic IDs while localizing labels and snippets', () => {
    const english = getCommandCatalog({codeLanguage: 'en-US', isStage: false, resources: []});
    const portuguese = getCommandCatalog({codeLanguage: 'pt-BR', isStage: false, resources: []});
    const englishMove = english.find(item => item.id === 'function.move');
    const portugueseMove = portuguese.find(item => item.id === 'function.move');

    assert.equal(englishMove.label, 'move');
    assert.match(englishMove.snippet, /^move\(\$\{1:steps:/);
    assert.equal(portugueseMove.label, 'mova');
    assert.match(portugueseMove.snippet, /^mova\(\$\{1:passos:/);
    assert.equal(portugueseMove.category, 'motion');
    assert.equal(portugueseMove.color, '#4c97ff');
    assert.deepEqual(portugueseMove.arguments.map(argument => argument.name), ['passos']);
    assert.equal(portugueseMove.preview, 'mova(passos: 10)');
});

test('command catalog exposes translated events, control snippets and project resources', () => {
    const catalog = getCommandCatalog({
        codeLanguage: 'pt-BR',
        isStage: false,
        resources: [{id: 'score-id', kind: 'variable', name: 'pontuação', ownerName: 'Palco'}]
    });

    assert.match(catalog.find(item => item.id === 'event.green_flag').snippet, /^ao bandeira_verde:/);
    assert.equal(catalog.find(item => item.id === 'control.if').snippet, 'se ${1:verdadeiro}:\n    ${2:passe}');
    assert.equal(catalog.find(item => item.id === 'resource.variable.score-id').snippet, 'pontuação');
    assert.ok(catalog.some(item => item.category === 'operators'));
    assert.ok(catalog.some(item => item.category === 'functions'));
    const keyPressed = catalog.find(item => item.id === 'function.key_pressed');
    assert.ok(keyPressed.arguments[0].options.some(option => option.label === 'seta_direita'));
});

test('Portuguese syntax covers every canonical command, event and argument', () => {
    const missing = Object.keys(canonicalEntries).filter(semanticId => !portugueseSyntax[semanticId]);
    assert.deepEqual(missing, []);
});
