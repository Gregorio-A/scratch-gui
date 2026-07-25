'use strict';

const SOURCE_COMMENT_ID = 'textwarp_source_v1';
const SOURCE_MARKER = '@textwarp/source-v1\n';
const ROOT_COMMENT_PREFIX = 'textwarp_generated_root_';
const ROOT_MARKER = '@textwarp/generated-root-v1';
const ROOT_MARKER_V2 = '@textwarp/generated-root-v2\n';

const defaultRecord = (source, moduleId = null) => ({
    formatVersion: 3,
    languageVersion: '0.3',
    moduleId,
    source,
    generatedRootIds: [],
    generatedBlockIds: [],
    sourceMap: {},
    units: [],
    generatedVariables: [],
    resourceBindings: [],
    breakpoints: []
});

const findCommentEntry = (target, predicate) => {
    if (!target || !target.comments) return null;
    for (const [id, comment] of Object.entries(target.comments)) {
        if (predicate(comment)) return {id, comment};
    }
    return null;
};

const findSourceComment = target => findCommentEntry(
    target,
    comment => typeof comment.text === 'string' && comment.text.startsWith(SOURCE_MARKER)
);

const parseRootMarker = text => {
    if (text === ROOT_MARKER) return {legacy: true, unitId: null, hash: null};
    if (typeof text !== 'string' || !text.startsWith(ROOT_MARKER_V2)) return null;
    try {
        const marker = JSON.parse(text.slice(ROOT_MARKER_V2.length));
        if (!marker || typeof marker.unitId !== 'string') return null;
        return {legacy: false, unitId: marker.unitId, hash: marker.hash || null};
    } catch (error) {
        return null;
    }
};

const findGeneratedRootComments = target => {
    if (!target || !target.comments) return [];
    return Object.entries(target.comments).reduce((result, [id, comment]) => {
        const marker = parseRootMarker(comment.text);
        if (marker && comment.blockId) result.push(Object.assign({id, comment}, marker));
        return result;
    }, []);
};

const markGeneratedRootsDirty = target => {
    findGeneratedRootComments(target).forEach(entry => {
        if (entry.legacy) return;
        entry.comment.text = ROOT_MARKER_V2 + JSON.stringify({unitId: entry.unitId, hash: null});
    });
};

const orderedUnitBlocks = (target, rootId) => {
    const result = [];
    const visited = new Set();
    const visit = id => {
        if (!id || visited.has(id)) return;
        const block = target.blocks && target.blocks.getBlock(id);
        if (!block) return;
        visited.add(id);
        result.push(block);
        Object.values(block.inputs || {}).forEach(input => {
            // Menu shadows are created before a connected reporter. This order
            // mirrors compiler.js and makes structural remapping deterministic.
            if (input.shadow && input.shadow !== input.block) visit(input.shadow);
            visit(input.block);
        });
        visit(block.next);
    };
    visit(rootId);
    return result;
};

