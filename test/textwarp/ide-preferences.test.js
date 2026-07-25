'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    chooseSecondaryTargetId,
    clampBottomPanelHeight,
    clampFontSize,
    clampSidebarWidth,
    clampSplitRatio
} = require('../../src/lib/textwarp/ide-preferences');
const {normalizeLocale, translate} = require('../../src/lib/textwarp/i18n');

test('clamps persistent IDE layout and font preferences', () => {
    assert.equal(clampFontSize(4), 11);
    assert.equal(clampFontSize(18), 18);
    assert.equal(clampFontSize(99), 28);
    assert.equal(clampSidebarWidth(50), 180);
    assert.equal(clampBottomPanelHeight(900), 520);
    assert.equal(clampSplitRatio(10), 25);
    assert.equal(clampSplitRatio(90), 75);
});

test('dual editor always selects a module different from the primary editor', () => {
    const modules = [{id: 'stage'}, {id: 'cat'}, {id: 'dog'}];
    assert.equal(chooseSecondaryTargetId(modules, 'cat', 'dog'), 'dog');
    assert.equal(chooseSecondaryTargetId(modules, 'dog', 'dog'), 'stage');
    assert.equal(chooseSecondaryTargetId([{id: 'only'}], 'only', null), null);
});

test('TextWarp UI uses Portuguese explicitly and English as the universal fallback', () => {
    assert.equal(normalizeLocale('pt-BR'), 'pt');
    assert.equal(normalizeLocale('fr'), 'en');
    assert.equal(translate('pt-BR', 'compile'), 'Compilar');
    assert.equal(translate('de', 'compile'), 'Compile');
    assert.equal(translate('en', 'topics', {count: 12}), '12 topics');
});
