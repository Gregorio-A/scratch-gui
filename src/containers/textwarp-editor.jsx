import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VisualBlocks from './blocks.jsx';
import downloadBlob from '../lib/download-blob';
import {setProjectUnchanged} from '../reducers/project-changed';
import {setFileHandle, setTextwarpUiOperation, TEXTWARP_UI_COMMANDS} from '../reducers/tw';

import {compileText} from '../lib/textwarp/compiler';
import {ConversionWorkerClient} from '../lib/textwarp/conversion-worker-client';
import {getDebugController} from '../lib/textwarp/debug-controller';
import {inspectExpression} from '../lib/textwarp/debug-inspector';
import {decompileTarget} from '../lib/textwarp/decompiler';
import {createDiagnosticReport} from '../lib/textwarp/diagnostic-report';
import ActivityBar from '../components/textwarp-editor/activity-bar.jsx';
import DocumentationPane from '../components/textwarp-editor/documentation-pane.jsx';
import Backpack from './backpack.jsx';
import {buildExtensionInventory, summarizeExtensionCatalog} from '../lib/textwarp/extension-catalog';
import IdeSidebar from '../components/textwarp-editor/ide-sidebar.jsx';
import InterfaceIcon from '../components/textwarp-editor/interface-icon.jsx';
import QuickPanel from '../components/textwarp-editor/quick-panel.jsx';
import {
    DEFAULT_BOTTOM_PANEL_HEIGHT,
    DEFAULT_FONT_SIZE,
    DEFAULT_SIDEBAR_WIDTH,
    DEFAULT_SPLIT_RATIO,
    chooseSecondaryTargetId,
    clampBottomPanelHeight,
    clampFontSize,
    clampSidebarWidth,
    clampSplitRatio
} from '../lib/textwarp/ide-preferences';
import {
    DEFAULT_LIST_LIMIT,
    PANEL_IDS,
    VIEW_IDS,
    getLayoutMode,
    getNextTabId,
    getVisibleItems,
    normalizeUiState
} from '../lib/textwarp/interface-state';
import {createTranslator} from '../lib/textwarp/i18n';
import {sanitizeIdentifier} from '../lib/textwarp/identifier';
import {getDiagnosticSuggestion, getOutline} from '../lib/textwarp/language-service';
import MonacoEditor from '../components/textwarp-editor/monaco-editor.jsx';
import {mergeVisualSource} from '../lib/textwarp/source-merge';
import {exportTextwarpProject, importTextwarpProject} from '../lib/textwarp/textwarp-package';
import {
    clearTextwarpHandle,
    getTextwarpHandle,
    getTextwarpSuggestedName,
    setTextwarpHandle
} from '../lib/textwarp/textwarp-session';
import {
    notifyTextwarpFileOpened,
    showTextwarpOpenFilePicker,
    showTextwarpSaveFilePicker
} from '../lib/textwarp/platform';
import {
    adoptImportedRoots,
    applyCompilation,
    blockFingerprint,
    captureTargetSnapshot,
    markGeneratedRootsDirty,
    readSourceRecord,
    removeRoots,
    restoreTargetSnapshot,
    saveBreakpoints,
    saveTextSource
} from '../lib/textwarp/vm-adapter';
import {
    buildWorkspace,
    loadHistory,
    loadRecentTargets,
    rememberRecentTarget,
    replaceWorkspace,
    saveHistorySnapshot,
    searchWorkspace,
    synchronizeStableReferences,
    targetFileName
} from '../lib/textwarp/workspace-service';
import styles from '../components/textwarp-editor/text-editor.css';

const AUTO_COMPILE_DELAY = 300;
const ANALYSIS_DELAY = 120;
const HISTORY_DELAY = 1200;
const MAX_AUTO_SOURCE_LENGTH = 100000;
const MAX_AUTO_BLOCKS = 10000;
const emptyWorkspace = () => ({modules: [], resources: [], editableFiles: [], generatedFiles: []});
const DEFAULT_SHORTCUTS = Object.freeze({
    compile: 'F7',
    run: 'Ctrl+Enter',
    runSelection: 'Ctrl+Shift+Enter',
    stop: 'Shift+F5',
    restart: 'Ctrl+Shift+F5',
    format: 'Ctrl+Shift+I'
});
const SHORTCUT_MESSAGE_KEYS = Object.freeze({
    compile: 'shortcutCompile',
    format: 'shortcutFormat',
    restart: 'shortcutRestart',
    run: 'shortcutRun',
    runSelection: 'shortcutRunSelection',
    stop: 'shortcutStop'
});

const getTemplate = target => target && target.isStage ? `stage

global variable score = 0
global list messages = []

on green_flag:
    score = 0
    broadcast("start-game")

on receive("game-over"):
    stop_all()` : `actor ${target ? target.getName() : 'Actor'}

variable speed = 5
variable health = 100
list hits = []

procedure take_damage(amount):
    health -= amount
    list_add(hits, amount)

on green_flag:
    go_to(0, 0)
    forever:
        if key_pressed("right"):
            change_x(speed)
        if key_pressed("left"):
            change_x(-speed)
        wait(0)

on clone_started:
    show()`;

const countErrors = diagnostics => diagnostics.filter(item => item.severity === 'error').length;

const getConversionScope = (target, compilation) => {
    const record = readSourceRecord(target);
    const owned = new Set(record && record.generatedRootIds || []);
    const unownedRoots = Object.values(target.blocks && target.blocks._blocks || {})
        .filter(block => block.topLevel && !block.shadow && !owned.has(block.id))
        .map(block => block.id);
    if (!unownedRoots.length) return null;
    const newOpcodes = new Set(compilation.graph.units.map(unit => compilation.graph.blocks[unit.rootId].opcode));
    return {
        compilation,
        matchingRootIds: unownedRoots.filter(id => {
            const block = target.blocks.getBlock(id);
            return block && newOpcodes.has(block.opcode);
        }),
        unownedCount: unownedRoots.length
    };
};

class TextEditor extends React.Component {
    constructor (props) {
        super(props);
        const t = createTranslator(props.locale);
        this.state = {
            source: '',
            diagnostics: [],
            status: t('selectTarget'),
            announcement: t('selectTarget'),
            statusKind: 'idle',
            targetName: '',
            isStage: false,
            viewMode: 'code',
            secondaryTargetId: null,
            secondarySource: '',
            secondaryDiagnostics: [],
            sidebarVisible: true,
            sidebarPanel: 'explorer',
            settingsOpen: false,
            externalOpen: false,
            actionMenuOpen: false,
            convertMenuOpen: false,
            fileTabMenu: null,
            shortcuts: DEFAULT_SHORTCUTS,
            fontSize: DEFAULT_FONT_SIZE,
            compactUi: false,
            autoSync: true,
            sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
            bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
            splitRatio: DEFAULT_SPLIT_RATIO,
            activeBottomPanel: 'problems',
            bottomPanelCollapsed: false,
            layoutMode: 'wide',
            compactLayout: false,
            narrowLayout: false,
            workspace: emptyWorkspace(),
            openTargetIds: [],
            searchQuery: '',
            replaceValue: '',
            docsQuery: '',
            searchResults: [],
            history: [],
            lastConversion: null,
            saveState: 'salvo',
            blockRefresh: 0,
            breakpoints: [],
            debugSnapshot: {
                enabled: false, threads: [], activeLinesByTarget: {}, runtimeErrors: [], consoleEntries: [], executionState: 'stopped'
            },
            watches: [],
            watchInput: '',
            selectedThreadId: null,
            extensionSummary: {extensionCount: 0, blockCount: 0, extensions: []},
            extensionPalette: [],
            visualConflict: null,
            conflictReviewOpen: false,
            conversionScopePrompt: null,
            blocksDiverged: false,
            busy: false,
            externalHandle: null,
            externalName: '',
            externalLastModified: 0,
            externalSyncState: 'disconnected',
            monacoError: '',
            debugLimit: DEFAULT_LIST_LIMIT,
            diagnosticLimit: DEFAULT_LIST_LIMIT,
            consoleLimit: DEFAULT_LIST_LIMIT,
            extensionLimit: DEFAULT_LIST_LIMIT,
            cursorPosition: {line: 1, column: 1},
            draggedTargetId: null
        };
        this.compileTimer = null;
        this.analysisTimer = null;
        this.debugController = null;
        this.unsubscribeDebugger = null;
        this.extensionCatalog = {};
        this.conversionWorker = new ConversionWorkerClient();
        this.conversionGeneration = 0;
        this.secondaryConversionGeneration = 0;
        this.blockConversionGeneration = 0;
        this.languageContextCache = null;
        this.lastAppliedSource = '';
        this.lastBlockFingerprint = '';
        this.blockSyncTimer = null;
        this.historyTimer = null;
        this.secondaryCompileTimer = null;
        this.secondaryAnalysisTimer = null;
        this.suppressBlockSyncUntil = 0;
        this.monacoEditor = null;
        this.secondaryMonacoEditor = null;
        this.pendingLocation = null;
        this.pendingCompilation = null;
        this.pendingVisualResult = null;
        this.rootElement = null;
        this.editorAreaElement = null;
        this.resizeObserver = null;
        this.resizeSession = null;
        this.externalInput = null;
        this.handleProjectLoaded = () => {
            clearTextwarpHandle(`${this.props.projectTitle || 'project'}.textwarp`);
            setTimeout(() => {
                if (this._isMounted) this.loadSelectedTarget();
            }, 0);
        };
        this.packageInput = null;
        this.openTabsElement = null;
        this.actionMenuElement = null;
        this.actionMenuButton = null;
        this.convertMenuElement = null;
        this.convertMenuButton = null;
        this.fileCommandReturnFocus = null;
        this.handleChange = this.handleChange.bind(this);
        this.handleCompile = this.handleCompile.bind(this);
        this.handleRun = this.handleRun.bind(this);
        this.handleRunSelection = this.handleRunSelection.bind(this);
        this.handleStop = this.handleStop.bind(this);
        this.handleRestart = this.handleRestart.bind(this);
        this.handleImportBlocks = this.handleImportBlocks.bind(this);
        this.handleImportProjectBlocks = this.handleImportProjectBlocks.bind(this);
        this.handlePackageFile = this.handlePackageFile.bind(this);
        this.handleTextwarpUiCommand = this.handleTextwarpUiCommand.bind(this);
        this.openTextwarp = this.openTextwarp.bind(this);
        this.handleToggleBreakpoint = this.handleToggleBreakpoint.bind(this);
        this.handleBreakpointsChange = this.handleBreakpointsChange.bind(this);
        this.handleSecondaryBreakpointsChange = this.handleSecondaryBreakpointsChange.bind(this);
        this.handleInvalidShortcut = this.handleInvalidShortcut.bind(this);
        this.handleWorkspaceModelChange = this.handleWorkspaceModelChange.bind(this);
        this.handleExtensionsChanged = this.handleExtensionsChanged.bind(this);
        this.handleInsertExtensionXml = this.handleInsertExtensionXml.bind(this);
        this.handleProjectChanged = this.handleProjectChanged.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.handleActionMenuKeyDown = this.handleActionMenuKeyDown.bind(this);
        this.handleMobileCommands = this.handleMobileCommands.bind(this);
        this.handleOpenExternalPanel = this.handleOpenExternalPanel.bind(this);
        this.handleOpenSettingsPanel = this.handleOpenSettingsPanel.bind(this);
        this.handleCompactUiChange = this.handleCompactUiChange.bind(this);
        this.handleToggleActionMenu = this.handleToggleActionMenu.bind(this);
        this.handleWindowResize = this.handleWindowResize.bind(this);
        this.handlePointerMove = this.handlePointerMove.bind(this);
        this.handlePointerUp = this.handlePointerUp.bind(this);
        this.handleSearch = this.handleSearch.bind(this);
        this.handleReplaceAll = this.handleReplaceAll.bind(this);
        this.openTarget = this.openTarget.bind(this);
        this.openLocation = this.openLocation.bind(this);
        this.openResource = this.openResource.bind(this);
        this.setSecondaryTarget = this.setSecondaryTarget.bind(this);
        this.handleNavigateResource = this.openResource;
        this.handleOpenModel = this.openTarget;
        this.handleSecondaryOpenModel = this.setSecondaryTarget;
        this.insertResource = this.insertResource.bind(this);
        this.restoreHistory = this.restoreHistory.bind(this);
        this.undoLastConversion = this.undoLastConversion.bind(this);
        this.handleExternalFile = this.handleExternalFile.bind(this);
        this.closeSidebar = this.closeSidebar.bind(this);
        this.openSidebar = this.openSidebar.bind(this);
        this.handleResizeKeyDown = this.handleResizeKeyDown.bind(this);
        this.openBottomPanel = this.openBottomPanel.bind(this);
        this.resetLayout = this.resetLayout.bind(this);
        this.handleCopyDiagnosticReport = this.handleCopyDiagnosticReport.bind(this);
        this.handleDownloadDiagnosticReport = this.handleDownloadDiagnosticReport.bind(this);
        this.handleMonacoLoadError = this.handleMonacoLoadError.bind(this);
        this.handleProjectRunStop = this.handleProjectRunStop.bind(this);
    }

    componentDidMount () {
        this._isMounted = true;
        const storage = this.getStorage();
        try {
            const savedShortcuts = storage && JSON.parse(storage.getItem('textwarp.ide.shortcuts'));
            if (savedShortcuts) this.setState({shortcuts: Object.assign({}, DEFAULT_SHORTCUTS, savedShortcuts)});
            const savedPreferences = storage && JSON.parse(storage.getItem('textwarp.ide.preferences'));
            if (savedPreferences) {
                this.setState({
                    autoSync: savedPreferences.autoSync !== false,
                    bottomPanelHeight: clampBottomPanelHeight(savedPreferences.bottomPanelHeight),
                    compactUi: savedPreferences.compactUi === true,
                    fontSize: clampFontSize(savedPreferences.fontSize),
                    sidebarWidth: clampSidebarWidth(savedPreferences.sidebarWidth),
                    splitRatio: clampSplitRatio(savedPreferences.splitRatio)
                });
                this.applyCompactUiClass(savedPreferences.compactUi === true);
            }
            const savedUiState = storage && JSON.parse(storage.getItem('textwarp.ide.ui-state'));
            if (savedUiState) {
                const restoredUiState = normalizeUiState(savedUiState);
                this.setState(restoredUiState);
            }
        } catch (error) {
            // Invalid local preferences are ignored and defaults remain active.
        }
        if (typeof ResizeObserver !== 'undefined' && this.rootElement) {
            this.resizeObserver = new ResizeObserver(entries => {
                const width = entries[0] && entries[0].contentRect.width;
                this.updateResponsiveLayout(width);
            });
            this.resizeObserver.observe(this.rootElement);
        } else if (this.rootElement) {
            this.updateResponsiveLayout(this.rootElement.getBoundingClientRect().width);
            window.addEventListener('resize', this.handleWindowResize);
        }
        this.refreshExtensionCatalog();
        this.debugController = getDebugController(this.props.vm);
        this.unsubscribeDebugger = this.debugController.subscribe(debugSnapshot => this.setState({debugSnapshot}));
        this.syncAllBreakpoints();
        if (this.props.vm.runtime && typeof this.props.vm.runtime.on === 'function') {
            this.props.vm.runtime.on('EXTENSION_ADDED', this.handleExtensionsChanged);
            this.props.vm.runtime.on('BLOCKSINFO_UPDATE', this.handleExtensionsChanged);
            this.props.vm.runtime.on('PROJECT_LOADED', this.handleProjectLoaded);
        }
        if (typeof this.props.vm.on === 'function') {
            this.props.vm.on('PROJECT_CHANGED', this.handleProjectChanged);
            this.props.vm.on('PROJECT_RUN_STOP', this.handleProjectRunStop);
        }
        document.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
        window.addEventListener('pointermove', this.handlePointerMove);
        window.addEventListener('pointerup', this.handlePointerUp);
        this.loadSelectedTarget();
    }

    componentDidUpdate (previousProps, previousState) {
        if (
            previousProps.editingTargetId !== this.props.editingTargetId ||
            previousProps.editingTargetName !== this.props.editingTargetName
        ) this.loadSelectedTarget();
        if (previousProps.textwarpUiCommand.id !== this.props.textwarpUiCommand.id) {
            this.handleTextwarpUiCommand(this.props.textwarpUiCommand.name);
        }
        if (previousProps.editingTargetId !== this.props.editingTargetId && this.openTabsElement) {
            const activeTab = this.openTabsElement.querySelector('[aria-selected="true"]');
            if (activeTab && typeof activeTab.scrollIntoView === 'function') {
                activeTab.scrollIntoView({behavior: 'smooth', block: 'nearest', inline: 'nearest'});
            }
        }
        if (
            previousState.status !== this.state.status &&
            this.state.announcement !== this.state.status
        ) this.setState({announcement: this.state.status});
    }

    componentWillUnmount () {
        this._isMounted = false;
        this.conversionGeneration++;
        this.secondaryConversionGeneration++;
        this.blockConversionGeneration++;
        clearTimeout(this.compileTimer);
        clearTimeout(this.analysisTimer);
        clearTimeout(this.blockSyncTimer);
        clearTimeout(this.historyTimer);
        clearTimeout(this.secondaryCompileTimer);
        clearTimeout(this.secondaryAnalysisTimer);
        if (this.resizeObserver) this.resizeObserver.disconnect();
        window.removeEventListener('resize', this.handleWindowResize);
        window.removeEventListener('pointermove', this.handlePointerMove);
        window.removeEventListener('pointerup', this.handlePointerUp);
        if (this.unsubscribeDebugger) this.unsubscribeDebugger();
        this.conversionWorker.cancelPending();
        if (this.debugController) this.debugController.setEnabled(false);
        if (this.props.vm.runtime && typeof this.props.vm.runtime.removeListener === 'function') {
            this.props.vm.runtime.removeListener('EXTENSION_ADDED', this.handleExtensionsChanged);
            this.props.vm.runtime.removeListener('BLOCKSINFO_UPDATE', this.handleExtensionsChanged);
            this.props.vm.runtime.removeListener('PROJECT_LOADED', this.handleProjectLoaded);
        }
        if (typeof this.props.vm.removeListener === 'function') {
            this.props.vm.removeListener('PROJECT_CHANGED', this.handleProjectChanged);
            this.props.vm.removeListener('PROJECT_RUN_STOP', this.handleProjectRunStop);
        }
        document.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
    }

    getTarget () {
        if (!this.props.vm || !this.props.vm.runtime) return null;
        return this.props.vm.runtime.getTargetById(this.props.editingTargetId) || this.props.vm.editingTarget;
    }

    getStage () {
        return this.props.vm.runtime.getTargetForStage ? this.props.vm.runtime.getTargetForStage() :
            this.props.vm.runtime.targets.find(target => target.isStage);
    }

    getProjectStorageId () {
        const stage = this.getStage();
        return `${this.props.projectTitle || 'project'}:${stage && stage.id || 'stage'}`;
    }

    getStorage () {
        try {
            return typeof window !== 'undefined' ? window.localStorage : null;
        } catch (error) {
            return null;
        }
    }

    applyCompactUiClass (compactUi) {
        if (typeof document === 'undefined') return;
        document.documentElement.classList.toggle('textwarp-compact-ui', Boolean(compactUi));
    }

