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
    const fileTabs = editorSource.match(/<div[^>]*className=\{styles\.openTabsRegion\}[^>]*>[\s\S]*?<\/nav>/)[0];

    assert.doesNotMatch(editorSource, /t\('models'\)|textwarp-templates-panel|templatesOpen/);
    assert.doesNotMatch(editorSource, /actionDrawer|projectSwitch|t\('projects'\)/);
    assert.match(fileTabs, /draggable[\s\S]*?onContextMenu=[\s\S]*?onAuxClick=/);
    assert.match(
        editorSource,
        /id="textwarp-convert-menu"[\s\S]*?t\('textToBlocks'\)[\s\S]*?t\('blocksToText'\)[\s\S]*?t\('blocksToTextProject'\)/
    );
    assert.doesNotMatch(editorSource, /t\('autoSync'\)|setAutoSync/);
    assert.match(editorSource, /t\('codeLanguage'\)[\s\S]*?value="en-US"[\s\S]*?value="pt-BR"/);
    assert.match(editorSource, /id="textwarp-action-menu"[\s\S]*?t\('commandPalette'\)[\s\S]*?t\('preferences'\)/);
    assert.match(editorStyles, /\.narrow-layout \.convert-menu-trigger span,[\s\S]*?display: none/);
});

test('keyboard navigation is scoped, pane-aware and exposes discoverable project commands', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const monacoSource = readSource('src/components/textwarp-editor/monaco-editor.jsx');

    assert.match(editorSource, /!this\.props\.isVisible[\s\S]*?!this\.rootElement\.contains\(event\.target\)/);
    assert.match(editorSource, /isEditableElement\(event\.target\) && !insideMonaco/);
    assert.match(editorSource, /key === 'p'[\s\S]*?quickOpenOpen: true/);
    assert.match(editorSource, /event\.key === 'F8'[\s\S]*?navigateProblem/);
    assert.match(editorSource, /event\.key === 'F9'[\s\S]*?toggleBreakpointAtCursor/);
    assert.match(editorSource, /getActiveMonacoEditor \(\)/);
    assert.match(editorSource, /event\.key === 'ContextMenu'[\s\S]*?event\.key === 'F10'/);
    assert.match(editorSource, /MENU_ITEM_SELECTOR[\s\S]*?menuitemcheckbox/);
    assert.match(editorSource, /quickOpenModules\.map/);
    assert.match(monacoSource, /GUTTER_GLYPH_MARGIN[\s\S]*?toggleBreakpoint/);
    assert.doesNotMatch(
        monacoSource.match(/this\.mouseSubscription = this\.editor\.onMouseDown[\s\S]*?this\.registerActions\(\)/)[0],
        /GUTTER_LINE_NUMBERS/
    );
});

test('Extensions lives in the programming sidebar and the bottom panel contains IDE output areas', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');
    const panelTabs = editorSource.match(/<nav className=\{styles\.panelTabs\}[\s\S]*?<\/nav>/)[0];

    assert.match(sidebarSource, /'explorer', 'commands', 'search', 'actors', 'extensions'/);
    assert.match(sidebarSource, /activePanel === 'extensions'[\s\S]*?extensionSidebarSummary/);
    assert.match(panelTabs, /t\('problems'\)[\s\S]*?t\('console'\)[\s\S]*?t\('debugPanel'\)[\s\S]*?t\('output'\)[\s\S]*?t\('backpack'\)/);
    assert.doesNotMatch(panelTabs, /t\('extensions'\)/);
});

test('translated commands live in the programming sidebar and insert Monaco snippets', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');
    const monacoSource = readSource('src/components/textwarp-editor/monaco-editor.jsx');

    assert.match(sidebarSource, /value=\{props\.activePanel\}[\s\S]*?props\.onPanelChange/);
    assert.match(sidebarSource, /activePanel === 'commands'[\s\S]*?searchCommands[\s\S]*?onInsertCommand/);
    assert.match(editorSource, /getCommandCatalog\(this\.getLanguageContext\(target\)\)/);
    assert.match(editorSource, /insertCommand \(command\)[\s\S]*?insertSnippet\(command\.snippet\)/);
    assert.match(monacoSource, /editor\.action\.insertSnippet/);
    assert.doesNotMatch(editorSource, /<header className=\{styles\.toolbar\}/);
    assert.match(editorSource, /role="toolbar"[\s\S]*?openTabs[\s\S]*?viewTabs/);
});

