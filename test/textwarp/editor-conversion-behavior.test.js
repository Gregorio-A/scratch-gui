'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const {addHook} = require('pirates');
const babel = require('@babel/core');
const VM = require('scratch-vm');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {
    applyCompilation: applyVmCompilation,
    readSourceRecord
} = require('../../src/lib/textwarp/vm-adapter');

const loadProductionEditor = () => {
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request.startsWith('!')) return '';
        if (
            parent &&
            /textwarp-editor\.jsx$/.test(parent.filename) &&
            /\.jsx$/.test(request)
        ) return () => null;
        return originalLoad.call(this, request, parent, isMain);
    };
    const revertHook = addHook(
        (code, filename) => babel.transformSync(code, {
            filename,
            configFile: require.resolve('../../.babelrc'),
            babelrc: false
        }).code,
        {exts: ['.js', '.jsx'], ignoreNodeModules: true}
    );
    const assetExtensions = ['.css', '.svg', '.png', '.wav', '.mp3', '.jpg', '.gif'];
    const originalExtensions = Object.fromEntries(assetExtensions.map(extension => [
        extension,
        require.extensions[extension]
    ]));
    assetExtensions.forEach(extension => {
        require.extensions[extension] = module => {
            module.exports = {};
        };
    });
    try {
        return require('../../src/containers/textwarp-editor.jsx').TextEditor;
    } finally {
        Module._load = originalLoad;
        revertHook();
        assetExtensions.forEach(extension => {
            if (originalExtensions[extension]) require.extensions[extension] = originalExtensions[extension];
            else delete require.extensions[extension];
        });
    }
};

const TextEditor = loadProductionEditor();

const emptyProject = () => ({
    targets: [
        {
            isStage: true, name: 'Stage', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
            currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 0, tempo: 60,
            videoTransparency: 50, videoState: 'on'
        },
        {
            isStage: false, name: 'Player', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
            currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 1, visible: true,
            x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
        },
        {
            isStage: false, name: 'Helper', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
            currentCostume: 0, costumes: [], sounds: [], volume: 100, layerOrder: 2, visible: true,
            x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
        }
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '11.3.0', agent: 'TextWarp editor conversion tests'}
});

const createEditor = async () => {
    const vm = new VM();
    await vm.loadProject(emptyProject());
    const target = vm.runtime.targets.find(item => !item.isStage);
    vm.editingTarget = target;
    const editor = new TextEditor({
        editingTargetId: target.id,
        editingTargetName: target.getName(),
        locale: 'en',
        projectTitle: 'Conversion behavior',
        textwarpUiCommand: {id: 0, name: null},
        onClearSb3FileHandle () {},
        onSetProjectUnchanged () {},
        onSetTextwarpUiOperation () {},
        vm
    });
    editor.setState = (update, callback) => {
        const patch = typeof update === 'function' ? update(editor.state, editor.props) : update;
        editor.state = Object.assign({}, editor.state, patch);
        if (callback) callback();
    };
    editor._isMounted = true;
    editor.state.workspace = {modules: [], resources: [], editableFiles: [], generatedFiles: []};
    return {editor, target, vm};
};

const disposeEditor = editor => {
    editor._isMounted = false;
    clearTimeout(editor.analysisTimer);
    clearTimeout(editor.compileTimer);
    clearTimeout(editor.historyTimer);
    clearTimeout(editor.blockSyncTimer);
    clearTimeout(editor.secondaryAnalysisTimer);
    clearTimeout(editor.secondaryCompileTimer);
    editor.conversionWorker.cancelPending();
};

const waitForAutomaticConversion = () => new Promise(resolve => setTimeout(resolve, 520));

test('production editor honors bidirectional automatic synchronization and exact undo', async () => {
    const {editor, target, vm} = await createEditor();
    try {
        editor.state.autoSync = false;
        editor.handleChange('actor Player\non green_flag:\n    move(10)');
        await waitForAutomaticConversion();
        assert.equal(Object.keys(target.blocks._blocks).length, 0);
        assert.equal(readSourceRecord(target).hasDraft, true);

        editor.state.autoSync = true;
        vm.runtime.getMonitorState().set('monitor-one', {
            id: 'monitor-one',
            opcode: 'data_variable',
            mode: 'slider',
            sliderMin: -10,
            sliderMax: 10,
            visible: true
        });
        editor.handleChange('actor Player\non green_flag:\n    say("automatic")');
        await waitForAutomaticConversion();
        assert.ok(Object.values(target.blocks._blocks).some(block => block.opcode === 'looks_say'));
        assert.ok(editor.state.lastConversion);
        vm.runtime.getMonitorState().set('monitor-one', {sliderMax: 999, visible: false});

        editor.undoLastConversion();
        assert.equal(Object.keys(target.blocks._blocks).length, 0);
        assert.equal(editor.state.lastConversion, null);
        assert.equal(editor.state.status, editor.t('conversionUndone'));
        assert.equal(vm.runtime.getMonitorState().get('monitor-one').sliderMax, 10);
        assert.equal(vm.runtime.getMonitorState().get('monitor-one').visible, true);
        assert.ok(Object.values(target.comments).every(comment => typeof comment.toXML === 'function'));
    } finally {
        disposeEditor(editor);
    }
});

