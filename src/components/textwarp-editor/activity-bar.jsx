import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import {createTranslator} from '../../lib/textwarp/i18n';
import InterfaceIcon from './interface-icon.jsx';
import styles from './activity-bar.css';

/* eslint-disable react/jsx-no-bind */
const ActivityButton = ({
    active,
    controls,
    expanded,
    icon,
    label,
    onClick
}) => (
    <button
        aria-controls={controls}
        aria-expanded={typeof expanded === 'boolean' ? expanded : null}
        aria-label={label}
        className={classNames(styles.button, active && styles.active)}
        title={label}
        type="button"
        onClick={onClick}
    >
        <InterfaceIcon name={icon} />
        <span>{label}</span>
    </button>
);

ActivityButton.propTypes = {
    active: PropTypes.bool,
    controls: PropTypes.string,
    expanded: PropTypes.bool,
    icon: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    onClick: PropTypes.func.isRequired
};

const ActivityBar = props => {
    const t = createTranslator(props.locale);
    const openSidebar = panel => {
        if (props.sidebarVisible && props.activeSidebarPanel === panel) {
            props.onCloseSidebar();
            return;
        }
        props.onOpenSidebar(panel);
    };
    return (
        <nav
            aria-label={t('activityBar')}
            className={styles.root}
        >
            <div className={styles.primary}>
                <ActivityButton
                    active={props.sidebarVisible && props.activeSidebarPanel === 'explorer'}
                    controls="textwarp-ide-sidebar"
                    expanded={props.sidebarVisible && props.activeSidebarPanel === 'explorer'}
                    icon="files"
                    label={t('files')}
                    onClick={() => openSidebar('explorer')}
                />
                <ActivityButton
                    active={props.sidebarVisible && props.activeSidebarPanel === 'search'}
                    controls="textwarp-ide-sidebar"
                    expanded={props.sidebarVisible && props.activeSidebarPanel === 'search'}
                    icon="search"
                    label={t('search')}
                    onClick={() => openSidebar('search')}
                />
                <ActivityButton
                    active={props.sidebarVisible && props.activeSidebarPanel === 'actors'}
                    controls="textwarp-ide-sidebar"
                    expanded={props.sidebarVisible && props.activeSidebarPanel === 'actors'}
                    icon="actor"
                    label={t('actors')}
                    onClick={() => openSidebar('actors')}
                />
                <ActivityButton
                    active={props.sidebarVisible && props.activeSidebarPanel === 'extensions'}
                    controls="textwarp-ide-sidebar"
                    expanded={props.sidebarVisible && props.activeSidebarPanel === 'extensions'}
                    icon="extensions"
                    label={t('extensions')}
                    onClick={() => openSidebar('extensions')}
                />
                <ActivityButton
                    active={!props.bottomPanelCollapsed && props.activeBottomPanel === 'debugger'}
                    controls="textwarp-bottom-panel-content"
                    expanded={!props.bottomPanelCollapsed && props.activeBottomPanel === 'debugger'}
                    icon="debug"
                    label={t('debugPanel')}
                    onClick={() => props.onOpenBottomPanel('debugger')}
                />
                <ActivityButton
                    active={props.viewMode === 'docs'}
                    controls="textwarp-editor-area"
                    expanded={props.viewMode === 'docs'}
                    icon="book"
                    label={t('documentation')}
                    onClick={props.onOpenDocumentation}
                />
            </div>
            <div className={styles.secondary}>
                <ActivityButton
                    active={props.settingsOpen}
                    controls="textwarp-settings-panel"
                    expanded={props.settingsOpen}
                    icon="settings"
                    label={t('preferences')}
                    onClick={props.onOpenSettings}
                />
            </div>
        </nav>
    );
};

ActivityBar.propTypes = {
    activeBottomPanel: PropTypes.string.isRequired,
    activeSidebarPanel: PropTypes.string.isRequired,
    bottomPanelCollapsed: PropTypes.bool.isRequired,
    locale: PropTypes.string,
    onCloseSidebar: PropTypes.func.isRequired,
    onOpenBottomPanel: PropTypes.func.isRequired,
    onOpenDocumentation: PropTypes.func.isRequired,
    onOpenSettings: PropTypes.func.isRequired,
    onOpenSidebar: PropTypes.func.isRequired,
    settingsOpen: PropTypes.bool.isRequired,
    sidebarVisible: PropTypes.bool.isRequired,
    viewMode: PropTypes.string.isRequired
};

ActivityBar.defaultProps = {
    locale: 'en'
};

export default React.memo(ActivityBar);
