'use strict';

const SOURCE_COMMENT_ID = 'textwarp_source_v1';
const SOURCE_MARKER = '@textwarp/source-v1\n';
const DRAFT_COMMENT_ID = 'textwarp_source_draft_v1';
const DRAFT_MARKER = '@textwarp/source-draft-v1\n';
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
    breakpoints: [],
    blockFingerprint: ''
});

const sourceRecordCache = new WeakMap();

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

const findDraftComment = target => findCommentEntry(
    target,
    comment => typeof comment.text === 'string' && comment.text.startsWith(DRAFT_MARKER)
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

const markerSignature = target => findGeneratedRootComments(target).map(entry => [
    entry.id,
    entry.comment.blockId,
    entry.comment.text
]).sort((left, right) => left[0].localeCompare(right[0])).map(item => item.join('\u0000')).join('\u0001');

const markGeneratedRootsDirty = target => {
    findGeneratedRootComments(target).forEach(entry => {
        if (entry.legacy) return;
        entry.comment.text = ROOT_MARKER_V2 + JSON.stringify({unitId: entry.unitId, hash: null});
    });
};

const orderedUnitBlocks = (target, rootId) => {
    const result = [];
    const visited = new Set();
    const pending = rootId ? [rootId] : [];
    while (pending.length) {
        const id = pending.pop();
        if (!id || visited.has(id)) continue;
        const block = target.blocks && target.blocks.getBlock(id);
        if (!block) continue;
        visited.add(id);
        result.push(block);
        if (block.next) pending.push(block.next);
        const inputs = Object.values(block.inputs || {});
        for (let index = inputs.length - 1; index >= 0; index--) {
            const input = inputs[index];
            // Menu shadows are created before a connected reporter. This order
            // mirrors compiler.js and makes structural remapping deterministic.
            if (input.block) pending.push(input.block);
            if (input.shadow && input.shadow !== input.block) pending.push(input.shadow);
        }
    }
    return result;
};

const blockFingerprint = target => {
    if (!target || !target.blocks || !target.blocks._blocks) return '';
    const blocks = Object.values(target.blocks._blocks).sort((left, right) =>
        String(left.id).localeCompare(String(right.id))
    ).map(block => ({
        id: block.id,
        opcode: block.opcode,
        next: block.next,
        parent: block.parent,
        topLevel: Boolean(block.topLevel),
        shadow: Boolean(block.shadow),
        fields: block.fields || {},
        inputs: block.inputs || {},
        mutation: block.mutation || null
    }));
    const variables = Object.values(target.variables || {}).map(variable => ({
        id: variable.id,
        name: variable.name,
        type: variable.type,
        isCloud: Boolean(variable.isCloud)
    })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const serialized = JSON.stringify({blocks, variables});
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < serialized.length; index++) {
        const code = serialized.charCodeAt(index);
        first = Math.imul(first ^ code, 0x01000193);
        second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
};

const readSourceRecord = target => {
    if (!target || !target.comments) return null;
    const entry = findSourceComment(target);
    if (!entry) return null;
    const draftEntry = findDraftComment(target);
    const cached = sourceRecordCache.get(target);
    const markersText = markerSignature(target);
    if (
        cached &&
        cached.sourceText === entry.comment.text &&
        cached.draftText === (draftEntry && draftEntry.comment.text || '') &&
        cached.markersText === markersText
    ) return cached.record;
    try {
        const record = JSON.parse(entry.comment.text.slice(SOURCE_MARKER.length));
        if (!record || ![1, 2, 3].includes(record.formatVersion) || typeof record.source !== 'string') return null;
        if (!record.sourceMap && Array.isArray(record.sourceMapCompact)) {
            record.sourceMap = Object.fromEntries(record.sourceMapCompact.map(item => [item[0], {
                blockId: item[0],
                actorId: item[1],
                file: item[2],
                startLine: item[3],
                startColumn: item[4],
                endLine: item[5],
                endColumn: item[6]
            }]));
        }
        const normalized = Object.assign(defaultRecord(record.source, target.id), record, {
            formatVersion: 3,
            languageVersion: record.languageVersion || '0.1'
        });
        if (!normalized.moduleId) normalized.moduleId = target.id;
        if (!Array.isArray(normalized.units)) normalized.units = [];
        normalized.units = normalized.units.map(unit => {
            const blocks = Array.isArray(unit.blocks) ? unit.blocks.map(block => {
                if (!Array.isArray(block)) return block;
                if (record.compactBlocksVersion === 2) {
                    return {
                        id: null,
                        opcode: block[0],
                        location: {
                            actorId: target.id,
                            file: target.isStage ? 'stage.tw' :
                                `${target.getName ? target.getName() : 'actor'}.tw`,
                            startLine: block[1],
                            startColumn: block[2],
                            endLine: block[1],
                            endColumn: block[3]
                        }
                    };
                }
                return {id: block[0], opcode: block[1]};
            }) : [];
            return Object.assign({}, unit, {
                blocks,
                blockIds: Array.isArray(unit.blockIds) ? unit.blockIds : blocks.map(block => block.id).filter(Boolean)
            });
        });
        if (!Array.isArray(normalized.generatedVariables)) normalized.generatedVariables = [];
        if (!Array.isArray(normalized.resourceBindings)) normalized.resourceBindings = [];
        if (!Array.isArray(normalized.breakpoints)) normalized.breakpoints = [];
        normalized.hasDraft = Boolean(draftEntry);
        if (draftEntry) normalized.source = draftEntry.comment.text.slice(DRAFT_MARKER.length);
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
                        const location = oldBlock.location || normalized.sourceMap[oldBlock.id];
                        if (oldBlock.id && oldBlock.id !== currentBlock.id) delete remappedSourceMap[oldBlock.id];
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
        if (!normalized.generatedBlockIds.length && normalized.units.every(unit => Array.isArray(unit.blockIds))) {
            normalized.generatedBlockIds = normalized.units.flatMap(unit => unit.blockIds);
        }
        sourceRecordCache.set(target, {
            sourceText: entry.comment.text,
            draftText: draftEntry && draftEntry.comment.text || '',
            markersText,
            record: normalized
        });
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
    normalized.hasDraft = false;
    normalized.blockFingerprint = blockFingerprint(target);
    const persisted = Object.assign({}, normalized, {
        compactBlocksVersion: 2,
        units: (normalized.units || []).map(unit => {
            const compact = Object.assign({}, unit, {
                blocks: (unit.blocks || []).map(block => {
                    const location = normalized.sourceMap && normalized.sourceMap[block.id] || {};
                    return [
                        block.opcode,
                        location.startLine || 0,
                        location.startColumn || 0,
                        location.endColumn || 0
                    ];
                })
            });
            delete compact.blockIds;
            return compact;
        })
    });
    delete persisted.sourceMap;
    delete persisted.sourceMapCompact;
    delete persisted.generatedBlockIds;
    delete persisted.generatedRootIds;
    delete persisted.hasDraft;
    const text = SOURCE_MARKER + JSON.stringify(persisted);
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
    const draft = findDraftComment(target);
    if (draft) delete target.comments[draft.id];
    sourceRecordCache.set(target, {
        sourceText: text,
        draftText: '',
        markersText: markerSignature(target),
        record: normalized
    });
    if (vm && vm.runtime && typeof vm.runtime.emitProjectChanged === 'function') vm.runtime.emitProjectChanged();
    return normalized;
};

const saveTextSource = (vm, target, source) => {
    let current = readSourceRecord(target);
    if (!current) {
        current = writeSourceRecord(vm, target, defaultRecord('', target.id));
    }
    if (current.source === source) return current;
    const text = DRAFT_MARKER + source;
    const existing = findDraftComment(target);
    if (!existing) {
        target.createComment(DRAFT_COMMENT_ID, null, text, -10000, -10000, 320, 160, true);
    } else {
        existing.comment.text = text;
    }
    const sourceEntry = findSourceComment(target);
    const normalized = Object.assign({}, current, {source, hasDraft: true});
    sourceRecordCache.set(target, {
        sourceText: sourceEntry && sourceEntry.comment.text || '',
        draftText: text,
        markersText: markerSignature(target),
        record: normalized
    });
    if (vm && vm.runtime && typeof vm.runtime.emitProjectChanged === 'function') vm.runtime.emitProjectChanged();
    return normalized;
};

const saveBreakpoints = (vm, target, breakpoints) => {
    const current = readSourceRecord(target) || defaultRecord('', target.id);
    const normalized = Array.from(new Set((breakpoints || []).filter(Number.isInteger))).sort((left, right) => left - right);
    if (JSON.stringify(current.breakpoints) === JSON.stringify(normalized)) return current;
    return writeSourceRecord(vm, target, Object.assign({}, current, {breakpoints: normalized}));
};

const collectBlockIds = (target, rootId) => {
    const result = new Set();
    const pending = rootId ? [rootId] : [];
    while (pending.length) {
        const id = pending.pop();
        if (!id || result.has(id)) continue;
        const block = target.blocks.getBlock(id);
        if (!block) continue;
        result.add(id);
        if (block.next) pending.push(block.next);
        Object.values(block.inputs || {}).forEach(input => {
            if (input.block) pending.push(input.block);
            if (input.shadow !== input.block && input.shadow) pending.push(input.shadow);
        });
    }
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

const cloneSerializable = value => {
    if (typeof value === 'undefined') return undefined;
    return JSON.parse(JSON.stringify(value));
};

const captureTargetSnapshot = (vm, target) => {
    const runtime = vm && vm.runtime;
    const stage = runtime && typeof runtime.getTargetForStage === 'function' && runtime.getTargetForStage();
    const variableTargets = [target].concat(stage && stage !== target ? [stage] : []);
    const monitorState = runtime && typeof runtime.getMonitorState === 'function' ?
        runtime.getMonitorState() : runtime && runtime._monitorState;
    return {
        targetId: target.id,
        blocks: Object.values(target.blocks && target.blocks._blocks || {}).map(cloneSerializable),
        comments: cloneSerializable(target.comments || {}),
        variableTargets: variableTargets.map(variableTarget => ({
            reference: variableTarget,
            variables: Object.values(variableTarget.variables || {}).map(variable => ({
                reference: variable,
                state: Object.keys(variable).reduce((result, key) => {
                    if (typeof variable[key] !== 'function') result[key] = cloneSerializable(variable[key]);
                    return result;
                }, {})
            }))
        })),
        monitorBlocks: Object.values(runtime && runtime.monitorBlocks && runtime.monitorBlocks._blocks || {})
            .map(cloneSerializable),
        monitors: monitorState && typeof monitorState.values === 'function' ?
            monitorState.values().map(record => Object.keys(record).reduce((result, key) => {
                if (typeof record[key] !== 'function') result[key] = cloneSerializable(record[key]);
                return result;
            }, {})) : []
    };
};

const restoreTargetSnapshot = (vm, target, snapshot) => {
    if (!snapshot || snapshot.targetId !== target.id) throw new Error('O snapshot não pertence ao alvo selecionado.');
    const currentBlockIds = Object.keys(target.blocks && target.blocks._blocks || {});
    currentBlockIds.forEach(id => {
        if (target.blocks.getBlock(id)) target.blocks.deleteBlock(id);
    });
    if (target.blocks && target.blocks._blocks) target.blocks._blocks = {};
    snapshot.blocks.forEach(block => target.blocks.createBlock(cloneSerializable(block)));
    target.comments = {};
    Object.values(snapshot.comments || {}).forEach(comment => {
        if (typeof target.createComment === 'function') {
            target.createComment(
                comment.id,
                comment.blockId,
                comment.text,
                comment.x,
                comment.y,
                comment.width,
                comment.height,
                comment.minimized
            );
            Object.assign(target.comments[comment.id], cloneSerializable(comment));
        } else {
            target.comments[comment.id] = cloneSerializable(comment);
        }
    });
    const variableTargets = snapshot.variableTargets || [{
        reference: target,
        variables: snapshot.variables || []
    }];
    variableTargets.forEach(variableTarget => {
        variableTarget.reference.variables = {};
        variableTarget.variables.forEach(variable => {
            Object.keys(variable.reference).forEach(key => {
                if (typeof variable.reference[key] !== 'function') delete variable.reference[key];
            });
            Object.assign(variable.reference, cloneSerializable(variable.state));
            variableTarget.reference.variables[variable.state.id] = variable.reference;
        });
    });
    const runtime = vm && vm.runtime;
    if (runtime && runtime.monitorBlocks) {
        Object.keys(runtime.monitorBlocks._blocks || {}).forEach(id => runtime.monitorBlocks.deleteBlock(id));
        runtime.monitorBlocks._blocks = {};
        snapshot.monitorBlocks.forEach(block => runtime.monitorBlocks.createBlock(cloneSerializable(block)));
    }
    const monitorState = runtime && (typeof runtime.getMonitorState === 'function' ?
        runtime.getMonitorState() : runtime._monitorState);
    if (monitorState && monitorState.map instanceof Map) {
        monitorState.map.clear();
        snapshot.monitors.forEach(monitor => monitorState.set(monitor.id, cloneSerializable(monitor)));
    }
    sourceRecordCache.delete(target);
    if (target.blocks && typeof target.blocks.resetCache === 'function') target.blocks.resetCache();
    if (vm && vm.editingTarget === target && typeof vm.emitWorkspaceUpdate === 'function') vm.emitWorkspaceUpdate();
    if (runtime && typeof runtime.emitProjectChanged === 'function') runtime.emitProjectChanged();
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

const removeRoots = (vm, target, rootIds) => {
    const snapshot = captureTargetSnapshot(vm, target);
    const roots = Array.from(new Set(rootIds || [])).filter(id => target.blocks.getBlock(id));
    const removedBlockIds = new Set();
    roots.forEach(rootId => collectBlockIds(target, rootId).forEach(id => removedBlockIds.add(id)));
    stopThreadsUsingBlocks(vm && vm.runtime, target, removedBlockIds);
    roots.forEach(rootId => removeRootEntry(target, {rootId, commentId: null}));
    Object.entries(target.comments || {}).forEach(([id, comment]) => {
        if (comment && removedBlockIds.has(comment.blockId)) delete target.comments[id];
    });
    if (target.blocks && typeof target.blocks.resetCache === 'function') target.blocks.resetCache();
    return snapshot;
};

const isInternalComment = comment => (
    comment &&
    typeof comment.text === 'string' &&
    (
        comment.text.startsWith(SOURCE_MARKER) ||
        comment.text.startsWith(DRAFT_MARKER) ||
        Boolean(parseRootMarker(comment.text))
    )
);

const planVisualTransfer = (target, previous, unit, graph) => {
    if (!previous || !previous.rootId) return null;
    const oldBlocks = orderedUnitBlocks(target, previous.rootId);
    const newBlocks = unit.blockIds.map(id => graph.blocks[id]).filter(Boolean);
    if (!oldBlocks.length || !newBlocks.length) return null;
    const availableByOpcode = new Map();
    newBlocks.forEach(block => {
        if (!availableByOpcode.has(block.opcode)) availableByOpcode.set(block.opcode, []);
        availableByOpcode.get(block.opcode).push(block.id);
    });
    const usedNewIds = new Set([newBlocks[0].id]);
    const mapped = new Map([[oldBlocks[0].id, newBlocks[0].id]]);
    oldBlocks.slice(1).forEach(block => {
        const nextId = (availableByOpcode.get(block.opcode) || []).find(id => !usedNewIds.has(id));
        if (nextId) {
            mapped.set(block.id, nextId);
            usedNewIds.add(nextId);
        }
    });
    return {
        rootId: unit.rootId,
        x: oldBlocks[0].x,
        y: oldBlocks[0].y,
        comments: Object.values(target.comments || {}).filter(comment =>
            comment && mapped.has(comment.blockId) && !isInternalComment(comment)
        ).map(comment => Object.assign(cloneSerializable(comment), {
            blockId: mapped.get(comment.blockId)
        }))
    };
};

const applyVisualTransfer = (target, transfer) => {
    if (!transfer) return;
    const root = target.blocks.getBlock(transfer.rootId);
    if (root) {
        if (Number.isFinite(transfer.x)) root.x = transfer.x;
        if (Number.isFinite(transfer.y)) root.y = transfer.y;
    }
    transfer.comments.forEach(comment => {
        const attached = target.blocks.getBlock(comment.blockId);
        target.comments[comment.id] = comment;
        if (attached) attached.comment = comment.id;
    });
};

const validateMutationPlan = (target, graph, changedUnits, removedBlockIds) => {
    const changedBlockIds = new Set();
    changedUnits.forEach(unit => {
        if (!unit || !unit.rootId || !Array.isArray(unit.blockIds) || !unit.blockIds.includes(unit.rootId)) {
            throw new Error('A compilação contém uma unidade inválida.');
        }
        unit.blockIds.forEach(blockId => {
            const block = graph.blocks[blockId];
            if (!block || block.id !== blockId) {
                throw new Error(`A compilação não contém o bloco esperado ${blockId}.`);
            }
            if (changedBlockIds.has(blockId)) {
                throw new Error(`O identificador gerado ${blockId} foi repetido na compilação.`);
            }
            changedBlockIds.add(blockId);
            if (target.blocks.getBlock(blockId) && !removedBlockIds.has(blockId)) {
                throw new Error(`O identificador gerado ${blockId} já pertence a outro bloco.`);
            }
        });
    });
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
        sourceName: item.sourceName || item.name,
        variableType: item.variableType,
        owner: item.owner,
        isCloud: Boolean(item.isCloud)
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
            owner.createVariable(variable.id, variable.name, variable.variableType, Boolean(variable.isCloud));
        }
        const created = owner.variables[variable.id];
        if (created && existed && created.name !== variable.name && typeof owner.renameVariable === 'function') {
            owner.renameVariable(variable.id, variable.name);
        } else if (created && existed && created.name !== variable.name) {
            created.name = variable.name;
        }
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
    if (
        Array.isArray(vm.runtime.threads) &&
        vm.runtime.threads.some(thread =>
            thread && (thread.topBlock || thread.stack && thread.stack.length) && thread.status !== 4
        )
    ) {
        throw new Error('A conversão deve aguardar o projeto em execução parar.');
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
    validateMutationPlan(target, graph, changedUnits, removedBlockIds);
    const visualTransfers = changedUnits.map(unit => planVisualTransfer(
        target,
        oldByUnit.get(unit.unitId),
        unit,
        graph
    ));
    const transactionSnapshot = captureTargetSnapshot(vm, target);

    try {
        stopThreadsUsingBlocks(vm.runtime, target, removedBlockIds);
        uniqueRemovals.forEach(entry => removeRootEntry(target, entry));
        changedUnits.forEach(unit => {
            unit.blockIds.forEach(blockId => target.blocks.createBlock(graph.blocks[blockId]));
        });
        changedUnits.forEach((unit, index) => createGeneratedRootComment(target, unit, index));
        visualTransfers.forEach(transfer => applyVisualTransfer(target, transfer));

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
    } catch (error) {
        try {
            restoreTargetSnapshot(vm, target, transactionSnapshot);
        } catch (rollbackError) {
            error.message = `${error.message} (a restauração também falhou: ${rollbackError.message})`;
        }
        throw error;
    }
};

const createImportedSourceRecord = (target, source, rootIds, sourceMap = {}, compilation = null, current = null) => {
    const base = current || readSourceRecord(target) || defaultRecord(source, target.id);
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
    return Object.assign({}, base, {
        source,
        sourceMap,
        units,
        generatedRootIds: rootIds,
        generatedBlockIds: units.flatMap(unit => unit.blockIds)
    });
};

const adoptImportedRoots = (vm, target, source, rootIds, sourceMap = {}, compilation = null) => {
    const record = createImportedSourceRecord(target, source, rootIds, sourceMap, compilation);
    findGeneratedRootComments(target).forEach(entry => {
        delete target.comments[entry.id];
    });
    record.units.forEach(createGeneratedRootComment.bind(null, target));
    return writeSourceRecord(vm, target, record);
};

module.exports = {
    ROOT_MARKER,
    ROOT_MARKER_V2,
    SOURCE_COMMENT_ID,
    SOURCE_MARKER,
    adoptImportedRoots,
    applyCompilation,
    blockFingerprint,
    captureTargetSnapshot,
    collectBlockIds,
    createImportedSourceRecord,
    findGeneratedRootComments,
    markGeneratedRootsDirty,
    orderedUnitBlocks,
    readSourceRecord,
    removeRoots,
    restoreTargetSnapshot,
    saveBreakpoints,
    saveTextSource,
    writeSourceRecord
};