test('Blocks to Text for the entire project converts every module transactionally and has one-step undo', async () => {
    const {editor, target, vm} = await createEditor();
    try {
        const stage = vm.runtime.getTargetForStage();
        const helper = vm.runtime.targets.find(item => item.getName() === 'Helper');
        const playerCompilation = compileText(
            'actor Player\non green_flag:\n    move(10)',
            editor.getCompileOptions(target)
        );
        const helperCompilation = compileText(
            'actor Helper\non green_flag:\n    say("ready")',
            editor.getCompileOptions(helper)
        );
        Object.values(playerCompilation.graph.blocks).forEach(block => target.blocks.createBlock(block));
        Object.values(helperCompilation.graph.blocks).forEach(block => helper.blocks.createBlock(block));
        const playerRootCount = Object.values(target.blocks._blocks).filter(block =>
            block.topLevel && !block.shadow
        ).length;
        const helperRootCount = Object.values(helper.blocks._blocks).filter(block =>
            block.topLevel && !block.shadow
        ).length;

        await editor.handleImportProjectBlocks();

        assert.match(readSourceRecord(stage).source, /^stage/);
        assert.match(readSourceRecord(target).source, /^actor Player/);
        assert.match(readSourceRecord(helper).source, /^actor Helper/);
        assert.equal(Object.values(target.blocks._blocks).filter(block =>
            block.topLevel && !block.shadow
        ).length, playerRootCount);
        assert.equal(Object.values(helper.blocks._blocks).filter(block =>
            block.topLevel && !block.shadow
        ).length, helperRootCount);
        assert.equal(editor.state.lastConversion.direction, 'blocks-to-text-project');
        assert.equal(editor.state.lastConversion.projectSnapshots.length, 3);

        editor.undoLastConversion();

        assert.equal(editor.state.lastConversion, null);
        assert.equal(editor.state.status, editor.t('conversionUndone'));
        assert.equal(Object.values(target.blocks._blocks).filter(block =>
            block.topLevel && !block.shadow
        ).length, playerRootCount);
        assert.equal(Object.values(helper.blocks._blocks).filter(block =>
            block.topLevel && !block.shadow
        ).length, helperRootCount);
    } finally {
        disposeEditor(editor);
    }
});

test('production editor queues live conversion until Scratch execution stops', async () => {
    const {editor, target, vm} = await createEditor();
    try {
        const source = 'actor Player\non green_flag:\n    move(10)';
        const compilation = compileText(source, editor.getCompileOptions(target));
        const snapshot = editor.captureConversionSnapshot('text-to-blocks', target, source);
        vm.runtime.threads = [{target, topBlock: 'running-root', stack: ['running-root'], status: 0}];

        editor.applyCompilation(compilation, target, false, snapshot);
        assert.ok(editor.pendingCompilation);
        assert.equal(Object.keys(target.blocks._blocks).length, 0);

        vm.runtime.threads = [];
        editor.handleProjectRunStop();
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(editor.pendingCompilation, null);
        assert.ok(Object.values(target.blocks._blocks).some(block => block.opcode === 'motion_movesteps'));
        assert.strictEqual(editor.state.lastConversion, snapshot);
    } finally {
        disposeEditor(editor);
    }
});

test('automatic Text to Blocks requires an explicit scope for unowned visual roots', async () => {
    const {editor, target} = await createEditor();
    try {
        target.blocks.createBlock({
            id: 'manual-event',
            opcode: 'event_whenflagclicked',
            inputs: {},
            fields: {},
            next: null,
            parent: null,
            topLevel: true,
            shadow: false,
            x: 20,
            y: 30
        });
        editor.state.autoSync = true;
        editor.handleChange('actor Player\non green_flag:\n    move(10)');
        await waitForAutomaticConversion();

        assert.ok(target.blocks.getBlock('manual-event'));
        assert.equal(Object.keys(target.blocks._blocks).length, 1);
        assert.ok(editor.state.conversionScopePrompt);
        assert.deepEqual(editor.state.conversionScopePrompt.matchingRootIds, ['manual-event']);

        editor.resolveConversionScope('replace');
        assert.equal(target.blocks.getBlock('manual-event'), undefined);
        assert.ok(Object.values(target.blocks._blocks).some(block => block.opcode === 'motion_movesteps'));
    } finally {
        disposeEditor(editor);
    }
});

test('Compare versions recomputes a fresh semantic diff even when an older conflict exists', async () => {
    const {editor, target, vm} = await createEditor();
    try {
        const source = 'actor Player\non green_flag:\n    say("text")';
        applyVmCompilation(vm, target, compileText(source, editor.getCompileOptions(target)));
        editor.state.source = source;
        editor.state.visualConflict = {source: 'stale conflict'};
        const literal = Object.values(target.blocks._blocks).find(block => block.opcode === 'text');
        literal.fields.TEXT.value = 'visual';

        await editor.compareTextAndBlocks();

        assert.notEqual(editor.state.visualConflict.source, 'stale conflict');
        assert.deepEqual(editor.state.visualConflict.semanticDiff.changed.length, 1);
        assert.equal(editor.state.conflictReviewOpen, true);
        assert.equal(editor.state.blocksDiverged, true);
    } finally {
        disposeEditor(editor);
    }
});
