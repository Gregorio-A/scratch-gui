'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('@turbowarp/jszip');
const VM = require('scratch-vm');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {
    FORMAT_NAME,
    PACKAGE_LIMITS,
    exportTextwarpProject,
    importTextwarpProject,
    packTextwarp,
    restoreExtensionDependencies,
    unpackTextwarp
} = require('../../src/lib/textwarp/textwarp-package');
const {applyCompilation} = require('../../src/lib/textwarp/vm-adapter');

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
        }
    ],
    monitors: [],
    extensions: [],
    meta: {semver: '3.0.0', vm: '11.3.0', agent: 'TextWarp package tests'}
});

test('packs editable sources, resources, manifest and compiled SB3 separately', async () => {
    const sb3 = new JSZip();
    sb3.file('project.json', JSON.stringify({targets: [], monitors: [], extensions: [], meta: {semver: '3.0.0'}}));
    sb3.file('asset.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const projectData = await sb3.generateAsync({type: 'uint8array'});
    const packageBytes = await packTextwarp({
        projectData,
        modules: [
            {
                moduleId: 'stage-module',
                name: 'Stage',
                isStage: true,
                sourceText: 'stage\non green_flag:\n    wait(0)',
                conversionState: {formatVersion: 3, source: 'stage\non green_flag:\n    wait(0)', units: []}
            },
            {moduleId: 'player-module', name: 'Player', isStage: false, sourceText: 'actor Player\non green_flag:\n    move(10)'}
        ],
        extensions: [{id: 'physics', url: 'https://example.com/physics.js'}],
        metadata: {name: 'Game', createdAt: '2026-07-19T00:00:00.000Z'}
    });
    const archive = await JSZip.loadAsync(packageBytes);
    assert.ok(archive.file('manifest.json'));
    assert.ok(archive.file('compiled/project.sb3'));
    assert.ok(archive.file('project/project.json'));
    assert.ok(archive.file('assets/asset.svg'));
    assert.ok(archive.file('extensions/lock.json'));
    assert.ok(Object.keys(archive.files).some(name => name.startsWith('state/') && name.endsWith('.json')));

    const unpacked = await unpackTextwarp(packageBytes);
    assert.equal(unpacked.manifest.format, FORMAT_NAME);
    assert.equal(unpacked.manifest.name, 'Game');
    assert.equal(unpacked.modules.length, 2);
    assert.equal(unpacked.modules.find(module => module.isStage).sourceText.startsWith('stage'), true);
    assert.equal(unpacked.modules.find(module => module.isStage).conversionState.formatVersion, 3);
    assert.deepEqual(unpacked.extensions, [{id: 'physics', url: 'https://example.com/physics.js'}]);
    const restoredSb3 = await JSZip.loadAsync(unpacked.projectData);
    assert.ok(restoredSb3.file('project.json'));
    assert.ok(restoredSb3.file('asset.svg'));
});

test('rejects ZIP files that are not TextWarp projects', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'not a project');
    const data = await zip.generateAsync({type: 'uint8array'});
    await assert.rejects(() => unpackTextwarp(data), /manifest\.json/);
});

test('rejects oversized source entries before importing a TextWarp project', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
        format: FORMAT_NAME,
        formatVersion: 1,
        modules: [{moduleId: 'stage', name: 'Stage', isStage: true, source: 'sources/stage.tw'}],
        compiledProject: 'compiled/project.sb3'
    }));
    zip.file('sources/stage.tw', 'x'.repeat(PACKAGE_LIMITS.sourceBytes + 1));
    zip.file('compiled/project.sb3', new Uint8Array());
    const data = await zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
    await assert.rejects(() => unpackTextwarp(data), /excede o limite/);
});

test('rejects unsafe or duplicated source paths in a TextWarp manifest', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({
        format: FORMAT_NAME,
        formatVersion: 1,
        modules: [{moduleId: 'stage', name: 'Stage', isStage: true, source: '../outside.tw'}],
        compiledProject: 'compiled/project.sb3'
    }));
    zip.file('compiled/project.sb3', new Uint8Array());
    const data = await zip.generateAsync({type: 'uint8array'});
    await assert.rejects(() => unpackTextwarp(data), /Caminho de fonte inválido/);
});

