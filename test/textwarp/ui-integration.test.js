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

test('editor action buttons share one responsive row without execution buttons', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const editorStyles = readSource('src/components/textwarp-editor/text-editor.css');
    const toolbar = editorSource.match(/<header className=\{styles\.toolbar\}>[\s\S]*?<\/header>/)[0];
    const drawer = editorSource.match(
        /<div className=\{classNames\([\s\S]*?styles\.actionDrawer[\s\S]*?<\/div>/
    )[0];

    assert.doesNotMatch(toolbar, /handleRun|handleStop|handleRestart|handleCompile|handleImportBlocks/);
    assert.doesNotMatch(editorSource, /onClick=\{this\.handle(?:Run|Stop|Restart)\}/);
    assert.doesNotMatch(editorSource, /styles\.editorControls|styles\.controlGroup/);
    assert.match(
        drawer,
        /t\('commands'\)[\s\S]*?t\('models'\)[\s\S]*?t\('externalEditor'\)[\s\S]*?t\('textToBlocks'\)[\s\S]*?t\('blocksToText'\)[\s\S]*?t\('projects'\)/
    );
    assert.match(editorStyles, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
    assert.match(editorStyles, /\.compact-layout \.action-drawer \{[\s\S]*?repeat\(3,/);
    assert.match(editorStyles, /\.narrow-layout \.action-drawer \{[\s\S]*?repeat\(2,/);
});

test('Extensions is available beside Problems, Console and Debugger only in the bottom panel', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const drawer = editorSource.match(/<div className=\{classNames\([\s\S]*?styles\.actionDrawer[\s\S]*?<\/div>/)[0];
    const panelTabs = editorSource.match(/<nav className=\{styles\.panelTabs\}[\s\S]*?<\/nav>/)[0];

    assert.doesNotMatch(drawer, /t\('extensions'\)|t\('console'\)|t\('debug'\)/);
    assert.match(panelTabs, /t\('problems'\)[\s\S]*?t\('console'\)[\s\S]*?t\('debugPanel'\)[\s\S]*?t\('extensions'\)/);
});

test('File and Advanced menus expose TextWarp file actions and preferences', () => {
    const menuSource = readSource('src/components/menu-bar/menu-bar.jsx');

    assert.match(menuSource, /defaultMessage="New File"/);
    assert.match(menuSource, /defaultMessage="Open \.textwarp"/);
    assert.match(menuSource, /defaultMessage="Save As \.textwarp"/);
    assert.match(menuSource, /defaultMessage="Import Project"/);
    assert.match(menuSource, /defaultMessage="Export Project"/);
    assert.match(menuSource, /open=\{this\.props\.advancedMenuOpen\}[\s\S]*?defaultMessage="Preferences"/);
});
