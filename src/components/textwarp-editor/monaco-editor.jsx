import PropTypes from 'prop-types';
import React from 'react';

import {createTranslator} from '../../lib/textwarp/i18n';
import {
    clearDocumentIndexes,
    getContextualValueControl,
    getDiagnosticSuggestion,
    getResourceAt
} from '../../lib/textwarp/language-service';
import {
    clearModelContext,
    clampMarkerRange,
    createModelUri,
    loadMonaco,
    retryMonaco,
    setModelContext
} from '../../lib/textwarp/monaco-loader';
import {parseKeybinding} from '../../lib/textwarp/shortcut-service';

import styles from './monaco-editor.css';

class MonacoEditor extends React.Component {
    constructor (props) {
        super(props);
        this.state = {contextControl: null, loadError: null, loaded: false};
        this.shell = null;
        this.container = null;
        this.contextPanel = null;
        this.editor = null;
        this.monaco = null;
        this.models = new Map();
        this.modelSubscriptions = new Map();
        this.modelKeysByUri = new Map();
        this.modelStates = new Map();
        this.changeSubscription = null;
        this.cursorSubscription = null;
        this.focusSubscription = null;
        this.mouseSubscription = null;
        this.scrollSubscription = null;
        this.modelChangeSubscription = null;
        this.editorOpenerDisposable = null;
        this.resizeObserver = null;
        this.actionDisposables = [];
        this.decorationIds = [];
        this.breakpointDecorationIds = [];
        this.ignoreChanges = false;
        this.mounted = false;
        this.initializationId = 0;
        this.currentNamespace = null;
        this.adaptiveLineBand = null;
        this.lastAdaptiveOptions = null;
        this.runtimeActiveLines = props.activeLines;
        this.setContainer = element => {
            this.container = element;
        };
        this.setShell = element => {
            this.shell = element;
        };
        this.setContextPanel = element => {
            this.contextPanel = element;
        };
        this.handleRetry = () => this.initializeMonaco(true);
        this.handleFallbackChange = event => this.props.onChange(event.target.value);
        this.handleDocumentPointerDown = event => {
            if (this.contextPanel && this.contextPanel.contains(event.target)) return;
            if (this.state.contextControl) this.setState({contextControl: null});
        };
    }
    componentDidMount () {
        this.mounted = true;
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
        this.initializeMonaco(false);
    }
    // Initialization belongs next to mount because it is also the retry entrypoint.
    // eslint-disable-next-line react/sort-comp
    initializeMonaco (retry) {
        const initializationId = ++this.initializationId;
        this.setState({contextControl: null, loadError: null, loaded: false});
        if (retry && this.props.onLoadError) this.props.onLoadError(null);
        const loader = retry ? retryMonaco() : loadMonaco();
        loader.then(monaco => {
            if (!this.mounted || !this.container || initializationId !== this.initializationId) return;
            this.monaco = monaco;
            this.container.textContent = '';
            this.currentNamespace = this.getModelNamespace();
            const model = this.getModel(this.props.modelKey, this.props.value);
            const t = createTranslator(this.props.locale);
            const compact = this.container.clientWidth > 0 && this.container.clientWidth < 700;
            this.editor = monaco.editor.create(this.container, {
                model,
                theme: this.props.dark ? 'vs-dark' : 'vs',
                automaticLayout: true,
                fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                fontSize: this.props.fontSize,
                lineHeight: Math.round(this.props.fontSize * 1.53),
                minimap: {enabled: !compact && model.getLineCount() < 500},
                glyphMargin: true,
                folding: true,
                foldingStrategy: 'auto',
                padding: {top: 14, bottom: 14},
                renderWhitespace: 'selection',
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                stickyScroll: {enabled: !compact && model.getLineCount() < 1000},
                tabSize: 4,
                insertSpaces: true,
                wordWrap: compact ? 'on' : 'bounded',
                wordWrapColumn: 120,
                ariaLabel: t('editor')
            });
            setModelContext(model, this.getLanguageContext(this.props.modelKey));
            this.syncDocumentModels();
            this.changeSubscription = this.editor.onDidChangeModelContent(() => {
                if (this.ignoreChanges) return;
                if (this.state.contextControl) this.setState({contextControl: null});
                const activeModel = this.editor.getModel();
                const key = activeModel && this.modelKeysByUri.get(String(activeModel.uri));
                const state = key && this.modelStates.get(key);
                if (state) state.dirty = true;
                this.monaco.editor.setModelMarkers(activeModel, 'textwarp', []);
                if (key && key !== this.props.modelKey) return;
                this.props.onChange(this.editor.getValue());
                const lineBand = this.getAdaptiveLineBand();
                if (lineBand !== this.adaptiveLineBand) this.updateAdaptiveOptions();
                setTimeout(() => this.syncTrackedBreakpoints(), 0);
            });
            this.modelChangeSubscription = this.editor.onDidChangeModel(() => {
                const activeModel = this.editor.getModel();
                const key = activeModel && this.modelKeysByUri.get(String(activeModel.uri));
                if (key && key !== this.props.modelKey && this.props.onOpenModel) this.props.onOpenModel(key);
                this.updateAdaptiveOptions();
            });
            this.cursorSubscription = this.editor.onDidChangeCursorPosition(event => {
                if (this.props.onCursorPositionChange) {
                    this.props.onCursorPositionChange({
                        column: event.position.column,
                        line: event.position.lineNumber
                    });
                }
            });
            this.focusSubscription = this.editor.onDidFocusEditorText(() => {
                if (this.props.onFocus) this.props.onFocus();
            });
            if (typeof window !== 'undefined' && window.ResizeObserver) {
                this.resizeObserver = new window.ResizeObserver(() => this.updateAdaptiveOptions());
                this.resizeObserver.observe(this.container);
            }
            this.registerEditorOpener();
            this.mouseSubscription = this.editor.onMouseDown(event => {
                if (
                    event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
                    event.target.position
                ) {
                    this.toggleBreakpoint(event.target.position.lineNumber);
                    if (this.state.contextControl) this.setState({contextControl: null});
                    return;
                }
                const browserEvent = event.event && event.event.browserEvent;
                if (
                    event.target.position && browserEvent && (browserEvent.ctrlKey || browserEvent.metaKey) &&
                    this.props.onNavigateResource
                ) {
                    const position = event.target.position;
                    const resource = getResourceAt(
                        this.editor.getValue(),
                        position.lineNumber,
                        position.column,
                        this.getLanguageContext(this.props.modelKey)
                    );
                    if (resource) this.props.onNavigateResource(resource);
                    if (this.state.contextControl) this.setState({contextControl: null});
                    return;
                }
                if (!event.target.position || !browserEvent || browserEvent.button !== 0) {
                    if (this.state.contextControl) this.setState({contextControl: null});
                    return;
                }
                this.openContextControl(event.target.position, browserEvent);
            });
            this.scrollSubscription = this.editor.onDidScrollChange(() => {
                if (this.state.contextControl) this.setState({contextControl: null});
            });
            this.registerActions();
            this.updateMarkers();
            this.updateDecorations();
            this.updateAdaptiveOptions();
            this.setState({loaded: true});
            if (this.props.onLoadError) this.props.onLoadError(null);
            if (this.props.onReady) this.props.onReady(this);
        }).catch(error => {
            console.error(error);
            if (this.mounted && initializationId === this.initializationId) {
                const message = error && error.message ? error.message : String(error);
                this.setState({contextControl: null, loadError: message, loaded: false});
                if (this.props.onLoadError) this.props.onLoadError(message);
            }
        });
    }
    componentDidUpdate (previousProps) {
        if (!this.editor || !this.monaco) return;
        const namespace = this.getModelNamespace();
        const namespaceChanged = namespace !== this.currentNamespace;
        if (namespaceChanged) {
            this.editor.setModel(null);
            this.disposeModels();
            this.currentNamespace = namespace;
            this.editor.setModel(this.getModel(this.props.modelKey, this.props.value));
            this.syncDocumentModels();
        }
        const activeState = this.modelStates.get(this.props.modelKey);
        if (!namespaceChanged && previousProps.modelKey !== this.props.modelKey) {
            this.editor.setModel(this.getModel(this.props.modelKey, this.props.value));
        } else if (
            !namespaceChanged &&
            previousProps.value !== this.props.value &&
            this.editor.getValue() !== this.props.value &&
            (!activeState || !activeState.dirty)
        ) {
            this.ignoreChanges = true;
            const model = this.editor.getModel();
            model.pushStackElement();
            model.pushEditOperations([], [{range: model.getFullModelRange(), text: this.props.value}], () => null);
            model.pushStackElement();
            this.ignoreChanges = false;
        }
        if (activeState && this.editor.getValue() === this.props.value) {
            activeState.dirty = false;
            activeState.lastExternalValue = this.props.value;
        }
        if (
            namespaceChanged ||
            previousProps.languageContext !== this.props.languageContext ||
            previousProps.modelKey !== this.props.modelKey ||
            previousProps.instanceKey !== this.props.instanceKey
        ) {
            setModelContext(this.editor.getModel(), this.getLanguageContext(this.props.modelKey));
            this.syncDocumentModels();
        }
        if (previousProps.shortcuts !== this.props.shortcuts || previousProps.locale !== this.props.locale) {
            this.actionDisposables.forEach(disposable => disposable.dispose());
            this.actionDisposables = [];
            this.registerActions();
        }
        if (previousProps.dark !== this.props.dark) {
            this.monaco.editor.setTheme(this.props.dark ? 'vs-dark' : 'vs');
        }
        if (previousProps.fontSize !== this.props.fontSize || previousProps.locale !== this.props.locale) {
            this.editor.updateOptions({
                ariaLabel: createTranslator(this.props.locale)('editor'),
                fontSize: this.props.fontSize,
                lineHeight: Math.round(this.props.fontSize * 1.53)
            });
        }
        if (
            namespaceChanged ||
            previousProps.diagnostics !== this.props.diagnostics ||
            previousProps.modelKey !== this.props.modelKey
        ) {
            this.updateMarkers();
        }
        if (
            namespaceChanged ||
            previousProps.activeLines !== this.props.activeLines ||
            previousProps.breakpoints !== this.props.breakpoints ||
            previousProps.modelKey !== this.props.modelKey
        ) {
            if (previousProps.activeLines !== this.props.activeLines) {
                this.runtimeActiveLines = this.props.activeLines;
            }
            this.updateDecorations();
        }
        if (this.props.visible && !previousProps.visible) this.editor.layout();
    }
    componentWillUnmount () {
        this.mounted = false;
        this.initializationId++;
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
        if (this.changeSubscription) this.changeSubscription.dispose();
        if (this.cursorSubscription) this.cursorSubscription.dispose();
        if (this.focusSubscription) this.focusSubscription.dispose();
        if (this.mouseSubscription) this.mouseSubscription.dispose();
        if (this.scrollSubscription) this.scrollSubscription.dispose();
        if (this.modelChangeSubscription) this.modelChangeSubscription.dispose();
        if (this.editorOpenerDisposable) this.editorOpenerDisposable.dispose();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        this.actionDisposables.forEach(disposable => disposable.dispose());
        if (this.editor) this.editor.dispose();
        this.disposeModels();
        this.currentNamespace = null;
    }
    disposeModels () {
        clearDocumentIndexes(this.models.keys());
        this.modelSubscriptions.forEach(subscription => subscription.dispose());
        this.modelSubscriptions.clear();
        this.models.forEach(model => {
            clearModelContext(model);
            model.dispose();
        });
        this.models.clear();
        this.modelKeysByUri.clear();
        this.modelStates.clear();
        this.decorationIds = [];
        this.breakpointDecorationIds = [];
    }
    getModelNamespace () {
        const workspaceId = this.props.languageContext.workspaceId || 'workspace';
        return `${this.props.instanceKey}:${workspaceId}`;
    }
    getLanguageContext (modelKey = this.props.modelKey) {
        const targetResource = (this.props.languageContext.resources || []).find(resource =>
            resource.id === modelKey && ['actor', 'stage'].includes(resource.kind)
        );
        return Object.assign({}, this.props.languageContext, {
            instanceKey: this.props.instanceKey,
            isStage: targetResource ? targetResource.kind === 'stage' : this.props.languageContext.isStage,
            locale: this.props.locale,
            modelNamespace: this.currentNamespace || this.getModelNamespace(),
            modelKey,
            targetId: modelKey
        });
    }
    openContextControl (position, browserEvent) {
        if (!this.editor || !this.shell) return;
        const control = getContextualValueControl(
            this.editor.getValue(),
            position.lineNumber,
            position.column,
            this.getLanguageContext(this.props.modelKey)
        );
        if (!control) {
            if (this.state.contextControl) this.setState({contextControl: null});
            return;
        }
        const bounds = this.shell.getBoundingClientRect();
        const panelWidth = Math.min(280, Math.max(210, bounds.width - 16));
        const left = Math.max(8, Math.min(bounds.width - panelWidth - 8, browserEvent.clientX - bounds.left));
        const top = Math.max(8, Math.min(bounds.height - 130, browserEvent.clientY - bounds.top + 18));
        this.setState({
            contextControl: Object.assign({}, control, {
                left,
                numberDraft: control.kind === 'number' ? String(control.value) : null,
                panelWidth,
                top
            })
        });
    }
    applyContextValue (value, replacement) {
        const control = this.state.contextControl;
        if (!control || !this.editor) return;
        const text = typeof replacement === 'function' ? replacement(value) : replacement;
        if (typeof text !== 'string') return;
        this.editor.executeEdits('textwarp-context-control', [{
            range: control.range,
            text,
            forceMoveMarkers: true
        }]);
        this.setState({contextControl: null}, () => this.editor.focus());
    }
    /* eslint-disable react/jsx-no-bind */
    renderContextControl () {
        const control = this.state.contextControl;
        if (!control) return null;
        const t = createTranslator(this.props.locale);
        const title = control.argumentName ?
            `${t('contextualValue')}: ${control.argumentName}` : t('contextualValue');
        return (
            <div
                aria-label={title}
                className={styles.contextControl}
                ref={this.setContextPanel}
                role="dialog"
                style={{left: control.left, top: control.top, width: control.panelWidth}}
            >
                <div className={styles.contextHeader}>
                    <div>
                        <strong>{title}</strong>
                        {control.callName && <small>{control.callName}</small>}
                    </div>
                    <button
                        aria-label={t('close')}
                        type="button"
                        onClick={() => this.setState({contextControl: null})}
                    >
                        {'×'}
                    </button>
                </div>
                {control.kind === 'boolean' && (
                    <div className={styles.booleanControl}>
                        {control.values.map(item => (
                            <button
                                aria-pressed={control.value === item.value}
                                key={String(item.value)}
                                type="button"
                                onClick={() => this.applyContextValue(item.value, item.replacement)}
                            >
                                {item.value ? t('trueValue') : t('falseValue')}
                            </button>
                        ))}
                    </div>
                )}
                {control.kind === 'color' && (
                    <label className={styles.colorControl}>
                        <span>{t('chooseColor')}</span>
                        <input
                            aria-label={t('chooseColor')}
                            type="color"
                            value={control.value}
                            onChange={event => this.applyContextValue(event.target.value, control.replacement)}
                        />
                        <code>{control.value}</code>
                    </label>
                )}
                {control.kind === 'select' && (
                    <label className={styles.selectControl}>
                        <span>{t('chooseValue')}</span>
                        <select
                            autoFocus
                            defaultValue={String(control.value)}
                            onChange={event => {
                                const option = control.options.find(item =>
                                    String(item.value) === event.target.value
                                );
                                if (option) this.applyContextValue(option.value, option.replacement);
                            }}
                        >
                            {!control.options.some(option => String(option.value) === String(control.value)) && (
                                <option
                                    disabled
                                    value={String(control.value)}
                                >
                                    {String(control.value)}
                                </option>
                            )}
                            {control.options.map((option, index) => (
                                <option
                                    key={`${String(option.value)}:${index}`}
                                    value={String(option.value)}
                                >
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {control.kind === 'number' && (
                    <form
                        className={styles.numberControl}
                        onSubmit={event => {
                            event.preventDefault();
                            const value = Number(control.numberDraft);
                            if (Number.isFinite(value)) this.applyContextValue(value, control.replacement);
                        }}
                    >
                        <button
                            aria-label={t('decreaseValue')}
                            type="button"
                            onClick={() => this.applyContextValue(control.value - control.step, control.replacement)}
                        >
                            {'−'}
                        </button>
                        <input
                            aria-label={t('numberValue')}
                            step={control.step}
                            type="number"
                            value={control.numberDraft}
                            onChange={event => this.setState({
                                contextControl: Object.assign({}, control, {numberDraft: event.target.value})
                            })}
                        />
                        <button
                            aria-label={t('increaseValue')}
                            type="button"
                            onClick={() => this.applyContextValue(control.value + control.step, control.replacement)}
                        >
                            {'+'}
                        </button>
                        <button
                            className={styles.applyValue}
                            type="submit"
                        >
                            {t('apply')}
                        </button>
                    </form>
                )}
            </div>
        );
    }
    /* eslint-enable react/jsx-no-bind */
    getModel (key, value) {
        if (this.models.has(key)) {
            const existing = this.models.get(key);
            const state = this.modelStates.get(key);
            if (existing.getValue() !== value && (!state || !state.dirty)) {
                this.ignoreChanges = true;
                existing.setValue(value);
                this.ignoreChanges = false;
                if (state) state.lastExternalValue = value;
            }
            return existing;
        }
        const uri = createModelUri(
            this.monaco,
            this.currentNamespace || this.getModelNamespace(),
            key
        );
        const model = this.monaco.editor.createModel(value, 'textwarp', uri);
        this.modelKeysByUri.set(String(uri), key);
        this.modelStates.set(key, {dirty: false, lastExternalValue: value});
        setModelContext(model, this.getLanguageContext(key));
        this.modelSubscriptions.set(key, model.onDidChangeContent(() => {
            setModelContext(model, this.getLanguageContext(key));
            if (
                !this.ignoreChanges && key !== this.props.modelKey && !String(key).endsWith(':secondary') &&
                this.props.onWorkspaceModelChange
            ) {
                const state = this.modelStates.get(key);
                if (state) state.dirty = true;
                this.props.onWorkspaceModelChange(key, model.getValue());
                if (state) {
                    state.dirty = false;
                    state.lastExternalValue = model.getValue();
                }
            }
        }));
        this.models.set(key, model);
        return model;
    }
    syncDocumentModels () {
        if (!this.monaco || !this.props.workspaceModels) return;
        const documents = this.props.languageContext.documents || [];
        const retained = new Set([this.props.modelKey]);
        documents.forEach(document => {
            if (!document.modelKey) return;
            retained.add(document.modelKey);
            const existing = this.models.get(document.modelKey);
            if (!existing) {
                this.getModel(document.modelKey, document.source || '');
                return;
            }
            setModelContext(existing, this.getLanguageContext(document.modelKey));
            const state = this.modelStates.get(document.modelKey);
            if (
                document.modelKey !== this.props.modelKey &&
                existing.getValue() !== document.source &&
                (!state || !state.dirty)
            ) {
                this.ignoreChanges = true;
                existing.setValue(document.source || '');
                this.ignoreChanges = false;
                if (state) state.lastExternalValue = document.source || '';
            }
        });
        Array.from(this.models.keys()).forEach(key => {
            if (retained.has(key)) return;
            const model = this.models.get(key);
            const subscription = this.modelSubscriptions.get(key);
            if (subscription) subscription.dispose();
            clearModelContext(model);
            this.modelSubscriptions.delete(key);
            this.modelStates.delete(key);
            this.modelKeysByUri.delete(String(model.uri));
            this.models.delete(key);
            model.dispose();
        });
    }
    registerActions () {
        const shortcuts = this.props.shortcuts;
        const t = createTranslator(this.props.locale);
        const parse = (value, fallback) => parseKeybinding(
            this.monaco,
            value,
            fallback,
            this.props.onInvalidShortcut
        );
        const actions = [
            {
                id: 'textwarp.compile',
                label: `TextWarp: ${t('textToBlocks')}`,
                value: shortcuts.compile,
                fallback: this.monaco.KeyCode.F7,
                run: this.props.onCompile
            },
            {
                id: 'textwarp.run',
                label: `TextWarp: ${t('run')}`,
                value: shortcuts.run,
                fallback: this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.Enter,
                run: this.props.onRun
            },
            {
                id: 'textwarp.runSelection',
                label: `TextWarp: ${t('run')} selection`,
                value: shortcuts.runSelection,
                fallback: this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Shift | this.monaco.KeyCode.Enter,
                run: this.props.onRunSelection ? () => this.props.onRunSelection(this.getSelection()) : null
            },
            {
                id: 'textwarp.stop',
                label: `TextWarp: ${t('stop')}`,
                value: shortcuts.stop,
                fallback: this.monaco.KeyMod.Shift | this.monaco.KeyCode.F5,
                run: this.props.onStop
            },
            {
                id: 'textwarp.restart',
                label: `TextWarp: ${t('redo')}`,
                value: shortcuts.restart,
                fallback: this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Shift | this.monaco.KeyCode.F5,
                run: this.props.onRestart
            },
            {
                id: 'textwarp.format',
                label: 'TextWarp: Format document',
                value: shortcuts.format,
                fallback: this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Shift | this.monaco.KeyCode.KeyI,
                run: () => {
                    this.editor.getAction('editor.action.formatDocument').run();
                }
            }
        ];
        const enabledActions = actions
            .filter(action => action.run && String(action.value || '').trim())
            .map(action => Object.assign({}, action, {
                keybinding: parse(action.value, action.fallback)
            }));
        const reportedCollisions = new Set();
        for (let attempt = 0; attempt < enabledActions.length; attempt++) {
            const bindings = new Map();
            enabledActions.forEach(action => {
                if (!bindings.has(action.keybinding)) bindings.set(action.keybinding, []);
                bindings.get(action.keybinding).push(action);
            });
            let changed = false;
            bindings.forEach(colliding => {
                if (colliding.length < 2) return;
                const collisionId = colliding.map(action => action.id).sort()
                    .join(':');
                if (!reportedCollisions.has(collisionId) && this.props.onInvalidShortcut) {
                    this.props.onInvalidShortcut(colliding.map(action => action.label).join(' / '));
                }
                reportedCollisions.add(collisionId);
                colliding.forEach(action => {
                    if (action.keybinding !== action.fallback) changed = true;
                    action.keybinding = action.fallback;
                });
            });
            if (!changed) break;
        }
        enabledActions.forEach(action => {
            this.actionDisposables.push(this.editor.addAction({
                id: action.id,
                label: action.label,
                keybindings: [action.keybinding],
                run: action.run
            }));
        });
    }
    toggleBreakpoint (line) {
        if (this.props.onToggleBreakpoint) {
            this.props.onToggleBreakpoint(line);
            return;
        }
        if (!this.props.onBreakpointsChange) return;
        const breakpoints = new Set(this.props.breakpoints);
        if (breakpoints.has(line)) breakpoints.delete(line);
        else breakpoints.add(line);
        this.props.onBreakpointsChange(Array.from(breakpoints).sort((left, right) => left - right));
    }
    toggleBreakpointAtCursor () {
        if (!this.editor) return;
        const position = this.editor.getPosition();
        if (position) this.toggleBreakpoint(position.lineNumber);
    }
    registerEditorOpener () {
        this.editorOpenerDisposable = this.monaco.editor.registerEditorOpener({
            openCodeEditor: (sourceEditor, resource, selectionOrPosition) => {
                if (sourceEditor !== this.editor) return false;
                const model = this.monaco.editor.getModel(resource);
                if (!model || !this.modelKeysByUri.has(String(resource))) return false;
                this.editor.setModel(model);
                if (selectionOrPosition) {
                    const position = {
                        lineNumber: selectionOrPosition.startLineNumber || selectionOrPosition.lineNumber,
                        column: selectionOrPosition.startColumn || selectionOrPosition.column
                    };
                    if (selectionOrPosition.startLineNumber) this.editor.setSelection(selectionOrPosition);
                    else this.editor.setPosition(position);
                    this.editor.revealPositionInCenter(position);
                }
                this.editor.focus();
                return true;
            }
        });
    }
    getSelection () {
        if (!this.editor) return null;
        const selection = this.editor.getSelection();
        return {
            text: this.editor.getModel().getValueInRange(selection),
            startLine: selection.startLineNumber,
            endLine: selection.endLineNumber,
            empty: selection.isEmpty()
        };
    }
    revealPosition (line, column = 1) {
        if (!this.editor) return;
        this.editor.setPosition({lineNumber: line, column});
        this.editor.revealLineInCenter(line);
        this.editor.focus();
    }
    insertText (text) {
        if (!this.editor) return;
        const selection = this.editor.getSelection();
        this.editor.executeEdits('textwarp-resource', [{range: selection, text, forceMoveMarkers: true}]);
        this.editor.focus();
    }
    insertSnippet (snippet) {
        if (!this.editor) return;
        this.editor.focus();
        this.editor.trigger('textwarp-commands', 'editor.action.insertSnippet', {snippet});
    }
    focus () {
        if (this.editor) this.editor.focus();
    }
    setRuntimeActiveLines (activeLines) {
        const normalized = activeLines || [];
        if (
            normalized.length === this.runtimeActiveLines.length &&
            normalized.every((line, index) => line === this.runtimeActiveLines[index])
        ) return;
        this.runtimeActiveLines = normalized.slice();
        this.updateDecorations();
    }
    openCommandPalette () {
        if (!this.editor) return;
        this.editor.focus();
        const action = this.editor.getAction('editor.action.quickCommand');
        if (action) action.run();
    }
    formatDocument () {
        if (!this.editor) return;
        this.editor.focus();
        const action = this.editor.getAction('editor.action.formatDocument');
        if (action) action.run();
    }
    updateMarkers () {
        if (!this.editor || !this.monaco) return;
        const model = this.editor.getModel();
        const t = createTranslator(this.props.locale);
        const markers = this.props.diagnostics.map(item => {
            const range = clampMarkerRange(model, item);
            const suggestion = getDiagnosticSuggestion(item, this.props.locale);
            return {
                severity: item.severity === 'warning' ?
                    this.monaco.MarkerSeverity.Warning :
                    this.monaco.MarkerSeverity.Error,
                message: suggestion ? `${item.message}\n${t('suggestion')}: ${suggestion}` : item.message,
                startLineNumber: range.line,
                startColumn: range.startColumn,
                endLineNumber: range.endLine,
                endColumn: range.endColumn,
                code: item.code
            };
        });
        this.monaco.editor.setModelMarkers(model, 'textwarp', markers);
    }
    updateDecorations () {
        if (!this.editor || !this.monaco) return;
        const t = createTranslator(this.props.locale);
        const decorations = [];
        this.props.breakpoints.forEach(line => decorations.push({
            range: new this.monaco.Range(line, 1, line, 1),
            options: {
                glyphMarginClassName: 'textwarp-breakpoint-glyph',
                glyphMarginHoverMessage: {value: `${t('debug')} · ${t('language')} ${line}`}
            }
        }));
        this.runtimeActiveLines.forEach(line => decorations.push({
            range: new this.monaco.Range(line, 1, line, 1),
            options: {
                isWholeLine: true,
                className: 'textwarp-active-line',
                glyphMarginClassName: 'textwarp-active-glyph'
            }
        }));
        this.decorationIds = this.editor.deltaDecorations(this.decorationIds, decorations);
        this.breakpointDecorationIds = this.decorationIds.slice(0, this.props.breakpoints.length);
    }
    updateAdaptiveOptions () {
        if (!this.editor || !this.container) return;
        const model = this.editor.getModel();
        if (!model) return;
        const compact = this.container.clientWidth > 0 && this.container.clientWidth < 700;
        const lineBand = this.getAdaptiveLineBand();
        const nextOptions = {
            minimap: !compact && lineBand === 'small',
            stickyScroll: !compact && lineBand !== 'large',
            compact
        };
        if (
            this.lastAdaptiveOptions &&
            Object.keys(nextOptions).every(key => nextOptions[key] === this.lastAdaptiveOptions[key])
        ) {
            this.adaptiveLineBand = lineBand;
            return;
        }
        this.lastAdaptiveOptions = nextOptions;
        this.adaptiveLineBand = lineBand;
        this.editor.updateOptions({
            minimap: {enabled: nextOptions.minimap},
            stickyScroll: {enabled: nextOptions.stickyScroll},
            wordWrap: compact ? 'on' : 'bounded',
            wordWrapColumn: compact ? 80 : 120
        });
    }
    getAdaptiveLineBand () {
        if (!this.editor || !this.editor.getModel()) return 'small';
        const lineCount = this.editor.getModel().getLineCount();
        return lineCount < 500 ? 'small' : lineCount < 1000 ? 'medium' : 'large';
    }
    syncTrackedBreakpoints () {
        if (
            !this.mounted ||
            !this.editor ||
            !this.props.onBreakpointsChange ||
            !this.breakpointDecorationIds.length
        ) return;
        const model = this.editor.getModel();
        if (!model) return;
        const breakpoints = this.breakpointDecorationIds.map(id => model.getDecorationRange(id))
            .filter(Boolean)
            .map(range => range.startLineNumber)
            .filter((line, index, values) => values.indexOf(line) === index)
            .sort((left, right) => left - right);
        if (
            breakpoints.length !== this.props.breakpoints.length ||
            breakpoints.some((line, index) => line !== this.props.breakpoints[index])
        ) this.props.onBreakpointsChange(breakpoints);
    }
    render () {
        const t = createTranslator(this.props.locale);
        if (this.state.loadError) {
            return (
                <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
                    <div style={{padding: '0.5rem', color: '#c33'}}>
                        {t('editorBasic')}
                        <button
                            type="button"
                            onClick={this.handleRetry}
                        >
                            {t('editorRetry')}
                        </button>
                        <details>
                            <summary>{t('errorDetails')}</summary>
                            <code>{this.state.loadError}</code>
                        </details>
                        {(this.props.onCopyDiagnosticReport || this.props.onDownloadDiagnosticReport) && (
                            <div style={{display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.35rem'}}>
                                <span>{t('diagnosticReportIncludesCode')}</span>
                                {this.props.onCopyDiagnosticReport && (
                                    <button
                                        type="button"
                                        onClick={this.props.onCopyDiagnosticReport}
                                    >
                                        {t('copyDiagnosticReport')}
                                    </button>
                                )}
                                {this.props.onDownloadDiagnosticReport && (
                                    <button
                                        type="button"
                                        onClick={this.props.onDownloadDiagnosticReport}
                                    >
                                        {t('downloadDiagnosticReport')}
                                    </button>
                                )}
                            </div>
                        )}
                        {this.props.diagnostics.length > 0 && (
                            <div role="status">
                                <strong>{t('problems')}{`: ${this.props.diagnostics.length}`}</strong>
                                <ul>
                                    {this.props.diagnostics.slice(0, 10).map((item, index) => (
                                        <li key={`${item.code || 'diagnostic'}:${item.line}:${item.column}:${index}`}>
                                            {`L${item.line}:${item.column} — ${item.message}`}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                    <textarea
                        aria-label={t('editor')}
                        spellCheck={false}
                        style={{
                            flex: 1,
                            resize: 'none',
                            fontFamily: 'monospace',
                            fontSize: this.props.fontSize,
                            padding: 14
                        }}
                        value={this.props.value}
                        onChange={this.handleFallbackChange}
                    />
                </div>
            );
        }
        return (
            <div
                className={styles.root}
                ref={this.setShell}
            >
                <div
                    aria-busy={!this.state.loaded}
                    className={styles.host}
                    ref={this.setContainer}
                />
                {!this.state.loaded && <div className={styles.loading}>{t('editorLoading')}</div>}
                {this.renderContextControl()}
            </div>
        );
    }
}

MonacoEditor.propTypes = {
    activeLines: PropTypes.arrayOf(PropTypes.number),
    breakpoints: PropTypes.arrayOf(PropTypes.number),
    dark: PropTypes.bool,
    diagnostics: PropTypes.arrayOf(PropTypes.shape({
        message: PropTypes.string.isRequired,
        line: PropTypes.number.isRequired,
        column: PropTypes.number.isRequired,
        endLine: PropTypes.number.isRequired,
        endColumn: PropTypes.number.isRequired,
        severity: PropTypes.string.isRequired
    })).isRequired,
    fontSize: PropTypes.number,
    instanceKey: PropTypes.string,
    languageContext: PropTypes.shape({
        documents: PropTypes.arrayOf(PropTypes.shape({
            fileName: PropTypes.string,
            modelKey: PropTypes.string,
            source: PropTypes.string
        })),
        isStage: PropTypes.bool,
        resources: PropTypes.arrayOf(PropTypes.shape({
            id: PropTypes.string,
            kind: PropTypes.string
        })),
        workspaceId: PropTypes.string
    }),
    locale: PropTypes.string,
    modelKey: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired,
    onBreakpointsChange: PropTypes.func,
    onCompile: PropTypes.func,
    onInvalidShortcut: PropTypes.func,
    onNavigateResource: PropTypes.func,
    onCopyDiagnosticReport: PropTypes.func,
    onCursorPositionChange: PropTypes.func,
    onDownloadDiagnosticReport: PropTypes.func,
    onFocus: PropTypes.func,
    onLoadError: PropTypes.func,
    onOpenModel: PropTypes.func,
    onReady: PropTypes.func,
    onRestart: PropTypes.func,
    onRun: PropTypes.func,
    onRunSelection: PropTypes.func,
    onStop: PropTypes.func,
    onToggleBreakpoint: PropTypes.func,
    onWorkspaceModelChange: PropTypes.func,
    shortcuts: PropTypes.shape({
        compile: PropTypes.string,
        format: PropTypes.string,
        restart: PropTypes.string,
        run: PropTypes.string,
        runSelection: PropTypes.string,
        stop: PropTypes.string
    }),
    value: PropTypes.string.isRequired,
    visible: PropTypes.bool,
    workspaceModels: PropTypes.bool
};

MonacoEditor.defaultProps = {
    activeLines: [],
    breakpoints: [],
    fontSize: 15,
    instanceKey: 'primary',
    languageContext: {},
    locale: 'en',
    shortcuts: {},
    workspaceModels: true
};

export default MonacoEditor;
