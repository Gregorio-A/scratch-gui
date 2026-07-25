'use strict';

const {readSourceRecord} = require('./vm-adapter');

const HISTORY_LIMIT = 30;
const RECENT_LIMIT = 10;
const STORAGE_PREFIX = 'textwarp.ide.v1';

const safeName = target => target && target.getName ? target.getName() : target && target.sprite && target.sprite.name || 'Sem nome';

const targetFileName = target => target && target.isStage ? 'stage.tw' : `${safeName(target)}.tw`;

const targetResources = target => {
    if (!target) return [];
    const ownerName = safeName(target);
    const values = [];
    Object.values(target.variables || {}).forEach(variable => {
        const kind = variable.type === 'list' ? 'list' : variable.type === 'broadcast_msg' ? 'broadcast' : 'variable';
        values.push({
            id: variable.id,
            name: variable.name,
            kind,
            kindLabel: kind === 'list' ? 'Lista' : kind === 'broadcast' ? 'Mensagem' : 'Variável',
            ownerId: target.id,
            ownerName,
            detail: `${kind === 'list' ? 'Lista' : kind === 'broadcast' ? 'Mensagem de broadcast' : 'Variável'} de ${ownerName}. ID estável: ${variable.id}`
        });
    });
    const sprite = target.sprite || {};
    (sprite.costumes || []).forEach(costume => values.push({
        id: costume.assetId || costume.md5 || costume.name,
        name: costume.name,
        kind: 'costume',
        kindLabel: 'Fantasia',
        ownerId: target.id,
        ownerName,
        detail: `Fantasia de ${ownerName}.`
    }));
    (sprite.sounds || []).forEach(sound => values.push({
        id: sound.assetId || sound.md5 || sound.name,
        name: sound.name,
        kind: 'sound',
        kindLabel: 'Som',
        ownerId: target.id,
        ownerName,
        detail: `Som de ${ownerName}.`
    }));
    return values;
};

const buildWorkspace = vm => {
    const targets = vm && vm.runtime && vm.runtime.targets || [];
    const modules = targets.map(target => {
        const record = readSourceRecord(target);
        return {
            id: target.id,
            name: safeName(target),
            fileName: targetFileName(target),
            isStage: Boolean(target.isStage),
            source: record ? record.source : '',
            breakpoints: record ? record.breakpoints || [] : [],
            generated: false,
            resources: targetResources(target)
        };
    });
    const targetEntries = targets.map(target => ({
        id: target.id,
        name: safeName(target),
        kind: target.isStage ? 'stage' : 'actor',
        kindLabel: target.isStage ? 'Palco' : 'Ator',
        ownerId: target.id,
        ownerName: safeName(target),
        detail: `${target.isStage ? 'Palco' : 'Ator'} do projeto. ID estável: ${target.id}`
    }));
    return {
        modules,
        resources: targetEntries.concat(...modules.map(module => module.resources)),
        editableFiles: modules.map(module => module.fileName),
        generatedFiles: ['compiled/project.sb3', 'manifest.json', 'extensions/lock.json']
    };
};

const searchWorkspace = (workspace, query) => {
    const normalized = String(query || '').trim().toLocaleLowerCase();
    if (!normalized) return [];
    const results = [];
    (workspace.modules || []).forEach(module => {
        String(module.source || '').split(/\r?\n/).forEach((text, index) => {
            const column = text.toLocaleLowerCase().indexOf(normalized);
            if (column !== -1) results.push({
                targetId: module.id,
                fileName: module.fileName,
                line: index + 1,
                column: column + 1,
                text: text.trim()
            });
        });
    });
    return results;
};

