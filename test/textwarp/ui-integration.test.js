'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const readSource = relativePath => fs.readFileSync(
    path.join(__dirname, '..', '..', relativePath),
    'utf8'
);

test('TextWarp view and file tabs are isolated from the outer Scratch tab container', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');

    assert.match(editorSource, /<section[\s\S]*?data-tabs="textwarp"/);
    assert.match(editorSource, /className=\{styles\.viewTabs\}[\s\S]*?role="tablist"/);
    assert.match(editorSource, /className=\{styles\.openTabs\}[\s\S]*?role="tablist"/);
});

test('editor actions use file tabs plus contextual conversion and action menus', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const editorStyles = readSource('src/components/textwarp-editor/text-editor.css');
    const fileTabs = editorSource.match(/<div className=\{styles\.openTabsRegion\}>[\s\S]*?<\/nav>/)[0];

    assert.doesNotMatch(editorSource, /t\('models'\)|textwarp-templates-panel|templatesOpen/);
    assert.doesNotMatch(editorSource, /actionDrawer|projectSwitch|t\('projects'\)/);
    assert.match(fileTabs, /draggable[\s\S]*?onContextMenu=[\s\S]*?onAuxClick=/);
    assert.match(editorSource, /id="textwarp-convert-menu"[\s\S]*?t\('textToBlocks'\)[\s\S]*?t\('blocksToText'\)/);
    assert.match(editorSource, /role="menuitemcheckbox"[\s\S]*?t\('autoSync'\)/);
    assert.match(editorSource, /id="textwarp-action-menu"[\s\S]*?t\('commandPalette'\)[\s\S]*?t\('preferences'\)/);
    assert.match(editorStyles, /\.narrow-layout \.convert-menu-trigger span,[\s\S]*?display: none/);
});

test('Extensions lives in the activity sidebar and the bottom panel contains IDE output areas', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const activitySource = readSource('src/components/textwarp-editor/activity-bar.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');
    const panelTabs = editorSource.match(/<nav className=\{styles\.panelTabs\}[\s\S]*?<\/nav>/)[0];

    assert.match(activitySource, /activeSidebarPanel === 'extensions'[\s\S]*?t\('extensions'\)/);
    assert.match(sidebarSource, /activePanel === 'extensions'[\s\S]*?extensionSidebarSummary/);
    assert.match(panelTabs, /t\('problems'\)[\s\S]*?t\('console'\)[\s\S]*?t\('debugPanel'\)[\s\S]*?t\('output'\)[\s\S]*?t\('backpack'\)/);
    assert.doesNotMatch(panelTabs, /t\('extensions'\)/);
});

