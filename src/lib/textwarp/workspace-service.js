'use strict';

const {readSourceRecord} = require('./vm-adapter');
const {
    loadHistory: loadStoredHistory,
    loadHistoryAsync: loadStoredHistoryAsync,
    saveHistory,
    whenHistoryPersisted
} = require('./history-storage');

const HISTORY_LIMIT = 30;
const RECENT_LIMIT = 10;
const SEARCH_RESULT_LIMIT = 500;
const SEARCH_RESULT_PER_MODULE_LIMIT = 200;
const STORAGE_PREFIX = 'textwarp.ide.v1';
const searchLinesByModule = new WeakMap();

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
    (sprite.costumes || []).forEach((costume, index) => values.push({
        id: costume.id || costume.assetId || costume.md5 || `${target.id}:costume:${index}`,
        name: costume.name,
        kind: 'costume',
        kindLabel: 'Fantasia',
        ownerId: target.id,
        ownerName,
        detail: `Fantasia de ${ownerName}.`
    }));
    (sprite.sounds || []).forEach((sound, index) => values.push({
        id: sound.id || sound.assetId || sound.md5 || `${target.id}:sound:${index}`,
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

const searchWorkspace = (workspace, query, options = {}) => {
    const needle = String(query || '').trim();
    if (!needle) return [];
    const limit = Math.max(1, Number(options.limit) || SEARCH_RESULT_LIMIT);
    const perModuleLimit = Math.max(1, Number(options.perModuleLimit) || SEARCH_RESULT_PER_MODULE_LIMIT);
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
    const results = [];
    let truncated = false;
    (workspace.modules || []).forEach(module => {
        if (results.length >= limit) {
            truncated = true;
            return;
        }
        let moduleMatches = 0;
        const source = String(module.source || '');
        const cachedLines = searchLinesByModule.get(module);
        const lines = cachedLines && cachedLines.source === source ?
            cachedLines.lines :
            source.split(/\r?\n/);
        if (!cachedLines || cachedLines.source !== source) {
            searchLinesByModule.set(module, {lines, source});
        }
        lines.forEach((text, index) => {
            if (results.length >= limit || moduleMatches >= perModuleLimit) {
                truncated = true;
                return;
            }
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(text))) {
                if (results.length >= limit || moduleMatches >= perModuleLimit) {
                    truncated = true;
                    break;
                }
                results.push({
                    targetId: module.id,
                    fileName: module.fileName,
                    line: index + 1,
                    column: match.index + 1,
                    endColumn: match.index + match[0].length + 1,
                    text: text.trim()
                });
                moduleMatches++;
            }
        });
    });
    Object.defineProperty(results, 'truncated', {
        configurable: true,
        enumerable: false,
        value: truncated
    });
    return results;
};

const replaceWorkspace = (workspace, query, replacement) => {
    const needle = String(query || '');
    if (!needle) return {count: 0, modules: (workspace.modules || []).map(module => Object.assign({}, module))};
    const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
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
    if (!targetId) return [];
    const key = storageKey(projectId, targetId, 'history');
    const history = loadStoredHistory(storage, key);
    const latest = history[0];
    if (latest && latest.source === source) return history;
    const next = [{timestamp: now, reason, source: String(source || '')}].concat(history).slice(0, HISTORY_LIMIT);
    return saveHistory(storage, key, projectId, next);
};

const loadHistory = (storage, projectId, targetId) =>
    loadStoredHistory(storage, storageKey(projectId, targetId, 'history'));

const loadHistoryAsync = (storage, projectId, targetId) =>
    loadStoredHistoryAsync(storage, storageKey(projectId, targetId, 'history'));

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
    SEARCH_RESULT_LIMIT,
    SEARCH_RESULT_PER_MODULE_LIMIT,
    buildWorkspace,
    loadHistory,
    loadHistoryAsync,
    loadRecentTargets,
    rememberRecentTarget,
    replaceWorkspace,
    saveHistorySnapshot,
    searchWorkspace,
    synchronizeStableReferences,
    targetFileName,
    targetResources,
    whenHistoryPersisted
};
