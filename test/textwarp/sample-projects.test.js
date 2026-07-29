'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const JSZip = require('@turbowarp/jszip');
const nanoLog = require('@turbowarp/nanolog');
const VM = require('scratch-vm');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {decompileTarget} = require('../../src/lib/textwarp/decompiler');
const {buildExtensionCatalog} = require('../../src/lib/textwarp/extension-catalog');
const {buildWorkspace} = require('../../src/lib/textwarp/workspace-service');

const samplesDirectory = path.join(__dirname, '..', '..', 'samples');
const sampleProjects = fs.existsSync(samplesDirectory) ?
    fs.readdirSync(samplesDirectory).filter(filename => filename.endsWith('.sb3')).sort() :
    [];
nanoLog.disable();

const loadProjectWithoutAssets = async filename => {
    const archive = await JSZip.loadAsync(fs.readFileSync(path.join(samplesDirectory, filename)));
    const project = JSON.parse(await archive.file('project.json').async('string'));
    const assetMetadata = project.targets.map(target => ({
        costumes: target.costumes,
        sounds: target.sounds
    }));
    project.targets.forEach(target => {
        target.costumes = [];
        target.sounds = [];
    });
    project.monitors = [];
    const vm = new VM();
    await vm.loadProject(project);
    vm.runtime.targets.filter(target =>
        target && (target.isStage || target.isOriginal !== false)
    ).forEach((target, index) => {
        target.sprite.costumes = assetMetadata[index].costumes;
        target.sprite.sounds = assetMetadata[index].sounds;
    });
    return vm;
};

const compileOptions = (vm, target, extensionCatalog, resources) => {
    const stage = vm.runtime.getTargetForStage();
    const variables = [];
    const appendVariables = (owner, ownerName) => Object.values(owner && owner.variables || {}).forEach(variable => {
        if (variable.type === 'broadcast_msg') return;
        variables.push({
            id: variable.id,
            name: variable.name,
            variableType: variable.type,
            owner: ownerName,
            generated: false,
            isCloud: Boolean(variable.isCloud)
        });
    });
    appendVariables(target, 'target');
    if (stage !== target) appendVariables(stage, 'stage');
    return {
        targetId: target.id,
        stageId: stage.id,
        targetName: target.getName(),
        isStage: target.isStage,
        variables,
        broadcasts: Object.values(stage.variables || {}).filter(variable =>
            variable.type === 'broadcast_msg'
        ).map(variable => ({
            id: variable.id,
            name: variable.name,
            generated: false
        })),
        resources,
        extensionCatalog,
        availableOpcodes: Object.keys(vm.runtime._primitives || {})
    };
};

test('every supplied internet project converts every stage and actor to compilable TextWarp', {
    skip: sampleProjects.length === 0 ? 'No local .sb3 projects were supplied in samples/' : false,
    timeout: 30000
}, async t => {
    for (const filename of sampleProjects) {
        await t.test(filename, async () => {
            const vm = await loadProjectWithoutAssets(filename);
            const stage = vm.runtime.getTargetForStage();
            const extensionCatalog = buildExtensionCatalog(vm);
            const resources = buildWorkspace(vm).resources;
            const targets = vm.runtime.targets.filter(target =>
                target && (target.isStage || target.isOriginal !== false)
            );
            for (const target of targets) {
                const roots = Object.values(target.blocks && target.blocks._blocks || {}).filter(block =>
                    block.topLevel && !block.shadow
                );
                const decompiled = decompileTarget(target, {extensionCatalog, stageTarget: stage});
                assert.equal(
                    decompiled.success,
                    true,
                    `${filename} / ${target.getName()}: ${JSON.stringify(decompiled.diagnostics)}`
                );
                assert.equal(
                    decompiled.importedRootIds.length,
                    roots.length,
                    `${filename} / ${target.getName()} did not cover every visual root`
                );
                const compilation = compileText(
                    decompiled.source,
                    compileOptions(vm, target, extensionCatalog, resources)
                );
                assert.equal(
                    compilation.success,
                    true,
                    `${filename} / ${target.getName()}: ${JSON.stringify(
                        compilation.diagnostics.filter(item => item.severity === 'error')
                    )}`
                );
            }
        });
    }
});
