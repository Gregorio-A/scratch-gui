import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import styles from './workspace-activity-bar.css';

import codeIcon from '!../../lib/tw-recolor/build!./icon--code.svg';
import costumesIcon from '!../../lib/tw-recolor/build!./icon--costumes.svg';
import soundsIcon from '!../../lib/tw-recolor/build!./icon--sounds.svg';
import InterfaceIcon from '../textwarp-editor/interface-icon.jsx';

const messages = defineMessages({
    programming: {id: 'tw.gui.programmingTab', defaultMessage: 'Programming', description: 'Open programming'},
    costumes: {id: 'gui.gui.costumesTab', defaultMessage: 'Costumes', description: 'Open costumes'},
    backdrops: {id: 'gui.gui.backdropsTab', defaultMessage: 'Backdrops', description: 'Open backdrops'},
    sounds: {id: 'gui.gui.soundsTab', defaultMessage: 'Sounds', description: 'Open sounds'},
    files: {id: 'tw.workspace.files', defaultMessage: 'Files', description: 'Open project files'},
    commands: {id: 'tw.workspace.commands', defaultMessage: 'Commands', description: 'Open commands'},
    actors: {id: 'tw.workspace.actors', defaultMessage: 'Actors', description: 'Open actors'},
    extensions: {id: 'tw.workspace.extensions', defaultMessage: 'Extensions', description: 'Open extensions'},
    outline: {id: 'tw.workspace.outline', defaultMessage: 'Outline', description: 'Open outline'},
    history: {id: 'tw.workspace.history', defaultMessage: 'History', description: 'Open history'},
    documentation: {
        id: 'tw.workspace.documentation',
        defaultMessage: 'Documentation',
        description: 'Open documentation'
    },
    debugger: {id: 'tw.workspace.debugger', defaultMessage: 'Debugger', description: 'Open debugger'},
    search: {id: 'tw.workspace.search', defaultMessage: 'Search', description: 'Open project search'},
    settings: {id: 'tw.workspace.settings', defaultMessage: 'Settings', description: 'Open editor settings'}
});

const dispatchTextwarpAction = (onSelect, name) => {
    onSelect(0);
    setTimeout(() => document.dispatchEvent(new CustomEvent(`textwarp-${name}`)), 0);
};

const dispatchTextwarpPanel = (onSelect, panel) => {
    onSelect(0);
    setTimeout(() => document.dispatchEvent(new CustomEvent('textwarp-open-panel', {
        detail: {panel}
    })), 0);
};

/* eslint-disable react/jsx-no-bind */
const WorkspaceActivityBar = ({activeTabIndex, intl, onSelect, targetIsStage}) => {
    const activities = [
        [0, intl.formatMessage(messages.programming), codeIcon()],
        [1, intl.formatMessage(targetIsStage ? messages.backdrops : messages.costumes), costumesIcon()],
        [2, intl.formatMessage(messages.sounds), soundsIcon()]
    ];
    const programmingActivities = [
        ['explorer', 'files', messages.files],
        ['commands', 'commands', messages.commands],
        ['actors', 'actor', messages.actors],
        ['extensions', 'extensions', messages.extensions],
        ['symbols', 'files', messages.outline],
        ['history', 'reset', messages.history]
    ];
    return (
        <nav
            aria-label={intl.formatMessage(messages.programming)}
            className={styles.root}
        >
            <div className={styles.primary}>
                {activities.map(([index, label, icon]) => (
                    <button
                        aria-current={activeTabIndex === index ? 'page' : null}
                        aria-label={label}
                        className={classNames(styles.button, activeTabIndex === index && styles.active)}
                        key={index}
                        title={label}
                        type="button"
                        onClick={() => {
                            if (index === 0) dispatchTextwarpPanel(onSelect, 'explorer');
                            else onSelect(index);
                        }}
                    >
                        <img
                            alt=""
                            draggable={false}
                            src={icon}
                        />
                        <span>{label}</span>
                    </button>
                ))}
                {activeTabIndex === 0 && (
                    <div className={styles.contextual}>
                        {programmingActivities.map(([panel, icon, message]) => {
                            const label = intl.formatMessage(message);
                            return (
                                <button
                                    aria-label={label}
                                    className={styles.button}
                                    key={panel}
                                    title={label}
                                    type="button"
                                    onClick={() => dispatchTextwarpPanel(onSelect, panel)}
                                >
                                    <InterfaceIcon name={icon} />
                                    <span>{label}</span>
                                </button>
                            );
                        })}
                        <button
                            aria-label={intl.formatMessage(messages.documentation)}
                            className={styles.button}
                            title={intl.formatMessage(messages.documentation)}
                            type="button"
                            onClick={() => dispatchTextwarpAction(onSelect, 'open-documentation')}
                        >
                            <InterfaceIcon name="book" />
                            <span>{intl.formatMessage(messages.documentation)}</span>
                        </button>
                        <button
                            aria-label={intl.formatMessage(messages.debugger)}
                            className={styles.button}
                            title={intl.formatMessage(messages.debugger)}
                            type="button"
                            onClick={() => dispatchTextwarpAction(onSelect, 'open-debugger')}
                        >
                            <InterfaceIcon name="debug" />
                            <span>{intl.formatMessage(messages.debugger)}</span>
                        </button>
                    </div>
                )}
                <button
                    aria-label={intl.formatMessage(messages.search)}
                    className={styles.button}
                    title={intl.formatMessage(messages.search)}
                    type="button"
                    onClick={() => dispatchTextwarpAction(onSelect, 'open-search')}
                >
                    <span
                        aria-hidden="true"
                        className={styles.glyph}
                    >{'⌕'}</span>
                    <span>{intl.formatMessage(messages.search)}</span>
                </button>
            </div>
            <button
                aria-label={intl.formatMessage(messages.settings)}
                className={styles.button}
                title={intl.formatMessage(messages.settings)}
                type="button"
                onClick={() => dispatchTextwarpAction(onSelect, 'open-settings')}
            >
                <span
                    aria-hidden="true"
                    className={styles.glyph}
                >{'⚙'}</span>
                <span>{intl.formatMessage(messages.settings)}</span>
            </button>
        </nav>
    );
};
/* eslint-enable react/jsx-no-bind */

WorkspaceActivityBar.propTypes = {
    activeTabIndex: PropTypes.number.isRequired,
    intl: intlShape.isRequired,
    onSelect: PropTypes.func.isRequired,
    targetIsStage: PropTypes.bool
};

export default injectIntl(WorkspaceActivityBar);
