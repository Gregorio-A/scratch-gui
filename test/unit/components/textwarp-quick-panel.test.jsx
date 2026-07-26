import React from 'react';
import {shallow} from 'enzyme';

import QuickPanel from '../../../src/components/textwarp-editor/quick-panel';

describe('TextWarp quick panel', () => {
    let previousDocument;

    beforeEach(() => {
        previousDocument = global.document;
    });

    afterEach(() => {
        global.document = previousDocument;
    });

    test('focuses its first action, closes with Escape and restores focus', () => {
        const listeners = {};
        const trigger = {
            contains: jest.fn(() => false),
            focus: jest.fn()
        };
        const firstAction = {focus: jest.fn()};
        global.document = {
            activeElement: trigger,
            addEventListener: jest.fn((type, listener) => {
                listeners[type] = listener;
            }),
            contains: jest.fn(() => true),
            removeEventListener: jest.fn()
        };
        const onClose = jest.fn();
        const wrapper = shallow(
            <QuickPanel
                closeLabel="Close"
                id="test-panel"
                label="Test panel"
                onClose={onClose}
            >
                <button type="button">First action</button>
            </QuickPanel>,
            {disableLifecycleMethods: true}
        );
        const instance = wrapper.instance();
        instance.panel = {
            contains: jest.fn(() => false),
            querySelector: jest.fn(() => firstAction)
        };

        instance.componentDidMount();
        expect(firstAction.focus).toHaveBeenCalledTimes(1);

        const escapeEvent = {
            key: 'Escape',
            preventDefault: jest.fn(),
            stopPropagation: jest.fn()
        };
        listeners.keydown(escapeEvent);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(escapeEvent.preventDefault).toHaveBeenCalledTimes(1);

        instance.componentWillUnmount();
        expect(trigger.focus).toHaveBeenCalledTimes(1);
    });
});
