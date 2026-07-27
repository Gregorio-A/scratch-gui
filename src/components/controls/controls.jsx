import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import GreenFlag from '../green-flag/green-flag.jsx';
import StopAll from '../stop-all/stop-all.jsx';
import TurboMode from '../turbo-mode/turbo-mode.jsx';
import FramerateIndicator from '../tw-framerate-indicator/framerate-indicator.jsx';

import styles from './controls.css';

const messages = defineMessages({
    goTitle: {
        id: 'tw.controls.run',
        defaultMessage: 'Run',
        description: 'Run project button title'
    },
    pauseTitle: {
        id: 'tw.controls.pause',
        defaultMessage: 'Pause',
        description: 'Pause project button title'
    },
    resumeTitle: {
        id: 'tw.controls.resume',
        defaultMessage: 'Resume',
        description: 'Resume paused project button title'
    },
    stopTitle: {
        id: 'gui.controls.stop',
        defaultMessage: 'Stop',
        description: 'Stop button title'
    },
    restartTitle: {
        id: 'tw.controls.restart',
        defaultMessage: 'Restart',
        description: 'Restart the current project'
    }
});

const Controls = function (props) {
    const {
        active,
        className,
        intl,
        onGreenFlagClick,
        onPauseClick,
        onRestartClick,
        onStopAllClick,
        paused,
        turbo,
        framerate,
        interpolation,
        isSmall,
        showFramerate,
        ...componentProps
    } = props;
    const pauseMessage = paused ? messages.resumeTitle : messages.pauseTitle;
    return (
        <div
            className={classNames(styles.controlsContainer, className)}
            {...componentProps}
        >
            {active ? (
                <button
                    className={styles.executionButton}
                    title={intl.formatMessage(pauseMessage)}
                    type="button"
                    onClick={onPauseClick}
                >
                    <span
                        aria-hidden="true"
                        className={styles.pauseIcon}
                    >{paused ? '▶' : 'Ⅱ'}</span>
                    {!isSmall && <span>{intl.formatMessage(pauseMessage)}</span>}
                </button>
            ) : (
                <button
                    className={classNames(styles.executionButton, styles.runButton)}
                    title={intl.formatMessage(messages.goTitle)}
                    type="button"
                    onClick={onGreenFlagClick}
                    onContextMenu={onGreenFlagClick}
                >
                    <GreenFlag
                        active={active}
                        title=""
                    />
                    {!isSmall && <span>{intl.formatMessage(messages.goTitle)}</span>}
                </button>
            )}
            {active && <button
                className={classNames(styles.executionButton, styles.stopButton)}
                title={intl.formatMessage(messages.stopTitle)}
                type="button"
                onClick={onStopAllClick}
            >
                <StopAll
                    active
                    title=""
                />
                {!isSmall && <span>{intl.formatMessage(messages.stopTitle)}</span>}
            </button>}
            {active && !isSmall && <button
                className={styles.restartButton}
                title={intl.formatMessage(messages.restartTitle)}
                type="button"
                onClick={onRestartClick}
            >
                <span aria-hidden="true">{'⟳'}</span>
                <span>{intl.formatMessage(messages.restartTitle)}</span>
            </button>}
            {turbo ? (
                <TurboMode isSmall={isSmall} />
            ) : null}
            {!isSmall && showFramerate && (
                <FramerateIndicator
                    framerate={framerate}
                    interpolation={interpolation}
                />
            )}
        </div>
    );
};

Controls.propTypes = {
    active: PropTypes.bool,
    className: PropTypes.string,
    intl: intlShape.isRequired,
    onGreenFlagClick: PropTypes.func.isRequired,
    onPauseClick: PropTypes.func.isRequired,
    onRestartClick: PropTypes.func.isRequired,
    onStopAllClick: PropTypes.func.isRequired,
    paused: PropTypes.bool,
    framerate: PropTypes.number,
    interpolation: PropTypes.bool,
    isSmall: PropTypes.bool,
    showFramerate: PropTypes.bool,
    turbo: PropTypes.bool
};

Controls.defaultProps = {
    active: false,
    paused: false,
    showFramerate: true,
    turbo: false,
    isSmall: false
};

export default injectIntl(Controls);
