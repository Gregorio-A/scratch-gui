'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {
    ROOT_MARKER,
    SOURCE_COMMENT_ID,
    SOURCE_MARKER,
    applyCompilation,
    readSourceRecord,
    saveTextSource
} = require('../../src/lib/textwarp/vm-adapter');

const actorOptions = {
    targetId: 'sprite-1',
    targetName: 'Player',
    isStage: false
};

test('compiles nested TextWarp source to Scratch block graph', () => {
    const source = `actor Player

on green_flag:
    repeat(3):
        move(10)
        wait(0.1)
    say("Pronto!")`;
    const result = compileText(source, actorOptions);
    assert.equal(result.success, true, JSON.stringify(result.diagnostics));

    const blocks = Object.values(result.graph.blocks);
    assert.deepEqual(
        new Set(blocks.map(block => block.opcode)),
        new Set([
            'event_whenflagclicked',
            'control_repeat',
            'math_whole_number',
            'motion_movesteps',
            'math_number',
            'control_wait',
            'math_positive_number',
            'looks_say',
            'text'
        ])
    );

    const event = blocks.find(block => block.opcode === 'event_whenflagclicked');
    const repeat = blocks.find(block => block.opcode === 'control_repeat');
    const move = blocks.find(block => block.opcode === 'motion_movesteps');
    const wait = blocks.find(block => block.opcode === 'control_wait');
    const say = blocks.find(block => block.opcode === 'looks_say');

    assert.equal(event.next, repeat.id);
    assert.equal(repeat.parent, event.id);
    assert.equal(repeat.inputs.SUBSTACK.block, move.id);
    assert.equal(move.parent, repeat.id);
    assert.equal(move.next, wait.id);
    assert.equal(wait.parent, move.id);
    assert.equal(repeat.next, say.id);
    assert.equal(say.parent, repeat.id);
});

test('reports semantic errors without creating a graph', () => {
    const result = compileText(`stage

on green_flag:
    move("dez")`, {
        targetId: 'stage-1',
        targetName: 'Stage',
        isStage: true
    });
    assert.equal(result.success, false);
    assert.equal(result.graph, null);
    assert.ok(result.diagnostics.some(item => item.code === 'command-not-allowed-on-stage'));
    assert.ok(result.diagnostics.some(item => item.code === 'scratch-coercion' && item.severity === 'warning'));
});

test('normalizes friendly arrow-key aliases to canonical Scratch menu values', () => {
    const reporter = compileText(`actor Player
on green_flag:
    if key_pressed("right"):
        wait(0)`, actorOptions);
    assert.equal(reporter.success, true, JSON.stringify(reporter.diagnostics));
    const keyMenu = Object.values(reporter.graph.blocks)
        .find(block => block.opcode === 'sensing_keyoptions');
    assert.equal(keyMenu.fields.KEY_OPTION.value, 'right arrow');

    const event = compileText(`actor Player
on key_pressed("left"):
    wait(0)`, actorOptions);
    assert.equal(event.success, true, JSON.stringify(event.diagnostics));
    const keyEvent = Object.values(event.graph.blocks)
        .find(block => block.opcode === 'event_whenkeypressed');
    assert.equal(keyEvent.fields.KEY_OPTION.value, 'left arrow');
});

test('keeps IDs stable when an unrelated command is inserted', () => {
    const first = compileText(`actor Player
on green_flag:
    move(10)
    say("ok")`, actorOptions);
    const second = compileText(`actor Player
on green_flag:
    wait(1)
    move(20)
    say("changed")`, actorOptions);
    const findId = (result, opcode) => Object.values(result.graph.blocks).find(block => block.opcode === opcode).id;
    assert.equal(findId(first, 'motion_movesteps'), findId(second, 'motion_movesteps'));
    assert.equal(findId(first, 'looks_say'), findId(second, 'looks_say'));
});

const makeFakeVm = () => {
    const storedBlocks = new Map();
    const target = {
        id: 'sprite-1',
        isStage: false,
        comments: {},
        createComment (id, blockId, text, x, y, width, height, minimized) {
            this.comments[id] = {id, blockId, text, x, y, width, height, minimized};
        },
        blocks: {
            getBlock: id => storedBlocks.get(id),
            createBlock: block => storedBlocks.set(block.id, block),
            deleteBlock: id => storedBlocks.delete(id),
            resetCache: () => {},
            updateTargetSpecificBlocks: () => {}
        }
    };
    const vm = {
        editingTarget: target,
        emitWorkspaceUpdate: () => {},
        runtime: {
            emitProjectChanged: () => {},
            stopForTarget: () => {}
        }
    };
    return {vm, target, storedBlocks};
};

test('embeds source and replaces only previously generated blocks', () => {
    const {vm, target, storedBlocks} = makeFakeVm();
    storedBlocks.set('manual-block', {id: 'manual-block'});
    const first = compileText('actor Player\non green_flag:\n    move(10)', actorOptions);
    applyCompilation(vm, target, first);
    assert.ok(target.comments[SOURCE_COMMENT_ID]);
    assert.equal(readSourceRecord(target).source, first.source);
    assert.equal(readSourceRecord(target).moduleId, target.id);
    assert.ok(storedBlocks.has('manual-block'));

    const oldGeneratedIds = readSourceRecord(target).generatedBlockIds;
    const second = compileText('actor Player\non green_flag:\n    say("novo")', actorOptions);
    saveTextSource(vm, target, second.source);
    applyCompilation(vm, target, second);

    assert.ok(storedBlocks.has('manual-block'));
    assert.ok(oldGeneratedIds.some(id => !storedBlocks.has(id)));
    assert.equal(readSourceRecord(target).source, second.source);
});

test('finds source and generated roots after SB3 ID optimization', () => {
    const {target} = makeFakeVm();
    target.comments = {
        a: {
            id: 'a',
            blockId: null,
            text: SOURCE_MARKER + JSON.stringify({
                formatVersion: 1,
                languageVersion: '0.1',
                moduleId: 'persistent-player-module',
                source: 'actor Player\non green_flag:\n    move(10)',
                generatedRootIds: ['old-root-id']
            })
        },
        b: {
            id: 'b',
            blockId: 'optimized-root-id',
            text: ROOT_MARKER
        }
    };
    const record = readSourceRecord(target);
    assert.equal(record.source.startsWith('actor Player'), true);
    assert.equal(record.moduleId, 'persistent-player-module');
    assert.deepEqual(record.generatedRootIds, ['optimized-root-id']);
});
