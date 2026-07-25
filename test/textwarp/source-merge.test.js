'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {compileText} = require('../../src/lib/textwarp/compiler');
const {mergeVisualSource} = require('../../src/lib/textwarp/source-merge');

const options = {targetId: 'sprite', stageId: 'stage', targetName: 'Player', isStage: false};
const compile = source => compileText(source, options);

test('preserves comments, spacing and textual order outside a visually changed unit', () => {
    const base = `actor Player

# comentário do evento
on green_flag:
    move(10)  # manter apenas se a unidade não mudar


# comentário do procedimento
procedure greet(name: string):
    say( name )
`;
    const visual = `actor Player

on green_flag:
    move(20)

procedure greet(name: string):
    say(name)`;
    const result = mergeVisualSource({
        baseSource: base,
        textSource: base,
        visualSource: visual,
        baseCompilation: compile(base),
        textCompilation: compile(base),
        visualCompilation: compile(visual)
    });
    assert.deepEqual(result.conflicts, []);
    assert.match(result.source, /# comentário do evento/);
    assert.match(result.source, /move\(20\)/);
    assert.match(result.source, /# comentário do procedimento/);
    assert.match(result.source, /say\( name \)/);
    assert.ok(result.source.indexOf('on green_flag:') < result.source.indexOf('procedure greet'));
});

test('automatically merges independent text and block units', () => {
    const base = `actor Player
on green_flag:
    move(10)
on clicked:
    say("old")`;
    const textSource = base.replace('move(10)', 'move(30)  # texto');
    const visualSource = base.replace('say("old")', 'say("blocos")');
    const result = mergeVisualSource({
        baseSource: base,
        textSource,
        visualSource,
        baseCompilation: compile(base),
        textCompilation: compile(textSource),
        visualCompilation: compile(visualSource)
    });
    assert.deepEqual(result.conflicts, []);
    assert.match(result.source, /move\(30\)  # texto/);
    assert.match(result.source, /say\("blocos"\)/);
    assert.deepEqual(result.mergedUnits, ['script:clicked#0']);
});

test('reports a semantic conflict when text and blocks change the same unit', () => {
    const base = 'actor Player\non green_flag:\n    move(10)';
    const textSource = base.replace('10', '20');
    const visualSource = base.replace('10', '30');
    const result = mergeVisualSource({
        baseSource: base,
        textSource,
        visualSource,
        baseCompilation: compile(base),
        textCompilation: compile(textSource),
        visualCompilation: compile(visualSource)
    });
    assert.deepEqual(result.conflicts, ['script:green_flag#0']);
    assert.equal(result.source, null);
});

test('keeps independent text edits when visual variable declarations require a canonical fallback', () => {
    const base = `actor Player
variable score = 0
on green_flag:
    move(10)`;
    const textSource = base.replace('move(10)', 'move(20)  # texto');
    const visualSource = `actor Player
variable score = 0
variable lives = 3
on green_flag:
    move(10)`;
    const result = mergeVisualSource({
        baseSource: base,
        textSource,
        visualSource,
        baseCompilation: compile(base),
        textCompilation: compile(textSource),
        visualCompilation: compile(visualSource)
    });
    assert.deepEqual(result.conflicts, []);
    assert.equal(result.canonicalFallback, true);
    assert.match(result.source, /variable lives = 3/);
    assert.match(result.source, /move\(20\)  # texto/);
});
