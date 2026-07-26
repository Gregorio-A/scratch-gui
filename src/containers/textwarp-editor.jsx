import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import VisualBlocks from './blocks.jsx';
import {setProjectUnchanged} from '../reducers/project-changed';
import {setFileHandle, TEXTWARP_UI_COMMANDS} from '../reducers/tw';

import {compileText} from '../lib/textwarp/compiler';
import {getDebugController} from '../lib/textwarp/debug-controller';
import {inspectExpression} from '../lib/textwarp/debug-inspector';
import {decompileTarget} from '../lib/textwarp/decompiler';
import DocumentationPane from '../components/textwarp-editor/documentation-pane.jsx';
import {buildExtensionInventory, summarizeExtensionCatalog} from '../lib/textwarp/extension-catalog';
import IdeSidebar from '../components/textwarp-editor/ide-sidebar.jsx';
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
import {createTranslator, normalizeLocale} from '../lib/textwarp/i18n';
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
    markGeneratedRootsDirty,
    readSourceRecord,
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
const emptyWorkspace = () => ({modules: [], resources: [], editableFiles: [], generatedFiles: []});
const DEFAULT_SHORTCUTS = Object.freeze({
    compile: 'F7',
    run: 'Ctrl+Enter',
    runSelection: 'Ctrl+Shift+Enter',
    stop: 'Shift+F5',
    restart: 'Ctrl+Shift+F5',
    format: 'Ctrl+Shift+I'
});
const IDE_TEMPLATES = Object.freeze([
    {
        id: 'movement',
        name: 'Ator com movimento',
        nameEnglish: 'Moving actor',
        scope: 'actor',
        source: name => `actor ${name}\n\nvariable speed = 5\n\non green_flag:\n    forever:\n        if key_pressed("right"):\n            change_x(speed)\n        if key_pressed("left"):\n            change_x(-speed)\n        if key_pressed("up"):\n            change_y(speed)\n        if key_pressed("down"):\n            change_y(-speed)\n        wait(0)\n`
    },
    {
        id: 'animation',
        name: 'Ator animado',
        nameEnglish: 'Animated actor',
        scope: 'actor',
        source: name => `actor ${name}\n\nvariable frame_time = 0.12\n\non green_flag:\n    forever:\n        next_costume()\n        wait(frame_time)\n`
    },
    {
        id: 'game-stage',
        name: 'Palco de jogo',
        nameEnglish: 'Game stage',
        scope: 'stage',
        source: () => 'stage\n\nglobal variable score = 0\nglobal variable lives = 3\n\non green_flag:\n    score = 0\n    lives = 3\n    broadcast("start-game")\n\non receive("game-over"):\n    stop_all()\n'
    }
]);

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

const sortedObject = value => Object.keys(value || {}).sort().reduce((result, key) => {
    result[key] = value[key];
    return result;
}, {});

const blockFingerprint = target => {
    if (!target || !target.blocks || !target.blocks._blocks) return '';
    const blocks = Object.values(target.blocks._blocks).sort((left, right) => left.id.localeCompare(right.id)).map(block => ({
        id: block.id,
        opcode: block.opcode,
        next: block.next,
        parent: block.parent,
        topLevel: Boolean(block.topLevel),
        shadow: Boolean(block.shadow),
        fields: sortedObject(block.fields),
        inputs: sortedObject(block.inputs),
        mutation: block.mutation || null
    }));
    const variables = Object.values(target.variables || {}).map(variable => ({
        id: variable.id,
        name: variable.name,
        type: variable.type
    })).sort((left, right) => left.id.localeCompare(right.id));
    return JSON.stringify({blocks, variables});
};

