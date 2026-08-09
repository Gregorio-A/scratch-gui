'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const VM = require('scratch-vm');

const {CompilationManager} = require('../../src/lib/textwarp/compilation-manager');
const {compileText} = require('../../src/lib/textwarp/compiler');
const {createEditorStatus, transitionEditorStatus} = require('../../src/lib/textwarp/editor-state');
const {localizeSource, switchCodeLanguage} = require('../../src/lib/textwarp/localized-syntax');
const {SourceManager} = require('../../src/lib/textwarp/source-manager');
const {applyProjectCompilation, blockFingerprint} = require('../../src/lib/textwarp/vm-adapter');

test('SourceManager creates immutable, versioned project snapshots', () => {
    const manager = new SourceManager([{
        id: 'sprite',
        content: 'actor Cat',
        sourceLanguage: 'en-US',
        metadata: {targetId: 'sprite'}
    }]);
    const first = manager.createSnapshot();
    assert.equal(first.version, 1);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.files), true);
    assert.equal(Object.isFrozen(first.files[0]), true);
    assert.equal(Object.isFrozen(first.files[0].metadata), true);

    manager.updateDocument('sprite', 'actor Cat\n# edit');
    const second = manager.createSnapshot();
    assert.equal(second.version, 2);
    assert.equal(second.files[0].version, 2);
    assert.equal(second.files[0].dirty, true);
    assert.equal(manager.isCurrent(first), false);
    assert.equal(manager.isCurrent(second), true);

    manager.openDocument({id: 'deleted-sprite', content: 'actor Gone'});
    manager.retainDocuments(['sprite']);
    assert.equal(manager.getDocument('deleted-sprite'), null);
    assert.deepEqual(manager.createSnapshot().files.map(file => file.id), ['sprite']);
});

test('CompilationManager discards an older build that finishes last', async () => {
    const pending = new Map();
    const compiler = source => new Promise(resolve => pending.set(source, resolve));
    const sources = new SourceManager([{id: 'sprite', content: 'version-one'}]);
    const manager = new CompilationManager(compiler);
    const firstBuild = manager.compile(sources.createSnapshot());

    sources.updateDocument('sprite', 'version-two');
    const secondBuild = manager.compile(sources.createSnapshot());
    pending.get('version-two')({success: true, diagnostics: []});
    const second = await secondBuild;
    pending.get('version-one')({success: true, diagnostics: []});
    const first = await firstBuild;

    assert.equal(first, null);
    assert.equal(second.success, true);
    assert.equal(second.documents[0].file.content, 'version-two');
});

test('localized syntax and named arguments produce the canonical IR', () => {
    const english = compileText(
        'actor Cat\nvariable velocidade = 2\non green_flag:\n    go_to(x: 10, y: 20)\n    say("se mude_x")',
        {targetId: 'cat', targetName: 'Cat', isStage: false, codeLanguage: 'en-US'}
    );
    const portuguese = compileText(
        'ator Cat\nvariavel velocidade = 2\nao bandeira_verde:\n    go_to(y: 20, x: 10)\n    diga("se mude_x")',
        {targetId: 'cat', targetName: 'Cat', isStage: false, codeLanguage: 'pt-BR'}
    );
    assert.equal(english.success, true, JSON.stringify(english.diagnostics));
    assert.equal(portuguese.success, true, JSON.stringify(portuguese.diagnostics));
    assert.deepEqual(
        Object.values(portuguese.graph.blocks).map(block => block.opcode).sort(),
        Object.values(english.graph.blocks).map(block => block.opcode).sort()
    );
    assert.match(portuguese.canonicalSource, /variable velocidade/);
    assert.match(portuguese.canonicalSource, /say\("se mude_x"\)/);
    assert.equal(portuguese.textwarpIR.scripts[0].statements[0].arguments[0].value, 10);
    assert.equal(portuguese.textwarpIR.scripts[0].statements[0].arguments[1].value, 20);
});