    t (key, values) {
        return createTranslator(this.props.locale)(key, values);
    }

    getDiagnosticReport () {
        const target = this.getTarget();
        const stage = this.getStage();
        let conversion = null;
        if (target) {
            try {
                const result = decompileTarget(target, {extensionCatalog: this.extensionCatalog});
                conversion = {
                    success: result.success,
                    importedRootCount: result.importedRootIds.length,
                    unsupportedRootCount: result.unsupportedRootIds.length,
                    unsupportedOpcodes: result.unsupportedOpcodes
                };
            } catch (error) {
                conversion = {
                    success: false,
                    importedRootCount: 0,
                    unsupportedRootCount: 0,
                    unsupportedOpcodes: [`diagnostic-report: ${error.message}`]
                };
            }
        }
        const variables = [];
        const appendVariables = (owner, ownerName) => Object.values(
            owner && owner.variables ? owner.variables : {}
        ).forEach(variable => {
            if (variable.type === 'broadcast_msg') {
                return;
            }
            variables.push({
                id: variable.id,
                name: variable.name,
                owner: ownerName,
                type: variable.type
            });
        });
        appendVariables(target, target && target.isStage ? 'stage' : 'target');
        if (stage && stage !== target) {
            appendVariables(stage, 'stage');
        }
        const snapshot = this.state.debugSnapshot;
        return createDiagnosticReport({
            blockCount: target && target.blocks && target.blocks._blocks ?
                Object.keys(target.blocks._blocks).length : 0,
            consoleEntries: snapshot.consoleEntries,
            conversion,
            diagnostics: this.state.diagnostics,
            extensions: this.state.extensionSummary.extensions,
            generatedAt: new Date().toISOString(),
            isStage: Boolean(target && target.isStage),
            languageVersion: '0.3',
            locale: this.props.locale,
            monacoError: this.state.monacoError,
            projectTitle: this.props.projectTitle,
            runtimeErrors: snapshot.runtimeErrors,
            source: this.state.source,
            status: this.state.status,
            targetCount: this.props.vm.runtime && this.props.vm.runtime.targets ?
                this.props.vm.runtime.targets.length : 0,
            targetId: target && target.id,
            targetName: target && target.getName ? target.getName() : '',
            userAgent: typeof navigator === 'object' ? navigator.userAgent : '',
            variables
        });
    }

    async handleCopyDiagnosticReport () {
        const report = this.getDiagnosticReport();
        let input = null;
        try {
            if (typeof navigator === 'object' && navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(report);
            } else {
                input = document.createElement('textarea');
                input.value = report;
                input.style.position = 'fixed';
                input.style.opacity = '0';
                document.body.appendChild(input);
                input.select();
                if (!document.execCommand('copy')) {
                    throw new Error('Clipboard command was rejected.');
                }
            }
            this.setState({status: this.t('diagnosticReportCopied'), statusKind: 'success'});
        } catch (error) {
            this.setState({status: this.t('diagnosticReportFailed'), statusKind: 'error'});
        } finally {
            if (input) {
                input.remove();
            }
        }
    }

    handleDownloadDiagnosticReport () {
        try {
            const target = this.getTarget();
            const targetName = sanitizeIdentifier(
                target && target.getName ? target.getName() : 'project',
                'project'
            );
            downloadBlob(
                `textwarp-diagnostic-${targetName}.txt`,
                new Blob([this.getDiagnosticReport()], {type: 'text/plain;charset=utf-8'})
            );
            this.setState({status: this.t('diagnosticReportDownloaded'), statusKind: 'success'});
        } catch (error) {
            this.setState({status: this.t('diagnosticReportFailed'), statusKind: 'error'});
        }
    }

    handleMonacoLoadError (monacoError) {
        this.setState({monacoError: monacoError || ''});
    }

    updateResponsiveLayout (width) {
        const viewportWidth = typeof window === 'undefined' ? Number(width) : window.innerWidth;
        const layoutMode = getLayoutMode(width, viewportWidth);
        const compactLayout = ['compact', 'narrow'].includes(layoutMode);
        const narrowLayout = layoutMode === 'narrow';
        const responsiveState = {compactLayout, layoutMode, narrowLayout};
        if (narrowLayout && !this.state.narrowLayout) {
            Object.assign(responsiveState, {
                actionMenuOpen: false,
                bottomPanelCollapsed: true,
                sidebarVisible: false
            });
        }
        if (
            layoutMode !== this.state.layoutMode ||
            compactLayout !== this.state.compactLayout ||
            narrowLayout !== this.state.narrowLayout
        ) this.setState(responsiveState);
    }

    handleWindowResize () {
        if (this.rootElement) this.updateResponsiveLayout(this.rootElement.getBoundingClientRect().width);
    }

    persistPreferences (next = {}) {
        const preferences = {
            autoSync: typeof next.autoSync === 'undefined' ? this.state.autoSync : next.autoSync,
            bottomPanelHeight: next.bottomPanelHeight === undefined ?
                this.state.bottomPanelHeight : next.bottomPanelHeight,
            compactUi: typeof next.compactUi === 'undefined' ? this.state.compactUi : next.compactUi,
            fontSize: next.fontSize === undefined ? this.state.fontSize : next.fontSize,
            sidebarWidth: next.sidebarWidth === undefined ? this.state.sidebarWidth : next.sidebarWidth,
            splitRatio: next.splitRatio === undefined ? this.state.splitRatio : next.splitRatio
        };
        const storage = this.getStorage();
        try {
            if (storage) storage.setItem('textwarp.ide.preferences', JSON.stringify(preferences));
        } catch (error) {
            // Preferences remain active for this session when storage is unavailable.
        }
    }

    persistUiState (next = {}) {
        const uiState = {
            activeBottomPanel: next.activeBottomPanel === undefined ?
                this.state.activeBottomPanel : next.activeBottomPanel,
            bottomPanelCollapsed: next.bottomPanelCollapsed === undefined ?
                this.state.bottomPanelCollapsed : next.bottomPanelCollapsed,
            sidebarPanel: next.sidebarPanel === undefined ? this.state.sidebarPanel : next.sidebarPanel,
            sidebarVisible: next.sidebarVisible === undefined ? this.state.sidebarVisible : next.sidebarVisible,
            viewMode: next.viewMode === undefined ? this.state.viewMode : next.viewMode
        };
        const storage = this.getStorage();
        try {
            if (storage) storage.setItem('textwarp.ide.ui-state', JSON.stringify(uiState));
        } catch (error) {
            // Safe interface state remains active for this session when storage is unavailable.
        }
    }

    resetLayout () {
        const layout = {
            bottomPanelCollapsed: this.state.narrowLayout,
            bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
            compactUi: false,
            fontSize: DEFAULT_FONT_SIZE,
            sidebarVisible: !this.state.narrowLayout,
            sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
            splitRatio: DEFAULT_SPLIT_RATIO
        };
        this.setState(Object.assign({status: this.t('layoutReset'), statusKind: 'success'}, layout));
        this.applyCompactUiClass(false);
        this.persistPreferences(layout);
        this.persistUiState(Object.assign({}, layout, {
            bottomPanelCollapsed: false,
            sidebarVisible: true
        }));
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
    }

    setFontSize (value) {
        const fontSize = clampFontSize(value);
        this.setState({fontSize});
        this.persistPreferences({fontSize});
    }

    setCompactUi (compactUi) {
        this.setState({compactUi});
        this.applyCompactUiClass(compactUi);
        this.persistPreferences({compactUi});
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
    }

    startResize (kind, event) {
        if (event.button !== undefined && event.button !== 0) return;
        event.preventDefault();
        this.resizeSession = {kind};
        document.body.classList.add('textwarp-resizing');
    }

    handlePointerMove (event) {
        if (!this.resizeSession || !this.rootElement) return;
        const rootBounds = this.rootElement.getBoundingClientRect();
        if (this.resizeSession.kind === 'sidebar') {
            this.setState({sidebarWidth: clampSidebarWidth(event.clientX - rootBounds.left)});
            return;
        }
        if (this.resizeSession.kind === 'bottom') {
            this.setState({
                bottomPanelCollapsed: false,
                bottomPanelHeight: clampBottomPanelHeight(rootBounds.bottom - event.clientY)
            });
            return;
        }
        if (this.resizeSession.kind === 'split' && this.editorAreaElement) {
            const editorBounds = this.editorAreaElement.getBoundingClientRect();
            const ratio = this.state.narrowLayout ?
                ((event.clientY - editorBounds.top) / editorBounds.height) * 100 :
                ((event.clientX - editorBounds.left) / editorBounds.width) * 100;
            this.setState({splitRatio: clampSplitRatio(ratio)});
        }
    }

    handlePointerUp () {
        if (!this.resizeSession) return;
        this.resizeSession = null;
        document.body.classList.remove('textwarp-resizing');
        this.persistPreferences();
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
    }

