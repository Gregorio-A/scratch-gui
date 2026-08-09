'use strict';

const JSZip = require('@turbowarp/jszip');

const {compileText} = require('./compiler');
const {decompileTarget} = require('./decompiler');
const {sanitizeIdentifier} = require('./identifier');
const {buildExtensionCatalog} = require('./extension-catalog');
const {
    adoptImportedRoots,
    applyCompilation,
    blockFingerprint,
    captureTargetSnapshot,
    createImportedSourceRecord,
    readSourceRecord,
    restoreTargetSnapshot
} = require('./vm-adapter');

const FORMAT_NAME = 'textwarp-project';
const FORMAT_VERSION = 1;
const PACKAGE_LIMITS = Object.freeze({
    archiveBytes: 128 * 1024 * 1024,
    compiledProjectBytes: 384 * 1024 * 1024,
    entries: 4096,
    jsonBytes: 1024 * 1024,
    modules: 1024,
    sourceBytes: 4 * 1024 * 1024,
    stateBytes: 16 * 1024 * 1024,
    totalUncompressedBytes: 512 * 1024 * 1024
});

const asArrayBuffer = value => {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    return value;
};

const byteLength = value => {
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    return 0;
};

const encodedByteLength = value => {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(value)).byteLength;
    let bytes = 0;
    for (const character of String(value)) {
        const codePoint = character.codePointAt(0);
        if (codePoint <= 0x7F) bytes += 1;
        else if (codePoint <= 0x7FF) bytes += 2;
        else if (codePoint <= 0xFFFF) bytes += 3;
        else bytes += 4;
    }
    return bytes;
};

const entrySize = file => {
    const size = file && file._data && file._data.uncompressedSize;
    return Number.isSafeInteger(size) && size >= 0 ? size : null;
};

const validateEntrySize = (file, maximum, label) => {
    const size = entrySize(file);
    if (size !== null && size > maximum) {
        throw new Error(`Pacote .textwarp inválido: ${label} excede o limite de ${maximum} bytes.`);
    }
};

const readLimited = async (file, type, maximum, label) => {
    if (!file) return null;
    validateEntrySize(file, maximum, label);
    const value = await file.async(type);
    const actualSize = typeof value === 'string' ? encodedByteLength(value) : byteLength(value);
    if (actualSize > maximum) {
        throw new Error(`Pacote .textwarp inválido: ${label} excede o limite de ${maximum} bytes.`);
    }
    return value;
};

const validateArchive = zip => {
    const files = Object.values(zip.files);
    if (files.length > PACKAGE_LIMITS.entries) {
        throw new Error(`Pacote .textwarp inválido: mais de ${PACKAGE_LIMITS.entries} entradas.`);
    }
    let knownUncompressedBytes = 0;
    files.forEach(file => {
        const size = entrySize(file);
        if (size !== null) knownUncompressedBytes += size;
    });
    if (knownUncompressedBytes > PACKAGE_LIMITS.totalUncompressedBytes) {
        throw new Error('Pacote .textwarp inválido: conteúdo expandido excede o limite de segurança.');
    }
};

const isSourcePath = value => (
    typeof value === 'string' &&
    value.startsWith('sources/') &&
    !value.includes('\\') &&
    value.split('/').every(segment => segment && segment !== '.' && segment !== '..')
);

const isStatePath = value => (
    typeof value === 'string' &&
    value.startsWith('state/') &&
    value.endsWith('.json') &&
    !value.includes('\\') &&
    value.split('/').every(segment => segment && segment !== '.' && segment !== '..')
);

const safeModuleFilename = (module, index) => {
    const kind = module.isStage ? 'stage' : sanitizeIdentifier(module.name, `actor_${index + 1}`).toLowerCase();
    const identity = sanitizeIdentifier(module.moduleId, String(index + 1)).slice(0, 48);
    return `sources/${kind}-${identity}.tw`;
};

