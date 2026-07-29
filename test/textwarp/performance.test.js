'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {performance} = require('node:perf_hooks');

const {ConversionWorkerClient} = require('../../src/lib/textwarp/conversion-worker-client');
const {TextWarpDebugController} = require('../../src/lib/textwarp/debug-controller');
const {
    clearLanguageServiceCache,
    createDocumentIndex,
    getDocumentIndexCacheStats
} = require('../../src/lib/textwarp/language-service');
const {
    HISTORY_TARGET_BYTE_LIMIT,
    decodeHistory,
    encodeHistory,
    fitHistoryToBudget
} = require('../../src/lib/textwarp/history-storage');
const {
    loadHistory,
    resetHistoryStorageForTests,
    saveHistory,
    whenHistoryPersisted
} = require('../../src/lib/textwarp/history-storage');
const {saveTextSource, writeSourceRecord} = require('../../src/lib/textwarp/vm-adapter');
const {
    SEARCH_RESULT_LIMIT,
    SEARCH_RESULT_PER_MODULE_LIMIT,
    searchWorkspace
} = require('../../src/lib/textwarp/workspace-service');

test('language indexes retain only the current revision across 81 edits of a 100 KiB model', () => {
    clearLanguageServiceCache();
    const body = 'on green_flag:\n    repeat 10:\n        change_x(1)\n        wait(0)\n';
    const source = `actor CacheTest\n${body.repeat(1600)}`;
    const started = performance.now();
    for (let revision = 0; revision < 81; revision++) {
        createDocumentIndex(`${source}\n# revision ${revision}`, 'live-model');
    }
    const elapsed = performance.now() - started;
    const stats = getDocumentIndexCacheStats();
    assert.equal(stats.entries, 1);
    assert.deepEqual(stats.modelKeys, ['live-model']);
    assert.ok(stats.bytes <= 16 * 1024 * 1024);
    assert.ok(elapsed < 12000, `revision indexing took ${elapsed.toFixed(1)} ms`);
});

test('workspace search stops at per-module and global result budgets', () => {
    const moduleSource = 'match '.repeat(90000);
    const workspace = {
        modules: Array.from({length: 4}, (unused, index) => ({
            fileName: `actor-${index}.tw`,
            id: `actor-${index}`,
            source: moduleSource
        }))
    };
    const started = performance.now();
    const results = searchWorkspace(workspace, 'match');
    const elapsed = performance.now() - started;
    const counts = results.reduce((byTarget, result) => {
        byTarget[result.targetId] = (byTarget[result.targetId] || 0) + 1;
        return byTarget;
    }, {});
    assert.equal(results.length, SEARCH_RESULT_LIMIT);
    assert.equal(results.truncated, true);
    assert.ok(Object.values(counts).every(count => count <= SEARCH_RESULT_PER_MODULE_LIMIT));
    assert.ok(elapsed < 250, `bounded search took ${elapsed.toFixed(1)} ms`);
});

test('history snapshots round-trip through compact deltas within their storage budget', () => {
    const base = 'x'.repeat(100000);
    const history = Array.from({length: 30}, (unused, index) => ({
        reason: 'autosave',
        source: `${base.slice(0, 99950)}${String(index).padStart(50, '0')}`,
        timestamp: index
    })).reverse();
    const encoded = encodeHistory(history);
    assert.deepEqual(decodeHistory(encoded), history);
    assert.equal(encoded.filter(entry => typeof entry.full === 'string').length, 3);
    assert.ok(JSON.stringify(encoded).length < JSON.stringify(history).length / 5);
    const fitted = fitHistoryToBudget(history);
    assert.ok(fitted.bytes <= HISTORY_TARGET_BYTE_LIMIT);
    assert.equal(fitted.history.length, history.length);
});

test('history persistence uses compact asynchronous storage and reports quota failures', async () => {
    resetHistoryStorageForTests();
    const values = new Map();
    const storage = {
        getItem: key => values.get(key) || null,
        removeItem: key => values.delete(key),
        setItem: (key, value) => values.set(key, value)
    };
    const history = [{reason: 'autosave', source: 'actor A', timestamp: 1}];
    const saved = saveHistory(storage, 'target.history', 'project', history);
    await whenHistoryPersisted(saved);
    assert.ok(values.has('target.history.compact'));

    resetHistoryStorageForTests();
    assert.deepEqual(loadHistory(storage, 'target.history'), history);

    const fullStorage = Object.assign({}, storage, {
        setItem () {
            throw new Error('quota exceeded');
        }
    });
    const failed = saveHistory(fullStorage, 'full.history', 'project', history);
    await assert.rejects(whenHistoryPersisted(failed), /quota exceeded/);
});

test('draft persistence marks the project dirty without emitting a block-change event', () => {
    let projectChanges = 0;
    const vm = {runtime: {emitProjectChanged: () => projectChanges++}};
    const target = {
        blocks: {_blocks: {}},
        comments: {},
        createComment (id, blockId, text, x, y, width, height, minimized) {
            this.comments[id] = {blockId, height, minimized, text, width, x, y};
        },
        getName: () => 'Actor',
        id: 'actor',
        isStage: false,
        variables: {}
    };
    writeSourceRecord(vm, target, {source: 'actor Actor'});
    projectChanges = 0;
    saveTextSource(vm, target, 'actor Actor\non green_flag:\n    move(10)', {
        emitProjectChanged: false
    });
    assert.equal(projectChanges, 0);
});

test('hidden debugger consumers receive snapshots without variable or call-stack inspection', () => {
    const target = {
        blocks: {getBlock: () => ({opcode: 'motion_movesteps'})},
        comments: {},
        getName: () => 'Actor',
        id: 'actor',
        variables: {}
    };
    const thread = {
        getId: () => 'thread',
        isCompiled: false,
        peekStack: () => 'block',
        stack: ['block'],
        target
    };
    const runtime = {
        _primitives: {},
        _pushThread () {},
        compilerOptions: {enabled: true},
        getTargetForStage: () => null,
        on () {},
        sequencer: {stepThread () {}},
        threads: [thread]
    };
    const controller = new TextWarpDebugController({runtime});
    const lightweight = controller.snapshot(false);
    assert.equal(lightweight.threads[0].inspector, null);
    assert.deepEqual(lightweight.threads[0].callStack, []);
    assert.equal(controller.snapshot(true).threads[0].inspector.target.name, 'Actor');
});

test('conversion cancellation keeps one worker alive until the editor is disposed', async () => {
    const OriginalWorker = global.Worker;
    const workers = [];
    class FakeWorker {
        constructor () {
            this.terminated = false;
            workers.push(this);
        }
        postMessage (message) {
            this.lastMessage = message;
        }
        terminate () {
            this.terminated = true;
        }
    }
    global.Worker = FakeWorker;
    const client = new ConversionWorkerClient();
    try {
        const cancelled = client.compile('actor A', {});
        client.cancelPending();
        await assert.rejects(cancelled, /cancelada/);
        assert.equal(workers.length, 1);
        assert.equal(workers[0].terminated, false);

        const completed = client.compile('actor A', {});
        assert.equal(workers.length, 1);
        workers[0].onmessage({
            data: {id: workers[0].lastMessage.id, result: {success: true}}
        });
        assert.deepEqual(await completed, {success: true});

        client.dispose();
        assert.equal(workers[0].terminated, true);
    } finally {
        if (OriginalWorker) global.Worker = OriginalWorker;
        else delete global.Worker;
    }
});