test('a new actor template is localized from the persisted Portuguese preference', () => {
    const template = [
        'actor Cat',
        '',
        'on green_flag:',
        '    forever:',
        '        if key_pressed("right arrow"):',
        '            change_x(10)',
        '        wait(0)'
    ].join('\n');
    const localized = localizeSource(template, 'pt-BR').source;

    assert.match(localized, /^ator Cat/m);
    assert.match(localized, /^ao bandeira_verde:/m);
    assert.match(localized, /^    para_sempre:/m);
    assert.match(localized, /se tecla_pressionada\(seta_direita\):/);
    assert.match(localized, /mude_x\(10\)/);
    assert.match(localized, /espere\(0\)/);
});

test('user procedures retain precedence when their names collide with native syntax', () => {
    const compilation = compileText([
        'actor Cat',
        'procedure show_variable():',
        '    pass',
        'procedure letter(a, b, c, d, e):',
        '    pass',
        'on green_flag:',
        '    show_variable()',
        '    letter(1, 2, 3, 4, 5)',
        '    say(letter(1, "abc"))'
    ].join('\n'), {targetId: 'cat', targetName: 'Cat', isStage: false});
    assert.equal(compilation.success, true, JSON.stringify(compilation.diagnostics));
    assert.equal(compilation.textwarpIR.scripts[0].statements[0].type, 'ProcedureCall');
    assert.equal(compilation.textwarpIR.scripts[0].statements[1].type, 'ProcedureCall');
    assert.equal(compilation.textwarpIR.scripts[0].statements[2].arguments[0].opcode, 'operator_letter_of');
});