const safeStateFilename = (module, index) => safeModuleFilename(module, index)
    .replace(/^sources\//, 'state/')
    .replace(/\.tw$/, '.json');

const packTextwarp = async ({projectData, modules, extensions = [], metadata = {}}) => {
    if (byteLength(projectData) > PACKAGE_LIMITS.compiledProjectBytes) {
        throw new Error('O projeto compilado excede o limite de tamanho do formato .textwarp.');
    }
    if (!Array.isArray(modules) || modules.length > PACKAGE_LIMITS.modules) {
        throw new Error(`Um projeto .textwarp pode conter no máximo ${PACKAGE_LIMITS.modules} módulos.`);
    }
    modules.forEach(module => {
        if (encodedByteLength(module.sourceText || '') > PACKAGE_LIMITS.sourceBytes) {
            throw new Error(`A fonte do módulo "${module.name || 'sem nome'}" excede o limite de tamanho.`);
        }
        if (
            module.conversionState &&
            encodedByteLength(JSON.stringify(module.conversionState)) > PACKAGE_LIMITS.stateBytes
        ) {
            throw new Error(`O estado do módulo "${module.name || 'sem nome'}" excede o limite de tamanho.`);
        }
    });
    const zip = new JSZip();
    const compiledBytes = asArrayBuffer(projectData);
    const compiledZip = await JSZip.loadAsync(compiledBytes);
    const manifestModules = modules.map((module, index) => Object.assign({}, module, {
        source: safeModuleFilename(module, index),
        state: module.conversionState ? safeStateFilename(module, index) : null
    }));
    const manifest = {
        format: FORMAT_NAME,
        formatVersion: FORMAT_VERSION,
        languageVersion: '0.3',
        name: metadata.name || 'TextWarp Project',
        createdAt: metadata.createdAt || new Date().toISOString(),
        compiledProject: 'compiled/project.sb3',
        projectJson: 'project/project.json',
        modules: manifestModules.map(module => ({
            moduleId: module.moduleId,
            targetId: module.targetId || null,
            name: module.name,
            isStage: Boolean(module.isStage),
            sourceLanguage: module.sourceLanguage || 'en-US',
            source: module.source,
            state: module.state
        })),
        extensions: 'extensions/lock.json'
    };

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('compiled/project.sb3', compiledBytes);
    zip.file('extensions/lock.json', JSON.stringify({formatVersion: 1, extensions}, null, 2));
    manifestModules.forEach(module => {
        zip.file(module.source, module.sourceText || '');
        if (module.state) zip.file(module.state, JSON.stringify(module.conversionState));
    });

    const projectJsonFile = compiledZip.file('project.json');
    if (projectJsonFile) zip.file('project/project.json', await projectJsonFile.async('uint8array'));
    await Promise.all(Object.values(compiledZip.files).map(async file => {
        if (file.dir || file.name === 'project.json') return;
        zip.file(`assets/${file.name}`, await file.async('uint8array'));
    }));
    return zip.generateAsync({type: 'uint8array', compression: 'DEFLATE', compressionOptions: {level: 6}});
};

const unpackTextwarp = async data => {
    const archive = asArrayBuffer(data);
    if (byteLength(archive) > PACKAGE_LIMITS.archiveBytes) {
        throw new Error('Pacote .textwarp inválido: arquivo comprimido excede o limite de segurança.');
    }
    const zip = await JSZip.loadAsync(archive);
    validateArchive(zip);
    const manifestFile = zip.file('manifest.json');
    if (!manifestFile) throw new Error('Pacote .textwarp inválido: manifest.json não encontrado.');
    let manifest;
    try {
        manifest = JSON.parse(await readLimited(
            manifestFile,
            'string',
            PACKAGE_LIMITS.jsonBytes,
            'manifest.json'
        ));
    } catch (error) {
        throw new Error(`Pacote .textwarp inválido: ${error.message}`);
    }
    if (manifest.format !== FORMAT_NAME || manifest.formatVersion !== FORMAT_VERSION) {
        throw new Error(`Formato .textwarp não suportado: ${manifest.format || 'desconhecido'} v${manifest.formatVersion}.`);
    }
    if (!Array.isArray(manifest.modules) || manifest.modules.length > PACKAGE_LIMITS.modules) {
        throw new Error(`Pacote .textwarp inválido: limite de ${PACKAGE_LIMITS.modules} módulos excedido.`);
    }
    const modules = [];
    const sourcePaths = new Set();
    const statePaths = new Set();
    for (const module of manifest.modules) {
        if (!module || !isSourcePath(module.source) || sourcePaths.has(module.source)) {
            throw new Error(`Caminho de fonte inválido ou duplicado: ${module && module.source}.`);
        }
        sourcePaths.add(module.source);
        if (module.state && (!isStatePath(module.state) || statePaths.has(module.state))) {
            throw new Error(`Caminho de estado inválido ou duplicado: ${module.state}.`);
        }
        if (module.state) statePaths.add(module.state);
        const sourceFile = zip.file(module.source);
        if (!sourceFile) throw new Error(`Fonte ausente no pacote: ${module.source}.`);
        const stateFile = module.state ? zip.file(module.state) : null;
        if (module.state && !stateFile) throw new Error(`Estado de conversão ausente no pacote: ${module.state}.`);
        modules.push(Object.assign({}, module, {
            sourceText: await readLimited(
                sourceFile,
                'string',
                PACKAGE_LIMITS.sourceBytes,
                module.source
            ),
            conversionState: stateFile ? JSON.parse(await readLimited(
                stateFile,
                'string',
                PACKAGE_LIMITS.stateBytes,
                module.state
            )) : null
        }));
    }
    let projectData = null;
    const compiled = zip.file(manifest.compiledProject || 'compiled/project.sb3');
    if (compiled) {
        projectData = await readLimited(
            compiled,
            'arraybuffer',
            PACKAGE_LIMITS.compiledProjectBytes,
            'compiled/project.sb3'
        );
    } else {
        const projectJson = zip.file(manifest.projectJson || 'project/project.json');
        if (!projectJson) throw new Error('O pacote não contém o projeto compilado nem project/project.json.');
        const rebuilt = new JSZip();
        rebuilt.file('project.json', await projectJson.async('uint8array'));
        await Promise.all(Object.values(zip.files).map(async file => {
            if (file.dir || !file.name.startsWith('assets/')) return;
            rebuilt.file(file.name.slice('assets/'.length), await file.async('uint8array'));
        }));
        projectData = await rebuilt.generateAsync({type: 'arraybuffer'});
    }
    const lockFile = zip.file(manifest.extensions || 'extensions/lock.json');
    const lock = lockFile ? JSON.parse(await readLimited(
        lockFile,
        'string',
        PACKAGE_LIMITS.jsonBytes,
        'extensions/lock.json'
    )) : {extensions: []};
    return {manifest, modules, extensions: lock.extensions || [], projectData};
};

const originalTargets = vm => (vm.runtime.targets || []).filter(target => target.isStage || target.isOriginal !== false);

const exportTextwarpProject = async (vm, metadata = {}) => {
    if (!vm || typeof vm.saveProjectSb3 !== 'function') throw new Error('A VM não pode salvar um projeto SB3.');
    const extensionCatalog = buildExtensionCatalog(vm);
    const stage = vm.runtime.getTargetForStage && vm.runtime.getTargetForStage();
    const stageRecord = stage && readSourceRecord(stage);
    const generatedAcrossProject = new Set(originalTargets(vm).flatMap(runtimeTarget => {
        const runtimeRecord = readSourceRecord(runtimeTarget);
        return runtimeRecord ? runtimeRecord.generatedVariables : [];
    }).map(item => item.id));
    const modules = originalTargets(vm).map(target => {
        const record = readSourceRecord(target);
        if (record && (
            record.hasDraft ||
            !record.blockFingerprint ||
            record.blockFingerprint !== blockFingerprint(target)
        )) {
            throw new Error(
                `Não é possível exportar "${target.getName ? target.getName() : target.id}": ` +
                'o texto e os blocos possuem alterações não sincronizadas.'
            );
        }
        const decompiled = record ? null : decompileTarget(target, {extensionCatalog});
        const sourceText = record ? record.source : decompiled.source;
        const moduleId = record && record.moduleId ? record.moduleId : target.id;
        const compilation = compileText(sourceText, {
            targetId: moduleId,
            stageId: stageRecord && stageRecord.moduleId ? stageRecord.moduleId : stage && stage.id,
            targetName: target.getName ? target.getName() : target.id,
            isStage: target.isStage,
            variables: variableOptions(vm, target, record && record.generatedVariables),
            broadcasts: Object.values(stage && stage.variables || {})
                .filter(variable => variable.type === 'broadcast_msg')
                .map(variable => ({
                    id: variable.id,
                    name: variable.name,
                    generated: generatedAcrossProject.has(variable.id)
                })),
            previousUnits: record && record.units || [],
            extensionCatalog
        });
        if (!compilation.success) {
            throw new Error(
                `Não é possível exportar "${target.getName ? target.getName() : target.id}": ` +
                'a fonte contém erros de conversão.'
            );
        }
        const conversionState = record || createImportedSourceRecord(
            target,
            sourceText,
            decompiled.importedRootIds,
            decompiled.sourceMap,
            compilation
        );
        conversionState.blockFingerprint = blockFingerprint(target);
        return {
            moduleId,
            targetId: target.id,
            name: target.getName ? target.getName() : target.sprite && target.sprite.name || (target.isStage ? 'Stage' : 'Actor'),
            isStage: target.isStage,
            sourceLanguage: conversionState.sourceLanguage || 'en-US',
            sourceText,
            conversionState
        };
    });
    const extensionURLs = vm.extensionManager && typeof vm.extensionManager.getExtensionURLs === 'function' ?
        vm.extensionManager.getExtensionURLs() : {};
    const extensions = Object.values(extensionCatalog).reduce((result, item) => {
        if (result.some(extension => extension.id === item.extensionId)) return result;
        result.push({
            id: item.extensionId,
            url: extensionURLs[item.extensionId] || null,
            blockCount: Object.values(extensionCatalog).filter(block => block.extensionId === item.extensionId).length
        });
        return result;
    }, []);
    return packTextwarp({projectData: await vm.saveProjectSb3('arraybuffer'), modules, extensions, metadata});
};

const variableOptions = (vm, target, generatedVariables) => {
    const result = [];
    const generated = new Set((generatedVariables || []).map(item => item.id));
    const append = (owner, ownerName) => Object.values(owner && owner.variables || {}).forEach(variable => {
        if (variable.type === 'broadcast_msg') return;
        result.push({
            id: variable.id,
            name: variable.name,
            variableType: variable.type,
            owner: ownerName,
            generated: generated.has(variable.id),
            isCloud: Boolean(variable.isCloud)
        });
    });
    append(target, 'target');
    const stage = vm.runtime.getTargetForStage && vm.runtime.getTargetForStage();
    if (stage && stage !== target) append(stage, 'stage');
    return result;
};

const targetForModule = (vm, module, usedTargets) => {
    const exact = module.targetId && vm.runtime.getTargetById && vm.runtime.getTargetById(module.targetId);
    if (
        exact &&
        !usedTargets.has(exact.id) &&
        Boolean(exact.isStage) === Boolean(module.isStage)
    ) return exact;
    if (module.isStage) return vm.runtime.getTargetForStage && vm.runtime.getTargetForStage();
    const targets = originalTargets(vm).filter(target => !target.isStage && !usedTargets.has(target.id));
    return targets.find(target => (target.getName ? target.getName() : target.sprite && target.sprite.name) === module.name) || targets[0];
};

const restoreExtensionDependencies = async (vm, extensions) => {
    const manager = vm && vm.extensionManager;
    if (!manager) {
        if ((extensions || []).length) throw new Error('A VM não possui um gerenciador de extensões.');
        return {loaded: [], alreadyLoaded: []};
    }
    const loaded = [];
    const alreadyLoaded = [];
    for (const dependency of extensions || []) {
        if (!dependency || typeof dependency.id !== 'string' || !dependency.id) continue;
        if (manager.isExtensionLoaded(dependency.id)) {
            alreadyLoaded.push(dependency.id);
            continue;
        }
        const locator = dependency.url || (manager.isBuiltinExtension(dependency.id) ? dependency.id : null);
        if (!locator) {
            throw new Error(`A extensão "${dependency.id}" é necessária, mas extensions/lock.json não contém sua URL.`);
        }
        const securityManager = vm.securityManager || manager.securityManager;
        if (
            dependency.url && securityManager &&
            typeof securityManager.canLoadExtensionFromProject === 'function' &&
            !await securityManager.canLoadExtensionFromProject(dependency.url)
        ) {
            throw new Error(`Permissão negada para carregar a extensão "${dependency.id}".`);
        }
        await manager.loadExtensionURL(locator);
        if (!manager.isExtensionLoaded(dependency.id)) {
            throw new Error(`A dependência ${locator} não registrou a extensão esperada "${dependency.id}".`);
        }
        loaded.push(dependency.id);
    }
    return {loaded, alreadyLoaded};
};

const importTextwarpProject = async (vm, data) => {
    if (!vm || typeof vm.loadProject !== 'function') throw new Error('A VM não pode abrir projetos.');
    const unpacked = await unpackTextwarp(data);
    // Restore the explicit lock before deserializing the SB3. This also lets old
    // packages open when project.json lost its custom extensionURLs metadata.
    const extensionRestore = await restoreExtensionDependencies(vm, unpacked.extensions);
    await vm.loadProject(unpacked.projectData);
    const stageModule = unpacked.modules.find(module => module.isStage);
    const stageId = stageModule ? stageModule.moduleId : vm.runtime.getTargetForStage().id;
    const extensionCatalog = buildExtensionCatalog(vm);
    const diagnostics = [];
    const usedTargets = new Set();
    const orderedModules = unpacked.modules.slice().sort((left, right) => Number(right.isStage) - Number(left.isStage));

    orderedModules.forEach(module => {
        const target = targetForModule(vm, module, usedTargets);
        if (!target) {
            diagnostics.push({module: module.name, success: false, diagnostics: [{message: 'Alvo correspondente não encontrado.'}]});
            return;
        }
        usedTargets.add(target.id);
        const existing = readSourceRecord(target);
        const conversionState = module.conversionState || existing || {};
        const moduleId = module.moduleId || target.id;
        const generatedAcrossProject = new Set(originalTargets(vm).flatMap(runtimeTarget => {
            const runtimeRecord = readSourceRecord(runtimeTarget);
            return runtimeRecord ? runtimeRecord.generatedVariables : [];
        }).map(item => item.id));
        const compilation = compileText(module.sourceText, {
            codeLanguage: module.sourceLanguage || conversionState.sourceLanguage || 'en-US',
            targetId: moduleId,
            stageId,
            targetName: target.getName ? target.getName() : module.name,
            isStage: target.isStage,
            variables: variableOptions(vm, target, conversionState.generatedVariables),
            broadcasts: Object.values(vm.runtime.getTargetForStage().variables || {})
                .filter(variable => variable.type === 'broadcast_msg')
                .map(variable => ({
                    id: variable.id,
                    name: variable.name,
                    generated: generatedAcrossProject.has(variable.id)
                })),
            previousUnits: conversionState.units || [],
            extensionCatalog
        });
        if (compilation.success) {
            const transactionSnapshot = captureTargetSnapshot(vm, target);
            try {
                let roots = conversionState.generatedRootIds;
                let sourceMap = conversionState.sourceMap || {};
                if (
                    !Array.isArray(roots) ||
                    roots.length === 0 ||
                    roots.some(rootId => !target.blocks.getBlock(rootId))
                ) {
                    const loadedVisual = decompileTarget(target, {extensionCatalog});
                    roots = loadedVisual.importedRootIds;
                    sourceMap = loadedVisual.sourceMap;
                }
                adoptImportedRoots(vm, target, module.sourceText, roots, sourceMap, compilation);
                const adopted = readSourceRecord(target);
                if (adopted) {
                    adopted.moduleId = moduleId;
                    adopted.generatedVariables = conversionState.generatedVariables || adopted.generatedVariables;
                    adopted.resourceBindings = conversionState.resourceBindings || adopted.resourceBindings;
                    adopted.breakpoints = conversionState.breakpoints || adopted.breakpoints;
                    adopted.sourceLanguage = module.sourceLanguage || conversionState.sourceLanguage || 'en-US';
                }
                applyCompilation(vm, target, compilation);
            } catch (error) {
                restoreTargetSnapshot(vm, target, transactionSnapshot);
                throw error;
            }
        }
        diagnostics.push({module: module.name, success: compilation.success, diagnostics: compilation.diagnostics});
    });
    if (typeof vm.emitTargetsUpdate === 'function') vm.emitTargetsUpdate();
    if (typeof vm.emitWorkspaceUpdate === 'function') vm.emitWorkspaceUpdate();
    return Object.assign({}, unpacked, {diagnostics, extensionRestore});
};

module.exports = {
    FORMAT_NAME,
    FORMAT_VERSION,
    PACKAGE_LIMITS,
    exportTextwarpProject,
    importTextwarpProject,
    packTextwarp,
    restoreExtensionDependencies,
    unpackTextwarp
};