test('the legacy find bar uses progressive reveal and leaves TextWarp Ctrl+F to Monaco', () => {
    const findBarSource = readSource('src/addons/addons/find-bar/userscript.js');
    const findBarStyles = readSource('src/addons/addons/find-bar/userstyle.css');

    assert.match(findBarSource, /querySelector\('\[data-tabs="textwarp"\]'\)/);
    assert.match(findBarSource, /textWarpEditor\.contains\(document\.activeElement\)/);
    assert.match(findBarSource, /classList\.add\("revealed"\)/);
    assert.match(findBarSource, /classList\.remove\("revealed"\)/);
    assert.match(findBarStyles, /\.sa-find-wrapper \{[\s\S]*?width: 0;[\s\S]*?opacity: 0/);
    assert.match(findBarStyles, /\.sa-find-bar\.revealed \.sa-find-wrapper \{/);
});

test('Problems and the basic editor expose copyable and downloadable technical reports', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const monacoSource = readSource('src/components/textwarp-editor/monaco-editor.jsx');
    const editorStyles = readSource('src/components/textwarp-editor/text-editor.css');

    assert.match(editorSource, /getDiagnosticReport \(\)/);
    assert.match(editorSource, /handleCopyDiagnosticReport \(\)/);
    assert.match(editorSource, /handleDownloadDiagnosticReport \(\)/);
    assert.match(editorSource, /onCopyDiagnosticReport=\{this\.handleCopyDiagnosticReport\}/);
    assert.match(editorSource, /onDownloadDiagnosticReport=\{this\.handleDownloadDiagnosticReport\}/);
    assert.match(editorSource, /onLoadError=\{this\.handleMonacoLoadError\}/);
    assert.match(monacoSource, /this\.props\.onCopyDiagnosticReport/);
    assert.match(monacoSource, /this\.props\.onDownloadDiagnosticReport/);
    assert.match(editorStyles, /\.diagnostic-report-actions \{/);
});

test('activity navigation, responsive overlays and panels expose keyboard and ARIA state', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const activitySource = readSource('src/components/textwarp-editor/activity-bar.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');
    const quickPanelSource = readSource('src/components/textwarp-editor/quick-panel.jsx');

    assert.match(activitySource, /controls="textwarp-ide-sidebar"/);
    assert.match(activitySource, /expanded=\{props\.sidebarVisible/);
    assert.match(activitySource, /controls="textwarp-bottom-panel-content"/);
    assert.match(editorSource, /className=\{styles\.sidebarBackdrop\}/);
    assert.match(sidebarSource, /aria-label=\{t\('closeSidebar'\)\}/);
    assert.match(editorSource, /getNextTabId/);
    assert.match(quickPanelSource, /event\.key !== 'Escape'/);
    assert.match(quickPanelSource, /this\.returnFocus\.focus\(\)/);
    assert.match(editorSource, /activeBottomPanel/);
    assert.match(editorSource, /aria-selected=\{!this\.state\.bottomPanelCollapsed/);
});

test('interface has measured-width layouts, touch targets, pagination and layout recovery', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const guiSource = readSource('src/components/gui/gui.jsx');
    const editorStyles = readSource('src/components/textwarp-editor/text-editor.css');
    const stateSource = readSource('src/lib/textwarp/interface-state.js');

    assert.match(stateSource, /width < 600/);
    assert.match(stateSource, /width < 850/);
    assert.match(stateSource, /width < 1180/);
    assert.match(editorStyles, /--textwarp-control-height: 2\.25rem/);
    assert.match(editorStyles, /\.compact-ui \{[\s\S]*?--textwarp-control-height: 1\.85rem/);
    assert.match(editorStyles, /\.narrow-layout \{[\s\S]*?--textwarp-control-height: 2\.75rem/);
    assert.match(editorSource, /compactUi: savedPreferences\.compactUi === true/);
    assert.match(editorSource, /storage\.setItem\('textwarp\.ide\.preferences'/);
    assert.match(editorStyles, /\.narrow-layout \.debug-grid,[\s\S]*?grid-template-columns: 1fr/);
    assert.match(editorStyles, /\.narrow-layout \.extension-entry \{[\s\S]*?grid-template-columns: 1fr/);
    assert.match(editorSource, /getVisibleItems/);
    assert.match(editorSource, /resetLayout/);
    assert.match(editorSource, /handleResizeKeyDown/);
    assert.match(guiSource, /textwarp\.workspace\.stage-layout/);
    assert.match(guiSource, /localStorage\.setItem\(STAGE_LAYOUT_STORAGE_KEY/);
    assert.match(guiSource, /mobileHeight/);
});

test('File, Project and Help menus expose TextWarp actions in a compact hierarchy', () => {
    const menuSource = readSource('src/components/menu-bar/menu-bar.jsx');

    assert.match(menuSource, /defaultMessage="New File"/);
    assert.match(menuSource, /defaultMessage="Open \.textwarp"/);
    assert.match(menuSource, /defaultMessage="Save As \.textwarp"/);
    assert.match(menuSource, /defaultMessage="Import Project"/);
    assert.match(menuSource, /defaultMessage="Export Project"/);
    assert.match(menuSource, /defaultMessage="Project"[\s\S]*?open=\{this\.props\.advancedMenuOpen\}/);
    assert.match(menuSource, /defaultMessage="Preferences"[\s\S]*?defaultMessage="Extensions and addons"/);
    assert.match(menuSource, /defaultMessage="Help"[\s\S]*?defaultMessage="Send feedback"/);
    assert.match(menuSource, /textwarpUiOperation\.state === 'working'/);
    assert.match(menuSource, /role="status"/);
});

test('refined workspace compacts targets and protects text-block conversions', () => {
    const controlsSource = readSource('src/components/controls/controls.jsx');
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const guiSource = readSource('src/components/gui/gui.jsx');
    const menuSource = readSource('src/components/menu-bar/menu-bar.jsx');
    const selectorSource = readSource('src/components/sprite-selector/sprite-selector.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');

    assert.match(guiSource, /id="tw\.gui\.programmingTab"/);
    assert.doesNotMatch(guiSource, /styles\.actorNavigation/);
    assert.match(selectorSource, /\['actors', messages\.actors\][\s\S]*?\['backdrops', messages\.backdrops\]/);
    assert.match(selectorSource, /className=\{styles\.targetTabs\}/);
    assert.doesNotMatch(menuSource, /<SettingsMenu/);
    assert.match(controlsSource, /id: 'tw\.controls\.run'/);
    assert.match(controlsSource, /id: 'tw\.controls\.pause'/);
    assert.match(controlsSource, /id: 'gui\.controls\.stop'/);
    assert.match(editorSource, /captureConversionSnapshot \(\w+\)/);
    assert.match(editorSource, /t\('undoConversion'\)[\s\S]*?t\('viewDifferences'\)/);
    assert.match(editorSource, /t\('conflictKeepText'\)[\s\S]*?t\('conflictUseBlocks'\)[\s\S]*?t\('cancel'\)/);
    assert.match(editorSource, /diagnosticFileName[\s\S]*?item\.line[\s\S]*?item\.column/);
    assert.match(sidebarSource, /outlineVariables[\s\S]*?outlineProcedures[\s\S]*?outlineEvents/);
});