test('the persisted code language is restored before localized starter sources are opened', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');

    assert.match(editorSource, /const restoredState = \{\}[\s\S]*?Object\.assign\(restoredState,[\s\S]*?codeLanguage/);
    assert.match(editorSource, /this\.setState\(restoredState, \(\) => this\.loadSelectedTarget\(\)\)/);
    assert.match(editorSource, /localizeSource\(getTemplate\(target\), codeLanguage\)\.source/);
    assert.match(
        editorSource,
        /runtimeTarget === target \? codeLanguage[\s\S]*?runtimeRecord && runtimeRecord\.sourceLanguage/
    );
    assert.match(editorSource, /localizeSource\(getTemplate\(secondaryTarget\), secondaryCodeLanguage\)\.source/);
});

test('the legacy find bar leaves text editing shortcuts to Monaco and native fields', () => {
    const findBarSource = readSource('src/addons/addons/find-bar/userscript.js');
    const findBarStyles = readSource('src/addons/addons/find-bar/userstyle.css');

    assert.match(findBarSource, /querySelector\('\[data-tabs="textwarp"\]'\)/);
    assert.match(findBarSource, /textWarpEditor\.contains\(document\.activeElement\)/);
    assert.match(findBarSource, /activeElement\.tagName === "TEXTAREA"/);
    assert.match(findBarSource, /activeElement\.isContentEditable/);
    assert.match(findBarSource, /e\.key === "ArrowLeft"[\s\S]*?if \(isEditingText\)/);
    assert.match(findBarSource, /e\.key === "ArrowRight"[\s\S]*?if \(isEditingText\)/);
    assert.match(findBarSource, /classList\.add\("revealed"\)/);
    assert.match(findBarSource, /classList\.remove\("revealed"\)/);
    assert.match(findBarStyles, /\.sa-find-wrapper \{[\s\S]*?width: 0;[\s\S]*?opacity: 0/);
    assert.match(findBarStyles, /\.sa-find-bar\.revealed \.sa-find-wrapper \{/);
});

test('new projects keep the minimal starter as text until an explicit build', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');

    assert.match(editorSource, /key_pressed\("right arrow"\)/);
    assert.match(editorSource, /key_pressed\("left arrow"\)/);
    assert.doesNotMatch(editorSource, /variable health|procedure take_damage|on clone_started/);
    assert.match(editorSource, /starterApplied = false/);
    assert.doesNotMatch(editorSource, /synchronized\.count \|\| starterApplied[\s\S]*?applyCompilation/);
    assert.match(editorSource, /this\.lastAppliedSource = stored && !stored\.hasDraft \? source : ''/);
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
    const activitySource = readSource('src/components/gui/workspace-activity-bar.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');
    const quickPanelSource = readSource('src/components/textwarp-editor/quick-panel.jsx');

    assert.match(activitySource, /aria-current=\{activeTabIndex === index/);
    assert.match(activitySource, /dispatchTextwarpAction\(onSelect, 'open-search'\)/);
    assert.match(activitySource, /dispatchTextwarpAction\(onSelect, 'open-settings'\)/);
    assert.doesNotMatch(editorSource, /<ActivityBar/);
    assert.match(editorSource, /className=\{styles\.sidebarBackdrop\}/);
    assert.match(sidebarSource, /aria-label=\{t\('closeSidebar'\)\}/);
    assert.match(editorSource, /getNextTabId/);
    assert.match(quickPanelSource, /event\.key !== 'Escape'/);
    assert.match(quickPanelSource, /this\.returnFocus\.focus\(\)/);
    assert.match(editorSource, /activeBottomPanel/);
    assert.match(editorSource, /aria-selected=\{!this\.state\.bottomPanelCollapsed/);
});

test('side panels stay bounded and recognized literals expose optional visual controls', () => {
    const guiStyles = readSource('src/components/gui/gui.css');
    const spriteStyles = readSource('src/components/sprite-selector/sprite-selector.css');
    const sidebarStyles = readSource('src/components/textwarp-editor/ide-sidebar.css');
    const monacoSource = readSource('src/components/textwarp-editor/monaco-editor.jsx');
    const monacoStyles = readSource('src/components/textwarp-editor/monaco-editor.css');

    assert.match(guiStyles, /\.body-wrapper \{[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden/);
    assert.match(guiStyles, /\.stage-dock \{[\s\S]*?height: 100%;[\s\S]*?overflow: hidden/);
    assert.match(guiStyles, /::-webkit-scrollbar \{[\s\S]*?width: 6px/);
    assert.match(guiStyles, /scrollbar-color: transparent transparent/);
    assert.match(spriteStyles, /\.target-panel \{[\s\S]*?flex: 1 1 0;[\s\S]*?overflow: hidden/);
    assert.match(spriteStyles, /\.scroll-wrapper \{[\s\S]*?height: 0;[\s\S]*?overflow-y: auto/);
    assert.match(sidebarStyles, /\.content \{[\s\S]*?height: 0;[\s\S]*?overflow: auto/);
    assert.match(monacoSource, /getContextualValueControl/);
    assert.match(monacoSource, /textwarp-context-control/);
    assert.match(monacoSource, /control\.kind === 'boolean'/);
    assert.match(monacoSource, /control\.kind === 'color'/);
    assert.match(monacoSource, /control\.kind === 'select'/);
    assert.match(monacoSource, /control\.kind === 'number'/);
    assert.match(monacoStyles, /\.context-control \{/);
});

test('interface has measured-width layouts, touch targets, pagination and layout recovery', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const guiSource = readSource('src/components/gui/gui.jsx');
    const stageSource = readSource('src/components/stage/stage.jsx');
    const stageWrapperSource = readSource('src/components/stage-wrapper/stage-wrapper.jsx');
    const editorStyles = readSource('src/components/textwarp-editor/text-editor.css');
    const stateSource = readSource('src/lib/textwarp/interface-state.js');

    assert.match(stateSource, /width < 600/);
    assert.match(stateSource, /width < 850/);
    assert.match(stateSource, /width < 1180/);
    assert.match(editorStyles, /--textwarp-control-height: 2rem/);
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
    assert.match(stageWrapperSource, /TARGET_DOCK_HEIGHT_RESERVE[\s\S]*?availableHeight/);
    assert.match(stageSource, /Math\.min\(1, widthScale, heightScale\)/);
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

test('refined workspace unifies targets and protects text-block conversions', () => {
    const controlsSource = readSource('src/components/controls/controls.jsx');
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const guiSource = readSource('src/components/gui/gui.jsx');
    const menuSource = readSource('src/components/menu-bar/menu-bar.jsx');
    const selectorSource = readSource('src/components/sprite-selector/sprite-selector.jsx');
    const selectorStyles = readSource('src/components/sprite-selector/sprite-selector.css');
    const stageSelectorSource = readSource('src/components/stage-selector/stage-selector.jsx');
    const workspaceActivity = readSource('src/components/gui/workspace-activity-bar.jsx');
    const sidebarSource = readSource('src/components/textwarp-editor/ide-sidebar.jsx');
    const projectContext = readSource('src/components/menu-bar/project-context.jsx');

    assert.match(guiSource, /id="tw\.gui\.programmingTab"/);
    assert.doesNotMatch(guiSource, /styles\.actorNavigation/);
    assert.match(selectorSource, /styles\.inspectorPanel[\s\S]*?<SpriteInfo/);
    assert.match(selectorSource, /styles\.stageSection[\s\S]*?stageSelector[\s\S]*?styles\.actorSection[\s\S]*?<SpriteList/);
    assert.match(selectorSource, /messages\.addActor/);
    assert.match(stageSelectorSource, /messages\.addBackdrop/);
    assert.doesNotMatch(selectorSource, /activePanel|targetTabs/);
    assert.match(workspaceActivity, /programming[\s\S]*?costumes[\s\S]*?sounds[\s\S]*?programmingActivities/);
    assert.match(workspaceActivity, /explorer[\s\S]*?commands[\s\S]*?actors[\s\S]*?extensions[\s\S]*?symbols[\s\S]*?history/);
    assert.match(selectorStyles, /\.target-panel \{[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden/);
    assert.match(selectorStyles, /\.scroll-wrapper \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto/);
    assert.match(sidebarSource, /className=\{styles\.panelNavigation\}[\s\S]*?PANELS\.map/);
    assert.match(sidebarSource, /className=\{styles\.commandContext\}[\s\S]*?command\.arguments/);
    assert.match(projectContext, /interfaceLanguage[\s\S]*?syntaxLanguage[\s\S]*?textwarp-change-code-language/);
    assert.doesNotMatch(menuSource, /<SettingsMenu/);
    assert.match(controlsSource, /id: 'tw\.controls\.run'/);
    assert.match(controlsSource, /id: 'tw\.controls\.pause'/);
    assert.match(controlsSource, /id: 'gui\.controls\.stop'/);
    assert.match(editorSource, /captureConversionSnapshot \(direction,/);
    assert.match(editorSource, /captureTargetSnapshot[\s\S]*?restoreTargetSnapshot/);
    assert.match(editorSource, /conversionScopeReplace[\s\S]*?conversionScopeAdd/);
    assert.match(editorSource, /t\('undoConversion'\)[\s\S]*?t\('viewDifferences'\)/);
    assert.match(editorSource, /t\('conflictKeepText'\)[\s\S]*?t\('conflictUseBlocks'\)[\s\S]*?t\('cancel'\)/);
    assert.match(editorSource, /diagnosticFileName[\s\S]*?item\.line[\s\S]*?item\.column/);
    assert.match(sidebarSource, /outlineVariables[\s\S]*?outlineProcedures[\s\S]*?outlineEvents/);
});

test('top workspace controls replace redundant stage and panel controls', () => {
    const editorSource = readSource('src/containers/textwarp-editor.jsx');
    const editorStyles = readSource('src/components/textwarp-editor/text-editor.css');
    const guiSource = readSource('src/components/gui/gui.jsx');
    const menuSource = readSource('src/components/menu-bar/menu-bar.jsx');
    const stageHeaderSource = readSource('src/components/stage-header/stage-header.jsx');
    const stageSelectorSource = readSource('src/components/stage-selector/stage-selector.jsx');

    assert.match(menuSource, /projectRunning \? 'textwarp-stop-project' : 'textwarp-run-project'/);
    assert.match(menuSource, /styles\.runProjectButton[\s\S]*?InterfaceIcon name="fullscreen"/);
    assert.match(menuSource, /layout-activity[\s\S]*?layout-primary[\s\S]*?layout-panel[\s\S]*?layout-secondary/);
    assert.match(menuSource, /aria-pressed=\{visible\}/);
    assert.match(editorSource, /textwarp-toggle-layout/);
    assert.match(editorSource, /area === 'left-sidebar'/);
    assert.match(editorSource, /area === 'bottom-panel'/);
    assert.match(editorSource, /textwarp-stop-project/);
    assert.doesNotMatch(editorSource, /className=\{styles\.collapsePanelButton\}/);
    assert.match(editorStyles, /\.bottom-panel-collapsed \{\s*display: none/);
    assert.match(guiSource, /activityBarVisible[\s\S]*?rightSidebarVisible/);
    assert.doesNotMatch(guiSource, /collapsedStageDock|messages\.hideStage|messages\.showStage/);
    assert.match(stageHeaderSource, /if \(!isFullScreen && !isEmbedded\) return null/);
    assert.doesNotMatch(stageHeaderSource, /stageViewSelector|messages\.stageView|stageSizeRow/);
    assert.match(stageSelectorSource, /styles\.stageMeta[\s\S]*?messages\.backdropCount/);
});

test('asset editors share compact sidebars and sound editing exposes timeline details', () => {
    const assetSource = readSource('src/components/asset-panel/selector.jsx');
    const assetStyles = readSource('src/components/asset-panel/selector.css');
    const soundSource = readSource('src/components/sound-editor/sound-editor.jsx');
    const soundStyles = readSource('src/components/sound-editor/sound-editor.css');

    assert.match(assetSource, /className=\{styles\.assetHeader\}[\s\S]*?<h2>\{title\}<\/h2>[\s\S]*?<ActionMenu/);
    assert.match(assetStyles, /width: clamp\(11\.25rem, 16vw, 18rem\)/);
    assert.match(assetStyles, /resize: horizontal/);
    assert.match(soundSource, /className=\{styles\.timelineRuler\}/);
    assert.match(soundSource, /<details className=\{styles\.effects\}>[\s\S]*?messages\.speed[\s\S]*?messages\.volume[\s\S]*?messages\.fade[\s\S]*?messages\.transform/);
    assert.match(soundSource, /props\.sampleRate[\s\S]*?styles\.selectionInfo/);
    assert.match(soundStyles, /@container \(max-width: 560px\)/);
});