test('code-language switching is semantic and refuses partial invalid translations', () => {
    const source = [
        'ator Gato',
        '# se e mude_x permanecem no comentario',
        'ao bandeira_verde:',
        '    diga("se e mude_x permanecem na string")',
        '    mude_x(valor: velocidade)'
    ].join('\n');
    const options = {targetId: 'cat', targetName: 'Gato', isStage: false, variables: [{
        id: 'speed', name: 'velocidade', variableType: '', owner: 'target'
    }]};
    const switched = switchCodeLanguage(source, 'pt-BR', 'en-US', canonical => compileText(
        canonical,
        Object.assign({}, options, {codeLanguage: 'en-US'})
    ));
    assert.equal(switched.success, true, JSON.stringify(switched.diagnostics));
    assert.match(switched.source, /^actor Gato/m);
    assert.match(switched.source, /# se e mude_x permanecem no comentario/);
    assert.match(switched.source, /say\("se e mude_x permanecem na string"\)/);
    assert.match(switched.source, /change_x\(amount: velocidade\)/);

    const invalid = 'ator Gato\nao bandeira_verde:\n    se:';
    const rejected = switchCodeLanguage(invalid, 'pt-BR', 'en-US', canonical => compileText(
        canonical,
        Object.assign({}, options, {codeLanguage: 'en-US'})
    ));
    assert.equal(rejected.success, false);
    assert.equal(rejected.source, invalid);
});

test('code-language switching preserves user identifiers that collide with localized syntax', () => {
    const source = [
        'ator se',
        'variavel se = 1',
        'procedimento mude_x(valor: numero):',
        '    diga(valor)',
        'ao bandeira_verde:',
        '    mude_x(se)'
    ].join('\n');
    const options = {
        targetId: 'cat',
        targetName: 'se',
        isStage: false,
        variables: [{id: 'if-id', name: 'se', variableType: '', owner: 'target'}]
    };
    const switched = switchCodeLanguage(source, 'pt-BR', 'en-US', canonical => compileText(
        canonical,
        Object.assign({}, options, {codeLanguage: 'en-US'})
    ));

    assert.equal(switched.success, true, JSON.stringify(switched.diagnostics));
    assert.match(switched.source, /^actor se/m);
    assert.match(switched.source, /^variable se = 1/m);
    assert.match(switched.source, /^procedure mude_x\(valor: number\):/m);
    assert.match(switched.source, /^    mude_x\(se\)$/m);
});

test('analysis-only compilation validates IR without building Scratch runtime data', () => {
    const source = 'actor Cat\non green_flag:\n    move(10)';
    const analysis = compileText(source, {
        targetId: 'cat', targetName: 'Cat', isStage: false, analysisOnly: true
    });
    const build = compileText(source, {targetId: 'cat', targetName: 'Cat', isStage: false});

    assert.equal(analysis.success, true, JSON.stringify(analysis.diagnostics));
    assert.ok(analysis.textwarpIR);
    assert.equal(analysis.scratchIR, null);
    assert.ok(build.scratchIR);
});

test('compiler diagnostics expose stable IDs and follow the code language', () => {
    const source = 'actor Cat\non green_flag:\n    missing = 1';
    const english = compileText(source, {
        targetId: 'cat', targetName: 'Cat', isStage: false, codeLanguage: 'en-US', analysisOnly: true
    });
    const portuguese = compileText(source, {
        targetId: 'cat', targetName: 'Cat', isStage: false, codeLanguage: 'pt-BR', analysisOnly: true
    });
    const englishDiagnostic = english.diagnostics.find(item => item.code === 'unknown-variable');
    const portugueseDiagnostic = portuguese.diagnostics.find(item => item.code === 'unknown-variable');

    assert.equal(englishDiagnostic.id, 'diagnostic.unknown-variable');
    assert.equal(englishDiagnostic.message, 'This variable or list has not been declared.');
    assert.match(portugueseDiagnostic.message, /vari[aá]vel/i);
});

test('the editor state machine never runs a stale build', () => {
    const dirty = transitionEditorStatus(createEditorStatus(), 'edit', 4);
    assert.throws(() => transitionEditorStatus(dirty, 'run'), /compiled before Run/);
    const compiling = transitionEditorStatus(dirty, 'compile');
    const ready = transitionEditorStatus(compiling, 'compile-success', 4);
    const running = transitionEditorStatus(ready, 'run');
    assert.deepEqual(running, {
        state: 'running',
        sourceVersion: 4,
        buildVersion: 4,
        runtimeVersion: 4
    });
});

test('project commit rolls every target back when a later target fails', async () => {
    const vm = new VM();
    await vm.loadProject({
        targets: [
            {
                isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
                currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0, tempo: 60,
                videoTransparency: 50, videoState: 'on'
            },
            {
                isStage: false, name: 'Cat', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
                currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 1, visible: true,
                x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
            }
        ],
        monitors: [], extensions: [], meta: {semver: '3.0.0', vm: '11.3.0', agent: 'architecture test'}
    });
    const stage = vm.runtime.getTargetForStage();
    const cat = vm.runtime.targets.find(target => !target.isStage);
    const beforeStage = blockFingerprint(stage);
    const beforeCat = blockFingerprint(cat);
    const stageBuild = compileText('stage\non green_flag:\n    wait(1)', {
        targetId: stage.id, targetName: 'Stage', isStage: true
    });
    const catBuild = compileText('actor Cat\non green_flag:\n    move(10)', {
        targetId: cat.id, targetName: 'Cat', isStage: false
    });
    const originalCreateBlock = cat.blocks.createBlock.bind(cat.blocks);
    cat.blocks.createBlock = () => {
        throw new Error('injected second-target failure');
    };
    assert.throws(() => applyProjectCompilation(vm, [
        {target: stage, compilation: stageBuild},
        {target: cat, compilation: catBuild}
    ]), /injected second-target failure/);
    cat.blocks.createBlock = originalCreateBlock;
    assert.equal(blockFingerprint(stage), beforeStage);
    assert.equal(blockFingerprint(cat), beforeCat);
});
