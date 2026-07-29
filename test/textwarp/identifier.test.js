'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {assignSourceNames} = require('../../src/lib/textwarp/identifier');

test('creates deterministic valid aliases for Scratch names and collisions', () => {
    const aliases = assignSourceNames([
        {name: '7 Gear'},
        {name: 'Gear X'},
        {name: 'Gear-X'},
        {name: '°'},
        {name: 'true'},
        {name: 'and'}
    ]).map(item => item.sourceName);

    assert.deepEqual(aliases, ['_7_Gear', 'Gear_X', 'Gear_X_2', 'value_4', 'true_2', 'and_2']);
});