const readSourceRecord = target => {
    if (!target || !target.comments) return null;
    const entry = findSourceComment(target);
    if (!entry) return null;
    try {
        const record = JSON.parse(entry.comment.text.slice(SOURCE_MARKER.length));
        if (!record || ![1, 2, 3].includes(record.formatVersion) || typeof record.source !== 'string') return null;
        const normalized = Object.assign(defaultRecord(record.source, target.id), record, {
            formatVersion: 3,
            languageVersion: record.languageVersion || '0.1'
        });
        if (!normalized.moduleId) normalized.moduleId = target.id;
        if (!Array.isArray(normalized.units)) normalized.units = [];
        if (!Array.isArray(normalized.generatedVariables)) normalized.generatedVariables = [];
        if (!Array.isArray(normalized.resourceBindings)) normalized.resourceBindings = [];
        if (!Array.isArray(normalized.breakpoints)) normalized.breakpoints = [];
        const markers = findGeneratedRootComments(target);
        if (markers.length > 0) {
            normalized.generatedRootIds = markers.map(item => item.comment.blockId);
            const remappedSourceMap = Object.assign({}, normalized.sourceMap);
            normalized.units = normalized.units.map(unit => {
                const marker = markers.find(item => item.unitId === unit.unitId);
                if (!marker) return unit;
                const currentBlocks = orderedUnitBlocks(target, marker.comment.blockId);
                const persistedBlocks = Array.isArray(unit.blocks) ? unit.blocks : [];
                if (
                    persistedBlocks.length === currentBlocks.length &&
                    persistedBlocks.every((block, index) => block.opcode === currentBlocks[index].opcode)
                ) {
                    persistedBlocks.forEach((oldBlock, index) => {
                        const currentBlock = currentBlocks[index];
                        const location = normalized.sourceMap[oldBlock.id];
                        if (oldBlock.id !== currentBlock.id) delete remappedSourceMap[oldBlock.id];
                        if (location) remappedSourceMap[currentBlock.id] = Object.assign({}, location, {
                            blockId: currentBlock.id
                        });
                    });
                    return Object.assign({}, unit, {
                        rootId: marker.comment.blockId,
                        blockIds: currentBlocks.map(block => block.id),
                        blocks: currentBlocks.map(block => ({id: block.id, opcode: block.opcode}))
                    });
                }
                return Object.assign({}, unit, {rootId: marker.comment.blockId});
            });
            normalized.sourceMap = remappedSourceMap;
            if (normalized.units.every(unit => Array.isArray(unit.blockIds))) {
                normalized.generatedBlockIds = normalized.units.flatMap(unit => unit.blockIds);
            }
        }
        return normalized;
    } catch (error) {
        console.warn('Could not read embedded TextWarp source:', error);
        return null;
    }
};

const writeSourceRecord = (vm, target, record) => {
    const normalized = Object.assign(defaultRecord(record.source, target.id), record, {
        formatVersion: 3,
        languageVersion: record.languageVersion || '0.3'
    });
    const text = SOURCE_MARKER + JSON.stringify(normalized);
    const existing = findSourceComment(target);
    let comment = existing ? existing.comment : null;
    if (!comment) {
        target.createComment(SOURCE_COMMENT_ID, null, text, -10000, -10000, 320, 160, true);
        comment = target.comments[SOURCE_COMMENT_ID];
    } else {
        comment.text = text;
        comment.blockId = null;
        comment.x = -10000;
        comment.y = -10000;
        comment.width = 320;
        comment.height = 160;
        comment.minimized = true;
    }
    if (vm && vm.runtime && typeof vm.runtime.emitProjectChanged === 'function') vm.runtime.emitProjectChanged();
    return normalized;
};

const saveTextSource = (vm, target, source) => {
    const current = readSourceRecord(target) || defaultRecord(source, target.id);
    if (current.source === source && findSourceComment(target)) return current;
    return writeSourceRecord(vm, target, Object.assign({}, current, {source}));
};

const saveBreakpoints = (vm, target, breakpoints) => {
    const current = readSourceRecord(target) || defaultRecord('', target.id);
    const normalized = Array.from(new Set((breakpoints || []).filter(Number.isInteger))).sort((left, right) => left - right);
    if (JSON.stringify(current.breakpoints) === JSON.stringify(normalized)) return current;
    return writeSourceRecord(vm, target, Object.assign({}, current, {breakpoints: normalized}));
};

const collectBlockIds = (target, rootId) => {
    const result = new Set();
    const visit = id => {
        if (!id || result.has(id)) return;
        const block = target.blocks.getBlock(id);
        if (!block) return;
        result.add(id);
        visit(block.next);
        Object.values(block.inputs || {}).forEach(input => {
            visit(input.block);
            if (input.shadow !== input.block) visit(input.shadow);
        });
    };
    visit(rootId);
    return result;
};

