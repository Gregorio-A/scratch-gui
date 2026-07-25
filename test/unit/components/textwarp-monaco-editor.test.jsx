import React from 'react';
import {shallow} from 'enzyme';

import MonacoEditor from '../../../src/components/textwarp-editor/monaco-editor';

const makeProps = overrides => Object.assign({
    diagnostics: [],
    instanceKey: 'primary',
    languageContext: {workspaceId: 'project-a'},
    locale: 'en',
    modelKey: 'cat',
    onChange: jest.fn(),
    value: 'actor Cat\n'
}, overrides);

describe('TextWarp Monaco editor lifecycle and fallback', () => {
    test('namespaces models by project and editor instance', () => {
        const wrapper = shallow(
            <MonacoEditor {...makeProps({instanceKey: 'secondary'})} />,
            {disableLifecycleMethods: true}
        );
        expect(wrapper.instance().getModelNamespace()).toBe('secondary:project-a');
    });

    test('fallback keeps diagnostics and primary actions available', () => {
        const onCompile = jest.fn();
        const onRun = jest.fn();
        const wrapper = shallow(
            <MonacoEditor
                {...makeProps({
                    diagnostics: [{
                        code: 'invalid-indent',
                        message: 'Use four spaces.',
                        line: 3,
                        column: 2,
                        endLine: 3,
                        endColumn: 3,
                        severity: 'error'
                    }],
                    onCompile,
                    onRun
                })}
            />,
            {disableLifecycleMethods: true}
        );
        wrapper.setState({loadError: 'network unavailable'});
        expect(wrapper.find('[role="status"]').text()).toContain('Problems: 1');
        expect(wrapper.text()).toContain('L3:2');
        wrapper.find('button').filterWhere(button => button.text() === 'Compile')
            .simulate('click');
        wrapper.find('button').filterWhere(button => button.text() === 'Run')
            .simulate('click');
        expect(onCompile).toHaveBeenCalledTimes(1);
        expect(onRun).toHaveBeenCalledTimes(1);
        expect(wrapper.find('details code').text()).toBe('network unavailable');
    });

    test('adaptive options disable dense UI for narrow editors and large files', () => {
        const wrapper = shallow(
            <MonacoEditor {...makeProps()} />,
            {disableLifecycleMethods: true}
        );
        const instance = wrapper.instance();
        const updateOptions = jest.fn();
        instance.container = {clientWidth: 500};
        instance.editor = {
            getModel: () => ({getLineCount: () => 1200}),
            updateOptions
        };
        instance.updateAdaptiveOptions();
        expect(updateOptions).toHaveBeenCalledWith({
            minimap: {enabled: false},
            stickyScroll: {enabled: false},
            wordWrap: 'on',
            wordWrapColumn: 80
        });
    });

    test('duplicate shortcuts fall back to distinct defaults and secondary breakpoints toggle', () => {
        const onInvalidShortcut = jest.fn();
        const onBreakpointsChange = jest.fn();
        const wrapper = shallow(
            <MonacoEditor
                {...makeProps({
                    breakpoints: [3],
                    onBreakpointsChange,
                    onCompile: jest.fn(),
                    onInvalidShortcut,
                    onRun: jest.fn(),
                    onStop: jest.fn(),
                    shortcuts: {compile: 'Ctrl+Enter', run: 'Ctrl+Enter', stop: 'F7'}
                })}
            />,
            {disableLifecycleMethods: true}
        );
        const instance = wrapper.instance();
        const actions = [];
        instance.monaco = {
            KeyCode: {Enter: 3, F5: 63, F7: 65, KeyI: 39},
            KeyMod: {CtrlCmd: 1 << 11, Shift: 1 << 10}
        };
        instance.editor = {
            addAction: action => {
                actions.push(action);
                return {dispose: jest.fn()};
            },
            getAction: jest.fn()
        };
        instance.registerActions();
        expect(onInvalidShortcut).toHaveBeenCalledTimes(2);
        expect(actions.find(action => action.id === 'textwarp.compile').keybindings).toEqual([65]);
        expect(actions.find(action => action.id === 'textwarp.run').keybindings).toEqual([(1 << 11) | 3]);
        expect(actions.find(action => action.id === 'textwarp.stop').keybindings).toEqual([(1 << 10) | 63]);
        instance.toggleBreakpoint(5);
        expect(onBreakpointsChange).toHaveBeenCalledWith([3, 5]);
    });

    test('cross-file editor opener switches only models owned by the editor instance', async () => {
        const wrapper = shallow(
            <MonacoEditor {...makeProps()} />,
            {disableLifecycleMethods: true}
        );
        const instance = wrapper.instance();
        const resource = {toString: () => 'inmemory://textwarp/primary%3Aproject-a/stage.tw'};
        const model = {uri: resource};
        let opener;
        instance.editor = {
            focus: jest.fn(),
            revealPositionInCenter: jest.fn(),
            setModel: jest.fn(),
            setSelection: jest.fn()
        };
        instance.monaco = {editor: {
            getModel: candidate => (candidate === resource ? model : null),
            registerEditorOpener: registered => {
                opener = registered;
                return {dispose: jest.fn()};
            }
        }};
        instance.modelKeysByUri.set(resource.toString(), 'stage');
        instance.registerEditorOpener();
        expect(await opener.openCodeEditor(
            instance.editor,
            resource,
            {startLineNumber: 3, startColumn: 2, endLineNumber: 3, endColumn: 7}
        )).toBe(true);
        expect(instance.editor.setModel).toHaveBeenCalledWith(model);
        expect(instance.editor.setSelection).toHaveBeenCalled();
        expect(instance.editor.revealPositionInCenter).toHaveBeenCalledWith({lineNumber: 3, column: 2});
        expect(await opener.openCodeEditor({}, resource)).toBe(false);
    });
});
