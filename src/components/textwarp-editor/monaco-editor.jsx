import PropTypes from 'prop-types';
import React from 'react';

import {createTranslator} from '../../lib/textwarp/i18n';
import {getDiagnosticSuggestion} from '../../lib/textwarp/language-service';
import {clearModelContext, loadMonaco, setModelContext} from '../../lib/textwarp/monaco-loader';

const parseKeybinding = (monaco, value, fallback) => {
    const parts = String(value || '').split('+').map(part => part.trim().toLowerCase()).filter(Boolean);
    let binding = 0;
    const keys = {
        enter: monaco.KeyCode.Enter,
        f5: monaco.KeyCode.F5,
        f6: monaco.KeyCode.F6,
        f7: monaco.KeyCode.F7,
        f8: monaco.KeyCode.F8,
        f9: monaco.KeyCode.F9,
        f10: monaco.KeyCode.F10,
        f11: monaco.KeyCode.F11,
        f12: monaco.KeyCode.F12
    };
    parts.forEach(part => {
        if (part === 'ctrl' || part === 'cmd' || part === 'meta') binding |= monaco.KeyMod.CtrlCmd;
        else if (part === 'shift') binding |= monaco.KeyMod.Shift;
        else if (part === 'alt') binding |= monaco.KeyMod.Alt;
        else if (/^[a-z]$/.test(part)) binding |= monaco.KeyCode[`Key${part.toUpperCase()}`];
        else if (keys[part]) binding |= keys[part];
    });
    return binding || fallback;
};