const stopThreadsUsingBlocks = (runtime, target, blockIds) => {
    if (!runtime || !Array.isArray(runtime.threads) || blockIds.size === 0) return;
    runtime.threads.slice().forEach(thread => {
        if (thread.target !== target) return;
        const stack = Array.isArray(thread.stack) ? thread.stack : [];
        if (!blockIds.has(thread.topBlock) && !stack.some(id => blockIds.has(id))) return;
        if (typeof runtime._stopThread === 'function') runtime._stopThread(thread);
        else if (typeof runtime.stopForTarget === 'function') runtime.stopForTarget(target);
    });
};

const removeRootEntry = (target, entry) => {
    if (entry.commentId && target.comments[entry.commentId]) delete target.comments[entry.commentId];
    if (entry.rootId && target.blocks.getBlock(entry.rootId)) {
        const blockIds = Array.from(collectBlockIds(target, entry.rootId));
        target.blocks.deleteBlock(entry.rootId);
        // Blocks.deleteBlock is recursive in scratch-vm. Keeping this fallback
        // makes the adapter safe with simpler block containers used in tests.
        blockIds.forEach(blockId => {
            if (target.blocks.getBlock(blockId)) target.blocks.deleteBlock(blockId);
        });
    }
};

const createGeneratedRootComment = (target, unit, index) => {
    const marker = ROOT_MARKER_V2 + JSON.stringify({unitId: unit.unitId, hash: unit.hash});
    target.createComment(
        `${ROOT_COMMENT_PREFIX}${index}_${unit.rootId}`,
        unit.rootId,
        marker,
        0,
        0,
        100,
        40,
        true
    );
};

const ownerForVariable = (vm, target, variable) => {
    if (variable.owner !== 'stage') return target;
    if (vm.runtime && typeof vm.runtime.getTargetForStage === 'function') return vm.runtime.getTargetForStage();
    if (vm.runtime && Array.isArray(vm.runtime.targets)) return vm.runtime.targets.find(item => item.isStage) || target;
    return target.isStage ? target : null;
};

const syncVariables = (vm, target, graph, previousRecord) => {
    const desired = (graph.declarations || []).concat(graph.broadcasts || []);
    const generated = desired.filter(item => item.generated !== false).map(item => ({
        id: item.id,
        name: item.name,
        variableType: item.variableType,
        owner: item.owner
    }));
    const desiredIds = new Set(desired.map(item => item.id));

    (previousRecord.generatedVariables || []).forEach(variable => {
        if (desiredIds.has(variable.id)) return;
        const referencedElsewhere = variable.variableType === 'broadcast_msg' &&
            (vm.runtime.targets || []).some(otherTarget => {
                if (otherTarget === target) return false;
                const otherRecord = readSourceRecord(otherTarget);
                return Boolean(otherRecord && otherRecord.generatedVariables.some(item => item.id === variable.id));
            });
        if (referencedElsewhere) return;
        const owner = ownerForVariable(vm, target, variable);
        if (owner && owner.variables && owner.variables[variable.id] && typeof owner.deleteVariable === 'function') {
            owner.deleteVariable(variable.id);
        }
    });

    desired.forEach(variable => {
        const owner = ownerForVariable(vm, target, variable);
        if (!owner || !owner.variables) return;
        const existed = Boolean(owner.variables[variable.id]);
        if (!existed && typeof owner.createVariable === 'function') {
            owner.createVariable(variable.id, variable.name, variable.variableType, false);
        }
        const created = owner.variables[variable.id];
        if (created && !existed) {
            created.value = Array.isArray(variable.initialValue) ? variable.initialValue.slice() : variable.initialValue;
        }
    });
    return generated;
};

const previousRootEntries = (target, record) => {
    const markers = findGeneratedRootComments(target);
    const unitsById = new Map((record.units || []).map(unit => [unit.unitId, unit]));
    const entries = markers.map(marker => Object.assign({}, unitsById.get(marker.unitId) || {}, {
        unitId: marker.unitId,
        hash: marker.hash,
        rootId: marker.comment.blockId,
        commentId: marker.id,
        legacy: marker.legacy
    }));
    if (entries.length > 0) return entries;
    return (record.generatedRootIds || []).map((rootId, index) => ({
        unitId: record.units[index] ? record.units[index].unitId : null,
        hash: record.units[index] ? record.units[index].hash : null,
        rootId,
        commentId: null,
        legacy: true
    }));
};