class TextEditor extends React.Component {
    constructor (props) {
        super(props);
        const t = createTranslator(props.locale);
        this.state = {
            source: '',
            diagnostics: [],
            status: t('selectTarget'),
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
            templatesOpen: false,
            externalOpen: false,
            toolsOpen: false,
            shortcuts: DEFAULT_SHORTCUTS,
            fontSize: DEFAULT_FONT_SIZE,
            sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
            bottomPanelHeight: DEFAULT_BOTTOM_PANEL_HEIGHT,
            splitRatio: DEFAULT_SPLIT_RATIO,
            bottomPanelCollapsed: false,
            compactLayout: false,
            narrowLayout: false,
            workspace: emptyWorkspace(),
            openTargetIds: [],
            searchQuery: '',
            replaceValue: '',
            docsQuery: '',
            searchResults: [],
            history: [],
            saveState: 'salvo',
            blockRefresh: 0,
            breakpoints: [],
            debugOpen: false,
            extensionsOpen: false,
            consoleOpen: false,
            debugSnapshot: {
                enabled: false, threads: [], activeLinesByTarget: {}, runtimeErrors: [], consoleEntries: [], executionState: 'stopped'
            },
            watches: [],
            watchInput: '',
            selectedThreadId: null,
            extensionSummary: {extensionCount: 0, blockCount: 0, extensions: []},
            extensionPalette: [],
            visualConflict: null,
            busy: false,
            externalHandle: null,
            externalName: ''
        };
        this.compileTimer = null;
        this.analysisTimer = null;
        this.debugController = null;
        this.unsubscribeDebugger = null;
        this.extensionCatalog = {};
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
        this.handleChange = this.handleChange.bind(this);
        this.handleCompile = this.handleCompile.bind(this);
        this.handleRun = this.handleRun.bind(this);
        this.handleRunSelection = this.handleRunSelection.bind(this);
        this.handleStop = this.handleStop.bind(this);
        this.handleRestart = this.handleRestart.bind(this);
        this.handleImportBlocks = this.handleImportBlocks.bind(this);
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
        this.handleExternalFile = this.handleExternalFile.bind(this);
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
                    bottomPanelHeight: clampBottomPanelHeight(savedPreferences.bottomPanelHeight),
                    fontSize: clampFontSize(savedPreferences.fontSize),
                    sidebarWidth: clampSidebarWidth(savedPreferences.sidebarWidth),
                    splitRatio: clampSplitRatio(savedPreferences.splitRatio)
                });
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
        if (typeof this.props.vm.on === 'function') this.props.vm.on('PROJECT_CHANGED', this.handleProjectChanged);
        document.addEventListener('keydown', this.handleKeyDown, true);
        window.addEventListener('pointermove', this.handlePointerMove);
        window.addEventListener('pointerup', this.handlePointerUp);
        this.loadSelectedTarget();
    }

    componentDidUpdate (previousProps) {
        if (
            previousProps.editingTargetId !== this.props.editingTargetId ||
            previousProps.editingTargetName !== this.props.editingTargetName
        ) this.loadSelectedTarget();
        if (previousProps.textwarpUiCommand.id !== this.props.textwarpUiCommand.id) {
            this.handleTextwarpUiCommand(this.props.textwarpUiCommand.name);
        }
    }

    componentWillUnmount () {
        this._isMounted = false;
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
        if (this.debugController) this.debugController.setEnabled(false);
        if (this.props.vm.runtime && typeof this.props.vm.runtime.removeListener === 'function') {
            this.props.vm.runtime.removeListener('EXTENSION_ADDED', this.handleExtensionsChanged);
            this.props.vm.runtime.removeListener('BLOCKSINFO_UPDATE', this.handleExtensionsChanged);
            this.props.vm.runtime.removeListener('PROJECT_LOADED', this.handleProjectLoaded);
        }
        if (typeof this.props.vm.removeListener === 'function') this.props.vm.removeListener('PROJECT_CHANGED', this.handleProjectChanged);
        document.removeEventListener('keydown', this.handleKeyDown, true);
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

    t (key, values) {
        return createTranslator(this.props.locale)(key, values);
    }

    localized (portuguese, english) {
        return normalizeLocale(this.props.locale) === 'pt' ? portuguese : english;
    }

    getTemplateName (template) {
        return normalizeLocale(this.props.locale) === 'pt' ? template.name : template.nameEnglish;
    }

    updateResponsiveLayout (width) {
        const viewportWidth = typeof window === 'undefined' ? Number(width) : window.innerWidth;
        const effectiveWidth = Math.min(Number(width) || viewportWidth, viewportWidth);
        const compactLayout = effectiveWidth < 850;
        const narrowLayout = effectiveWidth < 600;
        if (
            compactLayout !== this.state.compactLayout ||
            narrowLayout !== this.state.narrowLayout
        ) this.setState({compactLayout, narrowLayout});
    }

    handleWindowResize () {
        if (this.rootElement) this.updateResponsiveLayout(this.rootElement.getBoundingClientRect().width);
    }

    persistPreferences (next = {}) {
        const preferences = {
            bottomPanelHeight: next.bottomPanelHeight === undefined ?
                this.state.bottomPanelHeight : next.bottomPanelHeight,
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

    setFontSize (value) {
        const fontSize = clampFontSize(value);
        this.setState({fontSize});
        this.persistPreferences({fontSize});
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

    updateShortcut (name, value) {
        const shortcuts = Object.assign({}, this.state.shortcuts, {[name]: value});
        this.setState({shortcuts});
        const storage = this.getStorage();
        try {
            if (storage) storage.setItem('textwarp.ide.shortcuts', JSON.stringify(shortcuts));
        } catch (error) {
            this.setState({
                status: this.localized(
                    'Atalho aplicado nesta sessão; o armazenamento local está indisponível.',
                    'Shortcut applied for this session; local storage is unavailable.'
                ),
                statusKind: 'working'
            });
        }
    }

    applyTemplate (template) {
        const target = this.getTarget();
        if (!target) return;
        const templateName = this.getTemplateName(template);
        if (this.state.source.trim() && typeof window !== 'undefined' && !window.confirm(
            normalizeLocale(this.props.locale) === 'pt' ?
                `Substituir ${targetFileName(target)} pelo modelo “${templateName}”? A versão atual continuará no histórico local.` :
                `Replace ${targetFileName(target)} with “${templateName}”? The current version will remain in local history.`
        )) return;
        saveHistorySnapshot(this.getStorage(), this.getProjectStorageId(), target.id, this.state.source, 'antes do modelo');
        this.handleChange(template.source(target.getName()));
        this.setState({
            templatesOpen: false,
            status: normalizeLocale(this.props.locale) === 'pt' ?
                `Modelo “${templateName}” aplicado.` : `Template “${templateName}” applied.`,
            statusKind: 'working'
        });
    }

    refreshWorkspace (callback) {
        const workspace = buildWorkspace(this.props.vm);
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
                generated: generated.has(variable.id)
            });
        });
        append(target, 'target');
        const stage = this.getStage();
        if (stage && stage !== target) append(stage, 'stage');
        return result;
    }

    getCompileOptions (target) {
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
            resources: buildWorkspace(this.props.vm).resources,
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
                throw new Error(this.localized(
                    'Abra a visualização Blocos ou Dividido antes de inserir XML.',
                    'Open the Blocks or Split view before inserting XML.'
                ));
            }
            const xml = /^\s*<xml\b/i.test(entry.xml) ? entry.xml :
                `<xml xmlns="http://www.w3.org/1999/xhtml">${entry.xml}</xml>`;
            const dom = ScratchBlocks.Xml.textToDom(xml);
            const inserted = ScratchBlocks.Xml.domToWorkspace(dom, workspace) || [];
            this.setState({
                viewMode: 'split',
                extensionsOpen: false,
                status: this.localized(
                    `${Array.isArray(inserted) ? inserted.length : 1} bloco(s) inserido(s) pela paleta da extensão.`,
                    `${Array.isArray(inserted) ? inserted.length : 1} block(s) inserted from the extension palette.`
                ),
                statusKind: 'success'
            });
        } catch (error) {
            this.setState({status: error.message, statusKind: 'error'});
        }
    }

    handleProjectChanged () {
        if (Date.now() < this.suppressBlockSyncUntil) return;
        clearTimeout(this.blockSyncTimer);
        this.blockSyncTimer = setTimeout(() => {
            const target = this.getTarget();
            const referencesUpdated = this.synchronizeProjectReferences();
            this.refreshWorkspace();
            if (referencesUpdated) return;
            if (!target || !['blocks', 'split'].includes(this.state.viewMode)) return;
            const fingerprint = blockFingerprint(target);
            if (fingerprint === this.lastBlockFingerprint) return;
            const result = decompileTarget(target, {extensionCatalog: this.extensionCatalog});
            const compileOptions = this.getCompileOptions(target);
            const visualCompilation = compileText(result.source, compileOptions);
            result.canonicalSource = result.source;
            result.visualCompilation = visualCompilation;
            const hasPendingText = this.state.source !== this.lastAppliedSource || countErrors(this.state.diagnostics) > 0;
            const baseCompilation = this.lastAppliedSource ? compileText(this.lastAppliedSource, compileOptions) : null;
            const textCompilation = compileText(this.state.source, compileOptions);
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
                    status: merged && merged.conflicts.length ?
                        this.localized(
                            `Conflito semântico em ${merged.conflicts.length} unidade(s). Escolha qual versão manter.`,
                            `Semantic conflict in ${merged.conflicts.length} unit(s). Choose which version to keep.`
                        ) :
                        this.localized(
                            'Texto inválido e blocos foram alterados ao mesmo tempo. Escolha qual versão manter.',
                            'Invalid text and blocks changed at the same time. Choose which version to keep.'
                        ),
                    statusKind: 'working'
                });
                return;
            }
            this.acceptVisualChanges(result);
        }, 220);
    }

    synchronizeProjectReferences () {
        const workspace = buildWorkspace(this.props.vm);
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
            const compilation = compileText(synchronized.source, this.getCompileOptions(target));
            if (!compilation.success) return;
            this.suppressBlockSyncUntil = Date.now() + 750;
            applyCompilation(this.props.vm, target, compilation);
            saveHistorySnapshot(
                this.getStorage(), this.getProjectStorageId(), target.id, synchronized.source, 'sincronização de recurso'
            );
            if (target.id === this.props.editingTargetId) currentUpdate = {source: synchronized.source, compilation};
        });
        if (!currentUpdate) return false;
        this.lastAppliedSource = currentUpdate.source;
        this.lastBlockFingerprint = blockFingerprint(this.getTarget());
        this.setState({
            source: currentUpdate.source,
            diagnostics: currentUpdate.compilation.diagnostics,
            status: this.localized(
                'Referências estáveis atualizadas após mudança no projeto.',
                'Stable references updated after the project changed.'
            ),
            statusKind: 'success'
        });
        return true;
    }

    acceptVisualChanges (result = this.state.visualConflict) {
        const target = this.getTarget();
        if (!target || !result) return;
        clearTimeout(this.compileTimer);
        const compileOptions = this.getCompileOptions(target);
        const canonicalSource = result.canonicalSource || result.source;
        const visualCompilation = result.visualCompilation || compileText(canonicalSource, compileOptions);
        const compilation = compileText(result.source, compileOptions);
        if (!visualCompilation.success || !compilation.success) {
            this.setState({
                diagnostics: compilation.diagnostics,
                status: this.localized(
                    'A sincronização produziu uma fonte inválida; nenhuma alteração foi aplicada.',
                    'Synchronization produced invalid source; no changes were applied.'
                ),
                statusKind: 'error'
            });
            return;
        }
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
        const record = applyCompilation(this.props.vm, target, compilation);
        this.lastAppliedSource = result.source;
        this.lastBlockFingerprint = blockFingerprint(target);
        this.setState(state => ({
            source: result.source,
            diagnostics: compilation.diagnostics,
            visualConflict: null,
            blockRefresh: state.blockRefresh + 1,
            status: this.localized(
                `${result.semanticMerge && result.semanticMerge.mergedUnits.length ?
                    `${result.semanticMerge.mergedUnits.length} unidade(s) mesclada(s) automaticamente; ` : ''
                }blocos sincronizados (${result.importedRootIds.length} stack(s), ${
                    result.unsupportedOpcodes.length
                } opcode(s) indisponível(is) mantido(s) somente em blocos, ${
                    record.lastApply && record.lastApply.unchangedUnits || 0
                } unidade(s) preservada(s)).`,
                `${result.semanticMerge && result.semanticMerge.mergedUnits.length ?
                    `${result.semanticMerge.mergedUnits.length} unit(s) merged automatically; ` : ''
                }blocks synchronized (${result.importedRootIds.length} stack(s), ${
                    result.unsupportedOpcodes.length
                } unavailable opcode(s) kept only as blocks, ${
                    record.lastApply && record.lastApply.unchangedUnits || 0
                } unit(s) preserved).`
            ),
            statusKind: compilation.success ? 'success' : 'error'
        }));
    }

    keepTextChanges () {
        const target = this.getTarget();
        if (!target) return;
        markGeneratedRootsDirty(target);
        this.setState({visualConflict: null}, () => this.compileCurrent(false));
    }

    setViewMode (viewMode) {
        this.setState({viewMode}, () => {
            if (typeof window !== 'undefined') window.dispatchEvent(new Event('resize'));
            if (viewMode === 'blocks' || viewMode === 'split') {
                this.lastBlockFingerprint = blockFingerprint(this.getTarget());
            }
        });
    }

    handleKeyDown (event) {
        if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
        const key = String(event.key).toLowerCase();
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
            return;
        }
        if (event.shiftKey && key === 'f') {
            event.preventDefault();
            this.setState({sidebarVisible: true, sidebarPanel: 'search'});
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
            status: this.localized(
                `${resource.kindLabel || 'Recurso'} “${resource.name}” selecionado no projeto.`,
                `${resource.kindLabel || 'Resource'} “${resource.name}” selected in the project.`
            ),
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
            !window.confirm(this.localized(
                `Substituir ${replacement.count} ocorrência(s) em todos os scripts editáveis?`,
                `Replace ${replacement.count} occurrence(s) in every editable script?`
            ))
        ) return;
        const compilations = replacement.modules.map(module => {
            const target = this.props.vm.runtime.getTargetById(module.id);
            return {module, target, compilation: compileText(module.source, this.getCompileOptions(target))};
        });
        const invalid = compilations.find(item => !item.compilation.success);
        if (invalid) {
            this.setState({
                status: this.localized(
                    `A substituição deixaria ${invalid.module.fileName} inválido; nenhuma alteração foi aplicada.`,
                    `The replacement would make ${invalid.module.fileName} invalid; no changes were applied.`
                ),
                statusKind: 'error'
            });
            return;
        }
        compilations.forEach(item => {
            saveTextSource(this.props.vm, item.target, item.module.source);
            applyCompilation(this.props.vm, item.target, item.compilation);
            saveHistorySnapshot(
                this.getStorage(), this.getProjectStorageId(), item.target.id, item.module.source, 'substituição global'
            );
        });
        const current = compilations.find(item => item.target.id === this.props.editingTargetId);
        this.setState({
            source: current ? current.module.source : this.state.source,
            diagnostics: current ? current.compilation.diagnostics : this.state.diagnostics,
            status: this.localized(
                `${replacement.count} ocorrência(s) substituída(s) em ${compilations.length} script(s).`,
                `${replacement.count} occurrence(s) replaced in ${compilations.length} script(s).`
            ),
            statusKind: 'success',
            saveState: 'salvo'
        }, () => this.handleSearch(this.state.searchQuery));
    }

    restoreHistory (entry) {
        if (!entry || typeof entry.source !== 'string') return;
        this.handleChange(entry.source);
        this.setState({
            sidebarPanel: 'explorer',
            status: this.localized('Versão do histórico local restaurada.', 'Local history version restored.'),
            statusKind: 'working'
        });
    }

    handleStop () {
        if (this.props.vm && typeof this.props.vm.stopAll === 'function') this.props.vm.stopAll();
        if (this.debugController) this.debugController.log(
            'info',
            this.localized('Parada solicitada pelo editor.', 'Stop requested by the editor.')
        );
        this.setState({status: this.localized('Execução parada.', 'Execution stopped.'), statusKind: 'idle'});
    }

    handleRestart () {
        if (this.props.vm && typeof this.props.vm.stopAll === 'function') this.props.vm.stopAll();
        this.setState({
            status: this.localized('Reiniciando execução…', 'Restarting execution…'),
            statusKind: 'working'
        }, () => this.compileCurrent(true));
    }

    handleRunSelection (selection) {
        const target = this.getTarget();
        if (!target || !selection) return;
        const compilation = compileText(this.state.source, this.getCompileOptions(target));
        if (!compilation.success) {
            this.setState({
                diagnostics: compilation.diagnostics,
                status: this.localized(
                    'Corrija os erros antes da execução parcial.',
                    'Fix the errors before running a selection.'
                ),
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
                status: this.localized(
                    'Selecione um evento ou um procedimento sem parâmetros; procedimentos com parâmetros precisam ser chamados pelo código.',
                    'Select an event or a parameterless procedure; procedures with parameters must be called from code.'
                ),
                statusKind: 'error'
            });
            return;
        }
        this.applyCompilation(compilation, target, false);
        runnableUnits.forEach(unit => this.props.vm.runtime.toggleScript(unit.rootId, {target, stackClick: true}));
        if (this.debugController) this.debugController.log('info', this.localized(
            `${runnableUnits.length} unidade(s) executada(s) parcialmente.`,
            `${runnableUnits.length} unit(s) run from the selection.`
        ), target);
        this.setState({
            status: this.localized(
                `${runnableUnits.length} unidade(s) executada(s) a partir da seleção.`,
                `${runnableUnits.length} unit(s) run from the selection.`
            ),
            statusKind: 'success'
        });
    }

    handleTextwarpUiCommand (command) {
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
                externalOpen: false,
                settingsOpen: true,
                templatesOpen: false
            });
            break;
        default:
            break;
        }
    }

    async saveTextwarp (saveAs = false) {
        if (this.state.busy) return;
        this.setState({
            busy: true,
            status: this.localized('Salvando projeto editável .textwarp…', 'Saving editable .textwarp project…'),
            statusKind: 'working'
        });
        try {
            const target = this.getTarget();
            if (target) {
                const compilation = compileText(this.state.source, this.getCompileOptions(target));
                if (compilation.success && this.state.source !== this.lastAppliedSource) {
                    this.suppressBlockSyncUntil = Date.now() + 750;
                    applyCompilation(this.props.vm, target, compilation);
                    this.lastAppliedSource = compilation.source;
                    this.lastBlockFingerprint = blockFingerprint(target);
                }
            }
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
            this.setState({
                status: this.localized(
                    `${handle.name || 'Projeto'} salvo como fonte editável .textwarp.`,
                    `${handle.name || 'Project'} saved as editable .textwarp source.`
                ),
                statusKind: 'success'
            });
        } catch (error) {
            if (error && error.name === 'AbortError') {
                this.setState({
                    status: this.localized('Salvamento cancelado.', 'Save cancelled.'),
                    statusKind: 'idle'
                });
                return;
            }
            console.error(error);
            this.setState({status: error.message, statusKind: 'error'});
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
        this.debugController.setEnabled(this.state.debugOpen || hasBreakpoints);
    }

    loadSelectedTarget () {
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
        const secondaryCompilation = secondaryTarget ?
            compileText(secondarySource, this.getCompileOptions(secondaryTarget)) : {diagnostics: []};
        if (this.debugController) this.debugController.setBreakpoints(target, breakpoints);
        if (synchronized.count && compilation.success) applyCompilation(this.props.vm, target, compilation);
        this.lastAppliedSource = stored ? source : '';
        this.lastBlockFingerprint = blockFingerprint(target);
        this.setState({
            source,
            diagnostics: compilation.diagnostics,
            status: normalizeLocale(this.props.locale) === 'pt' ?
                (synchronized.count ? 'Fonte e referências atualizadas para o estado atual do projeto.' :
                    stored ? 'Fonte carregada do projeto.' : existingBlocks ?
                        'Este alvo já tem blocos. Use “Importar blocos” para convertê-los em texto.' :
                        'Exemplo inicial — edite ou compile para adicioná-lo ao projeto.') :
                (synchronized.count ? 'Source references updated to the current project state.' :
                    stored ? 'Source loaded from the project.' : existingBlocks ?
                        'This target already has blocks. Use “Import blocks” to convert them to text.' :
                        'Starter example — edit or compile it to add it to the project.'),
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
            blockRefresh: this.state.blockRefresh + 1
        }, () => {
            if (this.pendingLocation && this.pendingLocation.targetId === target.id) this.openLocation(this.pendingLocation);
        });
    }

    handleChange (source) {
        const target = this.getTarget();
        if (!target) return;
        saveTextSource(this.props.vm, target, source);
        this.setState({
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
                'autosave'
            );
            if (this._isMounted && this.props.editingTargetId === target.id) {
                this.setState({history, saveState: 'salvo'}, () => this.refreshWorkspace());
            }
        }, HISTORY_DELAY);
        clearTimeout(this.analysisTimer);
        clearTimeout(this.compileTimer);
        const targetId = target.id;
        this.analysisTimer = setTimeout(() => {
            if (
                !this._isMounted ||
                this.props.editingTargetId !== targetId ||
                this.state.source !== source
            ) return;
            const compilation = compileText(source, this.getCompileOptions(target));
            const errors = countErrors(compilation.diagnostics);
            this.setState({
                diagnostics: compilation.diagnostics,
                status: errors ?
                    this.localized(
                        `${errors} erro(s); a última versão válida continua executável.`,
                        `${errors} error(s); the last valid version remains executable.`
                    ) : this.t('analyzing'),
                statusKind: errors ? 'error' : 'working'
            });
            if (compilation.success) {
                this.compileTimer = setTimeout(() => {
                    if (
                        this.props.editingTargetId === targetId &&
                        this.state.source === source
                    ) this.applyCompilation(compilation, target, false);
                }, AUTO_COMPILE_DELAY);
            }
        }, ANALYSIS_DELAY);
    }

    handleWorkspaceModelChange (targetId, source) {
        const target = this.props.vm.runtime.getTargetById(targetId);
        if (!target || targetId === this.props.editingTargetId) return;
        const compilation = compileText(source, this.getCompileOptions(target));
        saveTextSource(this.props.vm, target, source);
        if (compilation.success) applyCompilation(this.props.vm, target, compilation);
        saveHistorySnapshot(this.getStorage(), this.getProjectStorageId(), targetId, source, 'refatoração');
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
        saveTextSource(this.props.vm, target, source);
        this.setState({
            secondarySource: source,
            saveState: 'salvando'
        });
        clearTimeout(this.secondaryAnalysisTimer);
        clearTimeout(this.secondaryCompileTimer);
        this.secondaryAnalysisTimer = setTimeout(() => {
            if (
                !this._isMounted ||
                this.state.secondaryTargetId !== target.id ||
                this.state.secondarySource !== source
            ) return;
            const compilation = compileText(source, this.getCompileOptions(target));
            const history = saveHistorySnapshot(
                this.getStorage(),
                this.getProjectStorageId(),
                target.id,
                source,
                'dual editor autosave'
            );
            this.setState({secondaryDiagnostics: compilation.diagnostics, saveState: 'salvo'});
            if (!compilation.success) return;
            this.secondaryCompileTimer = setTimeout(() => {
                if (
                    this.state.secondaryTargetId !== target.id ||
                    this.state.secondarySource !== source
                ) return;
                this.suppressBlockSyncUntil = Date.now() + 750;
                applyCompilation(this.props.vm, target, compilation);
                if (this._isMounted && this.state.secondaryTargetId === target.id) {
                    this.setState({saveState: 'salvo'}, () => this.refreshWorkspace());
                    if (target.id === this.props.editingTargetId) this.setState({history});
                }
            }, AUTO_COMPILE_DELAY);
        }, ANALYSIS_DELAY);
    }

    compileSecondary (run) {
        clearTimeout(this.secondaryCompileTimer);
        clearTimeout(this.secondaryAnalysisTimer);
        const target = this.state.secondaryTargetId &&
            this.props.vm.runtime.getTargetById(this.state.secondaryTargetId);
        if (!target) return;
        const compilation = compileText(this.state.secondarySource, this.getCompileOptions(target));
        this.setState({secondaryDiagnostics: compilation.diagnostics});
        if (!compilation.success) return;
        this.suppressBlockSyncUntil = Date.now() + 750;
        applyCompilation(this.props.vm, target, compilation);
        saveHistorySnapshot(
            this.getStorage(),
            this.getProjectStorageId(),
            target.id,
            this.state.secondarySource,
            'dual editor'
        );
        this.setState({saveState: 'salvo'}, () => this.refreshWorkspace());
        if (run) this.props.vm.greenFlag();
    }

    applyCompilation (compilation, target, run) {
        try {
            this.suppressBlockSyncUntil = Date.now() + 750;
            const record = applyCompilation(this.props.vm, target, compilation);
            this.lastAppliedSource = compilation.source;
            this.lastBlockFingerprint = blockFingerprint(target);
            const apply = record.lastApply || {};
            const changed = (apply.createdUnits || 0) + (apply.updatedUnits || 0);
            const history = saveHistorySnapshot(
                this.getStorage(), this.getProjectStorageId(), target.id, compilation.source, 'autosave'
            );
            this.setState(state => ({
                diagnostics: compilation.diagnostics,
                status: this.localized(
                    `${record.generatedBlockIds.length} bloco(s) · ${changed} unidade(s) atualizada(s) · ${apply.unchangedUnits || 0} preservada(s).`,
                    `${record.generatedBlockIds.length} block(s) · ${changed} updated unit(s) · ${apply.unchangedUnits || 0} preserved.`
                ),
                statusKind: 'success',
                saveState: 'salvo',
                history,
                blockRefresh: state.blockRefresh + 1
            }));
            if (run) this.props.vm.greenFlag();
        } catch (error) {
            console.error(error);
            this.setState({status: error.message, statusKind: 'error'});
        }
    }

    compileCurrent (run) {
        clearTimeout(this.compileTimer);
        clearTimeout(this.analysisTimer);
        const target = this.getTarget();
        if (!target) return;
        this.refreshExtensionCatalog();
        const compilation = compileText(this.state.source, this.getCompileOptions(target));
        const errors = countErrors(compilation.diagnostics);
        if (errors) {
            saveTextSource(this.props.vm, target, this.state.source);
            this.setState({
                diagnostics: compilation.diagnostics,
                status: this.localized(
                    `${errors} erro(s) impedem a compilação.`,
                    `${errors} error(s) prevent compilation.`
                ),
                statusKind: 'error'
            });
            return;
        }
        this.applyCompilation(compilation, target, run);
    }

    handleCompile () {
        this.compileCurrent(false);
    }

    handleRun () {
        this.compileCurrent(true);
    }

    handleImportBlocks () {
        const target = this.getTarget();
        if (!target) return;
        const result = decompileTarget(target, {extensionCatalog: this.extensionCatalog});
        if (result.importedRootIds.length === 0 && result.unsupportedRootIds.length === 0) {
            this.setState({
                status: this.localized(
                    'Este alvo não contém stacks para importar.',
                    'This target contains no stacks to import.'
                ),
                statusKind: 'idle'
            });
            return;
        }
        if (
            this.state.source.trim() &&
            typeof window !== 'undefined' &&
            !window.confirm(this.localized(
                'Substituir o texto atual pela conversão dos blocos existentes?',
                'Replace the current text with a conversion of the existing blocks?'
            ))
        ) return;
        const compilation = compileText(result.source, this.getCompileOptions(target));
        this.suppressBlockSyncUntil = Date.now() + 750;
        adoptImportedRoots(
            this.props.vm,
            target,
            result.source,
            result.importedRootIds,
            result.sourceMap,
            compilation
        );
        this.lastAppliedSource = result.source;
        this.lastBlockFingerprint = blockFingerprint(target);
        this.setState(state => ({
            source: result.source,
            diagnostics: compilation.diagnostics,
            status: this.localized(
                `${result.importedRootIds.length} stack(s) convertido(s); ${result.unsupportedRootIds.length} preservado(s) como blocos.`,
                `${result.importedRootIds.length} stack(s) converted; ${result.unsupportedRootIds.length} preserved as blocks.`
            ),
            statusKind: result.unsupportedRootIds.length ? 'working' : 'success',
            visualConflict: null,
            blockRefresh: state.blockRefresh + 1
        }));
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
                externalName: handle.name || file.name,
                externalOpen: true,
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
            const writable = await handle.createWritable();
            try {
                await writable.write(this.state.source);
                await writable.close();
            } catch (error) {
                await writable.abort();
                throw error;
            }
            this.setState({
                externalHandle: handle,
                externalName: handle.name || targetFileName(target),
                externalOpen: true,
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
            this.setState({status: this.t('externalSynchronized'), statusKind: 'success'});
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
            externalName: file.name,
            externalOpen: true,
            status: this.t('fileOpened', {name: file.name}),
            statusKind: 'success'
        });
    }

    async openTextwarp () {
        if (this.state.busy) return;
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
            if (!handle) return;
            await this.importTextwarpFile(await handle.getFile(), handle);
        } catch (error) {
            if (error && error.name === 'NotSupportedError') {
                if (this.packageInput) this.packageInput.click();
                return;
            }
            if (!error || error.name !== 'AbortError') {
                this.setState({status: error.message, statusKind: 'error'});
            }
        }
    }

    async importTextwarpFile (file, handle = null) {
        if (!file || this.state.busy) return;
        this.setState({
            busy: true,
            status: this.localized(`Abrindo ${file.name}…`, `Opening ${file.name}…`),
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
            this.setState({
                status: errors ?
                    this.localized(
                        `${file.name} aberto com erro em ${errors} módulo(s).`,
                        `${file.name} opened with errors in ${errors} module(s).`
                    ) :
                    this.localized(`${file.name} aberto.`, `${file.name} opened.`),
                statusKind: errors ? 'error' : 'success',
                busy: false
            });
            this.props.onSetProjectUnchanged();
            setTimeout(() => this.loadSelectedTarget(), 0);
        } catch (error) {
            console.error(error);
            this.setState({status: error.message, statusKind: 'error', busy: false});
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
        this.debugController.setEnabled(this.state.debugOpen || this.debugController.hasBreakpoints());
        this.setState({breakpoints});
    }

    handleSecondaryBreakpointsChange (breakpoints) {
        const target = this.state.secondaryTargetId &&
            this.props.vm.runtime.getTargetById(this.state.secondaryTargetId);
        if (!target) return;
        saveBreakpoints(this.props.vm, target, breakpoints);
        this.debugController.setBreakpoints(target, breakpoints);
        this.debugController.setEnabled(this.state.debugOpen || this.debugController.hasBreakpoints());
        this.refreshWorkspace();
    }

    handleInvalidShortcut (shortcut) {
        this.setState({
            status: this.localized(
                `Atalho inválido ou duplicado: ${shortcut}. O padrão foi mantido.`,
                `Invalid or duplicate shortcut: ${shortcut}. The default was kept.`
            ),
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
        if (this.state.diagnostics.length === 0) return <span className={styles.noDiagnostics}>{t('noProblems')}</span>;
        return this.state.diagnostics.slice(0, 8).map((item, index) => {
            const quoted = item.message.match(/[“"]([^”"]+)[”"]/);
            const helpQuery = quoted && quoted[1] || (/indent/.test(item.code) ? 'indentação' :
                /variable|list/.test(item.code) ? 'variável lista' : /procedure|parameter|return/.test(item.code) ?
                    'procedimentos parâmetros' : 'referência');
            return (
                <div className={classNames(styles.diagnostic, styles[item.severity])} key={`${item.line}:${item.column}:${item.code}:${index}`}>
                    <button title={normalizeLocale(this.props.locale) === 'pt' ? 'Ir para o problema' : 'Go to problem'} type="button" onClick={() => this.openLocation({
                        targetId: this.props.editingTargetId, line: item.line, column: item.column
                    })}>
                        <span className={styles.diagnosticLocation}>L{item.line}:{item.column}</span>
                        <span>{item.message}</span>
                        {getDiagnosticSuggestion(item) && <em>{getDiagnosticSuggestion(item)}</em>}
                        <small>{item.code}</small>
                    </button>
                    <button className={styles.diagnosticHelp} type="button" onClick={() => this.setState({
                        docsQuery: helpQuery,
                        viewMode: 'docs'
                    })}>{t('help')}</button>
                </div>
            );
        });
    }

    renderConsole () {
        const t = createTranslator(this.props.locale);
        const portuguese = normalizeLocale(this.props.locale) === 'pt';
        const entries = this.state.debugSnapshot.consoleEntries || [];
        return (
            <div className={styles.console} aria-label={t('outputConsole')}>
                <div className={styles.consoleActions}>
                    <strong>{portuguese ? 'Console estruturado' : 'Structured console'}</strong>
                    <span>{this.state.debugSnapshot.executionState === 'running' ?
                        (portuguese ? '● executando' : '● running') :
                        this.state.debugSnapshot.executionState === 'paused' ?
                            (portuguese ? 'Ⅱ pausado' : 'Ⅱ paused') : (portuguese ? '■ parado' : '■ stopped')}</span>
                    <button type="button" onClick={() => this.debugController.clearConsole()}>
                        {portuguese ? 'Limpar' : 'Clear'}
                    </button>
                </div>
                <div className={styles.consoleEntries} role="log" aria-live="polite">
                    {!entries.length && <span className={styles.noDiagnostics}>{portuguese ?
                        'A saída, perguntas e erros aparecerão aqui.' :
                        'Output, questions and errors will appear here.'}</span>}
                    {entries.slice().reverse().map(entry => (
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
                </div>
            </div>
        );
    }

    renderDebugger () {
        const portuguese = normalizeLocale(this.props.locale) === 'pt';
        const snapshot = this.state.debugSnapshot;
        const selectedThread = snapshot.threads.find(thread => thread.id === this.state.selectedThreadId) ||
            snapshot.threads.find(thread => thread.paused) || snapshot.threads[0];
        const inspector = selectedThread && selectedThread.inspector;
        const watches = this.getWatchValues();
        return (
            <div className={styles.debugger}>
                <div className={styles.debugActions}>
                    <button type="button" onClick={() => this.debugController.pauseAll()}>
                        {portuguese ? 'Pausar threads' : 'Pause threads'}
                    </button>
                    <button type="button" onClick={() => this.debugController.resumeAll()}>
                        {portuguese ? 'Continuar todas' : 'Resume all'}
                    </button>
                    <span>
                        {snapshot.threads.length} thread(s) · {this.state.breakpoints.length} breakpoint(s) · {
                            snapshot.selectiveInterpreter ?
                                (portuguese ? 'interpretador somente nos atores com breakpoint' :
                                    'interpreter only for actors with breakpoints') :
                                snapshot.interpreterRequired ?
                                    (portuguese ? 'interpretador para pausa global' : 'interpreter for global pause') :
                                    snapshot.jitEnabled ? (portuguese ? 'JIT ativo' : 'JIT active') :
                                        (portuguese ? 'interpretador do projeto' : 'project interpreter')
                        }
                    </span>
                </div>
                <div className={styles.debugGrid}>
                <div className={styles.threadList}>
                    {snapshot.threads.length === 0 && <span className={styles.noDiagnostics}>
                        {portuguese ? 'Nenhuma thread ativa.' : 'No active threads.'}
                    </span>}
                    {snapshot.threads.map(thread => (
                        <div
                            className={classNames(styles.thread, selectedThread && selectedThread.id === thread.id && styles.selectedThread)}
                            key={thread.id}
                        >
                            <button className={styles.threadSelect} type="button" onClick={() => this.setState({selectedThreadId: thread.id})}>
                            <span className={classNames(styles.threadState, thread.paused && styles.threadPaused)}>
                                {thread.paused ? (portuguese ? 'pausada' : 'paused') :
                                    (portuguese ? 'executando' : 'running')}
                            </span>
                            <strong>{thread.targetName}</strong>
                            <code>
                                {thread.line ? (portuguese ? `linha ${thread.line}` : `line ${thread.line}`) :
                                    thread.blockId || (portuguese ? 'sem linha' : 'no line')} · {
                                    thread.executionMode === 'jit' ? 'JIT' :
                                        (portuguese ? 'interpretador' : 'interpreter')
                                }
                            </code>
                            </button>
                            {thread.paused && <>
                                <button type="button" onClick={() => this.debugController.stepThread(thread.id)}>
                                    {thread.stepGranularity === 'frame' ?
                                        (portuguese ? 'Passo de frame' : 'Step frame') :
                                        (portuguese ? 'Entrar' : 'Step into')}
                                </button>
                                {thread.stepGranularity !== 'frame' && <button type="button" onClick={() =>
                                    this.debugController.stepOverThread(thread.id)
                                }>{portuguese ? 'Passar' : 'Step over'}</button>}
                                {thread.canStepOut && <button type="button" onClick={() =>
                                    this.debugController.stepOutThread(thread.id)
                                }>{portuguese ? 'Sair' : 'Step out'}</button>}
                                <button type="button" onClick={() => this.debugController.resumeThread(thread.id)}>
                                    {portuguese ? 'Continuar' : 'Resume'}
                                </button>
                            </>}
                        </div>
                    ))}
                </div>
                <div className={styles.inspector}>
                    <section>
                        <h3>{portuguese ? 'Variáveis e estado' : 'Variables and state'}</h3>
                        {inspector && inspector.target && <code>
                            x {inspector.target.x} · y {inspector.target.y} · {
                                portuguese ? 'direção' : 'direction'
                            } {inspector.target.direction} · {
                                inspector.target.visible ? (portuguese ? 'visível' : 'visible') :
                                    (portuguese ? 'oculto' : 'hidden')
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
                        <h3>{portuguese ? 'Pilha de chamadas' : 'Call stack'}</h3>
                        {selectedThread && selectedThread.callStack.map((frame, index) => (
                            <button key={`${frame.blockId}:${index}`} type="button" onClick={() => frame.line && this.openLocation({
                                targetId: selectedThread.targetId,
                                line: frame.line
                            })}>
                                <code>{frame.opcode || frame.blockId}</code>
                                <span>{frame.line ? `L${frame.line}` : (portuguese ? 'sem fonte' : 'no source')}</span>
                            </button>
                        ))}
                    </section>
                    <section>
                        <h3>Watch</h3>
                        <form onSubmit={event => this.addWatch(event)}>
                            <input
                                aria-label={portuguese ? 'Nova expressão watch' : 'New watch expression'}
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
                                <button type="button" aria-label={`${portuguese ? 'Remover' : 'Remove'} watch ${watch.expression}`} onClick={() => this.setState(state => ({
                                    watches: state.watches.filter(item => item !== watch.expression)
                                }))}>×</button>
                            </div>
                        ))}
                    </section>
                </div>
                </div>
                {snapshot.runtimeErrors.slice(0, 3).map(error => (
                    <details className={styles.runtimeError} key={`${error.timestamp}:${error.blockId}`}>
                        <summary>Runtime {error.targetName}{error.line ? ` L${error.line}` : ''}: {error.message}</summary>
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
        return (
            <div className={styles.extensionCatalog}>
                {entries.length === 0 && <span className={styles.noDiagnostics}>{t('noExtensions')}</span>}
                {entries.map((entry, index) => (
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
                            >{normalizeLocale(this.props.locale) === 'pt' ? 'Executar ação' : 'Run action'}</button>
                        )}
                    </div>
                ))}
            </div>
        );
    }

    render () {
        const t = createTranslator(this.props.locale);
        const targetLabel = this.state.isStage ? t('stage') : t('actor');
        const target = this.getTarget();
        const activeLines = this.state.debugSnapshot.activeLinesByTarget[this.props.editingTargetId] || [];
        const secondaryTarget = this.state.secondaryTargetId &&
            this.props.vm.runtime.getTargetById(this.state.secondaryTargetId);
        const secondaryActiveLines = secondaryTarget ?
            this.state.debugSnapshot.activeLinesByTarget[secondaryTarget.id] || [] : [];
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
                    this.state.compactLayout && styles.compactLayout,
                    this.state.narrowLayout && styles.narrowLayout
                )}
                data-tabs="textwarp"
                ref={element => { this.rootElement = element; }}
                style={rootStyle}
            >
                <header className={styles.toolbar}>
                    <div className={styles.identity}>
                        <span className={classNames(styles.targetBadge, this.state.isStage && styles.stageBadge)}>{targetLabel}</span>
                        <div>
                            <strong>{this.state.targetName || t('noneTarget')}</strong>
                            <span className={styles.filename}>{this.state.isStage ? 'stage.tw' : `${this.state.targetName || 'actor'}.tw`}</span>
                        </div>
                    </div>
                    <div className={styles.viewTabs} aria-label={t('viewModes')} role="tablist">
                        <button
                            className={this.state.viewMode === 'code' ? styles.activeTab : ''}
                            role="tab"
                            type="button"
                            onClick={() => this.setViewMode('code')}
                        >{t('code')}</button>
                        <button
                            className={this.state.viewMode === 'blocks' ? styles.activeTab : ''}
                            role="tab"
                            type="button"
                            onClick={() => this.setViewMode('blocks')}
                        >{t('blocks')}</button>
                        <button
                            className={this.state.viewMode === 'split' ? styles.activeTab : ''}
                            role="tab"
                            type="button"
                            onClick={() => this.setViewMode('split')}
                        >{t('split')}</button>
                        <button
                            className={this.state.viewMode === 'dual' ? styles.activeTab : ''}
                            role="tab"
                            type="button"
                            onClick={() => this.setViewMode('dual')}
                        >{t('dual')}</button>
                        <button
                            className={this.state.viewMode === 'docs' ? styles.activeTab : ''}
                            role="tab"
                            type="button"
                            onClick={() => this.setState({docsQuery: ''}, () => this.setViewMode('docs'))}
                        >{t('documentation')}</button>
                    </div>
                    <div className={styles.actions}>
                        <button
                            className={styles.drawerToggle}
                            type="button"
                            onClick={() => this.setState(state => ({toolsOpen: !state.toolsOpen}))}
                        >{t('tools')}</button>
                    </div>
                </header>
                <div className={classNames(
                    styles.actionDrawer,
                    this.state.compactLayout && !this.state.toolsOpen && styles.drawerClosed
                )}>
                    <button
                        className={styles.toolButton}
                        type="button"
                        onClick={() => {
                            if (this.monacoEditor) this.monacoEditor.openCommandPalette();
                        }}
                    >
                        {t('commands')}
                    </button>
                    <button
                        className={styles.toolButton}
                        type="button"
                        onClick={() => this.setState(state => ({
                            templatesOpen: !state.templatesOpen, settingsOpen: false, externalOpen: false
                        }))}
                    >
                        {t('models')}
                    </button>
                    <button
                        className={styles.toolButton}
                        type="button"
                        onClick={() => this.setState(state => ({
                            externalOpen: !state.externalOpen, settingsOpen: false, templatesOpen: false
                        }))}
                    >
                        {t('externalEditor')}
                    </button>
                    <button
                        className={styles.toolButton}
                        disabled={!this.state.targetName || this.state.busy}
                        type="button"
                        onClick={this.handleCompile}
                    >
                        {`${t('textToBlocks')} →`}
                    </button>
                    <button
                        className={styles.toolButton}
                        disabled={!this.state.targetName || this.state.busy}
                        type="button"
                        onClick={this.handleImportBlocks}
                    >
                        {`← ${t('blocksToText')}`}
                    </button>
                    <button
                        className={classNames(styles.toolButton, this.state.sidebarVisible && styles.debugButtonActive)}
                        title={`${t('projects')} (Ctrl+Shift+E)`}
                        type="button"
                        onClick={() => this.setState(state => ({sidebarVisible: !state.sidebarVisible}))}
                    >
                        {t('projects')}
                    </button>
                    <input
                        accept=".textwarp,application/zip"
                        className={styles.hiddenInput}
                        ref={element => {
                            this.packageInput = element;
                        }}
                        type="file"
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
                </div>
                <nav className={styles.openTabs} aria-label={t('openScripts')}>
                    {this.state.openTargetIds.map(targetId => {
                        const module = this.state.workspace.modules.find(item => item.id === targetId);
                        if (!module) return null;
                        return (
                            <div
                                className={targetId === this.props.editingTargetId ? styles.activeFileTab : ''}
                                key={targetId}
                            >
                                <button className={styles.fileTabMain} type="button" onClick={() => this.openTarget(targetId)}>
                                <span>{module.fileName}</span>
                                {targetId === this.props.editingTargetId && this.state.saveState === 'salvando' && <small>●</small>}
                                </button>
                                {this.state.openTargetIds.length > 1 && <button
                                    aria-label={`${t('close')} ${module.fileName}`}
                                    className={styles.closeFileTab}
                                    type="button"
                                    onClick={event => this.closeTarget(event, targetId)}
                                >×</button>}
                            </div>
                        );
                    })}
                </nav>
                {this.state.templatesOpen && (
                    <div className={styles.quickPanel} role="dialog" aria-label={t('models')}>
                        <strong>{t('templatesTitle')}</strong>
                        {IDE_TEMPLATES.filter(template => template.scope === (this.state.isStage ? 'stage' : 'actor')).map(template => (
                            <button key={template.id} type="button" onClick={() => this.applyTemplate(template)}>
                                {this.getTemplateName(template)}
                            </button>
                        ))}
                        <button type="button" onClick={() => this.setState({templatesOpen: false})}>{t('close')}</button>
                    </div>
                )}
                {this.state.settingsOpen && (
                    <div className={styles.quickPanel} role="dialog" aria-label={t('editorPreferences')}>
                        <strong>{t('editorPreferences')}</strong>
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
                            <output>{this.state.fontSize}px</output>
                        </label>
                        {Object.entries(this.state.shortcuts).map(([name, value]) => (
                            <label key={name}>
                                <span>{name}</span>
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
                                    status: this.localized(
                                        'Padrões restaurados somente nesta sessão.',
                                        'Defaults restored for this session only.'
                                    ),
                                    statusKind: 'working'
                                });
                            }
                            this.setFontSize(DEFAULT_FONT_SIZE);
                        }}>{t('resetDefaults')}</button>
                        <button type="button" onClick={() => this.setState({settingsOpen: false})}>{t('close')}</button>
                    </div>
                )}
                {this.state.externalOpen && (
                    <div className={styles.quickPanel} role="dialog" aria-label={t('externalEditor')}>
                        <strong>{t('externalEditor')}</strong>
                        <span className={styles.quickPanelHelp}>{t('externalHelp')}</span>
                        {this.state.externalName && <code>{this.state.externalName}</code>}
                        <button type="button" onClick={() => this.connectExternalSource()}>{t('externalConnect')}</button>
                        <button type="button" onClick={() => this.saveExternalSource(true)}>{t('externalSave')}</button>
                        <button disabled={!this.state.externalHandle} type="button" onClick={() => this.reloadExternalSource()}>
                            {t('externalReload')}
                        </button>
                        <button type="button" onClick={() => this.setState({externalOpen: false})}>{t('close')}</button>
                    </div>
                )}
                {this.state.visualConflict && (
                    <div className={styles.conflictBanner}>
                        <strong>{normalizeLocale(this.props.locale) === 'pt' ?
                            'Conflito entre texto e blocos.' : 'Text and blocks conflict.'}</strong>
                        <span>{normalizeLocale(this.props.locale) === 'pt' ?
                            'As duas versões têm alterações não aplicadas.' :
                            'Both versions contain unapplied changes.'}</span>
                        <button type="button" onClick={() => this.keepTextChanges()}>
                            {normalizeLocale(this.props.locale) === 'pt' ? 'Manter texto' : 'Keep text'}
                        </button>
                        <button type="button" onClick={() => this.acceptVisualChanges()}>
                            {normalizeLocale(this.props.locale) === 'pt' ? 'Usar blocos' : 'Use blocks'}
                        </button>
                    </div>
                )}
                <div className={styles.mainWorkspace}>
                    <IdeSidebar
                        activeFileName={targetFileName(target)}
                        activePanel={this.state.sidebarPanel}
                        activeTargetId={this.props.editingTargetId}
                        history={this.state.history}
                        locale={this.props.locale}
                        outline={getOutline(this.state.source)}
                        overlay={this.state.narrowLayout}
                        searchQuery={this.state.searchQuery}
                        searchResults={this.state.searchResults}
                        replaceValue={this.state.replaceValue}
                        visible={this.state.sidebarVisible && this.state.viewMode !== 'docs'}
                        workspace={this.state.workspace}
                        onInsertResource={this.insertResource}
                        onOpenLocation={this.openLocation}
                        onOpenResource={this.openResource}
                        onOpenTarget={this.openTarget}
                        onPanelChange={sidebarPanel => this.setState({sidebarPanel})}
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
                        />
                    )}
                <div className={classNames(
                    styles.editorArea,
                    this.state.viewMode === 'split' && styles.splitMode,
                    this.state.viewMode === 'dual' && styles.dualMode
                )} ref={element => { this.editorAreaElement = element; }}>
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
                    (this.state.debugOpen || this.state.consoleOpen || this.state.extensionsOpen) &&
                        styles.debugPanelOpen,
                    this.state.bottomPanelCollapsed && styles.bottomPanelCollapsed
                )}>
                    {!this.state.bottomPanelCollapsed && (
                        <div
                            aria-label={t('panels')}
                            className={styles.bottomResizeHandle}
                            role="separator"
                            tabIndex="0"
                            onPointerDown={event => this.startResize('bottom', event)}
                        />
                    )}
                    <div className={styles.statusRow}>
                        <span className={classNames(styles.statusDot, styles[this.state.statusKind])} />
                        <span aria-live="polite" role="status">{this.state.status}</span>
                        <nav className={styles.panelTabs} aria-label={t('panels')}>
                            <button className={!this.state.debugOpen && !this.state.consoleOpen && !this.state.extensionsOpen ? styles.activePanelTab : ''} type="button" onClick={() => this.setState({
                                bottomPanelCollapsed: false, debugOpen: false, consoleOpen: false, extensionsOpen: false
                            })}>{t('problems')} <small>{this.state.diagnostics.length}</small></button>
                            <button className={this.state.consoleOpen ? styles.activePanelTab : ''} type="button" onClick={() => this.setState({
                                bottomPanelCollapsed: false, debugOpen: false, consoleOpen: true, extensionsOpen: false
                            })}>{t('console')}</button>
                            <button className={this.state.debugOpen ? styles.activePanelTab : ''} type="button" onClick={() => {
                                this.debugController.setEnabled(true);
                                this.setState({
                                    bottomPanelCollapsed: false,
                                    debugOpen: true,
                                    consoleOpen: false,
                                    extensionsOpen: false
                                });
                            }}>{t('debugPanel')}</button>
                            <button
                                className={this.state.extensionsOpen ? styles.activePanelTab : ''}
                                type="button"
                                onClick={() => this.setState({
                                    bottomPanelCollapsed: false,
                                    debugOpen: false,
                                    consoleOpen: false,
                                    extensionsOpen: true
                                })}
                            >{t('extensions')}</button>
                        </nav>
                        <label className={styles.fontScale}>
                            <button aria-label={t('fontDecrease')} type="button" onClick={() => this.setFontSize(this.state.fontSize - 1)}>−</button>
                            <input
                                aria-label={t('fontSize')}
                                max="28"
                                min="11"
                                type="range"
                                value={this.state.fontSize}
                                onChange={event => this.setFontSize(event.target.value)}
                            />
                            <output>{this.state.fontSize}px</output>
                            <button aria-label={t('fontIncrease')} type="button" onClick={() => this.setFontSize(this.state.fontSize + 1)}>＋</button>
                            <button aria-label={t('fontReset')} type="button" onClick={() => this.setFontSize(DEFAULT_FONT_SIZE)}>0</button>
                        </label>
                        <span className={styles.languageHelp}>
                            {this.state.saveState === 'salvo' ? `✓ ${t('saved')}` : `● ${t('saving')}`} · TextWarp 0.3 · {
                                this.state.extensionSummary.extensionCount
                            } {t('extensions')} · {this.state.extensionSummary.blockCount} opcode(s)
                        </span>
                        <button
                            aria-label={this.state.bottomPanelCollapsed ? t('panelExpand') : t('panelCollapse')}
                            className={styles.collapsePanelButton}
                            type="button"
                            onClick={() => this.setState(state => ({
                                bottomPanelCollapsed: !state.bottomPanelCollapsed
                            }))}
                        >{this.state.bottomPanelCollapsed ? '⌃' : '⌄'}</button>
                    </div>
                    {!this.state.bottomPanelCollapsed && (this.state.debugOpen ? this.renderDebugger() :
                        this.state.consoleOpen ? this.renderConsole() : this.state.extensionsOpen ?
                        this.renderExtensionCatalog() : <div className={styles.diagnostics}>{this.renderDiagnostics()}</div>
                    )}
                </aside>
            </section>
        );
    }
}

TextEditor.propTypes = {
    canUseCloud: PropTypes.bool,
    editingTargetId: PropTypes.string,
    editingTargetName: PropTypes.string,
    grow: PropTypes.number,
    guiTheme: PropTypes.string,
    isVisible: PropTypes.bool,
    locale: PropTypes.string,
    onOpenCustomExtensionModal: PropTypes.func,
    onClearSb3FileHandle: PropTypes.func.isRequired,
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
    isVisible: true,
    locale: 'en',
    onOpenCustomExtensionModal: null,
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
        guiTheme: state.scratchGui.theme.theme.gui,
        locale: state.locales.locale,
        projectTitle: state.scratchGui.projectTitle,
        textwarpUiCommand: state.scratchGui.tw.textwarpUiCommand
    };
};

const mapDispatchToProps = dispatch => ({
    onClearSb3FileHandle: () => dispatch(setFileHandle(null)),
    onSetProjectUnchanged: () => dispatch(setProjectUnchanged())
});

export default connect(mapStateToProps, mapDispatchToProps)(TextEditor);
