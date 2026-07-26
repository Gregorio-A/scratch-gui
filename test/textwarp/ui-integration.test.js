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
        /<div aria-label=\{t\('tools'\)\} className=\{styles\.actionDrawer\}[\s\S]*?<\/div>/
    )[0];

    assert.doesNotMatch(toolbar, /handleRun|handleStop|handleRestart|handleCompile|handleImportBlocks/);
    assert.doesNotMatch(editorSource, /onClick=\{this\.handle(?:Run|Stop|Restart)\}/);
    assert.doesNotMatch(editorSource, /styles\.editorControls|styles\.controlGroup/);
    assert.doesNotMatch(editorSource, /drawerClosed|toolsOpen/);
    assert.match(
        drawer,
        /t\('commands'\)[\s\S]*?t\('models'\)[\s\S]*?t\('externalEditor'\)[\s\S]*?t\('textToBlocks'\)[\s\S]*?t\('blocksToText'\)[\s\S]*?t\('projects'\)/
    );
    assert.match(editorStyles, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
    assert.match(editorStyles, /\.condensed-layout \.action-drawer \{[\s\S]*?repeat\(3,/);
    assert.match(editorStyles, /\.compact-layout \.action-drawer \{[\s\S]*?repeat\(3,/);
    assert.match(editorStyles, /\.narrow-layout \.action-drawer \{[\s\S]*?repeat\(2,/);
});

test('Extensions is available beside Problems, Console and Debugger only in the bottom panel', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const drawer = editorSource.match(
        /<div aria-label=\{t\('tools'\)\} className=\{styles\.actionDrawer\}[\s\S]*?<\/div>/
    )[0];
    const panelTabs = editorSource.match(/<nav className=\{styles\.panelTabs\}[\s\S]*?<\/nav>/)[0];

    assert.doesNotMatch(drawer, /t\('extensions'\)|t\('console'\)|t\('debug'\)/);
    assert.match(panelTabs, /t\('problems'\)[\s\S]*?t\('console'\)[\s\S]*?t\('debugPanel'\)[\s\S]*?t\('extensions'\)/);
});

test('responsive overlays, tabs and panels expose complete keyboard and ARIA state', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');
    const quickPanelSource = readSource('src/components/textwarp-editor/quick-panel.jsx');

    assert.match(editorSource, /aria-controls="textwarp-projects-sidebar"/);
    assert.match(editorSource, /aria-expanded=\{this\.state\.sidebarVisible\}/);
    assert.match(editorSource, /className=\{styles\.sidebarBackdrop\}/);
    assert.match(sidebarSource, /aria-label=\{t\('closeProjects'\)\}/);
    assert.match(sidebarSource, /getNextTabId/);
    assert.match(quickPanelSource, /event\.key !== 'Escape'/);
    assert.match(quickPanelSource, /this\.returnFocus\.focus\(\)/);
    assert.match(editorSource, /activeBottomPanel/);
    assert.match(editorSource, /aria-selected=\{!this\.state\.bottomPanelCollapsed/);
});

test('interface has measured-width layouts, touch targets, pagination and layout recovery', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const editorStyles = readSource('src/components/textwarp-editor/text-editor.css');
    const stateSource = readSource('src/lib/textwarp/interface-state.js');

    assert.match(stateSource, /width < 600/);
    assert.match(stateSource, /width < 850/);
    assert.match(stateSource, /width < 1180/);
    assert.match(editorStyles, /--textwarp-control-height: 2\.75rem/);
    assert.match(editorStyles, /\.narrow-layout \.debug-grid,[\s\S]*?grid-template-columns: 1fr/);
    assert.match(editorStyles, /\.narrow-layout \.extension-entry \{[\s\S]*?grid-template-columns: 1fr/);
    assert.match(editorSource, /getVisibleItems/);
    assert.match(editorSource, /resetLayout/);
    assert.match(editorSource, /handleResizeKeyDown/);
});

test('File and Advanced menus expose TextWarp file actions and preferences', () => {
    const menuSource = readSource('src/components/menu-bar/menu-bar.jsx');

    assert.match(menuSource, /defaultMessage="New File"/);
    assert.match(menuSource, /defaultMessage="Open \.textwarp"/);
    assert.match(menuSource, /defaultMessage="Save As \.textwarp"/);
    assert.match(menuSource, /defaultMessage="Import Project"/);
    assert.match(menuSource, /defaultMessage="Export Project"/);
    assert.match(menuSource, /open=\{this\.props\.advancedMenuOpen\}[\s\S]*?defaultMessage="Preferences"/);
    assert.match(menuSource, /textwarpUiOperation\.state === 'working'/);
    assert.match(menuSource, /role="status"/);
});