test('restores locked extension dependencies before a project is compiled', async () => {
    const loaded = new Set(['pen']);
    const requested = [];
    const manager = {
        isExtensionLoaded: id => loaded.has(id),
        isBuiltinExtension: id => id === 'music',
        async loadExtensionURL (locator) {
            requested.push(locator);
            loaded.add(locator === 'music' ? 'music' : 'physics');
        }
    };
    const permissions = [];
    const vm = {
        extensionManager: manager,
        securityManager: {
            async canLoadExtensionFromProject (url) {
                permissions.push(url);
                return true;
            }
        }
    };
    const restored = await restoreExtensionDependencies(vm, [
        {id: 'pen', url: null},
        {id: 'music', url: null},
        {id: 'physics', url: 'https://example.com/physics.js'}
    ]);
    assert.deepEqual(restored.alreadyLoaded, ['pen']);
    assert.deepEqual(restored.loaded, ['music', 'physics']);
    assert.deepEqual(requested, ['music', 'https://example.com/physics.js']);
    assert.deepEqual(permissions, ['https://example.com/physics.js']);
});

test('rejects a missing locked URL instead of silently keeping third-party blocks inert', async () => {
    const vm = {
        extensionManager: {
            isExtensionLoaded: () => false,
            isBuiltinExtension: () => false
        }
    };
    await assert.rejects(
        () => restoreExtensionDependencies(vm, [{id: 'physics', url: null}]),
        /não contém sua URL/
    );
});

test('rejects a locked extension when project loading permission is denied', async () => {
    let loaded = false;
    const vm = {
        extensionManager: {
            isExtensionLoaded: () => false,
            isBuiltinExtension: () => false,
            async loadExtensionURL () { loaded = true; }
        },
        securityManager: {
            async canLoadExtensionFromProject () { return false; }
        }
    };
    await assert.rejects(
        () => restoreExtensionDependencies(vm, [{id: 'physics', url: 'https://example.com/physics.js'}]),
        /Permissão negada/
    );
    assert.equal(loaded, false);
});

test('marker-free Scratch roots remain single after a .textwarp export/import round trip', async () => {
    const vm = new VM();
    await vm.loadProject(emptyProject());
    const target = vm.runtime.targets.find(item => !item.isStage);
    const stage = vm.runtime.getTargetForStage();
    applyCompilation(vm, target, compileText(`actor Player
on green_flag:
    say("once")`, {
        targetId: target.id,
        stageId: stage.id,
        targetName: target.getName(),
        isStage: false
    }));
    Object.keys(target.comments).forEach(id => {
        if (target.comments[id].text.startsWith('@textwarp/')) delete target.comments[id];
    });
    const beforeRoots = Object.values(target.blocks._blocks)
        .filter(block => block.topLevel && !block.shadow).length;
    assert.equal(beforeRoots, 1);

    const packageData = await exportTextwarpProject(vm, {name: 'Marker-free'});
    const restoredVm = new VM();
    await importTextwarpProject(restoredVm, packageData);
    const restored = restoredVm.runtime.targets.find(item => !item.isStage);
    const roots = Object.values(restored.blocks._blocks).filter(block => block.topLevel && !block.shadow);
    assert.equal(roots.length, 1);
    assert.equal(roots[0].opcode, 'event_whenflagclicked');
    assert.equal(restored.blocks.getBlock(roots[0].next).opcode, 'looks_say');
});

test('export refuses stale embedded source instead of overwriting newer visual blocks on import', async () => {
    const vm = new VM();
    await vm.loadProject(emptyProject());
    const target = vm.runtime.targets.find(item => !item.isStage);
    const stage = vm.runtime.getTargetForStage();
    applyCompilation(vm, target, compileText(`actor Player
on green_flag:
    say("before")`, {
        targetId: target.id,
        stageId: stage.id,
        targetName: target.getName(),
        isStage: false
    }));
    const textBlock = Object.values(target.blocks._blocks).find(block => block.opcode === 'text');
    textBlock.fields.TEXT.value = 'visual edit';
    await assert.rejects(
        () => exportTextwarpProject(vm, {name: 'Diverged'}),
        /alterações não sincronizadas/
    );
});