    handleResizeKeyDown (kind, event) {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home') {
            if (kind === 'sidebar') {
                this.setState({sidebarWidth: DEFAULT_SIDEBAR_WIDTH});
                this.persistPreferences({sidebarWidth: DEFAULT_SIDEBAR_WIDTH});
            } else if (kind === 'bottom') {
                this.setState({
                    bottomPanelCollapsed: false,
                    bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT
                });
                this.persistPreferences({bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT});
            } else {
                this.setState({splitRatio: DEFAULT_SPLIT_RATIO});
                this.persistPreferences({splitRatio: DEFAULT_SPLIT_RATIO});
            }
            return;
        }
        const step = event.shiftKey ? 25 : 10;
        if (kind === 'sidebar') {
            const direction = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
            const sidebarWidth = clampSidebarWidth(this.state.sidebarWidth + direction);
            this.setState({sidebarWidth});
            this.persistPreferences({sidebarWidth});
        } else if (kind === 'bottom') {
            const direction = event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0;
            const bottomPanelHeight = clampBottomPanelHeight(this.state.bottomPanelHeight + direction);
            this.setState({bottomPanelCollapsed: false, bottomPanelHeight});
            this.persistPreferences({bottomPanelHeight});
        } else {
            const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -2 : 2;
            const splitRatio = clampSplitRatio(this.state.splitRatio + direction);
            this.setState({splitRatio});
            this.persistPreferences({splitRatio});
        }
    }

    closeSidebar () {
        const returnFocus = this.rootElement && this.rootElement.querySelector(
            '[aria-controls="textwarp-ide-sidebar"][aria-expanded="true"]'
        );
        this.setState({sidebarVisible: false}, () => {
            if (returnFocus) returnFocus.focus();
        });
        this.persistUiState({sidebarVisible: false});
    }

    openSidebar (sidebarPanel) {
        const next = {
            sidebarPanel,
            sidebarVisible: true,
            viewMode: this.state.viewMode === 'docs' ? 'code' : this.state.viewMode
        };
        this.setState(next, () => {
            if (!this.state.narrowLayout || !this.rootElement) return;
            const sidebar = this.rootElement.querySelector('#textwarp-ide-sidebar');
            const firstFocusable = sidebar && sidebar.querySelector(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
                'a[href], [tabindex]:not([tabindex="-1"])'
            );
            if (firstFocusable) firstFocusable.focus();
        });
        this.persistUiState(next);
    }

    openBottomPanel (activeBottomPanel) {
        if (!PANEL_IDS.includes(activeBottomPanel)) return;
        if (activeBottomPanel === 'debugger' && this.debugController) this.debugController.setEnabled(true);
        const panelState = {
            activeBottomPanel,
            bottomPanelCollapsed: false
        };
        this.setState(panelState);
        this.persistUiState(panelState);
    }

    handleToggleActionMenu () {
        this.setState(state => {
            const actionMenuOpen = !state.actionMenuOpen;
            return Object.assign(
                {actionMenuOpen},
                actionMenuOpen ? {
                    convertMenuOpen: false,
                    externalOpen: false,
                    fileTabMenu: null,
                    settingsOpen: false
                } : {}
            );
        }, () => {
            if (!this.state.actionMenuOpen || !this.actionMenuElement) return;
            const firstItem = Array.from(this.actionMenuElement.querySelectorAll('[role="menuitem"]'))
                .find(element => element.getClientRects().length);
            if (firstItem) firstItem.focus();
        });
    }

    closeActionMenu (returnFocus = false) {
        this.setState({actionMenuOpen: false}, () => {
            if (returnFocus && this.actionMenuButton) this.actionMenuButton.focus();
        });
    }

    handleToggleConvertMenu () {
        this.setState(state => ({
            actionMenuOpen: false,
            convertMenuOpen: !state.convertMenuOpen,
            fileTabMenu: null
        }), () => {
            if (!this.state.convertMenuOpen || !this.convertMenuElement) return;
            const firstItem = Array.from(this.convertMenuElement.querySelectorAll('[role="menuitem"]'))
                .find(element => element.getClientRects().length);
            if (firstItem) firstItem.focus();
        });
    }

    closeConvertMenu (returnFocus = false) {
        this.setState({convertMenuOpen: false}, () => {
            if (returnFocus && this.convertMenuButton) this.convertMenuButton.focus();
        });
    }

    setAutoSync (autoSync) {
        this.setState({autoSync, convertMenuOpen: false});
        this.persistPreferences({autoSync});
    }

    async compareTextAndBlocks () {
        this.setState({convertMenuOpen: false});
        const target = this.getTarget();
        if (!target) return;
        const generation = ++this.conversionGeneration;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        const source = this.state.source;
        const fingerprint = blockFingerprint(target);
        this.setState({status: this.t('analyzing'), statusKind: 'working'});
        let result;
        let textCompilation;
        let visualCompilation;
        try {
            result = await this.conversionWorker.decompile(target, {
                extensionCatalog: this.extensionCatalog,
                stageTarget: this.getStage()
            });
            const compileOptions = this.getCompileOptions(target);
            [textCompilation, visualCompilation] = await Promise.all([
                this.conversionWorker.compile(source, compileOptions),
                this.conversionWorker.compile(result.source, compileOptions)
            ]);
        } catch (error) {
            if (generation === this.conversionGeneration) {
                this.setState({status: error.message, statusKind: 'error'});
            }
            return;
        }
        if (
            generation !== this.conversionGeneration ||
            !this._isMounted ||
            target !== this.getTarget() ||
            source !== this.state.source ||
            fingerprint !== blockFingerprint(target)
        ) return;
        const textUnits = new Map((textCompilation.graph && textCompilation.graph.units || [])
            .map(unit => [unit.unitId, unit.hash]));
        const visualUnits = new Map((visualCompilation.graph && visualCompilation.graph.units || [])
            .map(unit => [unit.unitId, unit.hash]));
        const added = Array.from(visualUnits.keys()).filter(id => !textUnits.has(id));
        const removed = Array.from(textUnits.keys()).filter(id => !visualUnits.has(id));
        const changed = Array.from(textUnits.keys()).filter(id =>
            visualUnits.has(id) && visualUnits.get(id) !== textUnits.get(id)
        );
        result.canonicalSource = result.source;
        result.visualCompilation = visualCompilation;
        result.semanticDiff = {added, removed, changed};
        this.setViewMode('split');
        if (
            textCompilation.success &&
            visualCompilation.success &&
            added.length === 0 &&
            removed.length === 0 &&
            changed.length === 0 &&
            result.unsupportedOpcodes.length === 0
        ) {
            this.setState({status: this.t('versionsSynchronized'), statusKind: 'success', blocksDiverged: false});
        } else {
            this.setState({
                visualConflict: result,
                conflictReviewOpen: true,
                blocksDiverged: true,
                status: this.t('semanticConflict', {count: added.length + removed.length + changed.length}),
                statusKind: 'working'
            });
        }
    }

    captureConversionSnapshot (direction, selectedTarget = null, selectedSource = null) {
        const target = selectedTarget || this.getTarget();
        if (!target) return null;
        const source = selectedSource === null ? this.state.source : selectedSource;
        const timestamp = Date.now();
        const history = saveHistorySnapshot(
            this.getStorage(),
            this.getProjectStorageId(),
            target.id,
            source,
            this.t('historyConversionSnapshot'),
            timestamp
        );
        const snapshot = {
            direction,
            fileName: targetFileName(target),
            source,
            targetId: target.id,
            timestamp,
            projectSnapshot: captureTargetSnapshot(this.props.vm, target)
        };
        this.setState({history});
        return snapshot;
    }

    undoLastConversion () {
        const snapshot = this.state.lastConversion;
        if (snapshot && Array.isArray(snapshot.projectSnapshots)) {
            const currentTarget = this.getTarget();
            try {
                this.suppressBlockSyncUntil = Date.now() + 1500;
                snapshot.projectSnapshots.slice().reverse().forEach(entry => {
                    const target = this.props.vm.runtime.getTargetById(entry.targetId);
                    if (target) restoreTargetSnapshot(this.props.vm, target, entry.projectSnapshot);
                });
            } catch (error) {
                this.setState({status: error.message, statusKind: 'error'});
                return;
            }
            const record = currentTarget && readSourceRecord(currentTarget);
            const currentEntry = currentTarget && snapshot.projectSnapshots.find(entry =>
                entry.targetId === currentTarget.id
            );
            const source = record ? record.source : currentEntry ? currentEntry.source : this.state.source;
            const compilation = currentTarget && source.length <= MAX_AUTO_SOURCE_LENGTH ?
                compileText(source, this.getCompileOptions(currentTarget)) : {diagnostics: []};
            this.lastAppliedSource = record ? source : '';
            this.lastBlockFingerprint = blockFingerprint(currentTarget);
            this.setState({
                source,
                diagnostics: compilation.diagnostics,
                status: this.t('conversionUndone'),
                statusKind: 'success',
                lastConversion: null,
                visualConflict: null,
                blocksDiverged: false,
                blockRefresh: this.state.blockRefresh + 1
            }, () => this.refreshWorkspace());
            return;
        }
        const target = snapshot && this.props.vm.runtime.getTargetById(snapshot.targetId);
        if (!snapshot || !target) return;
        restoreTargetSnapshot(this.props.vm, target, snapshot.projectSnapshot);
        const record = readSourceRecord(target);
        const source = record ? record.source : snapshot.source;
        const compilation = source.length > MAX_AUTO_SOURCE_LENGTH ?
            {success: false, diagnostics: []} : compileText(source, this.getCompileOptions(target));
        this.lastAppliedSource = record ? source : '';
        this.lastBlockFingerprint = blockFingerprint(target);
        this.setState({
            source,
            diagnostics: compilation.diagnostics,
            status: this.t('conversionUndone'),
            statusKind: 'success',
            lastConversion: null,
            visualConflict: null,
            blocksDiverged: false,
            blockRefresh: this.state.blockRefresh + 1
        });
    }

    openActionPanel (panel) {
        this.setState({actionMenuOpen: false}, () => {
            if (this.actionMenuButton) this.actionMenuButton.focus();
            this.setState({
                externalOpen: panel === 'external',
                settingsOpen: panel === 'settings'
            });
        });
    }

    handleMobileCommands () {
        this.closeActionMenu();
        if (this.monacoEditor) this.monacoEditor.openCommandPalette();
    }

    handleOpenExternalPanel () {
        this.openActionPanel('external');
    }

    handleOpenSettingsPanel () {
        this.openActionPanel('settings');
    }

    handleCompactUiChange (event) {
        this.setCompactUi(event.target.checked);
    }

    handleDocumentPointerDown (event) {
        if (
            this.state.actionMenuOpen &&
            this.actionMenuElement &&
            !this.actionMenuElement.contains(event.target)
        ) this.closeActionMenu();
        if (
            this.state.convertMenuOpen &&
            this.convertMenuElement &&
            !this.convertMenuElement.contains(event.target)
        ) this.closeConvertMenu();
        if (this.state.fileTabMenu && !event.target.closest('[data-textwarp-tab-menu]')) {
            this.setState({fileTabMenu: null});
        }
    }

    handleActionMenuKeyDown (event) {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = Array.from(event.currentTarget.querySelectorAll('[role="menuitem"]'))
            .filter(element => element.getClientRects().length);
        if (!items.length) return;
        event.preventDefault();
        const currentIndex = Math.max(0, items.indexOf(document.activeElement));
        const nextIndex = event.key === 'Home' ? 0 :
            event.key === 'End' ? items.length - 1 :
                event.key === 'ArrowDown' ? (currentIndex + 1) % items.length :
                    (currentIndex - 1 + items.length) % items.length;
        items[nextIndex].focus();
    }

    handleTabKeyDown (event, ids, currentId, onSelect) {
        const nextId = getNextTabId(ids, currentId, event.key);
        if (nextId === currentId) return;
        event.preventDefault();
        onSelect(nextId);
        const list = event.currentTarget.parentElement;
        const nextTab = list && list.querySelector(`[data-tab-id="${nextId}"]`);
        if (nextTab) nextTab.focus();
    }

    updateShortcut (name, value) {
        const shortcuts = Object.assign({}, this.state.shortcuts, {[name]: value});
        this.setState({shortcuts});
        const storage = this.getStorage();
        try {
            if (storage) storage.setItem('textwarp.ide.shortcuts', JSON.stringify(shortcuts));
        } catch (error) {
            this.setState({
                status: this.t('shortcutStorageUnavailable'),
                statusKind: 'working'
            });
        }
    }

    refreshWorkspace (callback, preparedWorkspace = null) {
        const workspace = preparedWorkspace || buildWorkspace(this.props.vm);
        const activeModule = workspace.modules.find(module => module.id === this.props.editingTargetId);
        if (activeModule) activeModule.source = this.state.source;
        const searchResults = searchWorkspace(workspace, this.state.searchQuery);
        this.setState({workspace, searchResults}, callback);
        return workspace;
    }

    getLanguageContext (target = this.getTarget(), activeSource = this.state.source) {
        const workspace = this.state.workspace.modules.length ? this.state.workspace : buildWorkspace(this.props.vm);
        const targetId = target && target.id;
        if (
            this.languageContextCache && this.languageContextCache.workspace === workspace &&
            this.languageContextCache.source === activeSource &&
            this.languageContextCache.extensionCatalog === this.extensionCatalog &&
            this.languageContextCache.targetId === targetId
        ) return this.languageContextCache.value;
        const value = {
            extensionCatalog: this.extensionCatalog,
            resources: workspace.resources,
            documents: workspace.modules.map(module => ({
                fileName: module.fileName,
                modelKey: module.id,
                targetId: module.id,
                source: module.id === targetId ? activeSource : module.source
            })),
            workspaceId: this.getProjectStorageId(),
            targetId,
            targetName: target && target.getName ? target.getName() : '',
            isStage: Boolean(target && target.isStage)
        };
        this.languageContextCache = {
            workspace,
            source: activeSource,
            extensionCatalog: this.extensionCatalog,
            targetId,
            value
        };
        return value;
    }

    getVariableOptions (target, stored) {
        const result = [];
        const generated = new Set((stored && stored.generatedVariables || []).map(item => item.id));
        const append = (owner, ownerName) => Object.values(owner && owner.variables || {}).forEach(variable => {
            if (variable.type === 'broadcast_msg') return;
            result.push({
                id: variable.id,
                name: variable.name,
                variableType: variable.type,
                owner: ownerName,
                generated: generated.has(variable.id),
                isCloud: Boolean(variable.isCloud)
            });
        });
        append(target, 'target');
        const stage = this.getStage();
        if (stage && stage !== target) append(stage, 'stage');
        return result;
    }

    getCompileOptions (target, preparedWorkspace = null) {
        const stored = readSourceRecord(target);
        const stage = this.getStage();
        const stageRecord = stage && readSourceRecord(stage);
        const generatedStageVariables = new Set((this.props.vm.runtime.targets || []).flatMap(runtimeTarget => {
            const runtimeRecord = readSourceRecord(runtimeTarget);
            return runtimeRecord ? runtimeRecord.generatedVariables : [];
        }).map(item => item.id));
        return {
            targetId: stored && stored.moduleId ? stored.moduleId : target.id,
            stageId: stageRecord && stageRecord.moduleId ? stageRecord.moduleId : stage && stage.id,
            targetName: target.getName(),
            isStage: target.isStage,
            variables: this.getVariableOptions(target, stored),
            broadcasts: Object.values(stage && stage.variables || {}).filter(variable => variable.type === 'broadcast_msg').map(variable => ({
                id: variable.id,
                name: variable.name,
                generated: generatedStageVariables.has(variable.id)
            })),
            previousUnits: stored && stored.units || [],
            resources: preparedWorkspace && preparedWorkspace.resources ||
                this.state.workspace && this.state.workspace.resources ||
                buildWorkspace(this.props.vm).resources,
            extensionCatalog: this.extensionCatalog,
            availableOpcodes: Object.keys(this.props.vm.runtime._primitives || {})
        };
    }

    refreshExtensionCatalog () {
        const inventory = buildExtensionInventory(this.props.vm);
        this.extensionCatalog = inventory.catalog;
        if (typeof window !== 'undefined') window.__textwarpExtensionCatalog = this.extensionCatalog;
        const extensionSummary = summarizeExtensionCatalog(this.extensionCatalog);
        if (this._isMounted !== false) this.setState({extensionSummary, extensionPalette: inventory.palette});
        return extensionSummary;
    }

    handleExtensionsChanged () {
        this.refreshExtensionCatalog();
        const target = this.getTarget();
        if (!target) return;
        const compilation = compileText(this.state.source, this.getCompileOptions(target));
        this.setState({diagnostics: compilation.diagnostics});
    }

    handleInsertExtensionXml (entry) {
        try {
            const ScratchBlocks = typeof window !== 'undefined' && (window.ScratchBlocks || window.Blockly);
            const workspace = ScratchBlocks && typeof ScratchBlocks.getMainWorkspace === 'function' &&
                ScratchBlocks.getMainWorkspace();
            if (!workspace || !ScratchBlocks.Xml || typeof ScratchBlocks.Xml.domToWorkspace !== 'function') {
                throw new Error(this.t('extensionOpenBlocks'));
            }
            const xml = /^\s*<xml\b/i.test(entry.xml) ? entry.xml :
                `<xml xmlns="http://www.w3.org/1999/xhtml">${entry.xml}</xml>`;
            const dom = ScratchBlocks.Xml.textToDom(xml);
            const inserted = ScratchBlocks.Xml.domToWorkspace(dom, workspace) || [];
            this.setState({
                viewMode: 'split',
                activeBottomPanel: 'problems',
                status: this.t('extensionBlocksInserted', {
                    count: Array.isArray(inserted) ? inserted.length : 1
                }),
                statusKind: 'success'
            });
        } catch (error) {
            this.setState({status: error.message, statusKind: 'error'});
        }
    }

    handleProjectChanged () {
        if (Date.now() < this.suppressBlockSyncUntil) return;
        clearTimeout(this.blockSyncTimer);
        const generation = ++this.blockConversionGeneration;
        this.blockSyncTimer = setTimeout(async () => {
            const target = this.getTarget();
            const workspace = buildWorkspace(this.props.vm);
            this.refreshWorkspace(null, workspace);
            if (!target) return;
            if (Object.keys(target.blocks && target.blocks._blocks || {}).length > MAX_AUTO_BLOCKS) {
                this.setState({
                    blocksDiverged: true,
                    status: this.t('largeProjectManualConversion'),
                    statusKind: 'working'
                });
                return;
            }
            const fingerprint = blockFingerprint(target);
            if (fingerprint === this.lastBlockFingerprint) return;
            if (!this.state.autoSync || !['blocks', 'split'].includes(this.state.viewMode)) {
                this.setState({
                    blocksDiverged: true,
                    status: this.t('syncBlocksChanged'),
                    statusKind: 'working'
                });
                return;
            }
            const referencesUpdated = this.synchronizeProjectReferences(workspace);
            if (referencesUpdated) return;
            let result;
            try {
                result = await this.conversionWorker.decompile(target, {
                    extensionCatalog: this.extensionCatalog,
                    stageTarget: this.getStage()
                });
            } catch (error) {
                if (generation !== this.blockConversionGeneration) return;
                this.setState({status: error.message, statusKind: 'error'});
                return;
            }
            if (
                generation !== this.blockConversionGeneration ||
                !this._isMounted ||
                target !== this.getTarget() ||
                fingerprint !== blockFingerprint(target)
            ) return;
            const compileOptions = this.getCompileOptions(target, workspace);
            const sources = [
                result.source,
                this.state.source,
                this.lastAppliedSource
            ];
            let compilations;
            try {
                compilations = await Promise.all(sources.map(source =>
                    source ? this.conversionWorker.compile(source, compileOptions) : Promise.resolve(null)
                ));
            } catch (error) {
                if (generation !== this.blockConversionGeneration) return;
                this.setState({status: error.message, statusKind: 'error'});
                return;
            }
            if (generation !== this.blockConversionGeneration || !this._isMounted) return;
            const [visualCompilation, textCompilation, baseCompilation] = compilations;
            result.canonicalSource = result.source;
            result.visualCompilation = visualCompilation;
            const hasPendingText = this.state.source !== this.lastAppliedSource || countErrors(this.state.diagnostics) > 0;
            const merged = baseCompilation && visualCompilation.success ? mergeVisualSource({
                baseSource: this.lastAppliedSource,
                textSource: this.state.source,
                visualSource: result.canonicalSource,
                baseCompilation,
                textCompilation,
                visualCompilation
            }) : null;
            if (merged && merged.source !== null) {
                result.source = merged.source;
                result.semanticMerge = merged;
            }
            if (hasPendingText && (!merged || merged.conflicts.length > 0)) {
                this.lastBlockFingerprint = fingerprint;
                this.setState({
                    visualConflict: result,
                    blocksDiverged: true,
                    status: merged && merged.conflicts.length ?
                        this.t('semanticConflict', {count: merged.conflicts.length}) :
                        this.t('invalidTextConflict'),
                    statusKind: 'working'
                });
                return;
            }
            this.acceptVisualChanges(result);
        }, 220);
    }

    synchronizeProjectReferences (preparedWorkspace = null) {
        if (this.isRuntimeActive()) return false;
        const workspace = preparedWorkspace || buildWorkspace(this.props.vm);
        let currentUpdate = null;
        (this.props.vm.runtime.targets || []).forEach(target => {
            const record = readSourceRecord(target);
            if (!record) return;
            const synchronized = synchronizeStableReferences(
                record.source,
                target,
                record.resourceBindings,
                workspace.resources
            );
            if (!synchronized.count) return;
            const compilation = compileText(synchronized.source, this.getCompileOptions(target, workspace));
            if (!compilation.success) return;
            this.suppressBlockSyncUntil = Date.now() + 750;
            applyCompilation(this.props.vm, target, compilation);
            saveHistorySnapshot(
                this.getStorage(),
                this.getProjectStorageId(),
                target.id,
                synchronized.source,
                this.t('historyResourceSync')
            );
            if (target.id === this.props.editingTargetId) currentUpdate = {source: synchronized.source, compilation};
        });
        if (!currentUpdate) return false;
        this.lastAppliedSource = currentUpdate.source;
        this.lastBlockFingerprint = blockFingerprint(this.getTarget());
        this.setState({
            source: currentUpdate.source,
            diagnostics: currentUpdate.compilation.diagnostics,
            status: this.t('referencesUpdated'),
            statusKind: 'success'
        });
        return true;
    }

    acceptVisualChanges (result = this.state.visualConflict) {
        const target = this.getTarget();
        if (!target || !result) return;
        if (this.isRuntimeActive()) {
            this.pendingCompilation = null;
            this.pendingVisualResult = result;
            this.setState({status: this.t('conversionQueued'), statusKind: 'working'});
            return;
        }
        const conversionSnapshot = result.manualConversion ?
            this.captureConversionSnapshot('blocks-to-text') : null;
        clearTimeout(this.compileTimer);
        const compileOptions = this.getCompileOptions(target);
        const canonicalSource = result.canonicalSource || result.source;
        const visualCompilation = result.visualCompilation || compileText(canonicalSource, compileOptions);
        const compilation = compileText(result.source, compileOptions);
        if (!visualCompilation.success || !compilation.success) {
            this.setState({
                diagnostics: compilation.diagnostics,
                status: this.t('synchronizationInvalid'),
                statusKind: 'error'
            });
            return;
        }
        const transactionSnapshot = captureTargetSnapshot(this.props.vm, target);
        let record;
        try {
            this.suppressBlockSyncUntil = Date.now() + 750;
            adoptImportedRoots(
                this.props.vm,
                target,
                canonicalSource,
                result.importedRootIds,
                result.sourceMap,
                visualCompilation
            );
            // A segunda etapa atualiza somente unidades textuais que também mudaram.
            // Unidades adotadas do Blockly têm o mesmo hash e preservam seus IDs.
            record = applyCompilation(this.props.vm, target, compilation);
        } catch (error) {
            restoreTargetSnapshot(this.props.vm, target, transactionSnapshot);
            this.setState({status: error.message, statusKind: 'error'});
            return;
        }
        this.lastAppliedSource = result.source;
        this.lastBlockFingerprint = blockFingerprint(target);
        this.setState(state => ({
            source: result.source,
            diagnostics: compilation.diagnostics,
            visualConflict: null,
            conflictReviewOpen: false,
            blocksDiverged: false,
            lastConversion: conversionSnapshot || state.lastConversion,
            blockRefresh: state.blockRefresh + 1,
            status: this.t('blocksSynchronized', {
                merged: result.semanticMerge && result.semanticMerge.mergedUnits.length || 0,
                preserved: record.lastApply && record.lastApply.unchangedUnits || 0,
                stacks: result.importedRootIds.length,
                unsupported: result.unsupportedOpcodes.length
            }),
            statusKind: compilation.success ? 'success' : 'error'
        }));
    }

    keepTextChanges () {
        const target = this.getTarget();
        if (!target) return;
        const conversionSnapshot = this.captureConversionSnapshot('text-to-blocks');
        markGeneratedRootsDirty(target);
        this.setState(
            {conflictReviewOpen: false, visualConflict: null},
            () => this.compileCurrent(false, conversionSnapshot)
        );
    }

    setViewMode (viewMode) {
        this.setState({viewMode}, () => {
            this.persistUiState({viewMode});
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
            if (viewMode === 'blocks' || viewMode === 'split') {
                this.lastBlockFingerprint = blockFingerprint(this.getTarget());
            }
        });
    }

    handleKeyDown (event) {
        if (event.key === 'Escape' && (
            this.state.actionMenuOpen || this.state.convertMenuOpen || this.state.fileTabMenu
        )) {
            event.preventDefault();
            event.stopPropagation();
            if (this.state.actionMenuOpen) this.closeActionMenu(true);
            else if (this.state.convertMenuOpen) this.closeConvertMenu(true);
            else this.setState({fileTabMenu: null});
            return;
        }
        if (!event.ctrlKey && !event.metaKey && !event.altKey) {
            if (event.key === 'F5' && !event.shiftKey) {
                event.preventDefault();
                this.handleRun();
                return;
            }
            if (event.key === 'F5' && event.shiftKey) {
                event.preventDefault();
                this.handleStop();
                return;
            }
        }
        if (
            event.key === 'Tab' &&
            this.state.narrowLayout &&
            this.state.sidebarVisible &&
            this.state.viewMode !== 'docs' &&
            this.rootElement
        ) {
            const sidebar = this.rootElement.querySelector('#textwarp-ide-sidebar');
            const focusable = sidebar && Array.from(sidebar.querySelectorAll(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
                'a[href], [tabindex]:not([tabindex="-1"])'
            )).filter(element => element.getClientRects().length);
            if (focusable && focusable.length) {
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (!sidebar.contains(document.activeElement)) {
                    event.preventDefault();
                    first.focus();
                    return;
                }
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                    return;
                }
                if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                    return;
                }
            }
        }
        if (event.key === 'Escape' && this.state.narrowLayout && this.state.sidebarVisible) {
            event.preventDefault();
            this.closeSidebar();
            return;
        }
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = String(event.key).toLowerCase();
        if (event.shiftKey && key === 'p') {
            event.preventDefault();
            if (this.monacoEditor) this.monacoEditor.openCommandPalette();
            return;
        }
        if (!event.shiftKey && key === 'b') {
            event.preventDefault();
            const sidebarVisible = !this.state.sidebarVisible;
            this.setState({sidebarVisible});
            this.persistUiState({sidebarVisible});
            return;
        }
        if (!event.shiftKey && key === 'j') {
            event.preventDefault();
            const bottomPanelCollapsed = !this.state.bottomPanelCollapsed;
            this.setState({bottomPanelCollapsed});
            this.persistUiState({bottomPanelCollapsed});
            return;
        }
        if (key === '+' || key === '=') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.setFontSize(this.state.fontSize + 1);
            return;
        }
        if (key === '-') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.setFontSize(this.state.fontSize - 1);
            return;
        }
        if (key === '0') {
            event.preventDefault();
            event.stopImmediatePropagation();
            this.setFontSize(DEFAULT_FONT_SIZE);
            return;
        }
        if (event.shiftKey && key === 'e') {
            event.preventDefault();
            this.setState({sidebarVisible: true, sidebarPanel: 'explorer'});
            this.persistUiState({sidebarVisible: true, sidebarPanel: 'explorer'});
            return;
        }
        if (event.shiftKey && key === 'f') {
            event.preventDefault();
            this.setState({sidebarVisible: true, sidebarPanel: 'search'});
            this.persistUiState({sidebarVisible: true, sidebarPanel: 'search'});
            return;
        }
        if (key !== 's') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.saveTextwarp(Boolean(event.shiftKey));
    }

    openTarget (targetId) {
        if (!targetId) return;
        const storage = this.getStorage();
        rememberRecentTarget(storage, this.getProjectStorageId(), targetId);
        this.setState(state => ({
            openTargetIds: state.openTargetIds.includes(targetId) ? state.openTargetIds : state.openTargetIds.concat(targetId)
        }));
        if (targetId === this.props.editingTargetId) return;
        if (typeof this.props.vm.setEditingTarget === 'function') this.props.vm.setEditingTarget(targetId);
    }

    closeTarget (event, targetId) {
        event.stopPropagation();
        this.setState(state => {
            if (state.openTargetIds.length <= 1) return null;
            const openTargetIds = state.openTargetIds.filter(id => id !== targetId);
            if (targetId === this.props.editingTargetId) {
                const nextId = openTargetIds[openTargetIds.length - 1];
                setTimeout(() => this.openTarget(nextId), 0);
            }
            return {openTargetIds};
        });
    }

    closeTargets (targetIds) {
        const closing = new Set(targetIds);
        this.setState(state => {
            const openTargetIds = state.openTargetIds.filter(id => !closing.has(id));
            if (!openTargetIds.length) return {fileTabMenu: null};
            if (closing.has(this.props.editingTargetId)) {
                setTimeout(() => this.openTarget(openTargetIds[openTargetIds.length - 1]), 0);
            }
            return {fileTabMenu: null, openTargetIds};
        });
    }

    reorderTargetTabs (targetId, beforeTargetId) {
        if (!targetId || !beforeTargetId || targetId === beforeTargetId) return;
        this.setState(state => {
            const openTargetIds = state.openTargetIds.filter(id => id !== targetId);
            const destination = openTargetIds.indexOf(beforeTargetId);
            openTargetIds.splice(destination < 0 ? openTargetIds.length : destination, 0, targetId);
            return {draggedTargetId: null, openTargetIds};
        });
    }

    openLocation (location) {
        if (!location) return;
        this.pendingLocation = location;
        if (location.targetId && location.targetId !== this.props.editingTargetId) {
            this.openTarget(location.targetId);
            return;
        }
        this.setViewMode('code');
        setTimeout(() => {
            if (this.monacoEditor) this.monacoEditor.revealPosition(location.line || 1, location.column || 1);
            this.pendingLocation = null;
        }, 0);
    }

    openResource (resource) {
        if (!resource) return;
        const targetId = ['actor', 'stage'].includes(resource.kind) ? resource.id : resource.ownerId;
        this.openTarget(targetId);
        this.setState({
            status: this.t('resourceSelected', {
                kind: resource.kindLabel || this.t('resource'),
                name: resource.name
            }),
            statusKind: 'success'
        });
    }

    navigateResourceByName (name) {
        const resource = this.state.workspace.resources.find(item => item.name === name);
        if (resource) this.openResource(resource);
    }

    insertResource (resource) {
        this.setViewMode('code');
        setTimeout(() => {
            if (this.monacoEditor) this.monacoEditor.insertText(JSON.stringify(resource.name));
        }, 0);
    }

    handleSearch (searchQuery) {
        const workspace = buildWorkspace(this.props.vm);
        const activeModule = workspace.modules.find(module => module.id === this.props.editingTargetId);
        if (activeModule) activeModule.source = this.state.source;
        this.setState({searchQuery, workspace, searchResults: searchWorkspace(workspace, searchQuery)});
    }

    handleReplaceAll () {
        const workspace = buildWorkspace(this.props.vm);
        const activeModule = workspace.modules.find(module => module.id === this.props.editingTargetId);
        if (activeModule) activeModule.source = this.state.source;
        const replacement = replaceWorkspace(workspace, this.state.searchQuery, this.state.replaceValue);
        if (!replacement.count) return;
        if (
            typeof window !== 'undefined' &&
            !window.confirm(this.t('replaceConfirm', {count: replacement.count}))
        ) return;
        const compilations = replacement.modules.map(module => {
            const target = this.props.vm.runtime.getTargetById(module.id);
            return {module, target, compilation: compileText(module.source, this.getCompileOptions(target))};
        });
        const invalid = compilations.find(item => !item.compilation.success);
        if (invalid) {
            this.setState({
                status: this.t('replaceInvalid', {name: invalid.module.fileName}),
                statusKind: 'error'
            });
            return;
        }
        if (this.isRuntimeActive() && typeof this.props.vm.stopAll === 'function') this.props.vm.stopAll();
        compilations.forEach(item => {
            saveTextSource(this.props.vm, item.target, item.module.source);
            applyCompilation(this.props.vm, item.target, item.compilation);
            saveHistorySnapshot(
                this.getStorage(),
                this.getProjectStorageId(),
                item.target.id,
                item.module.source,
                this.t('historyGlobalReplace')
            );
        });
        const current = compilations.find(item => item.target.id === this.props.editingTargetId);
        this.setState({
            source: current ? current.module.source : this.state.source,
            diagnostics: current ? current.compilation.diagnostics : this.state.diagnostics,
            status: this.t('replaceSuccess', {
                count: replacement.count,
                scripts: compilations.length
            }),
            statusKind: 'success',
            saveState: 'salvo'
        }, () => this.handleSearch(this.state.searchQuery));
    }

    restoreHistory (entry) {
        if (!entry || typeof entry.source !== 'string') return;
        this.handleChange(entry.source);
        this.setState({
            sidebarPanel: 'explorer',
            status: this.t('historyRestored'),
            statusKind: 'working'
        });
    }

    handleStop () {
        if (this.props.vm && typeof this.props.vm.stopAll === 'function') this.props.vm.stopAll();
        if (this.debugController) this.debugController.log(
            'info',
            this.t('stopRequestedLog')
        );
        this.setState({status: this.t('executionStopped'), statusKind: 'idle'});
    }

    handleRestart () {
        if (this.props.vm && typeof this.props.vm.stopAll === 'function') this.props.vm.stopAll();
        this.setState({
            status: this.t('executionRestarting'),
            statusKind: 'working'
        }, () => this.compileCurrent(true));
    }

    async handleRunSelection (selection) {
        const target = this.getTarget();
        if (!target || !selection) return;
        const generation = ++this.conversionGeneration;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        const source = this.state.source;
        let compilation;
        try {
            compilation = await this.conversionWorker.compile(source, this.getCompileOptions(target));
        } catch (error) {
            if (generation === this.conversionGeneration) {
                this.setState({status: error.message, statusKind: 'error'});
            }
            return;
        }
        if (
            generation !== this.conversionGeneration ||
            !this._isMounted ||
            target !== this.getTarget() ||
            source !== this.state.source
        ) return;
        if (!compilation.success) {
            this.setState({
                diagnostics: compilation.diagnostics,
                status: this.t('runFixErrors'),
                statusKind: 'error'
            });
            return;
        }
        const startLine = selection.startLine;
        const endLine = selection.empty ? selection.startLine : selection.endLine;
        const units = compilation.graph.units.filter(unit => {
            const lines = unit.blockIds.map(id => compilation.graph.sourceMap[id] && compilation.graph.sourceMap[id].startLine).filter(Boolean);
            if (!lines.length) return false;
            const first = Math.min(...lines);
            const last = Math.max(...lines);
            return startLine <= last && endLine >= first;
        });
        const runnableUnits = units.filter(unit => unit.kind === 'script' || unit.kind === 'procedure' &&
            compilation.ir.procedures.some(procedure => procedure.name === unit.name && procedure.parameters.length === 0)
        );
        if (!runnableUnits.length) {
            this.setState({
                status: this.t('runSelectionHelp'),
                statusKind: 'error'
            });
            return;
        }
        this.applyCompilation(compilation, target, false);
        runnableUnits.forEach(unit => this.props.vm.runtime.toggleScript(unit.rootId, {target, stackClick: true}));
        if (this.debugController) this.debugController.log(
            'info',
            this.t('runSelectionSuccess', {count: runnableUnits.length}),
            target
        );
        this.setState({
            status: this.t('runSelectionSuccess', {count: runnableUnits.length}),
            statusKind: 'success'
        });
    }

    handleTextwarpUiCommand (command) {
        this.fileCommandReturnFocus = typeof document !== 'undefined' &&
            document.getElementById('textwarp-file-menu-trigger');
        switch (command) {
        case TEXTWARP_UI_COMMANDS.OPEN:
            this.openTextwarp();
            break;
        case TEXTWARP_UI_COMMANDS.SAVE:
            this.saveTextwarp(false);
            break;
        case TEXTWARP_UI_COMMANDS.SAVE_AS:
            this.saveTextwarp(true);
            break;
        case TEXTWARP_UI_COMMANDS.PREFERENCES:
            this.setState({
                actionMenuOpen: false,
                externalOpen: false,
                settingsOpen: true
            });
            break;
        default:
            break;
        }
    }

    setFileOperation (command, state, message) {
        this.props.onSetTextwarpUiOperation(command, state, message);
        if (state !== 'working' && this.fileCommandReturnFocus) {
            const returnFocus = this.fileCommandReturnFocus;
            setTimeout(() => {
                if (document.contains(returnFocus)) returnFocus.focus();
            }, 0);
        }
    }

    async saveTextwarp (saveAs = false) {
        if (this.state.busy) return;
        const operation = saveAs ? TEXTWARP_UI_COMMANDS.SAVE_AS : TEXTWARP_UI_COMMANDS.SAVE;
        const workingMessage = this.t('savingTextwarp');
        this.setFileOperation(operation, 'working', workingMessage);
        this.setState({
            busy: true,
            status: workingMessage,
            statusKind: 'working'
        });
        try {
            const bytes = await exportTextwarpProject(this.props.vm, {
                name: this.props.projectTitle || 'TextWarp Project'
            });
            let handle = saveAs ? null : getTextwarpHandle();
            if (!handle) handle = await showTextwarpSaveFilePicker({
                suggestedName: getTextwarpSuggestedName() || `${this.props.projectTitle || 'project'}.textwarp`,
                types: [{
                    description: 'TextWarp Project',
                    accept: {'application/zip': ['.textwarp']}
                }],
                excludeAcceptAllOption: true
            });
            const writable = await handle.createWritable();
            try {
                await writable.write(bytes);
                await writable.close();
            } catch (error) {
                await writable.abort();
                throw error;
            }
            setTextwarpHandle(handle);
            this.props.onClearSb3FileHandle();
            notifyTextwarpFileOpened(handle);
            this.props.onSetProjectUnchanged();
            const successMessage = this.t('saveSuccess', {name: handle.name || this.props.projectTitle});
            this.setState({
                status: successMessage,
                statusKind: 'success'
            });
            this.setFileOperation(operation, 'success', successMessage);
        } catch (error) {
            if (error && error.name === 'AbortError') {
                const cancelledMessage = this.t('saveCancelled');
                this.setState({
                    status: cancelledMessage,
                    statusKind: 'idle'
                });
                this.setFileOperation(operation, 'idle', cancelledMessage);
                return;
            }
            console.error(error);
            this.setState({status: error.message, statusKind: 'error'});
            this.setFileOperation(operation, 'error', error.message);
        } finally {
            if (this._isMounted) this.setState({busy: false});
        }
    }

    syncAllBreakpoints () {
        if (!this.debugController) return;
        let hasBreakpoints = false;
        (this.props.vm.runtime.targets || []).forEach(target => {
            const record = readSourceRecord(target);
            const breakpoints = record ? record.breakpoints : [];
            if (breakpoints.length) hasBreakpoints = true;
            this.debugController.setBreakpoints(target, breakpoints);
        });
        this.debugController.setEnabled(this.state.activeBottomPanel === 'debugger' || hasBreakpoints);
    }

    loadSelectedTarget () {
        this.conversionGeneration++;
        this.secondaryConversionGeneration++;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        clearTimeout(this.compileTimer);
        clearTimeout(this.historyTimer);
        const target = this.getTarget();
        if (!target) {
            this.setState({
                source: '', diagnostics: [], status: this.t('selectTarget'), statusKind: 'idle',
                targetName: '', isStage: false, breakpoints: []
            });
            return;
        }
        this.refreshExtensionCatalog();
        const stored = readSourceRecord(target);
        const initialSource = stored ? stored.source : getTemplate(target);
        const synchronized = stored ? synchronizeStableReferences(
            initialSource,
            target,
            stored.resourceBindings,
            buildWorkspace(this.props.vm).resources
        ) : {source: initialSource, count: 0};
        const source = synchronized.source;
        const compilation = compileText(source, this.getCompileOptions(target));
        const existingBlocks = target.blocks && target.blocks._blocks ? Object.keys(target.blocks._blocks).length : 0;
        const breakpoints = stored ? stored.breakpoints : [];
        const storage = this.getStorage();
        const projectId = this.getProjectStorageId();
        const recent = loadRecentTargets(storage, projectId);
        rememberRecentTarget(storage, projectId, target.id);
        const history = loadHistory(storage, projectId, target.id);
        const workspace = buildWorkspace(this.props.vm);
        const openTargetIds = Array.from(new Set(
            this.state.openTargetIds.concat(recent).filter(id => workspace.modules.some(module => module.id === id)).concat(target.id)
        ));
        const secondaryTargetId = chooseSecondaryTargetId(
            workspace.modules,
            target.id,
            this.state.secondaryTargetId
        );
        const secondaryTarget = secondaryTargetId && this.props.vm.runtime.getTargetById(secondaryTargetId);
        const secondaryStored = secondaryTarget && readSourceRecord(secondaryTarget);
        const secondarySource = secondaryTarget ? (secondaryStored ? secondaryStored.source : getTemplate(secondaryTarget)) : '';
        const secondaryCompilation = secondaryTarget && secondarySource.length <= MAX_AUTO_SOURCE_LENGTH ?
            compileText(secondarySource, this.getCompileOptions(secondaryTarget)) : {diagnostics: []};
        if (this.debugController) this.debugController.setBreakpoints(target, breakpoints);
        if (synchronized.count && compilation.success) applyCompilation(this.props.vm, target, compilation);
        this.lastAppliedSource = stored ? source : '';
        this.lastBlockFingerprint = blockFingerprint(target);
        this.setState({
            source,
            diagnostics: compilation.diagnostics,
            status: synchronized.count ? this.t('sourceReferencesUpdated') :
                stored ? this.t('sourceLoaded') : existingBlocks ?
                    this.t('existingBlocksHelp') : this.t('starterExample'),
            statusKind: stored ? 'success' : 'idle',
            targetName: target.getName(),
            isStage: target.isStage,
            breakpoints,
            workspace,
            openTargetIds,
            secondaryTargetId,
            secondarySource,
            secondaryDiagnostics: secondaryCompilation.diagnostics,
            history,
            searchResults: searchWorkspace(workspace, this.state.searchQuery),
            saveState: 'salvo',
            visualConflict: null,
            blocksDiverged: false,
            lastConversion: null,
            blockRefresh: this.state.blockRefresh + 1
        }, () => {
            if (this.pendingLocation && this.pendingLocation.targetId === target.id) this.openLocation(this.pendingLocation);
        });
    }

    handleChange (source) {
        const target = this.getTarget();
        if (!target) return;
        const generation = ++this.conversionGeneration;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        saveTextSource(this.props.vm, target, source);
        this.setState({
            externalSyncState: this.state.externalHandle ? 'dirty' : this.state.externalSyncState,
            source,
            status: this.t('analyzing'),
            statusKind: 'working',
            saveState: 'salvando'
        });
        clearTimeout(this.historyTimer);
        this.historyTimer = setTimeout(() => {
            const history = saveHistorySnapshot(
                this.getStorage(),
                this.getProjectStorageId(),
                target.id,
                source,
                this.t('historyAutosave')
            );
            if (this._isMounted && this.props.editingTargetId === target.id) {
                this.setState({history, saveState: 'salvo'}, () => this.refreshWorkspace());
            }
        }, HISTORY_DELAY);
        clearTimeout(this.analysisTimer);
        clearTimeout(this.compileTimer);
        const targetId = target.id;
        this.analysisTimer = setTimeout(async () => {
            if (
                !this._isMounted ||
                this.props.editingTargetId !== targetId ||
                this.state.source !== source
            ) return;
            if (source.length > MAX_AUTO_SOURCE_LENGTH) {
                this.setState({
                    diagnostics: [],
                    status: this.t('largeProjectManualConversion'),
                    statusKind: 'working'
                });
                return;
            }
            let compilation;
            try {
                compilation = await this.conversionWorker.compile(source, this.getCompileOptions(target));
            } catch (error) {
                if (generation !== this.conversionGeneration) return;
                this.setState({status: error.message, statusKind: 'error'});
                return;
            }
            if (
                generation !== this.conversionGeneration ||
                !this._isMounted ||
                this.props.editingTargetId !== targetId ||
                this.state.source !== source
            ) return;
            const errors = countErrors(compilation.diagnostics);
            this.setState({
                diagnostics: compilation.diagnostics,
                status: errors ?
                    this.t('sourceErrors', {count: errors}) : this.t('analyzing'),
                statusKind: errors ? 'error' : 'working'
            });
            if (compilation.success && this.state.autoSync) {
                const conversionScopePrompt = getConversionScope(target, compilation);
                if (conversionScopePrompt) {
                    this.setState({
                        conversionScopePrompt,
                        blocksDiverged: true,
                        status: this.t('conversionScopeTitle'),
                        statusKind: 'working'
                    });
                    return;
                }
                this.compileTimer = setTimeout(() => {
                    if (
                        this.props.editingTargetId === targetId &&
                        this.state.source === source
                    ) this.applyCompilation(
                        compilation,
                        target,
                        false,
                        this.captureConversionSnapshot('text-to-blocks')
                    );
                }, AUTO_COMPILE_DELAY);
            }
        }, ANALYSIS_DELAY);
    }

    handleWorkspaceModelChange (targetId, source) {
        const target = this.props.vm.runtime.getTargetById(targetId);
        if (!target || targetId === this.props.editingTargetId) return;
        const compilation = compileText(source, this.getCompileOptions(target));
        saveTextSource(this.props.vm, target, source);
        if (compilation.success && this.state.autoSync && !this.isRuntimeActive()) {
            applyCompilation(this.props.vm, target, compilation);
        }
        saveHistorySnapshot(
            this.getStorage(),
            this.getProjectStorageId(),
            targetId,
            source,
            this.t('historyRefactor')
        );
        this.refreshWorkspace();
    }

    setSecondaryTarget (targetId) {
        const selectedId = chooseSecondaryTargetId(
            this.state.workspace.modules,
            this.props.editingTargetId,
            targetId
        );
        const target = selectedId && this.props.vm.runtime.getTargetById(selectedId);
        if (!target) {
            this.setState({secondaryTargetId: null, secondarySource: '', secondaryDiagnostics: []});
            return;
        }
        const stored = readSourceRecord(target);
        const secondarySource = stored ? stored.source : getTemplate(target);
        const compilation = compileText(secondarySource, this.getCompileOptions(target));
        this.setState({
            secondaryTargetId: selectedId,
            secondarySource,
            secondaryDiagnostics: compilation.diagnostics
        });
    }

    handleSecondaryChange (source) {
        const target = this.state.secondaryTargetId &&
            this.props.vm.runtime.getTargetById(this.state.secondaryTargetId);
        if (!target) return;
        const generation = ++this.secondaryConversionGeneration;
        this.conversionGeneration++;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        saveTextSource(this.props.vm, target, source);
        this.setState({
            secondarySource: source,
            saveState: 'salvando'
        });
        clearTimeout(this.secondaryAnalysisTimer);
        clearTimeout(this.secondaryCompileTimer);
        this.secondaryAnalysisTimer = setTimeout(async () => {
            if (
                !this._isMounted ||
                this.state.secondaryTargetId !== target.id ||
                this.state.secondarySource !== source
            ) return;
            let compilation;
            try {
                compilation = await this.conversionWorker.compile(source, this.getCompileOptions(target));
            } catch (error) {
                if (generation === this.secondaryConversionGeneration) {
                    this.setState({status: error.message, statusKind: 'error'});
                }
                return;
            }
            if (
                generation !== this.secondaryConversionGeneration ||
                !this._isMounted ||
                this.state.secondaryTargetId !== target.id ||
                this.state.secondarySource !== source
            ) return;
            const history = saveHistorySnapshot(
                this.getStorage(),
                this.getProjectStorageId(),
                target.id,
                source,
                this.t('historyDualEditor')
            );
            this.setState({secondaryDiagnostics: compilation.diagnostics, saveState: 'salvo'});
            if (!compilation.success || !this.state.autoSync) return;
            this.secondaryCompileTimer = setTimeout(() => {
                if (
                    this.state.secondaryTargetId !== target.id ||
                    this.state.secondarySource !== source
                ) return;
                this.suppressBlockSyncUntil = Date.now() + 750;
                const conversionSnapshot = this.captureConversionSnapshot('text-to-blocks', target, source);
                this.applySecondaryCompilation(compilation, target, false, conversionSnapshot);
                if (this._isMounted && this.state.secondaryTargetId === target.id) {
                    this.setState({saveState: 'salvo', lastConversion: conversionSnapshot}, () => this.refreshWorkspace());
                    if (target.id === this.props.editingTargetId) this.setState({history});
                }
            }, AUTO_COMPILE_DELAY);
        }, ANALYSIS_DELAY);
    }

    async compileSecondary (run) {
        clearTimeout(this.secondaryCompileTimer);
        clearTimeout(this.secondaryAnalysisTimer);
        const target = this.state.secondaryTargetId &&
            this.props.vm.runtime.getTargetById(this.state.secondaryTargetId);
        if (!target) return;
        const generation = ++this.secondaryConversionGeneration;
        this.conversionGeneration++;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        const source = this.state.secondarySource;
        let compilation;
        try {
            compilation = await this.conversionWorker.compile(source, this.getCompileOptions(target));
        } catch (error) {
            if (generation === this.secondaryConversionGeneration) {
                this.setState({status: error.message, statusKind: 'error'});
            }
            return;
        }
        if (
            generation !== this.secondaryConversionGeneration ||
            !this._isMounted ||
            this.state.secondaryTargetId !== target.id ||
            this.state.secondarySource !== source
        ) return;
        this.setState({secondaryDiagnostics: compilation.diagnostics});
        if (!compilation.success) return;
        this.suppressBlockSyncUntil = Date.now() + 750;
        this.applySecondaryCompilation(
            compilation,
            target,
            run,
            this.captureConversionSnapshot('text-to-blocks', target, this.state.secondarySource)
        );
        saveHistorySnapshot(
            this.getStorage(),
            this.getProjectStorageId(),
            target.id,
            this.state.secondarySource,
            this.t('historyDualEditor')
        );
        this.setState({saveState: 'salvo'}, () => this.refreshWorkspace());
    }

    isRuntimeActive () {
        const threads = this.props.vm && this.props.vm.runtime && this.props.vm.runtime.threads;
        return Array.isArray(threads) && threads.some(thread =>
            thread && (thread.stack && thread.stack.length || thread.topBlock) && thread.status !== 4
        );
    }

    applySecondaryCompilation (compilation, target, run, conversionSnapshot) {
        if (this.isRuntimeActive()) {
            this.pendingVisualResult = null;
            this.pendingCompilation = {
                compilation,
                target,
                run,
                conversionSnapshot,
                replaceRootIds: [],
                secondary: true
            };
            this.setState({status: this.t('conversionQueued'), statusKind: 'working'});
            return;
        }
        try {
            applyCompilation(this.props.vm, target, compilation);
            this.setState({
                secondaryDiagnostics: compilation.diagnostics,
                saveState: 'salvo',
                lastConversion: conversionSnapshot
            }, () => this.refreshWorkspace());
            if (run) this.props.vm.greenFlag();
        } catch (error) {
            this.setState({status: error.message, statusKind: 'error'});
        }
    }

    handleProjectRunStop () {
        if (this.pendingVisualResult) {
            const result = this.pendingVisualResult;
            this.pendingVisualResult = null;
            setTimeout(() => {
                if (this._isMounted) this.acceptVisualChanges(result);
            }, 0);
            return;
        }
        if (!this.pendingCompilation) return;
        const pending = this.pendingCompilation;
        this.pendingCompilation = null;
        setTimeout(() => {
            if (!this._isMounted) return;
            if (pending.conversionSnapshot) {
                pending.conversionSnapshot.projectSnapshot = captureTargetSnapshot(this.props.vm, pending.target);
            }
            if (pending.secondary) {
                this.applySecondaryCompilation(
                    pending.compilation,
                    pending.target,
                    pending.run,
                    pending.conversionSnapshot
                );
                return;
            }
            this.applyCompilation(
                pending.compilation,
                pending.target,
                pending.run,
                pending.conversionSnapshot,
                pending.replaceRootIds
            );
        }, 0);
    }

    applyCompilation (compilation, target, run, conversionSnapshot = null, replaceRootIds = []) {
        if (this.isRuntimeActive()) {
            this.pendingVisualResult = null;
            this.pendingCompilation = {compilation, target, run, conversionSnapshot, replaceRootIds};
            this.setState({status: this.t('conversionQueued'), statusKind: 'working'});
            return;
        }
        const replacementSnapshot = replaceRootIds.length ? captureTargetSnapshot(this.props.vm, target) : null;
        try {
            this.suppressBlockSyncUntil = Date.now() + 750;
            if (replaceRootIds.length) removeRoots(this.props.vm, target, replaceRootIds);
            const record = applyCompilation(this.props.vm, target, compilation);
            this.lastAppliedSource = compilation.source;
            this.lastBlockFingerprint = blockFingerprint(target);
            const apply = record.lastApply || {};
            const changed = (apply.createdUnits || 0) + (apply.updatedUnits || 0);
            const history = saveHistorySnapshot(
                this.getStorage(),
                this.getProjectStorageId(),
                target.id,
                compilation.source,
                this.t('historyAutosave')
            );
            this.setState(state => ({
                diagnostics: compilation.diagnostics,
                status: this.t('compileSuccess', {
                    blocks: record.generatedBlockIds.length,
                    changed,
                    preserved: apply.unchangedUnits || 0
                }),
                statusKind: 'success',
                saveState: 'salvo',
                blocksDiverged: false,
                history,
                lastConversion: conversionSnapshot,
                blockRefresh: state.blockRefresh + 1
            }));
            if (run) this.props.vm.greenFlag();
        } catch (error) {
            if (replacementSnapshot) restoreTargetSnapshot(this.props.vm, target, replacementSnapshot);
            console.error(error);
            this.setState({status: error.message, statusKind: 'error'});
        }
    }

    async compileCurrent (run, conversionSnapshot = null) {
        clearTimeout(this.compileTimer);
        clearTimeout(this.analysisTimer);
        const target = this.getTarget();
        if (!target) return;
        this.refreshExtensionCatalog();
        const generation = ++this.conversionGeneration;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        const source = this.state.source;
        this.setState({status: this.t('analyzing'), statusKind: 'working'});
        let compilation;
        try {
            compilation = await this.conversionWorker.compile(source, this.getCompileOptions(target));
        } catch (error) {
            if (generation === this.conversionGeneration) {
                this.setState({status: error.message, statusKind: 'error'});
            }
            return;
        }
        if (
            generation !== this.conversionGeneration ||
            !this._isMounted ||
            target !== this.getTarget() ||
            source !== this.state.source
        ) return;
        const errors = countErrors(compilation.diagnostics);
        if (errors) {
            saveTextSource(this.props.vm, target, source);
            this.setState({
                diagnostics: compilation.diagnostics,
                status: this.t('compileErrors', {count: errors}),
                statusKind: 'error'
            });
            return;
        }
        this.applyCompilation(compilation, target, run, conversionSnapshot);
    }

    async handleCompile () {
        const target = this.getTarget();
        if (!target) return;
        const generation = ++this.conversionGeneration;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        const source = this.state.source;
        this.setState({status: this.t('analyzing'), statusKind: 'working'});
        let compilation;
        try {
            compilation = await this.conversionWorker.compile(source, this.getCompileOptions(target));
        } catch (error) {
            if (generation === this.conversionGeneration) {
                this.setState({status: error.message, statusKind: 'error'});
            }
            return;
        }
        if (
            generation !== this.conversionGeneration ||
            !this._isMounted ||
            target !== this.getTarget() ||
            source !== this.state.source
        ) return;
        if (!compilation.success) {
            this.setState({diagnostics: compilation.diagnostics, statusKind: 'error'});
            return;
        }
        const conversionScopePrompt = getConversionScope(target, compilation);
        if (conversionScopePrompt) {
            this.setState({
                conversionScopePrompt,
                convertMenuOpen: false
            });
            return;
        }
        this.applyCompilation(
            compilation,
            target,
            false,
            this.captureConversionSnapshot('text-to-blocks')
        );
    }

    resolveConversionScope (mode) {
        const prompt = this.state.conversionScopePrompt;
        const target = this.getTarget();
        this.setState({conversionScopePrompt: null});
        if (!prompt || !target || mode === 'cancel') {
            if (mode === 'cancel') this.setState({status: this.t('conversionCancelled'), statusKind: 'idle'});
            return;
        }
        const snapshot = this.captureConversionSnapshot('text-to-blocks');
        this.applyCompilation(
            prompt.compilation,
            target,
            false,
            snapshot,
            mode === 'replace' ? prompt.matchingRootIds : []
        );
    }

    handleRun () {
        this.compileCurrent(true);
    }

    async handleImportBlocks () {
        const target = this.getTarget();
        if (!target) return;
        const generation = ++this.conversionGeneration;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        const fingerprint = blockFingerprint(target);
        this.setState({status: this.t('analyzing'), statusKind: 'working'});
        let result;
        let compilation;
        try {
            result = await this.conversionWorker.decompile(target, {
                extensionCatalog: this.extensionCatalog,
                stageTarget: this.getStage()
            });
            compilation = await this.conversionWorker.compile(
                result.source,
                this.getCompileOptions(target)
            );
        } catch (error) {
            if (generation === this.conversionGeneration) {
                this.setState({status: error.message, statusKind: 'error'});
            }
            return;
        }
        if (
            generation !== this.conversionGeneration ||
            !this._isMounted ||
            target !== this.getTarget() ||
            fingerprint !== blockFingerprint(target)
        ) return;
        if (result.importedRootIds.length === 0 && result.unsupportedRootIds.length === 0) {
            this.setState({
                status: this.t('noStacks'),
                statusKind: 'idle'
            });
            return;
        }
        result.canonicalSource = result.source;
        result.visualCompilation = compilation;
        result.manualConversion = true;
        if (
            readSourceRecord(target) &&
            this.state.source.trim() &&
            result.source.trim() !== this.state.source.trim()
        ) {
            this.setState({
                visualConflict: result,
                conflictReviewOpen: false,
                status: this.t('manualConversionConflict'),
                statusKind: 'working'
            });
            return;
        }
        const conversionSnapshot = this.captureConversionSnapshot('blocks-to-text');
        try {
            this.suppressBlockSyncUntil = Date.now() + 750;
            adoptImportedRoots(
                this.props.vm,
                target,
                result.source,
                result.importedRootIds,
                result.sourceMap,
                compilation
            );
        } catch (error) {
            restoreTargetSnapshot(this.props.vm, target, conversionSnapshot.projectSnapshot);
            this.setState({status: error.message, statusKind: 'error'});
            return;
        }
        this.lastAppliedSource = result.source;
        this.lastBlockFingerprint = blockFingerprint(target);
        this.setState(state => ({
            source: result.source,
            diagnostics: compilation.diagnostics,
            status: this.t('blocksImported', {
                stacks: result.importedRootIds.length,
                unsupported: result.unsupportedRootIds.length
            }),
            statusKind: result.unsupportedRootIds.length ? 'working' : 'success',
            lastConversion: conversionSnapshot,
            visualConflict: null,
            blocksDiverged: false,
            blockRefresh: state.blockRefresh + 1
        }));
    }

    async handleImportProjectBlocks () {
        const runtime = this.props.vm && this.props.vm.runtime;
        const currentTarget = this.getTarget();
        if (!runtime || !currentTarget) return;
        const targets = (runtime.targets || []).filter(target =>
            target && (target.isStage || target.isOriginal !== false)
        );
        if (!targets.length) return;

        const generation = ++this.conversionGeneration;
        this.blockConversionGeneration++;
        this.conversionWorker.cancelPending();
        const fingerprints = new Map(targets.map(target => [target.id, blockFingerprint(target)]));
        const stageTarget = this.getStage();
        const workspace = buildWorkspace(this.props.vm);
        const plans = [];
        this.setState({
            busy: true,
            convertMenuOpen: false,
            status: this.t('projectConversionProgress', {current: 0, total: targets.length}),
            statusKind: 'working'
        });

        try {
            if (this.isRuntimeActive() && typeof this.props.vm.stopAll === 'function') this.props.vm.stopAll();
            for (let index = 0; index < targets.length; index++) {
                const target = targets[index];
                this.setState({
                    status: this.t('projectConversionProgress', {
                        current: index + 1,
                        total: targets.length
                    }),
                    statusKind: 'working'
                });
                const result = await this.conversionWorker.decompile(target, {
                    extensionCatalog: this.extensionCatalog,
                    stageTarget
                });
                const compilation = await this.conversionWorker.compile(
                    result.source,
                    this.getCompileOptions(target, workspace)
                );
                if (generation !== this.conversionGeneration || !this._isMounted) return;
                if (!result.success || !compilation.success) {
                    const diagnostic = (result.diagnostics || []).concat(compilation.diagnostics || [])
                        .find(item => item.severity === 'error');
                    throw new Error(this.t('projectConversionFailed', {
                        name: targetFileName(target),
                        reason: diagnostic ? diagnostic.message : this.t('compileErrors', {count: 1})
                    }));
                }
                plans.push({target, result, compilation});
            }

            const changedTarget = targets.find(target =>
                fingerprints.get(target.id) !== blockFingerprint(target)
            );
            if (changedTarget) throw new Error(this.t('projectConversionChanged', {
                name: targetFileName(changedTarget)
            }));

            const conflicts = plans.filter(({target, result}) => {
                const record = readSourceRecord(target);
                return record && record.source.trim() && record.source.trim() !== result.source.trim();
            });
            if (conflicts.length) {
                this.setState({
                    status: this.t('projectConversionConflict', {
                        count: conflicts.length,
                        names: conflicts.map(item => targetFileName(item.target)).join(', ')
                    }),
                    statusKind: 'working'
                });
                return;
            }

            const timestamp = Date.now();
            let currentHistory = this.state.history;
            const projectSnapshots = plans.map(({target}) => {
                const record = readSourceRecord(target);
                const source = record ? record.source :
                    target === currentTarget ? this.state.source : '';
                const history = saveHistorySnapshot(
                    this.getStorage(),
                    this.getProjectStorageId(),
                    target.id,
                    source,
                    this.t('historyConversionSnapshot'),
                    timestamp
                );
                if (target === currentTarget) currentHistory = history;
                return {
                    targetId: target.id,
                    fileName: targetFileName(target),
                    source,
                    projectSnapshot: captureTargetSnapshot(this.props.vm, target)
                };
            });
            const conversionSnapshot = {
                direction: 'blocks-to-text-project',
                fileName: this.t('entireProject'),
                source: this.state.source,
                targetId: currentTarget.id,
                timestamp,
                projectSnapshots
            };

            try {
                this.suppressBlockSyncUntil = Date.now() + 1500;
                plans.forEach(({target, result, compilation}) => {
                    adoptImportedRoots(
                        this.props.vm,
                        target,
                        result.source,
                        result.importedRootIds,
                        result.sourceMap,
                        compilation
                    );
                });
            } catch (error) {
                projectSnapshots.slice().reverse().forEach(entry => {
                    const target = runtime.getTargetById(entry.targetId);
                    if (target) restoreTargetSnapshot(this.props.vm, target, entry.projectSnapshot);
                });
                throw error;
            }

            const currentPlan = plans.find(item => item.target === currentTarget);
            const stackCount = plans.reduce((total, item) => total + item.result.importedRootIds.length, 0);
            const opaqueCount = plans.reduce((total, item) => total + item.result.opaqueRootIds.length, 0);
            this.lastAppliedSource = currentPlan.result.source;
            this.lastBlockFingerprint = blockFingerprint(currentTarget);
            this.setState(state => ({
                source: currentPlan.result.source,
                diagnostics: currentPlan.compilation.diagnostics,
                status: this.t('projectBlocksImported', {
                    targets: plans.length,
                    stacks: stackCount,
                    opaque: opaqueCount
                }),
                statusKind: 'success',
                history: currentHistory,
                lastConversion: conversionSnapshot,
                visualConflict: null,
                blocksDiverged: false,
                saveState: 'salvo',
                blockRefresh: state.blockRefresh + 1
            }), () => this.refreshWorkspace());
        } catch (error) {
            if (generation === this.conversionGeneration) {
                this.setState({status: error.message, statusKind: 'error'});
            }
        } finally {
            if (this._isMounted) this.setState({busy: false});
        }
    }

    async connectExternalSource () {
        try {
            const handles = await showTextwarpOpenFilePicker({
                multiple: false,
                types: [{
                    description: 'TextWarp source',
                    accept: {'text/plain': ['.tw']}
                }]
            });
            const handle = handles && handles[0];
            if (!handle) return;
            const file = await handle.getFile();
            const source = await file.text();
            this.handleChange(source);
            this.setState({
                externalHandle: handle,
                externalLastModified: file.lastModified || 0,
                externalName: handle.name || file.name,
                externalOpen: true,
                externalSyncState: 'synchronized',
                status: this.t('fileOpened', {name: handle.name || file.name}),
                statusKind: 'success'
            });
        } catch (error) {
            if (error && error.name === 'NotSupportedError') {
                if (this.externalInput) this.externalInput.click();
                return;
            }
            if (!error || error.name !== 'AbortError') {
                this.setState({status: error.message, statusKind: 'error'});
            }
        }
    }

    async saveExternalSource (saveAs = false) {
        try {
            const target = this.getTarget();
            if (!target) return;
            let handle = saveAs ? null : this.state.externalHandle;
            if (!handle || typeof handle.createWritable !== 'function') {
                handle = await showTextwarpSaveFilePicker({
                    suggestedName: targetFileName(target),
                    types: [{
                        description: 'TextWarp source',
                        accept: {'text/plain': ['.tw']}
                    }],
                    excludeAcceptAllOption: true
                });
            }
            if (!saveAs && handle === this.state.externalHandle && typeof handle.getFile === 'function') {
                const currentFile = await handle.getFile();
                const changedOutside = this.state.externalLastModified &&
                    currentFile.lastModified > this.state.externalLastModified;
                if (changedOutside && typeof window !== 'undefined' && !window.confirm(this.t('externalOverwriteWarning'))) {
                    this.setState({
                        externalSyncState: 'conflict',
                        status: this.t('externalConflictHelp'),
                        statusKind: 'error'
                    });
                    return;
                }
            }
            const writable = await handle.createWritable();
            try {
                await writable.write(this.state.source);
                await writable.close();
            } catch (error) {
                await writable.abort();
                throw error;
            }
            const savedFile = typeof handle.getFile === 'function' ? await handle.getFile() : null;
            this.setState({
                externalHandle: handle,
                externalLastModified: savedFile && savedFile.lastModified || Date.now(),
                externalName: handle.name || targetFileName(target),
                externalOpen: true,
                externalSyncState: 'synchronized',
                status: this.t('externalSynchronized'),
                statusKind: 'success'
            });
        } catch (error) {
            if (!error || error.name !== 'AbortError') {
                this.setState({status: error.message, statusKind: 'error'});
            }
        }
    }

    async reloadExternalSource () {
        const handle = this.state.externalHandle;
        if (!handle || typeof handle.getFile !== 'function') {
            this.setState({status: this.t('externalNoHandle'), statusKind: 'working'});
            return;
        }
        try {
            const file = await handle.getFile();
            this.handleChange(await file.text());
            this.setState({
                externalLastModified: file.lastModified || 0,
                externalSyncState: 'synchronized',
                status: this.t('externalSynchronized'),
                statusKind: 'success'
            });
        } catch (error) {
            this.setState({status: error.message, statusKind: 'error'});
        }
    }

    async handleExternalFile (event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        this.handleChange(await file.text());
        this.setState({
            externalHandle: null,
            externalLastModified: file.lastModified || 0,
            externalName: file.name,
            externalOpen: true,
            externalSyncState: 'imported',
            status: this.t('fileOpened', {name: file.name}),
            statusKind: 'success'
        });
    }

    async openTextwarp () {
        if (this.state.busy) return;
        const workingMessage = this.t('openChoose');
        this.setFileOperation(TEXTWARP_UI_COMMANDS.OPEN, 'working', workingMessage);
        this.setState({status: workingMessage, statusKind: 'working'});
        try {
            const handles = await showTextwarpOpenFilePicker({
                multiple: false,
                types: [{
                    description: 'TextWarp Project',
                    accept: {'application/zip': ['.textwarp']}
                }],
                excludeAcceptAllOption: true
            });
            const handle = handles && handles[0];
            if (!handle) {
                const cancelledMessage = this.t('openCancelled');
                this.setState({status: cancelledMessage, statusKind: 'idle'});
                this.setFileOperation(TEXTWARP_UI_COMMANDS.OPEN, 'idle', cancelledMessage);
                return;
            }
            await this.importTextwarpFile(await handle.getFile(), handle);
        } catch (error) {
            if (error && error.name === 'NotSupportedError') {
                if (this.packageInput) this.packageInput.click();
                return;
            }
            if (error && error.name === 'AbortError') {
                const cancelledMessage = this.t('openCancelled');
                this.setState({status: cancelledMessage, statusKind: 'idle'});
                this.setFileOperation(TEXTWARP_UI_COMMANDS.OPEN, 'idle', cancelledMessage);
            } else {
                this.setState({status: error.message, statusKind: 'error'});
                this.setFileOperation(TEXTWARP_UI_COMMANDS.OPEN, 'error', error.message);
            }
        }
    }

    async importTextwarpFile (file, handle = null) {
        if (!file || this.state.busy) return;
        this.setState({
            busy: true,
            status: this.t('openingFile', {name: file.name}),
            statusKind: 'working'
        });
        try {
            const result = await importTextwarpProject(this.props.vm, await file.arrayBuffer());
            if (handle) {
                setTextwarpHandle(handle);
                notifyTextwarpFileOpened(handle);
            } else {
                clearTextwarpHandle(file.name);
            }
            this.props.onClearSb3FileHandle();
            const errors = result.diagnostics.filter(module => !module.success).length;
            this.refreshExtensionCatalog();
            this.syncAllBreakpoints();
            const resultMessage = errors ?
                this.t('openWithErrors', {count: errors, name: file.name}) :
                this.t('openSuccess', {name: file.name});
            this.setState({
                status: resultMessage,
                statusKind: errors ? 'error' : 'success',
                busy: false
            });
            this.setFileOperation(
                TEXTWARP_UI_COMMANDS.OPEN,
                errors ? 'error' : 'success',
                resultMessage
            );
            this.props.onSetProjectUnchanged();
            setTimeout(() => this.loadSelectedTarget(), 0);
        } catch (error) {
            console.error(error);
            this.setState({status: error.message, statusKind: 'error', busy: false});
            this.setFileOperation(TEXTWARP_UI_COMMANDS.OPEN, 'error', error.message);
        }
    }

    async handlePackageFile (event) {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (file) await this.importTextwarpFile(file);
    }

    handleToggleBreakpoint (line) {
        const target = this.getTarget();
        if (!target) return;
        const next = new Set(this.state.breakpoints);
        if (next.has(line)) next.delete(line);
        else next.add(line);
        this.handleBreakpointsChange(Array.from(next).sort((left, right) => left - right));
    }

    handleBreakpointsChange (breakpoints) {
        const target = this.getTarget();
        if (!target) return;
        saveBreakpoints(this.props.vm, target, breakpoints);
        this.debugController.setBreakpoints(target, breakpoints);
        this.debugController.setEnabled(
            this.state.activeBottomPanel === 'debugger' || this.debugController.hasBreakpoints()
        );
        this.setState({breakpoints});
    }

    handleSecondaryBreakpointsChange (breakpoints) {
        const target = this.state.secondaryTargetId &&
            this.props.vm.runtime.getTargetById(this.state.secondaryTargetId);
        if (!target) return;
        saveBreakpoints(this.props.vm, target, breakpoints);
        this.debugController.setBreakpoints(target, breakpoints);
        this.debugController.setEnabled(
            this.state.activeBottomPanel === 'debugger' || this.debugController.hasBreakpoints()
        );
        this.refreshWorkspace();
    }

    handleInvalidShortcut (shortcut) {
        this.setState({
            status: this.t('invalidShortcut', {shortcut}),
            statusKind: 'error'
        });
    }

    addWatch (event) {
        event.preventDefault();
        const expression = this.state.watchInput.trim();
        if (!expression || this.state.watches.includes(expression)) return;
        this.setState(state => ({watches: state.watches.concat(expression), watchInput: ''}));
    }

    getWatchValues () {
        const selected = this.state.debugSnapshot.threads.find(thread => thread.id === this.state.selectedThreadId) ||
            this.state.debugSnapshot.threads.find(thread => thread.paused);
        const target = selected && this.props.vm.runtime.getTargetById(selected.targetId) || this.getTarget();
        const stage = this.getStage();
        return this.state.watches.map(expression => Object.assign({expression}, inspectExpression(expression, target, stage)));
    }

    renderDiagnostics () {
        const t = createTranslator(this.props.locale);
        const target = this.getTarget();
        const diagnosticFileName = target ? targetFileName(target) : '';
        const reportActions = (
            <div className={styles.diagnosticReportActions}>
                <span>{t('diagnosticReportIncludesCode')}</span>
                <button
                    type="button"
                    onClick={this.handleCopyDiagnosticReport}
                >
                    {t('copyDiagnosticReport')}
                </button>
                <button
                    type="button"
                    onClick={this.handleDownloadDiagnosticReport}
                >
                    {t('downloadDiagnosticReport')}
                </button>
            </div>
        );
        if (this.state.diagnostics.length === 0) return (
            <React.Fragment>
                {reportActions}
                <span className={styles.noDiagnostics}>{t('noProblems')}</span>
            </React.Fragment>
        );
        const visible = getVisibleItems(this.state.diagnostics, this.state.diagnosticLimit);
        return (
            <React.Fragment>
                {reportActions}
                {visible.items.map((item, index) => {
                    const quoted = item.message.match(/[“"]([^”"]+)[”"]/);
                    const helpQuery = quoted && quoted[1] || (/indent/.test(item.code) ? 'indentação' :
                        /variable|list/.test(item.code) ? 'variável lista' :
                            /procedure|parameter|return/.test(item.code) ? 'procedimentos parâmetros' : 'referência');
                    return (
                        <div
                            className={classNames(styles.diagnostic, styles[item.severity])}
                            key={`${item.line}:${item.column}:${item.code}:${index}`}
                        >
                            <button title={t('goToProblem')} type="button" onClick={() => this.openLocation({
                                targetId: this.props.editingTargetId, line: item.line, column: item.column
                            })}>
                                <span className={styles.diagnosticLocation}>
                                    {`${diagnosticFileName}:${item.line}:${item.column}`}
                                </span>
                                <span>{item.message}</span>
                                {getDiagnosticSuggestion(item) && <em>{getDiagnosticSuggestion(item)}</em>}
                                <small>{item.code}</small>
                            </button>
                            <button className={styles.diagnosticHelp} type="button" onClick={() => this.setState({
                                docsQuery: helpQuery
                            }, () => this.setViewMode('docs'))}>{t('help')}</button>
                        </div>
                    );
                })}
                {visible.hiddenCount > 0 && <button
                    className={styles.showMore}
                    type="button"
                    onClick={() => this.setState(state => ({
                        diagnosticLimit: state.diagnosticLimit + DEFAULT_LIST_LIMIT
                    }))}
                >{t('showMoreItems', {count: visible.hiddenCount})}</button>}
                {visible.totalCount > DEFAULT_LIST_LIMIT && <span className={styles.listCount}>
                    {t('showingItems', {visible: visible.items.length, total: visible.totalCount})}
                </span>}
            </React.Fragment>
        );
    }

    renderConsole () {
        const t = createTranslator(this.props.locale);
        const entries = (this.state.debugSnapshot.consoleEntries || []).slice().reverse();
        const visible = getVisibleItems(entries, this.state.consoleLimit);
        return (
            <div className={styles.console} aria-label={t('outputConsole')}>
                <div className={styles.consoleActions}>
                    <strong>{t('consoleStructured')}</strong>
                    <span>{this.state.debugSnapshot.executionState === 'running' ?
                        t('runtimeStateRunning') : this.state.debugSnapshot.executionState === 'paused' ?
                            t('runtimeStatePaused') : t('runtimeStateStopped')}</span>
                    <button type="button" onClick={() => this.debugController.clearConsole()}>
                        {t('clear')}
                    </button>
                </div>
                <div className={styles.consoleEntries} role="log" aria-live="polite">
                    {!entries.length && <span className={styles.noDiagnostics}>{t('consoleEmpty')}</span>}
                    {visible.items.map(entry => (
                        <button
                            className={styles[entry.level]}
                            disabled={!entry.line}
                            key={entry.id}
                            type="button"
                            onClick={() => entry.line && this.openLocation({targetId: entry.targetId, line: entry.line})}
                        >
                            <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                            <span>{entry.level}</span>
                            <code>{entry.targetName}{entry.line ? `:${entry.line}` : ''}</code>
                            <pre>{entry.message}</pre>
                        </button>
                    ))}
                    {visible.hiddenCount > 0 && <button
                        className={styles.showMore}
                        type="button"
                        onClick={() => this.setState(state => ({
                            consoleLimit: state.consoleLimit + DEFAULT_LIST_LIMIT
                        }))}
                    >{t('showMoreItems', {count: visible.hiddenCount})}</button>}
                </div>
            </div>
        );
    }

    renderDebugger () {
        const t = createTranslator(this.props.locale);
        const snapshot = this.state.debugSnapshot;
        const selectedThread = snapshot.threads.find(thread => thread.id === this.state.selectedThreadId) ||
            snapshot.threads.find(thread => thread.paused) || snapshot.threads[0];
        const inspector = selectedThread && selectedThread.inspector;
        const watches = this.getWatchValues();
        const visibleThreads = getVisibleItems(snapshot.threads, this.state.debugLimit);
        const executionMode = snapshot.selectiveInterpreter ? t('debugSelectiveInterpreter') :
            snapshot.interpreterRequired ? t('debugGlobalInterpreter') :
                snapshot.jitEnabled ? t('debugJitActive') : t('debugProjectInterpreter');
        return (
            <div className={styles.debugger}>
                <div className={styles.debugActions}>
                    <button type="button" onClick={() => this.debugController.pauseAll()}>
                        {t('pauseThreads')}
                    </button>
                    <button type="button" onClick={() => this.debugController.resumeAll()}>
                        {t('resumeAll')}
                    </button>
                    <span>{t('debugSummary', {
                        breakpoints: this.state.breakpoints.length,
                        mode: executionMode,
                        threads: snapshot.threads.length
                    })}</span>
                </div>
                <div className={styles.debugGrid}>
                <div className={styles.threadList}>
                    {snapshot.threads.length === 0 && <span className={styles.noDiagnostics}>
                        {t('noActiveThreads')}
                    </span>}
                    {visibleThreads.items.map(thread => (
                        <div
                            className={classNames(styles.thread, selectedThread && selectedThread.id === thread.id && styles.selectedThread)}
                            key={thread.id}
                        >
                            <button className={styles.threadSelect} type="button" onClick={() => this.setState({selectedThreadId: thread.id})}>
                            <span className={classNames(styles.threadState, thread.paused && styles.threadPaused)}>
                                {thread.paused ? t('runtimeStatePaused') : t('runtimeStateRunning')}
                            </span>
                            <strong>{thread.targetName}</strong>
                            <code>
                                {thread.line ? t('lineNumber', {line: thread.line}) :
                                    thread.blockId || t('noLine')} · {
                                    thread.executionMode === 'jit' ? 'JIT' : t('interpreter')
                                }
                            </code>
                            </button>
                            {thread.paused && <>
                                <button type="button" onClick={() => this.debugController.stepThread(thread.id)}>
                                    {thread.stepGranularity === 'frame' ?
                                        t('stepFrame') : t('stepInto')}
                                </button>
                                {thread.stepGranularity !== 'frame' && <button type="button" onClick={() =>
                                    this.debugController.stepOverThread(thread.id)
                                }>{t('stepOver')}</button>}
                                {thread.canStepOut && <button type="button" onClick={() =>
                                    this.debugController.stepOutThread(thread.id)
                                }>{t('stepOut')}</button>}
                                <button type="button" onClick={() => this.debugController.resumeThread(thread.id)}>
                                    {t('resume')}
                                </button>
                            </>}
                        </div>
                    ))}
                    {visibleThreads.hiddenCount > 0 && <button
                        className={styles.showMore}
                        type="button"
                        onClick={() => this.setState(state => ({
                            debugLimit: state.debugLimit + DEFAULT_LIST_LIMIT
                        }))}
                    >{t('showMoreItems', {count: visibleThreads.hiddenCount})}</button>}
                </div>
                <div className={styles.inspector}>
                    <section>
                        <h3>{t('variablesAndState')}</h3>
                        {inspector && inspector.target && <code>
                            x {inspector.target.x} · y {inspector.target.y} · {
                                t('direction')
                            } {inspector.target.direction} · {
                                inspector.target.visible ? t('visible') : t('hidden')
                            }
                        </code>}
                        {inspector && inspector.variables.map(variable => (
                            <div key={`${variable.ownerId}:${variable.id}`}>
                                <strong>{variable.name}</strong>
                                <span>{variable.ownerName}</span>
                                <code>{JSON.stringify(variable.value)}</code>
                            </div>
                        ))}
                    </section>
                    <section>
                        <h3>{t('callStack')}</h3>
                        {selectedThread && selectedThread.callStack.map((frame, index) => (
                            <button key={`${frame.blockId}:${index}`} type="button" onClick={() => frame.line && this.openLocation({
                                targetId: selectedThread.targetId,
                                line: frame.line
                            })}>
                                <code>{frame.opcode || frame.blockId}</code>
                                <span>{frame.line ? `L${frame.line}` : t('noSource')}</span>
                            </button>
                        ))}
                    </section>
                    <section>
                        <h3>{t('watch')}</h3>
                        <form onSubmit={event => this.addWatch(event)}>
                            <input
                                aria-label={t('watchExpression')}
                                placeholder="score * 2"
                                value={this.state.watchInput}
                                onChange={event => this.setState({watchInput: event.target.value})}
                            />
                            <button type="submit">{createTranslator(this.props.locale)('add')}</button>
                        </form>
                        {watches.map(watch => (
                            <div key={watch.expression}>
                                <strong>{watch.expression}</strong>
                                <code>{watch.success ? JSON.stringify(watch.value) : watch.error}</code>
                                <button
                                    aria-label={t('removeWatch', {name: watch.expression})}
                                    type="button"
                                    onClick={() => this.setState(state => ({
                                        watches: state.watches.filter(item => item !== watch.expression)
                                    }))}
                                ><InterfaceIcon name="close" /></button>
                            </div>
                        ))}
                    </section>
                </div>
                </div>
                {snapshot.runtimeErrors.slice(0, 3).map(error => (
                    <details className={styles.runtimeError} key={`${error.timestamp}:${error.blockId}`}>
                        <summary>{t('runtimeError', {
                            location: error.line ? ` L${error.line}` : '',
                            message: error.message,
                            target: error.targetName
                        })}</summary>
                        {error.stack && <pre>{error.stack}</pre>}
                        {error.callStack && error.callStack.length > 0 && <code>{error.callStack.map(frame =>
                            `${frame.line ? `L${frame.line}` : frame.blockId}`
                        ).join(' ← ')}</code>}
                    </details>
                ))}
            </div>
        );
    }

    renderExtensionCatalog () {
        const t = createTranslator(this.props.locale);
        const entries = this.state.extensionPalette.filter(entry => entry.kind !== 'separator');
        const visible = getVisibleItems(entries, this.state.extensionLimit);
        return (
            <div className={styles.extensionCatalog}>
                {entries.length === 0 && <span className={styles.noDiagnostics}>{t('noExtensions')}</span>}
                {visible.items.map((entry, index) => (
                    <div className={styles.extensionEntry} key={`${entry.canonicalName}:${index}`}>
                        <span className={styles.extensionKind}>{entry.kind}</span>
                        <code>{entry.canonicalName}</code>
                        {entry.text && <span>{entry.text}</span>}
                        {entry.kind === 'xml' && entry.xml && <code className={styles.extensionXml}>{entry.xml}</code>}
                        {entry.kind === 'xml' && entry.xml && (
                            <button
                                type="button"
                                onClick={() => this.handleInsertExtensionXml(entry)}
                            >{t('insertBlocks')}</button>
                        )}
                        {entry.kind === 'button' && entry.actionId && (
                            <button
                                type="button"
                                onClick={() => this.props.vm.handleExtensionButtonPress(entry.actionId)}
                            >{t('runAction')}</button>
                        )}
                    </div>
                ))}
                {visible.hiddenCount > 0 && <button
                    className={styles.showMore}
                    type="button"
                    onClick={() => this.setState(state => ({
                        extensionLimit: state.extensionLimit + DEFAULT_LIST_LIMIT
                    }))}
                >{t('showMoreItems', {count: visible.hiddenCount})}</button>}
                {visible.totalCount > DEFAULT_LIST_LIMIT && <span className={styles.listCount}>
                    {t('showingItems', {visible: visible.items.length, total: visible.totalCount})}
                </span>}
            </div>
        );
    }

    render () {
        const t = createTranslator(this.props.locale);
        const target = this.getTarget();
        const activeLines = this.state.debugSnapshot.activeLinesByTarget[this.props.editingTargetId] || [];
        const secondaryTarget = this.state.secondaryTargetId &&
            this.props.vm.runtime.getTargetById(this.state.secondaryTargetId);
        const secondaryActiveLines = secondaryTarget ?
            this.state.debugSnapshot.activeLinesByTarget[secondaryTarget.id] || [] : [];
        const activeFileName = target ? targetFileName(target) : '';
        const externalStateLabel = {
            conflict: t('externalConflict'),
            dirty: t('externalDirty'),
            imported: t('externalImported'),
            synchronized: t('externalConnected')
        }[this.state.externalSyncState] || t('externalDisconnected');
        const dirty = this.state.source !== this.lastAppliedSource || this.state.saveState === 'salvando';
        const syncKind = this.state.visualConflict ? 'conflict' :
            countErrors(this.state.diagnostics) ? 'error' :
                this.state.blocksDiverged ? 'blocks-dirty' :
                    dirty ? 'dirty' : 'synchronized';
        const syncLabel = {
            conflict: t('syncConflict'),
            'blocks-dirty': t('syncBlocksChanged'),
            dirty: t('syncTextChanged'),
            error: t('syncUnavailable'),
            synchronized: t('syncSynchronized')
        }[syncKind];
        const conflictDiff = this.state.visualConflict && this.state.visualConflict.semanticDiff;
        const conflictMerge = this.state.visualConflict && this.state.visualConflict.semanticMerge;
        const conflictUnitGroups = this.state.visualConflict ? [
            {
                label: t('conflictUnitsAdded', {count: conflictDiff ? conflictDiff.added.length : 0}),
                ids: conflictDiff ? conflictDiff.added : []
            },
            {
                label: t('conflictUnitsRemoved', {count: conflictDiff ? conflictDiff.removed.length : 0}),
                ids: conflictDiff ? conflictDiff.removed : []
            },
            {
                label: t('conflictUnitsChanged', {
                    count: conflictDiff ? conflictDiff.changed.length :
                        conflictMerge && conflictMerge.conflicts.length || 0
                }),
                ids: conflictDiff ? conflictDiff.changed : conflictMerge && conflictMerge.conflicts || []
            }
        ] : [];
        const rootStyle = {
            '--textwarp-bottom-panel-height': `${this.state.bottomPanelHeight}px`,
            '--textwarp-sidebar-width': `${this.state.sidebarWidth}px`,
            '--textwarp-split-ratio': `${this.state.splitRatio}%`
        };
        return (
            <section
                aria-label={t('editor')}
                className={classNames(
                    styles.root,
                    this.state.layoutMode === 'condensed' && styles.condensedLayout,
                    this.state.compactLayout && styles.compactLayout,
                    this.state.compactUi && styles.compactUi,
                    this.state.narrowLayout && styles.narrowLayout
                )}
                data-tabs="textwarp"
                ref={element => { this.rootElement = element; }}
                style={rootStyle}
            >
                <header className={styles.toolbar} role="toolbar">
                    <div className={styles.viewTabs} aria-label={t('viewModes')} role="tablist">
                        {[
                            ['code', t('textView')],
                            ['blocks', t('blocks')],
                            ['split', t('textAndBlocks')],
                            ['docs', t('documentation')]
                        ].map(([id, label]) => (
                            <button
                                aria-controls="textwarp-editor-area"
                                aria-selected={this.state.viewMode === id}
                                className={this.state.viewMode === id ? styles.activeTab : ''}
                                data-tab-id={id}
                                id={`textwarp-view-tab-${id}`}
                                key={id}
                                role="tab"
                                tabIndex={this.state.viewMode === id ? 0 : -1}
                                title={label}
                                type="button"
                                onClick={() => {
                                    if (id === 'docs') this.setState({docsQuery: ''}, () => this.setViewMode(id));
                                    else this.setViewMode(id);
                                }}
                                onKeyDown={event => this.handleTabKeyDown(
                                    event,
                                    VIEW_IDS,
                                    id,
                                    nextId => this.setViewMode(nextId)
                                )}
                            >{label}</button>
                        ))}
                    </div>
                </header>
                <div className={styles.openTabsRegion}>
                    <nav
                        aria-label={t('openScripts')}
                        className={styles.openTabs}
                        ref={element => {
                            this.openTabsElement = element;
                        }}
                        role="tablist"
                    >
                        {this.state.openTargetIds.map(targetId => {
                            const module = this.state.workspace.modules.find(item => item.id === targetId);
                            if (!module) return null;
                            const active = targetId === this.props.editingTargetId;
                            const targetIndex = this.state.openTargetIds.indexOf(targetId);
                            return (
                                <div
                                    className={classNames(
                                        active && styles.activeFileTab,
                                        this.state.draggedTargetId === targetId && styles.draggingFileTab
                                    )}
                                    data-textwarp-tab-menu
                                    draggable
                                    key={targetId}
                                    onContextMenu={event => {
                                        event.preventDefault();
                                        this.setState({
                                            actionMenuOpen: false,
                                            convertMenuOpen: false,
                                            fileTabMenu: {
                                                targetId,
                                                x: event.clientX,
                                                y: event.clientY
                                            }
                                        });
                                    }}
                                    onDragEnd={() => this.setState({draggedTargetId: null})}
                                    onDragOver={event => event.preventDefault()}
                                    onDragStart={event => {
                                        event.dataTransfer.effectAllowed = 'move';
                                        event.dataTransfer.setData('text/plain', targetId);
                                        this.setState({draggedTargetId: targetId});
                                    }}
                                    onDrop={event => {
                                        event.preventDefault();
                                        this.reorderTargetTabs(
                                            event.dataTransfer.getData('text/plain') || this.state.draggedTargetId,
                                            targetId
                                        );
                                    }}
                                >
                                    <button
                                        aria-selected={active}
                                        className={styles.fileTabMain}
                                        data-tab-id={targetId}
                                        role="tab"
                                        tabIndex={active ? 0 : -1}
                                        title={module.fileName}
                                        type="button"
                                        onAuxClick={event => {
                                            if (event.button === 1 && this.state.openTargetIds.length > 1) {
                                                this.closeTarget(event, targetId);
                                            }
                                        }}
                                        onClick={() => this.openTarget(targetId)}
                                        onKeyDown={event => this.handleTabKeyDown(
                                            event,
                                            this.state.openTargetIds,
                                            targetId,
                                            this.openTarget
                                        )}
                                    >
                                        <span>{module.fileName}</span>
                                        {active && dirty && (
                                            <small aria-hidden="true" className={styles.dirtyIndicator}>{'●'}</small>
                                        )}
                                    </button>
                                    {this.state.openTargetIds.length > 1 && <button
                                        aria-label={`${t('close')} ${module.fileName}`}
                                        className={styles.closeFileTab}
                                        type="button"
                                        onClick={event => this.closeTarget(event, targetId)}
                                    >
                                        <InterfaceIcon name="close" />
                                    </button>}
                                    {this.state.fileTabMenu && this.state.fileTabMenu.targetId === targetId && (
                                        <div
                                            aria-label={t('fileTabActions')}
                                            className={styles.fileTabContextMenu}
                                            role="menu"
                                            style={{
                                                left: this.state.fileTabMenu.x,
                                                top: this.state.fileTabMenu.y
                                            }}
                                            onKeyDown={this.handleActionMenuKeyDown}
                                        >
                                            <button
                                                disabled={this.state.openTargetIds.length <= 1}
                                                role="menuitem"
                                                type="button"
                                                onClick={() => this.closeTargets([targetId])}
                                            >{t('close')}</button>
                                            <button
                                                disabled={this.state.openTargetIds.length <= 1}
                                                role="menuitem"
                                                type="button"
                                                onClick={() => this.closeTargets(
                                                    this.state.openTargetIds.filter(id => id !== targetId)
                                                )}
                                            >{t('closeOthers')}</button>
                                            <button
                                                disabled={targetIndex === this.state.openTargetIds.length - 1}
                                                role="menuitem"
                                                type="button"
                                                onClick={() => this.closeTargets(
                                                    this.state.openTargetIds.slice(targetIndex + 1)
                                                )}
                                            >{t('closeRight')}</button>
                                            <button
                                                role="menuitem"
                                                type="button"
                                                onClick={() => this.setState(
                                                    {fileTabMenu: null},
                                                    () => this.setViewMode('dual')
                                                )}
                                            >{t('splitEditor')}</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </nav>
                    <button
                        aria-label={t('openFileExplorer')}
                        className={styles.newFileTab}
                        title={t('openFileExplorer')}
                        type="button"
                        onClick={() => {
                            this.setState({sidebarPanel: 'explorer', sidebarVisible: true});
                            this.persistUiState({sidebarPanel: 'explorer', sidebarVisible: true});
                        }}
                    >
                        <InterfaceIcon name="plus" />
                    </button>
                    <label className={styles.openTabsMenu}>
                        <span>{t('moreTabs')}</span>
                        <select
                            aria-label={t('moreTabs')}
                            value={this.props.editingTargetId || ''}
                            onChange={event => this.openTarget(event.target.value)}
                        >
                            {this.state.openTargetIds.map(targetId => {
                                const module = this.state.workspace.modules.find(item => item.id === targetId);
                                return module && <option key={targetId} value={targetId}>{module.fileName}</option>;
                            })}
                        </select>
                    </label>
                    <span className={classNames(styles.syncState, styles[syncKind])} title={syncLabel}>
                        <span aria-hidden="true" />
                        {syncLabel}
                    </span>
                    <div
                        className={styles.convertMenu}
                        ref={element => {
                            this.convertMenuElement = element;
                        }}
                    >
                        <button
                            aria-controls="textwarp-convert-menu"
                            aria-expanded={this.state.convertMenuOpen}
                            aria-haspopup="menu"
                            className={styles.convertMenuTrigger}
                            disabled={!this.state.targetName || this.state.busy}
                            ref={element => {
                                this.convertMenuButton = element;
                            }}
                            type="button"
                            onClick={() => this.handleToggleConvertMenu()}
                        >
                            <InterfaceIcon name="convert" />
                            <span>{t('convert')}</span>
                            <InterfaceIcon name="chevron-down" />
                        </button>
                        {this.state.convertMenuOpen && (
                            <div
                                aria-label={t('convert')}
                                className={styles.actionMenuPopup}
                                id="textwarp-convert-menu"
                                role="menu"
                                onKeyDown={this.handleActionMenuKeyDown}
                            >
                                <button role="menuitem" type="button" onClick={() => {
                                    this.closeConvertMenu();
                                    this.handleCompile();
                                }}>{t('textToBlocks')}</button>
                                <button role="menuitem" type="button" onClick={() => {
                                    this.closeConvertMenu();
                                    this.handleImportBlocks();
                                }}>{t('blocksToText')}</button>
                                <button role="menuitem" type="button" onClick={() => {
                                    this.closeConvertMenu();
                                    this.handleImportProjectBlocks();
                                }}>{t('blocksToTextProject')}</button>
                                <button
                                    aria-checked={this.state.autoSync}
                                    className={styles.menuStatusItem}
                                    role="menuitemcheckbox"
                                    type="button"
                                    onClick={() => this.setAutoSync(!this.state.autoSync)}
                                >
                                    <span>{t('autoSync')}</span>
                                    <small>{this.state.autoSync ? t('enabled') : t('disabled')}</small>
                                </button>
                                <button role="menuitem" type="button" onClick={() => this.compareTextAndBlocks()}>
                                    {t('compareVersions')}
                                </button>
                            </div>
                        )}
                    </div>
                    <div
                        className={styles.actionMenu}
                        ref={element => {
                            this.actionMenuElement = element;
                        }}
                    >
                        <button
                            aria-controls="textwarp-action-menu"
                            aria-expanded={this.state.actionMenuOpen}
                            aria-haspopup="menu"
                            aria-label={t('moreActions')}
                            className={styles.actionMenuTrigger}
                            ref={element => {
                                this.actionMenuButton = element;
                            }}
                            title={t('moreActions')}
                            type="button"
                            onClick={this.handleToggleActionMenu}
                        >
                            <InterfaceIcon name="more" />
                        </button>
                        {this.state.actionMenuOpen && (
                            <div
                                aria-label={t('moreActions')}
                                className={styles.actionMenuPopup}
                                id="textwarp-action-menu"
                                role="menu"
                                onKeyDown={this.handleActionMenuKeyDown}
                            >
                                <button role="menuitem" type="button" onClick={this.handleMobileCommands}>
                                    {t('commandPalette')} <small>{'Ctrl+Shift+P'}</small>
                                </button>
                                <button role="menuitem" type="button" onClick={() => {
                                    this.closeActionMenu();
                                    if (this.monacoEditor) this.monacoEditor.formatDocument();
                                }}>{t('formatDocument')}</button>
                                <button role="menuitem" type="button" onClick={() => {
                                    this.closeActionMenu();
                                    this.setViewMode('dual');
                                }}>{t('splitEditor')}</button>
                                <button role="menuitem" type="button" onClick={() => {
                                    this.closeActionMenu();
                                    this.setViewMode('docs');
                                }}>{t('documentation')}</button>
                                <button
                                    aria-controls="textwarp-external-panel"
                                    className={styles.menuStatusItem}
                                    role="menuitem"
                                    type="button"
                                    onClick={this.handleOpenExternalPanel}
                                >
                                    <span>{t('externalEditor')}</span>
                                    <small className={classNames(
                                        styles.connectionState,
                                        styles[this.state.externalSyncState]
                                    )}>{externalStateLabel}</small>
                                </button>
                                <button
                                    aria-controls="textwarp-settings-panel"
                                    role="menuitem"
                                    type="button"
                                    onClick={this.handleOpenSettingsPanel}
                                >{t('preferences')}</button>
                            </div>
                        )}
                    </div>
                </div>
                <input
                    accept=".textwarp,application/zip"
                    className={styles.hiddenInput}
                    ref={element => {
                        this.packageInput = element;
                    }}
                    type="file"
                    onCancel={() => {
                        const message = this.t('openCancelled');
                        this.setFileOperation(TEXTWARP_UI_COMMANDS.OPEN, 'idle', message);
                        this.setState({status: message, statusKind: 'idle'});
                    }}
                    onChange={this.handlePackageFile}
                />
                <input
                    accept=".tw,text/plain"
                    className={styles.hiddenInput}
                    ref={element => {
                        this.externalInput = element;
                    }}
                    type="file"
                    onChange={this.handleExternalFile}
                />
                {this.state.settingsOpen && (
                    <QuickPanel
                        closeLabel={t('close')}
                        id="textwarp-settings-panel"
                        label={t('editorPreferences')}
                        onClose={() => this.setState({settingsOpen: false})}
                    >
                        <label className={styles.fontPreference}>
                            <span>{t('fontSize')}</span>
                            <input
                                aria-label={t('fontSize')}
                                max="28"
                                min="11"
                                type="range"
                                value={this.state.fontSize}
                                onChange={event => this.setFontSize(event.target.value)}
                            />
                            <output>{`${this.state.fontSize}px`}</output>
                        </label>
                        <label className={styles.compactPreference}>
                            <input
                                checked={this.state.compactUi}
                                type="checkbox"
                                onChange={this.handleCompactUiChange}
                            />
                            <span>
                                <strong>{t('compactUi')}</strong>
                                <small>{t('compactUiDescription')}</small>
                            </span>
                        </label>
                        {Object.entries(this.state.shortcuts).map(([name, value]) => (
                            <label key={name}>
                                <span>{t(SHORTCUT_MESSAGE_KEYS[name])}</span>
                                <input value={value} onChange={event => this.updateShortcut(name, event.target.value)} />
                            </label>
                        ))}
                        <button type="button" onClick={() => {
                            const shortcuts = Object.assign({}, DEFAULT_SHORTCUTS);
                            this.setState({shortcuts});
                            const storage = this.getStorage();
                            try {
                                if (storage) storage.setItem('textwarp.ide.shortcuts', JSON.stringify(shortcuts));
                            } catch (error) {
                                this.setState({
                                    status: this.t('defaultsSessionOnly'),
                                    statusKind: 'working'
                                });
                            }
                            this.setFontSize(DEFAULT_FONT_SIZE);
                        }}>{t('resetDefaults')}</button>
                        <button type="button" onClick={this.resetLayout}>
                            <InterfaceIcon name="reset" />
                            {t('resetLayout')}
                        </button>
                    </QuickPanel>
                )}
                {this.state.externalOpen && (
                    <QuickPanel
                        closeLabel={t('close')}
                        id="textwarp-external-panel"
                        label={t('externalEditor')}
                        onClose={() => this.setState({externalOpen: false})}
                    >
                        <span className={styles.quickPanelHelp}>{t('externalHelp')}</span>
                        {this.state.externalName && <code>{this.state.externalName}</code>}
                        <span
                            className={classNames(styles.externalStatus, styles[this.state.externalSyncState])}
                            role="status"
                        >
                            {externalStateLabel}
                        </span>
                        <button type="button" onClick={() => this.connectExternalSource()}>{t('externalConnect')}</button>
                        <button
                            disabled={!this.state.externalHandle}
                            type="button"
                            onClick={() => this.saveExternalSource(false)}
                        >{t('externalSave')}</button>
                        <button type="button" onClick={() => this.saveExternalSource(true)}>{t('saveAs')}</button>
                        <button disabled={!this.state.externalHandle} type="button" onClick={() => this.reloadExternalSource()}>
                            {t('externalReload')}
                        </button>
                    </QuickPanel>
                )}
                {this.state.conversionScopePrompt && (
                    <div aria-live="assertive" className={styles.conflictBanner} role="alert">
                        <div>
                            <strong>{t('conversionScopeTitle')}</strong>
                            <span>{t('conversionScopeDescription', {
                                unowned: this.state.conversionScopePrompt.unownedCount,
                                matching: this.state.conversionScopePrompt.matchingRootIds.length
                            })}</span>
                        </div>
                        <button type="button" onClick={() => this.resolveConversionScope('replace')}>
                            {t('conversionScopeReplace')}
                        </button>
                        <button type="button" onClick={() => this.resolveConversionScope('add')}>
                            {t('conversionScopeAdd')}
                        </button>
                        <button type="button" onClick={() => this.resolveConversionScope('cancel')}>
                            {t('cancel')}
                        </button>
                    </div>
                )}
                {this.state.visualConflict && (
                    <div aria-live="assertive" className={styles.conflictBanner} role="alert">
                        <div>
                            <strong>{t('conflictTitle')}</strong>
                            <span>{t('conflictDescription')}</span>
                            <small>{t('conflictAffected', {
                                count: this.state.visualConflict.semanticMerge ?
                                    this.state.visualConflict.semanticMerge.conflicts.length : 1,
                                name: activeFileName
                            })}</small>
                        </div>
                        <button type="button" onClick={() => this.setState({conflictReviewOpen: true})}>
                            {t('conflictReview')}
                        </button>
                        <button type="button" onClick={() => this.keepTextChanges()}>
                            {t('conflictKeepText')}
                        </button>
                        <button type="button" onClick={() => this.acceptVisualChanges()}>
                            {t('conflictUseBlocks')}
                        </button>
                        <button type="button" onClick={() => this.setState({
                            conflictReviewOpen: false,
                            visualConflict: null,
                            status: t('conversionCancelled'),
                            statusKind: 'idle'
                        })}>
                            {t('cancel')}
                        </button>
                    </div>
                )}
                {this.state.visualConflict && this.state.conflictReviewOpen && (
                    <QuickPanel
                        closeLabel={t('close')}
                        id="textwarp-conflict-review"
                        label={t('conflictReview')}
                        onClose={() => this.setState({conflictReviewOpen: false})}
                    >
                        <section className={styles.conflictPreview}>
                            <strong>{t('conflictPlan')}</strong>
                            <ul>
                                {conflictUnitGroups.map(group => (
                                    <li key={group.label}>
                                        <span>{group.label}</span>
                                        {group.ids.length > 0 && <code>{group.ids.join(', ')}</code>}
                                    </li>
                                ))}
                                <li>{t('conflictUnsupported', {
                                    count: this.state.visualConflict.unsupportedOpcodes.length
                                })}</li>
                                <li>{t('conflictRootsAffected', {
                                    count: this.state.visualConflict.importedRootIds.length
                                })}
                                {this.state.visualConflict.importedRootIds.length > 0 && (
                                    <code>{this.state.visualConflict.importedRootIds.join(', ')}</code>
                                )}</li>
                            </ul>
                            {this.state.visualConflict.unsupportedOpcodes.length > 0 && (
                                <code>{this.state.visualConflict.unsupportedOpcodes.join(', ')}</code>
                            )}
                        </section>
                        <section className={styles.conflictPreview}>
                            <details>
                                <summary>{t('conflictTextPreview')}</summary>
                                <pre>{this.state.source}</pre>
                            </details>
                        </section>
                        <section className={styles.conflictPreview}>
                            <details>
                                <summary>{t('conflictBlocksPreview')}</summary>
                                <pre>{this.state.visualConflict.source}</pre>
                            </details>
                        </section>
                    </QuickPanel>
                )}
                {this.state.lastConversion && (
                    <div aria-live="polite" className={styles.conversionBanner} role="status">
                        <div>
                            <strong>{t('conversionCompleted')}</strong>
                            <span>{t('conversionSnapshotCreated', {name: this.state.lastConversion.fileName})}</span>
                        </div>
                        <button type="button" onClick={this.undoLastConversion}>{t('undoConversion')}</button>
                        <button type="button" onClick={() => this.compareTextAndBlocks()}>
                            {t('viewDifferences')}
                        </button>
                        <button
                            aria-label={t('close')}
                            className={styles.dismissConversion}
                            type="button"
                            onClick={() => this.setState({lastConversion: null})}
                        >
                            <InterfaceIcon name="close" />
                        </button>
                    </div>
                )}
                <div className={styles.mainWorkspace}>
                    {this.state.narrowLayout && this.state.sidebarVisible && this.state.viewMode !== 'docs' && (
                        <button
                            aria-label={t('closeSidebar')}
                            className={styles.sidebarBackdrop}
                            type="button"
                            onClick={this.closeSidebar}
                        />
                    )}
                    <ActivityBar
                        activeBottomPanel={this.state.activeBottomPanel}
                        activeSidebarPanel={this.state.sidebarPanel}
                        bottomPanelCollapsed={this.state.bottomPanelCollapsed}
                        locale={this.props.locale}
                        settingsOpen={this.state.settingsOpen}
                        sidebarVisible={this.state.sidebarVisible && this.state.viewMode !== 'docs'}
                        viewMode={this.state.viewMode}
                        onCloseSidebar={this.closeSidebar}
                        onOpenBottomPanel={this.openBottomPanel}
                        onOpenDocumentation={() => {
                            this.setState({docsQuery: '', sidebarVisible: false});
                            this.persistUiState({sidebarVisible: false, viewMode: 'docs'});
                            this.setViewMode('docs');
                        }}
                        onOpenSettings={() => this.setState(state => ({
                            actionMenuOpen: false,
                            convertMenuOpen: false,
                            settingsOpen: !state.settingsOpen
                        }))}
                        onOpenSidebar={this.openSidebar}
                    />
                    <IdeSidebar
                        activeFileName={targetFileName(target)}
                        activePanel={this.state.sidebarPanel}
                        activeTargetId={this.props.editingTargetId}
                        extensionSummary={this.state.extensionSummary}
                        history={this.state.history}
                        locale={this.props.locale}
                        outline={getOutline(this.state.source)}
                        overlay={this.state.narrowLayout}
                        searchQuery={this.state.searchQuery}
                        searchResults={this.state.searchResults}
                        replaceValue={this.state.replaceValue}
                        visible={this.state.sidebarVisible && this.state.viewMode !== 'docs'}
                        workspace={this.state.workspace}
                        onClose={this.closeSidebar}
                        onInsertResource={this.insertResource}
                        onOpenLocation={this.openLocation}
                        onOpenExtensionLibrary={this.props.onOpenExtensionLibrary}
                        onOpenResource={this.openResource}
                        onOpenTarget={this.openTarget}
                        onPanelChange={sidebarPanel => {
                            this.setState({sidebarPanel});
                            this.persistUiState({sidebarPanel});
                        }}
                        onReplaceAll={this.handleReplaceAll}
                        onReplaceValueChange={replaceValue => this.setState({replaceValue})}
                        onRestoreHistory={this.restoreHistory}
                        onSearch={this.handleSearch}
                    />
                    {this.state.sidebarVisible && this.state.viewMode !== 'docs' && !this.state.narrowLayout && (
                        <div
                            aria-label={t('sidebarResize')}
                            className={styles.sidebarResizeHandle}
                            role="separator"
                            tabIndex="0"
                            onPointerDown={event => this.startResize('sidebar', event)}
                            onKeyDown={event => this.handleResizeKeyDown('sidebar', event)}
                        />
                    )}
                <div className={classNames(
                    styles.editorArea,
                    this.state.viewMode === 'split' && styles.splitMode,
                    this.state.viewMode === 'dual' && styles.dualMode
                )}
                aria-label={this.state.viewMode === 'dual' ? t('splitEditor') : null}
                aria-labelledby={this.state.viewMode === 'dual' ? null :
                    `textwarp-view-tab-${this.state.viewMode}`}
                id="textwarp-editor-area"
                ref={element => { this.editorAreaElement = element; }}
                role="tabpanel">
                    <div className={classNames(
                        styles.viewPane,
                        styles.codePane,
                        !['code', 'split', 'dual'].includes(this.state.viewMode) && styles.hiddenPane
                    )}>
                        <MonacoEditor
                            activeLines={activeLines}
                            breakpoints={this.state.breakpoints}
                            dark={this.props.guiTheme === 'dark'}
                            diagnostics={this.state.diagnostics}
                            fontSize={this.state.fontSize}
                            instanceKey="primary"
                            languageContext={this.getLanguageContext(target)}
                            locale={this.props.locale}
                            modelKey={this.props.editingTargetId || 'none'}
                            value={this.state.source}
                            visible={this.props.isVisible && ['code', 'split', 'dual'].includes(this.state.viewMode)}
                            onChange={this.handleChange}
                            onCompile={this.handleCompile}
                            onInvalidShortcut={this.handleInvalidShortcut}
                            onBreakpointsChange={this.handleBreakpointsChange}
                            onNavigateResource={this.handleNavigateResource}
                            onCopyDiagnosticReport={this.handleCopyDiagnosticReport}
                            onCursorPositionChange={cursorPosition => this.setState({cursorPosition})}
                            onDownloadDiagnosticReport={this.handleDownloadDiagnosticReport}
                            onLoadError={this.handleMonacoLoadError}
                            onOpenModel={this.handleOpenModel}
                            onReady={editor => { this.monacoEditor = editor; }}
                            onRestart={this.handleRestart}
                            onRun={this.handleRun}
                            onRunSelection={this.handleRunSelection}
                            onStop={this.handleStop}
                            onToggleBreakpoint={this.handleToggleBreakpoint}
                            onWorkspaceModelChange={this.handleWorkspaceModelChange}
                            shortcuts={this.state.shortcuts}
                        />
                    </div>
                    <div className={classNames(
                        styles.viewPane,
                        styles.secondaryCodePane,
                        this.state.viewMode !== 'dual' && styles.hiddenPane
                    )}>
                        {secondaryTarget ? (
                            <React.Fragment>
                                <label className={styles.secondaryPaneHeader}>
                                    <span>{t('dualFile')}</span>
                                    <select
                                        value={this.state.secondaryTargetId}
                                        onChange={event => this.setSecondaryTarget(event.target.value)}
                                    >
                                        {this.state.workspace.modules.filter(module =>
                                            module.id !== this.props.editingTargetId
                                        ).map(module => (
                                            <option key={module.id} value={module.id}>{module.fileName}</option>
                                        ))}
                                    </select>
                                </label>
                                <div className={styles.secondaryEditorBody}>
                                    <MonacoEditor
                                        activeLines={secondaryActiveLines}
                                        breakpoints={readSourceRecord(secondaryTarget) ?
                                            readSourceRecord(secondaryTarget).breakpoints : []}
                                        dark={this.props.guiTheme === 'dark'}
                                        diagnostics={this.state.secondaryDiagnostics}
                                        fontSize={this.state.fontSize}
                                        instanceKey="secondary"
                                        languageContext={this.getLanguageContext(
                                            secondaryTarget,
                                            this.state.secondarySource
                                        )}
                                        locale={this.props.locale}
                                        modelKey={this.state.secondaryTargetId}
                                        shortcuts={this.state.shortcuts}
                                        value={this.state.secondarySource}
                                        visible={this.props.isVisible && this.state.viewMode === 'dual'}
                                        onChange={source => this.handleSecondaryChange(source)}
                                        onBreakpointsChange={this.handleSecondaryBreakpointsChange}
                                        onCompile={() => this.compileSecondary(false)}
                                        onInvalidShortcut={this.handleInvalidShortcut}
                                        onNavigateResource={this.handleNavigateResource}
                                        onOpenModel={this.handleSecondaryOpenModel}
                                        onReady={editor => { this.secondaryMonacoEditor = editor; }}
                                        onRestart={() => {
                                            this.handleStop();
                                            this.compileSecondary(true);
                                        }}
                                        onRun={() => this.compileSecondary(true)}
                                        onStop={this.handleStop}
                                        onWorkspaceModelChange={this.handleWorkspaceModelChange}
                                    />
                                </div>
                            </React.Fragment>
                        ) : <div className={styles.dualEmpty}>{t('dualEmpty')}</div>}
                    </div>
                    {['split', 'dual'].includes(this.state.viewMode) && (
                        <div
                            aria-label={t('splitResize')}
                            className={styles.splitResizeHandle}
                            role="separator"
                            tabIndex="0"
                            onPointerDown={event => this.startResize('split', event)}
                            onKeyDown={event => this.handleResizeKeyDown('split', event)}
                        />
                    )}
                    <div className={classNames(
                        styles.viewPane,
                        styles.blocksPane,
                        !['blocks', 'split'].includes(this.state.viewMode) && styles.hiddenPane
                    )}>
                        <VisualBlocks
                            canUseCloud={this.props.canUseCloud}
                            grow={this.props.grow}
                            isVisible={this.props.isVisible && ['blocks', 'split'].includes(this.state.viewMode)}
                            options={this.props.options}
                            stageSize={this.props.stageSize}
                            theme={this.props.theme}
                            vm={this.props.vm}
                            onOpenCustomExtensionModal={this.props.onOpenCustomExtensionModal}
                        />
                    </div>
                    <div className={classNames(
                        styles.viewPane,
                        styles.documentationPane,
                        this.state.viewMode !== 'docs' && styles.hiddenPane
                    )}>
                        <DocumentationPane
                            compact={this.state.compactLayout}
                            extensionCatalog={this.extensionCatalog}
                            extensionPalette={this.state.extensionPalette}
                            initialQuery={this.state.docsQuery}
                            locale={this.props.locale}
                        />
                    </div>
                </div>
                </div>
                <aside className={classNames(
                    styles.bottomPanel,
                    this.state.activeBottomPanel !== 'problems' &&
                        styles.debugPanelOpen,
                    this.state.bottomPanelCollapsed && styles.bottomPanelCollapsed
                )}
                aria-label={t('panels')}>
                    {!this.state.bottomPanelCollapsed && (
                        <div
                            aria-label={t('panels')}
                            className={styles.bottomResizeHandle}
                            role="separator"
                            tabIndex="0"
                            onPointerDown={event => this.startResize('bottom', event)}
                            onKeyDown={event => this.handleResizeKeyDown('bottom', event)}
                        />
                    )}
                    <nav className={styles.panelTabs} aria-label={t('panels')} role="tablist">
                        {[
                            ['problems', t('problems'), this.state.diagnostics.length],
                            ['console', t('console')],
                            ['debugger', t('debugPanel')],
                            ['output', t('output')],
                            ['backpack', t('backpack')]
                        ].map(([id, label, count]) => (
                            <button
                                aria-controls="textwarp-bottom-panel-content"
                                aria-selected={!this.state.bottomPanelCollapsed && this.state.activeBottomPanel === id}
                                className={!this.state.bottomPanelCollapsed &&
                                    this.state.activeBottomPanel === id ? styles.activePanelTab : ''}
                                data-tab-id={id}
                                id={`textwarp-bottom-tab-${id}`}
                                key={id}
                                role="tab"
                                tabIndex={this.state.activeBottomPanel === id ? 0 : -1}
                                title={label}
                                type="button"
                                onClick={() => this.openBottomPanel(id)}
                                onKeyDown={event => this.handleTabKeyDown(
                                    event,
                                    PANEL_IDS,
                                    id,
                                    this.openBottomPanel
                                )}
                            >
                                {label} {typeof count === 'number' && <small>{count}</small>}
                            </button>
                        ))}
                        <button
                            aria-controls="textwarp-bottom-panel-content"
                            aria-expanded={!this.state.bottomPanelCollapsed}
                            aria-label={this.state.bottomPanelCollapsed ? t('panelExpand') : t('panelCollapse')}
                            className={styles.collapsePanelButton}
                            type="button"
                            onClick={() => {
                                const bottomPanelCollapsed = !this.state.bottomPanelCollapsed;
                                this.setState({bottomPanelCollapsed});
                                this.persistUiState({bottomPanelCollapsed});
                            }}
                        >
                            <InterfaceIcon name={this.state.bottomPanelCollapsed ? 'chevron-up' : 'chevron-down'} />
                        </button>
                    </nav>
                    {!this.state.bottomPanelCollapsed && (
                        <div
                            aria-labelledby={`textwarp-bottom-tab-${this.state.activeBottomPanel}`}
                            className={styles.bottomPanelContent}
                            id="textwarp-bottom-panel-content"
                            role="tabpanel"
                        >
                            {this.state.activeBottomPanel === 'debugger' ? this.renderDebugger() :
                                this.state.activeBottomPanel === 'console' ? this.renderConsole() :
                                    this.state.activeBottomPanel === 'output' ? (
                                        <div className={styles.outputPanel}>
                                            <strong>{t('outputSummary')}</strong>
                                            <span className={classNames(styles.statusDot, styles[this.state.statusKind])} />
                                            <span>{this.state.status}</span>
                                            <small>{t('runtimeSummary', {
                                                blocks: this.state.extensionSummary.blockCount,
                                                extensions: this.state.extensionSummary.extensionCount,
                                                save: this.state.saveState === 'salvo' ? t('saved') : t('saving'),
                                                version: '0.3'
                                            })}</small>
                                        </div>
                                    ) : this.state.activeBottomPanel === 'backpack' ? (
                                        this.props.backpackVisible ? (
                                            <Backpack
                                                embedded
                                                host={this.props.backpackHost}
                                            />
                                        ) : <div className={styles.emptyPanel}>{t('backpackUnavailable')}</div>
                                    ) : <div className={styles.diagnostics}>{this.renderDiagnostics()}</div>}
                        </div>
                    )}
                </aside>
                <footer className={styles.statusBar}>
                    <span className={styles.statusMessage} title={this.state.status}>
                        <span className={classNames(styles.statusDot, styles[this.state.statusKind])} />
                        <span>{this.state.status}</span>
                    </span>
                    <span>{this.state.saveState === 'salvo' ? t('saved') : t('saving')}</span>
                    <span>{activeFileName}</span>
                    <span>{t('cursorPosition', this.state.cursorPosition)}</span>
                    <span>{t('problemCount', {count: this.state.diagnostics.length})}</span>
                    <span className={styles.statusSync}>{syncLabel}</span>
                    <span>{`${this.props.framerate} FPS`}</span>
                    <span>{({
                        paused: t('runtimeStatePaused'),
                        running: t('runtimeStateRunning'),
                        stopped: t('runtimeStateStopped')
                    })[this.state.debugSnapshot.executionState] || t('runtimeStateStopped')}</span>
                    <span
                        aria-live={this.state.statusKind === 'error' ? 'assertive' : 'polite'}
                        className={styles.visuallyHidden}
                        role={this.state.statusKind === 'error' ? 'alert' : 'status'}
                    >{this.state.announcement}</span>
                </footer>
            </section>
        );
    }
}

TextEditor.propTypes = {
    backpackHost: PropTypes.string,
    backpackVisible: PropTypes.bool,
    canUseCloud: PropTypes.bool,
    editingTargetId: PropTypes.string,
    editingTargetName: PropTypes.string,
    grow: PropTypes.number,
    guiTheme: PropTypes.string,
    framerate: PropTypes.number,
    isVisible: PropTypes.bool,
    locale: PropTypes.string,
    onOpenCustomExtensionModal: PropTypes.func,
    onOpenExtensionLibrary: PropTypes.func,
    onClearSb3FileHandle: PropTypes.func.isRequired,
    onSetTextwarpUiOperation: PropTypes.func.isRequired,
    onSetProjectUnchanged: PropTypes.func.isRequired,
    options: PropTypes.shape({}),
    projectTitle: PropTypes.string,
    stageSize: PropTypes.string,
    textwarpUiCommand: PropTypes.shape({
        id: PropTypes.number.isRequired,
        name: PropTypes.string
    }),
    theme: PropTypes.shape({}),
    vm: PropTypes.shape({
        editingTarget: PropTypes.shape({}),
        greenFlag: PropTypes.func.isRequired,
        loadProject: PropTypes.func.isRequired,
        saveProjectSb3: PropTypes.func.isRequired,
        runtime: PropTypes.shape({
            getTargetById: PropTypes.func.isRequired,
            targets: PropTypes.arrayOf(PropTypes.shape({})).isRequired
        }).isRequired
    }).isRequired
};

TextEditor.defaultProps = {
    backpackVisible: false,
    framerate: 30,
    isVisible: true,
    locale: 'en',
    onOpenCustomExtensionModal: null,
    onOpenExtensionLibrary: null,
    projectTitle: 'TextWarp Project',
    textwarpUiCommand: {
        id: 0,
        name: null
    }
};

const mapStateToProps = state => {
    const editingTargetId = state.scratchGui.targets.editingTarget;
    const targets = state.scratchGui.targets;
    const editingTarget = targets.sprites[editingTargetId] ||
        (targets.stage.id === editingTargetId ? targets.stage : null);
    return {
        editingTargetId,
        editingTargetName: editingTarget ? editingTarget.name : '',
        framerate: state.scratchGui.tw.framerate,
        guiTheme: state.scratchGui.theme.theme.gui,
        locale: state.locales.locale,
        projectTitle: state.scratchGui.projectTitle,
        textwarpUiCommand: state.scratchGui.tw.textwarpUiCommand
    };
};

const mapDispatchToProps = dispatch => ({
    onClearSb3FileHandle: () => dispatch(setFileHandle(null)),
    onSetTextwarpUiOperation: (command, state, message) =>
        dispatch(setTextwarpUiOperation(command, state, message)),
    onSetProjectUnchanged: () => dispatch(setProjectUnchanged())
});

export {TextEditor};
export default connect(mapStateToProps, mapDispatchToProps)(TextEditor);