const applyCompilation = (vm, target, compilation) => {
    if (!vm || !vm.runtime || !target) throw new Error('A VM ou o alvo selecionado não está disponível.');
    if (!compilation || !compilation.success || !compilation.graph) {
        throw new Error('Não é possível aplicar uma compilação com erros.');
    }

    const graph = compilation.graph;
    const previousRecord = readSourceRecord(target) || defaultRecord(compilation.source, target.id);
    const oldEntries = previousRootEntries(target, previousRecord);
    const oldByUnit = new Map(oldEntries.filter(item => item.unitId).map(item => [item.unitId, item]));
    const newByUnit = new Map(graph.units.map(unit => [unit.unitId, unit]));
    const unchangedUnits = [];
    const changedUnits = [];
    const entriesToRemove = [];

    graph.units.forEach(unit => {
        const previous = oldByUnit.get(unit.unitId);
        const currentBlocks = previous ? orderedUnitBlocks(target, previous.rootId) : [];
        const expectedOpcodes = unit.blockIds.map(blockId => graph.blocks[blockId].opcode);
        if (
            previous &&
            previous.hash === unit.hash &&
            target.blocks.getBlock(previous.rootId) &&
            currentBlocks.length === expectedOpcodes.length &&
            currentBlocks.every((block, index) => block.opcode === expectedOpcodes[index])
        ) unchangedUnits.push({unit, previous, currentBlocks});
        else {
            changedUnits.push(unit);
            if (previous) entriesToRemove.push(previous);
        }
    });
    oldEntries.forEach(entry => {
        if (!entry.unitId || !newByUnit.has(entry.unitId)) entriesToRemove.push(entry);
    });

    const uniqueRemovals = Array.from(new Map(entriesToRemove.map(entry => [entry.rootId, entry])).values());
    const removedBlockIds = new Set();
    uniqueRemovals.forEach(entry => collectBlockIds(target, entry.rootId).forEach(id => removedBlockIds.add(id)));
    stopThreadsUsingBlocks(vm.runtime, target, removedBlockIds);
    uniqueRemovals.forEach(entry => removeRootEntry(target, entry));

    const changedBlockIds = new Set(changedUnits.flatMap(unit => unit.blockIds));
    changedBlockIds.forEach(blockId => {
        if (target.blocks.getBlock(blockId)) throw new Error(`O identificador gerado ${blockId} já pertence a outro bloco.`);
    });
    changedUnits.forEach(unit => {
        unit.blockIds.forEach(blockId => target.blocks.createBlock(graph.blocks[blockId]));
    });
    changedUnits.forEach((unit, index) => createGeneratedRootComment(target, unit, index));

    const generatedVariables = syncVariables(vm, target, graph, previousRecord);
    if (typeof target.blocks.resetCache === 'function') target.blocks.resetCache();
    if (typeof target.blocks.updateTargetSpecificBlocks === 'function') {
        target.blocks.updateTargetSpecificBlocks(target.isStage);
    }

    const previousUnitIds = new Set(oldEntries.filter(item => item.unitId).map(item => item.unitId));
    const lastApply = {
        createdUnits: changedUnits.filter(unit => !previousUnitIds.has(unit.unitId)).length,
        updatedUnits: changedUnits.filter(unit => previousUnitIds.has(unit.unitId)).length,
        removedUnits: oldEntries.filter(item => item.unitId && !newByUnit.has(item.unitId)).length,
        unchangedUnits: unchangedUnits.length,
        createdBlocks: changedUnits.reduce((total, unit) => total + unit.blockIds.length, 0)
    };
    const unchangedById = new Map(unchangedUnits.map(item => [item.unit.unitId, item]));
    const finalSourceMap = {};
    const finalUnits = graph.units.map(unit => {
        const unchanged = unchangedById.get(unit.unitId);
        if (unchanged) {
            unit.blockIds.forEach((expectedId, index) => {
                const actualId = unchanged.currentBlocks[index].id;
                const location = graph.sourceMap[expectedId];
                if (location) finalSourceMap[actualId] = Object.assign({}, location, {blockId: actualId});
            });
            return {
                unitId: unit.unitId,
                kind: unit.kind,
                name: unit.name,
                hash: unit.hash,
                rootId: unchanged.previous.rootId,
                blockIds: unchanged.currentBlocks.map(block => block.id),
                blocks: unchanged.currentBlocks.map(block => ({id: block.id, opcode: block.opcode}))
            };
        }
        unit.blockIds.forEach(blockId => {
            if (graph.sourceMap[blockId]) finalSourceMap[blockId] = graph.sourceMap[blockId];
        });
        return {
            unitId: unit.unitId,
            kind: unit.kind,
            name: unit.name,
            hash: unit.hash,
            rootId: unit.rootId,
            blockIds: unit.blockIds,
            blocks: unit.blockIds.map(blockId => ({id: blockId, opcode: graph.blocks[blockId].opcode}))
        };
    });
    const record = writeSourceRecord(vm, target, Object.assign({}, previousRecord, {
        languageVersion: '0.3',
        source: compilation.source,
        generatedRootIds: finalUnits.map(unit => unit.rootId),
        generatedBlockIds: finalUnits.flatMap(unit => unit.blockIds),
        sourceMap: finalSourceMap,
        units: finalUnits,
        generatedVariables,
        resourceBindings: graph.resourceBindings || [],
        lastApply
    }));
    if (vm.editingTarget === target && typeof vm.emitWorkspaceUpdate === 'function') vm.emitWorkspaceUpdate();
    return record;
};