const replaceWorkspace = (workspace, query, replacement) => {
    const needle = String(query || '');
    if (!needle) return {count: 0, modules: (workspace.modules || []).map(module => Object.assign({}, module))};
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let count = 0;
    const modules = (workspace.modules || []).map(module => {
        const source = String(module.source || '');
        let moduleCount = 0;
        const updated = source.replace(pattern, () => {
            moduleCount++;
            return String(replacement || '');
        });
        count += moduleCount;
        return moduleCount ? Object.assign({}, module, {source: updated}) : Object.assign({}, module);
    });
    return {count, modules};
};

const synchronizeStableReferences = (source, target, bindings, resources) => {
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    let count = 0;
    if (target) {
        const declaration = target.isStage ? 'stage' : `actor ${safeName(target)}`;
        const declarationIndex = lines.findIndex(line => /^\s*(actor|stage)(?:\s+.*)?$/.test(line));
        if (declarationIndex !== -1 && lines[declarationIndex].trim() !== declaration) {
            lines[declarationIndex] = declaration;
            count++;
        }
    }
    (bindings || []).forEach(binding => {
        const resource = (resources || []).find(item =>
            item.id === binding.resourceId && item.kind === binding.resourceKind &&
            (!binding.ownerId || item.ownerId === binding.ownerId)
        );
        if (!resource || resource.name === binding.name || !Number.isInteger(binding.line) || !lines[binding.line - 1]) return;
        const doubleQuoted = JSON.stringify(binding.name);
        const singleQuoted = `'${String(binding.name).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
        const replacement = JSON.stringify(resource.name);
        const original = lines[binding.line - 1];
        const updated = original.includes(doubleQuoted) ? original.split(doubleQuoted).join(replacement) :
            original.includes(singleQuoted) ? original.split(singleQuoted).join(replacement) : original;
        if (updated !== original) {
            lines[binding.line - 1] = updated;
            binding.name = resource.name;
            count++;
        }
    });
    return {source: lines.join('\n'), count};
};

const storageAvailable = storage => storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function';
const storageKey = (projectId, targetId, type) => `${STORAGE_PREFIX}.${projectId || 'project'}.${targetId}.${type}`;

const parseStored = (storage, key, fallback) => {
    if (!storageAvailable(storage)) return fallback;
    try {
        const value = JSON.parse(storage.getItem(key));
        return value === null ? fallback : value;
    } catch (error) {
        return fallback;
    }
};

const saveHistorySnapshot = (storage, projectId, targetId, source, reason = 'autosave', now = Date.now()) => {
    if (!storageAvailable(storage) || !targetId) return [];
    const key = storageKey(projectId, targetId, 'history');
    const history = parseStored(storage, key, []);
    const latest = history[0];
    if (latest && latest.source === source) return history;
    const next = [{timestamp: now, reason, source: String(source || '')}].concat(history).slice(0, HISTORY_LIMIT);
    try {
        storage.setItem(key, JSON.stringify(next));
    } catch (error) {
        return history;
    }
    return next;
};

const loadHistory = (storage, projectId, targetId) => parseStored(
    storage,
    storageKey(projectId, targetId, 'history'),
    []
);

const rememberRecentTarget = (storage, projectId, targetId) => {
    if (!storageAvailable(storage) || !targetId) return [];
    const key = `${STORAGE_PREFIX}.${projectId || 'project'}.recent`;
    const recent = parseStored(storage, key, []).filter(id => id !== targetId);
    const next = [targetId].concat(recent).slice(0, RECENT_LIMIT);
    try {
        storage.setItem(key, JSON.stringify(next));
    } catch (error) {
        return recent;
    }
    return next;
};

const loadRecentTargets = (storage, projectId) => parseStored(
    storage,
    `${STORAGE_PREFIX}.${projectId || 'project'}.recent`,
    []
);

module.exports = {
    HISTORY_LIMIT,
    buildWorkspace,
    loadHistory,
    loadRecentTargets,
    rememberRecentTarget,
    replaceWorkspace,
    saveHistorySnapshot,
    searchWorkspace,
    synchronizeStableReferences,
    targetFileName,
    targetResources
};