class MonacoEditor extends React.Component {
    constructor (props) {
        super(props);
        this.state = {loadError: null};
        this.container = null;
        this.editor = null;
        this.monaco = null;
        this.models = new Map();
        this.modelSubscriptions = new Map();
        this.modelKeysByUri = new Map();
        this.changeSubscription = null;
        this.mouseSubscription = null;
        this.modelChangeSubscription = null;
        this.actionDisposables = [];
        this.decorationIds = [];
        this.ignoreChanges = false;
        this.setContainer = element => {
            this.container = element;
        };
    }
    componentDidMount () {
        loadMonaco().then(monaco => {
            if (!this.container) return;
            this.monaco = monaco;
            this.container.textContent = '';
            const model = this.getModel(this.props.modelKey, this.props.value);
            const t = createTranslator(this.props.locale);
            this.editor = monaco.editor.create(this.container, {
                model,
                theme: this.props.dark ? 'vs-dark' : 'vs',
                automaticLayout: true,
                fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                fontSize: this.props.fontSize,
                lineHeight: Math.round(this.props.fontSize * 1.53),
                minimap: {enabled: true},
                glyphMargin: true,
                padding: {top: 14, bottom: 14},
                renderWhitespace: 'selection',
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                tabSize: 4,
                insertSpaces: true,
                wordWrap: 'on',
                ariaLabel: t('editor')
            });
            setModelContext(model, this.props.languageContext);
            this.syncDocumentModels();
            this.changeSubscription = this.editor.onDidChangeModelContent(() => {
                if (!this.ignoreChanges) this.props.onChange(this.editor.getValue());
            });
            this.modelChangeSubscription = this.editor.onDidChangeModel(() => {
                const activeModel = this.editor.getModel();
                const key = activeModel && this.modelKeysByUri.get(String(activeModel.uri));
                if (key && key !== this.props.modelKey && this.props.onOpenModel) this.props.onOpenModel(key);
            });
            this.mouseSubscription = this.editor.onMouseDown(event => {
                const gutter = event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
                    event.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS;
                if (gutter && event.target.position && this.props.onToggleBreakpoint) {
                    this.props.onToggleBreakpoint(event.target.position.lineNumber);
                    return;
                }
                const browserEvent = event.event && event.event.browserEvent;
                if (
                    event.target.position && browserEvent && (browserEvent.ctrlKey || browserEvent.metaKey) &&
                    this.props.onNavigateResource
                ) {
                    const editorModel = this.editor.getModel();
                    const position = event.target.position;
                    const line = editorModel.getLineContent(position.lineNumber);
                    const index = Math.max(0, position.column - 1);
                    const before = line.slice(0, index);
                    const quoteStart = Math.max(before.lastIndexOf('"'), before.lastIndexOf("'"));
                    const quote = quoteStart >= 0 ? line[quoteStart] : null;
                    const quoteEnd = quote ? line.indexOf(quote, quoteStart + 1) : -1;
                    const word = editorModel.getWordAtPosition(position);
                    const resourceName = quoteStart >= 0 && quoteEnd >= index ? line.slice(quoteStart + 1, quoteEnd) :
                        word && word.word;
                    if (resourceName) this.props.onNavigateResource(resourceName);
                }
            });
            this.registerActions();
            this.updateMarkers();
            this.updateDecorations();
            if (this.props.onReady) this.props.onReady(this);
        }).catch(error => {
            console.error(error);
            this.setState({loadError: error.message});
        });
    }
    componentDidUpdate (previousProps) {
        if (!this.editor || !this.monaco) return;
        if (previousProps.modelKey !== this.props.modelKey) {
            this.editor.setModel(this.getModel(this.props.modelKey, this.props.value));
        } else if (previousProps.value !== this.props.value && this.editor.getValue() !== this.props.value) {
            this.ignoreChanges = true;
            const model = this.editor.getModel();
            model.pushStackElement();
            model.pushEditOperations([], [{range: model.getFullModelRange(), text: this.props.value}], () => null);
            model.pushStackElement();
            this.ignoreChanges = false;
        }
        if (previousProps.languageContext !== this.props.languageContext || previousProps.modelKey !== this.props.modelKey) {
            setModelContext(this.editor.getModel(), this.props.languageContext);
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
        if (previousProps.diagnostics !== this.props.diagnostics || previousProps.modelKey !== this.props.modelKey) {
            this.updateMarkers();
        }
        if (
            previousProps.activeLines !== this.props.activeLines ||
            previousProps.breakpoints !== this.props.breakpoints ||
            previousProps.modelKey !== this.props.modelKey
        ) this.updateDecorations();
        if (this.props.visible && !previousProps.visible) this.editor.layout();
    }
    componentWillUnmount () {
        if (this.changeSubscription) this.changeSubscription.dispose();
        if (this.mouseSubscription) this.mouseSubscription.dispose();
        if (this.modelChangeSubscription) this.modelChangeSubscription.dispose();
        this.actionDisposables.forEach(disposable => disposable.dispose());
        this.modelSubscriptions.forEach(subscription => subscription.dispose());
        this.modelSubscriptions.clear();
        this.models.forEach(model => clearModelContext(model));
        if (this.editor) this.editor.dispose();
        this.models.forEach(model => model.dispose());
        this.models.clear();
    }
    getModel (key, value) {
        if (this.models.has(key)) {
            const existing = this.models.get(key);
            if (existing.getValue() !== value) existing.setValue(value);
            return existing;
        }
        const safeKey = encodeURIComponent(key || 'target');
        const uri = this.monaco.Uri.parse(
            `inmemory://textwarp/${encodeURIComponent(this.props.instanceKey)}/${safeKey}.tw`
        );
        const model = this.monaco.editor.createModel(value, 'textwarp', uri);
        this.modelKeysByUri.set(String(uri), key);
        setModelContext(model, this.props.languageContext);
        this.modelSubscriptions.set(key, model.onDidChangeContent(() => {
            if (
                !this.ignoreChanges && key !== this.props.modelKey && !String(key).endsWith(':secondary') &&
                this.props.onWorkspaceModelChange
            ) this.props.onWorkspaceModelChange(key, model.getValue());
        }));
        this.models.set(key, model);
        return model;
    }
    syncDocumentModels () {
        if (!this.monaco || !this.props.workspaceModels) return;
        (this.props.languageContext.documents || []).forEach(document => {
            if (!document.modelKey) return;
            const existing = this.models.get(document.modelKey);
            if (!existing) {
                this.getModel(document.modelKey, document.source || '');
                return;
            }
            setModelContext(existing, this.props.languageContext);
            if (document.modelKey !== this.props.modelKey && existing.getValue() !== document.source) {
                this.ignoreChanges = true;
                existing.setValue(document.source || '');
                this.ignoreChanges = false;
            }
        });
    }
    registerActions () {
        const shortcuts = this.props.shortcuts;
        const t = createTranslator(this.props.locale);
        const actions = [
            ['textwarp.compile', `TextWarp: ${t('compile')}`, parseKeybinding(this.monaco, shortcuts.compile, this.monaco.KeyCode.F7), this.props.onCompile],
            ['textwarp.run', `TextWarp: ${t('run')}`, parseKeybinding(this.monaco, shortcuts.run, this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.Enter), this.props.onRun],
            ['textwarp.runSelection', `TextWarp: ${t('run')} selection`, parseKeybinding(this.monaco, shortcuts.runSelection, this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Shift | this.monaco.KeyCode.Enter), () => {
                if (this.props.onRunSelection) this.props.onRunSelection(this.getSelection());
            }],
            ['textwarp.stop', `TextWarp: ${t('stop')}`, parseKeybinding(this.monaco, shortcuts.stop, this.monaco.KeyMod.Shift | this.monaco.KeyCode.F5), this.props.onStop],
            ['textwarp.restart', `TextWarp: ${t('redo')}`, parseKeybinding(this.monaco, shortcuts.restart, this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Shift | this.monaco.KeyCode.F5), this.props.onRestart],
            ['textwarp.format', 'TextWarp: Format document', parseKeybinding(this.monaco, shortcuts.format, this.monaco.KeyMod.CtrlCmd | this.monaco.KeyMod.Shift | this.monaco.KeyCode.KeyI), () => {
                this.editor.getAction('editor.action.formatDocument').run();
            }]
        ];
        actions.forEach(([id, label, keybinding, run]) => {
            if (!run) return;
            this.actionDisposables.push(this.editor.addAction({id, label, keybindings: [keybinding], run}));
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
    focus () {
        if (this.editor) this.editor.focus();
    }
    openCommandPalette () {
        if (!this.editor) return;
        this.editor.focus();
        const action = this.editor.getAction('editor.action.quickCommand');
        if (action) action.run();
    }
    updateMarkers () {
        if (!this.editor || !this.monaco) return;
        const model = this.editor.getModel();
        const t = createTranslator(this.props.locale);
        const markers = this.props.diagnostics.map(item => ({
            severity: item.severity === 'warning' ?
                this.monaco.MarkerSeverity.Warning :
                this.monaco.MarkerSeverity.Error,
            message: getDiagnosticSuggestion(item) ?
                `${item.message}\n${t('suggestion')}: ${getDiagnosticSuggestion(item)}` : item.message,
            startLineNumber: item.line,
            startColumn: item.column,
            endLineNumber: item.endLine,
            endColumn: item.endColumn,
            code: item.code
        }));
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
        this.props.activeLines.forEach(line => decorations.push({
            range: new this.monaco.Range(line, 1, line, 1),
            options: {
                isWholeLine: true,
                className: 'textwarp-active-line',
                glyphMarginClassName: 'textwarp-active-glyph'
            }
        }));
        this.decorationIds = this.editor.deltaDecorations(this.decorationIds, decorations);
    }
    render () {
        const t = createTranslator(this.props.locale);
        if (this.state.loadError) {
            return (
                <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
                    <div style={{padding: '0.5rem', color: '#c33'}}>
                        {t('editorBasic')} {this.state.loadError}
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
                        onChange={event => this.props.onChange(event.target.value)}
                    />
                </div>
            );
        }
        return (
            <div
                ref={this.setContainer}
                style={{width: '100%', height: '100%'}}
            >
                {t('editorLoading')}
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
    languageContext: PropTypes.shape({}),
    locale: PropTypes.string,
    modelKey: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired,
    onCompile: PropTypes.func,
    onNavigateResource: PropTypes.func,
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
