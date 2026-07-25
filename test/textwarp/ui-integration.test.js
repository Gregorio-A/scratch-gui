'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readSource = relativePath => fs.readFileSync(
    path.join(__dirname, '..', '..', relativePath),
    'utf8'
);

test('nested TextWarp tabs are isolated from the outer Scratch tab container', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');

    assert.match(editorSource, /<section[\s\S]*?data-tabs="textwarp"/);
    assert.match(editorSource, /className=\{styles\.viewTabs\}[\s\S]*?role="tablist"/);
    assert.match(sidebarSource, /className=\{styles\.tabs\}[\s\S]*?role="tablist"/);
});
