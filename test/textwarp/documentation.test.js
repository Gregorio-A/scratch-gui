'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {specialSyntax, syntaxComponents} = require('../../src/lib/textwarp/block-coverage');
const {blockRegistry, controlRegistry, eventRegistry, operatorRegistry} =
    require('../../src/lib/textwarp/block-registry');
const {
    buildDocumentationSections,
    filterDocumentationSections
} = require('../../src/lib/textwarp/documentation-content');

const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const sourceDocuments = {
    guideMarkdown: read('TEXTWARP.md'),
    ideMarkdown: read('TEXTWARP_IDE.md'),
    legalMarkdown: read('TEXTWARP_LEGAL.md'),
    prioritiesMarkdown: read('TEXTWARP_PRIORIDADES.md'),
    referenceMarkdown: read('TEXTWARP_BLOCOS.md')
};
const englishDocuments = {
    guideMarkdown: read('TEXTWARP.en.md'),
    ideMarkdown: read('TEXTWARP_IDE.en.md'),
    legalMarkdown: read('TEXTWARP_LEGAL.en.md'),
    locale: 'en',
    prioritiesMarkdown: read('TEXTWARP_PRIORIDADES.en.md'),
    referenceMarkdown: read('TEXTWARP_BLOCOS.en.md')
};

test('documentation pane is built from every canonical TextWarp document', () => {
    const sections = buildDocumentationSections(sourceDocuments);
    assert.ok(sections.length > 20);
    assert.equal(new Set(sections.map(section => section.id)).size, sections.length);
    assert.deepEqual(
        new Set(sections.map(section => section.group)),
        new Set([
            'Manual TextWarp',
            'IDE TextWarp',
            'Referência completa',
            'Estado do projeto',
            'Licenças e compatibilidade',
            'Projeto atual'
        ])
    );
    assert.ok(sections.some(section => section.id === 'manual-visao-geral'));
    assert.ok(sections.some(section => section.id === 'ide-inteligencia-da-linguagem'));
    assert.ok(sections.some(section => section.id === 'reference-movimento'));
    assert.ok(sections.some(section => section.id === 'status-alta-prioridade'));
    assert.ok(sections.some(section => section.id === 'legal-extensoes'));
    [
        'Editor de código',
        'Inteligência da linguagem',
        'Recursos específicos do software',
        'Organização do projeto',
        'Integração com o software principal',
        'Execução e console',
        'Depuração',
        'Produtividade e recuperação',
        'Documentação integrada',
        'Segurança e estabilidade',
        'Usabilidade e acessibilidade'
    ].forEach(title => assert.ok(sections.some(section => section.group === 'IDE TextWarp' && section.title === title), title));
});

test('complete English documentation is available as the fallback for every non-Portuguese locale', () => {
    const sections = buildDocumentationSections(englishDocuments);
    assert.ok(sections.length > 20);
    assert.ok(sections.some(section => section.title === 'Code editor'));
    assert.ok(sections.some(section => section.title === 'High priority'));
    assert.ok(sections.some(section => section.title === 'Extensions' && section.documentId === 'legal'));
    assert.ok(sections.some(section => section.title === 'Motion'));
    assert.ok(sections.some(section => section.group === 'Complete reference'));
    assert.ok(sections.some(section => section.group === 'Current project'));
});

test('runtime documentation references every native syntax and internal component', () => {
    const sections = buildDocumentationSections(sourceDocuments);
    const referenceText = sections.filter(section => section.documentId === 'reference')
        .map(section => section.markdown).join('\n');

    [blockRegistry, controlRegistry, eventRegistry, operatorRegistry].forEach(registry => {
        Object.values(registry).forEach(metadata => {
            assert.match(referenceText, new RegExp(metadata.opcode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
            if (metadata.stageOpcode) assert.match(referenceText, new RegExp(metadata.stageOpcode));
        });
    });
    Object.keys(specialSyntax).forEach(opcode => assert.ok(referenceText.includes(opcode), opcode));
    Object.keys(syntaxComponents).forEach(opcode => assert.ok(referenceText.includes(opcode), opcode));
});

test('search is accent-insensitive and narrows extension entries without hiding their syntax', () => {
    const extensionCatalog = {
        'demo.sayHello': {
            canonicalName: 'demo.sayHello',
            extensionId: 'demo',
            extensionName: 'Demonstração',
            opcode: 'demo_sayHello',
            kind: 'command',
            allowStage: true,
            allowSprite: true,
            arguments: [{name: 'message'}],
            documentation: 'demo.sayHello(message) — mostra uma saudação.'
        },
        'demo.answer': {
            canonicalName: 'demo.answer',
            extensionId: 'demo',
            extensionName: 'Demonstração',
            opcode: 'demo_answer',
            kind: 'reporter',
            allowStage: true,
            allowSprite: false,
            arguments: [],
            documentation: 'demo.answer() — retorna uma resposta.'
        }
    };
    const sections = buildDocumentationSections(Object.assign({}, sourceDocuments, {
        extensionCatalog,
        extensionPalette: [{
            canonicalName: 'demo.@button.open',
            extensionName: 'Demonstração',
            kind: 'button',
            text: 'Abrir configuração'
        }]
    }));

    const procedureResults = filterDocumentationSections(sections, 'procedimentos parametros');
    assert.ok(procedureResults.some(section => section.title === 'Procedimentos e parâmetros'));

    const extensionResults = filterDocumentationSections(sections, 'saudacao');
    assert.equal(extensionResults.length, 1);
    assert.equal(extensionResults[0].id, 'runtime-extensoes-carregadas');
    assert.equal(extensionResults[0].entries.length, 1);
    assert.equal(extensionResults[0].entries[0].syntax, 'demo.sayHello(message)');

    const buttonResults = filterDocumentationSections(sections, 'configuracao');
    const runtimeButtons = buttonResults.find(section => section.id === 'runtime-extensoes-carregadas');
    assert.equal(runtimeButtons.palette[0].kind, 'button');
});