const adoptImportedRoots = (vm, target, source, rootIds, sourceMap = {}, compilation = null) => {
    const current = readSourceRecord(target) || defaultRecord(source, target.id);
    findGeneratedRootComments(target).forEach(entry => {
        delete target.comments[entry.id];
    });
    const graph = compilation && compilation.graph;
    const unitsByLine = new Map((graph && graph.units || []).map(unit => {
        const location = graph.sourceMap && graph.sourceMap[unit.rootId];
        return [location && location.startLine, unit];
    }).filter(([line]) => Number.isInteger(line)));
    const units = rootIds.map((rootId, index) => {
        const location = sourceMap[rootId];
        const compiledUnit = location && unitsByLine.get(location.startLine);
        const currentBlocks = orderedUnitBlocks(target, rootId);
        return {
            unitId: compiledUnit ? compiledUnit.unitId : `imported:${index}`,
            kind: compiledUnit ? compiledUnit.kind : 'imported',
            name: compiledUnit ? compiledUnit.name : `script-${index + 1}`,
            hash: compiledUnit ? compiledUnit.hash : `imported-${index}`,
            rootId,
            blockIds: currentBlocks.map(block => block.id),
            blocks: currentBlocks.map(block => ({id: block.id, opcode: block.opcode}))
        };
    });
    units.forEach(createGeneratedRootComment.bind(null, target));
    return writeSourceRecord(vm, target, Object.assign({}, current, {
        source,
        sourceMap,
        units,
        generatedRootIds: rootIds,
        generatedBlockIds: units.flatMap(unit => unit.blockIds)
    }));
};

module.exports = {
    ROOT_MARKER,
    ROOT_MARKER_V2,
    SOURCE_COMMENT_ID,
    SOURCE_MARKER,
    adoptImportedRoots,
    applyCompilation,
    collectBlockIds,
    findGeneratedRootComments,
    markGeneratedRootsDirty,
    orderedUnitBlocks,
    readSourceRecord,
    saveBreakpoints,
    saveTextSource,
    writeSourceRecord
};
