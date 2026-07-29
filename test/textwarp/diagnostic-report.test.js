'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {createDiagnosticReport} = require('../../src/lib/textwarp/diagnostic-report');

test('technical report includes conversion, Monaco, diagnostics and current source', () => {
    const report = createDiagnosticReport({
        generatedAt: '2026-07-26T18:00:00.000Z',
        locale: 'pt-br',
        userAgent: 'Test Browser',
        projectTitle: 'Gears',
        targetCount: 2,
        targetName: 'gears',
        targetId: 'sprite-gears',
        isStage: false,
        blockCount: 300,
        variables: [{id: 'gear-speed', name: 'Gear Speed °/s', type: 'list', owner: 'stage'}],
        extensions: ['pen'],
        status: '281 problemas',
        monacoError: 'AMD loader unavailable',
        source: 'actor gears\n\nlist Gear_Speed_s = []',
        conversion: {
            success: false,
            importedRootCount: 10,
            unsupportedRootCount: 2,
            unsupportedOpcodes: ['legacy_block']
        },
        diagnostics: [{
            severity: 'error',
            line: 13,
            column: 5,
            code: 'unknown-variable',
            message: 'A variável não existe.'
        }],
        runtimeErrors: [{message: 'runtime failure', targetName: 'gears'}],
        consoleEntries: [{level: 'warn', message: 'console message', targetName: 'gears'}]
    });

    assert.match(report, /Monaco error: AMD loader unavailable/);
    assert.match(report, /Gear Speed °\/s/);
    assert.match(report, /- pen/);
    assert.match(report, /Opaque-preserved opcodes: legacy_block/);
    assert.match(report, /ERROR L13:5 \[unknown-variable\]/);
    assert.match(report, /runtime failure/);
    assert.match(report, /console message/);
    assert.match(report, /```textwarp\nactor gears/);
});
