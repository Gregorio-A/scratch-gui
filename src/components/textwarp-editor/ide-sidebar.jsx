import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import {DEFAULT_LIST_LIMIT, getNextTabId, getVisibleItems} from '../../lib/textwarp/interface-state';
import {createTranslator} from '../../lib/textwarp/i18n';
import InterfaceIcon from './interface-icon.jsx';
import styles from './ide-sidebar.css';

const PANEL_IDS = ['explorer', 'search', 'symbols', 'history'];

const iconFor = kind => ({
    actor: 'A', stage: 'P', variable: 'V', list: 'L', broadcast: 'M', costume: 'F', sound: 'S'
}[kind] || '•');

const formatTime = (timestamp, locale) => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' :
        date.toLocaleTimeString(locale || [], {hour: '2-digit', minute: '2-digit'});
};

const PagedList = ({children, items, label, moreLabel}) => {
    const [limit, setLimit] = React.useState(DEFAULT_LIST_LIMIT);
    React.useEffect(() => setLimit(DEFAULT_LIST_LIMIT), [items.length]);
    const visible = getVisibleItems(items, limit);
    return (
        <React.Fragment>
            {visible.items.map(children)}
            {visible.hiddenCount > 0 && (
                <button
                    className={styles.showMore}
                    type="button"
                    onClick={() => setLimit(current => current + DEFAULT_LIST_LIMIT)}
                >
                    {moreLabel.replace('{count}', visible.hiddenCount)}
                </button>
            )}
            {visible.totalCount > DEFAULT_LIST_LIMIT && (
                <span className={styles.listCount}>{label
                    .replace('{visible}', visible.items.length)
                    .replace('{total}', visible.totalCount)}</span>
            )}
        </React.Fragment>
    );
};

PagedList.propTypes = {
    children: PropTypes.func.isRequired,
    items: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
    label: PropTypes.string.isRequired,
    moreLabel: PropTypes.string.isRequired
};

const IdeSidebar = props => {
    const t = createTranslator(props.locale);
    const handleTabKeyDown = (event, panelId) => {
        const nextPanel = getNextTabId(PANEL_IDS, panelId, event.key);
        if (nextPanel === panelId) return;
        event.preventDefault();
        props.onPanelChange(nextPanel);
        const nextTab = event.currentTarget.parentElement.querySelector(`[data-sidebar-tab="${nextPanel}"]`);
        if (nextTab) nextTab.focus();
    };
    const resources = props.workspace.resources.filter(resource => !['actor', 'stage'].includes(resource.kind));
    return (
    <aside
        className={classNames(styles.root, !props.visible && styles.hidden, props.overlay && styles.overlay)}
        aria-label={t('editorNavigation')}
        aria-hidden={!props.visible}
        aria-modal={props.overlay ? 'true' : null}
        id={props.id}
        role={props.overlay ? 'dialog' : 'complementary'}
    >
        <div className={styles.sidebarHeader}>
            <strong>{t('projects')}</strong>
            <span>{props.activeFileName}</span>
            <button aria-label={t('closeProjects')} type="button" onClick={props.onClose}>
                <InterfaceIcon name="close" />
            </button>
        </div>
        <div className={styles.tabs} role="tablist" aria-label={t('tools')}>
            {[
                ['explorer', t('explorer')],
                ['search', t('search')],
                ['symbols', t('symbols')],
                ['history', t('history')]
            ].map(([id, label]) => (
                <button
                    aria-controls={`${props.id}-panel-${id}`}
                    aria-selected={props.activePanel === id}
                    className={props.activePanel === id ? styles.activeTab : ''}
                    data-sidebar-tab={id}
                    id={`${props.id}-tab-${id}`}
                    key={id}
                    role="tab"
                    tabIndex={props.activePanel === id ? 0 : -1}
                    title={label}
                    type="button"
                    onClick={() => props.onPanelChange(id)}
                    onKeyDown={event => handleTabKeyDown(event, id)}
                >{label}</button>
            ))}
        </div>
        <div
            aria-labelledby={`${props.id}-tab-${props.activePanel}`}
            className={styles.content}
            id={`${props.id}-panel-${props.activePanel}`}
            role="tabpanel"
            tabIndex="0"
        >
            {props.activePanel === 'explorer' && (
                <React.Fragment>
                    <h2>{t('editableScripts')}</h2>
                    <div className={styles.tree}>
                        <PagedList
                            items={props.workspace.modules}
                            label={t('showingItems')}
                            moreLabel={t('showMoreItems')}
                        >
                            {module => (
                            <button
                                aria-current={module.id === props.activeTargetId ? 'page' : undefined}
                                className={module.id === props.activeTargetId ? styles.activeItem : ''}
                                key={module.id}
                                title={module.fileName}
                                type="button"
                                onClick={() => props.onOpenTarget(module.id)}
                            >
                                <span className={classNames(styles.icon, module.isStage && styles.stageIcon)}>{module.isStage ? 'P' : 'A'}</span>
                                <span>{module.fileName}</span>
                                {module.breakpoints.length > 0 && <small>{module.breakpoints.length}</small>}
                            </button>
                            )}
                        </PagedList>
                    </div>
                    <h2>{t('projectResources')}</h2>
                    <div className={styles.resources}>
                        <PagedList items={resources} label={t('showingItems')} moreLabel={t('showMoreItems')}>
                            {resource => (
                            <div key={`${resource.kind}:${resource.ownerId}:${resource.id}`}>
                                <button type="button" title={resource.detail} onClick={() => props.onOpenResource(resource)}>
                                    <span className={styles.icon}>{iconFor(resource.kind)}</span>
                                    <span>{resource.name}</span>
                                    <small>{resource.ownerName}</small>
                                </button>
                                <button
                                    aria-label={t('insertSafeReference', {name: resource.name})}
                                    className={styles.insertButton}
                                    title={t('insertSafeReference', {name: resource.name})}
                                    type="button"
                                    onClick={() => props.onInsertResource(resource)}
                                ><InterfaceIcon name="plus" /></button>
                            </div>
                            )}
                        </PagedList>
                    </div>
                    <h2>{t('generatedReadOnly')}</h2>
                    <div className={styles.generated}>
                        {props.workspace.generatedFiles.map(file => <span key={file}>◈ {file}</span>)}
                    </div>
                </React.Fragment>
            )}
            {props.activePanel === 'search' && (
                <React.Fragment>
                    <label className={styles.search}>
                        <span>{t('searchAllScripts')}</span>
                        <input
                            autoFocus
                            placeholder={t('searchProjectPlaceholder')}
                            type="search"
                            value={props.searchQuery}
                            onChange={event => props.onSearch(event.target.value)}
                        />
                    </label>
                    <label className={styles.search}>
                        <span>{t('replaceWith')}</span>
                        <input
                            placeholder={t('replacementPlaceholder')}
                            type="text"
                            value={props.replaceValue}
                            onChange={event => props.onReplaceValueChange(event.target.value)}
                        />
                    </label>
                    <button
                        className={styles.replaceButton}
                        disabled={!props.searchQuery || !props.searchResults.length}
                        type="button"
                        onClick={props.onReplaceAll}
                    >{t('replaceAllScripts')}</button>
                    <div className={styles.resultCount}>{t('resultCount', {count: props.searchResults.length})}</div>
                    <div className={styles.results}>
                        <PagedList items={props.searchResults} label={t('showingItems')} moreLabel={t('showMoreItems')}>
                            {(result, index) => (
                            <button
                                key={`${result.targetId}:${result.line}:${index}`}
                                type="button"
                                onClick={() => props.onOpenLocation(result)}
                            >
                                <strong>{result.fileName}</strong>
                                <small>L{result.line}:{result.column}</small>
                                <code>{result.text}</code>
                            </button>
                            )}
                        </PagedList>
                    </div>
                </React.Fragment>
            )}
            {props.activePanel === 'symbols' && (
                <React.Fragment>
                    <h2>{t('outlineOf', {name: props.activeFileName})}</h2>
                    <div className={styles.symbols}>
                        <PagedList items={props.outline} label={t('showingItems')} moreLabel={t('showMoreItems')}>
                            {(symbol, index) => (
                            <button key={`${symbol.kind}:${symbol.name}:${index}`} type="button" onClick={() => props.onOpenLocation({
                                targetId: props.activeTargetId,
                                line: symbol.range.startLineNumber,
                                column: symbol.range.startColumn
                            })}>
                                <span className={styles.icon}>{iconFor(symbol.kind)}</span>
                                <span>{symbol.name}</span>
                                <small>{symbol.detail}</small>
                            </button>
                            )}
                        </PagedList>
                        {!props.outline.length && <p>{t('noSymbols')}</p>}
                    </div>
                </React.Fragment>
            )}
            {props.activePanel === 'history' && (
                <React.Fragment>
                    <h2>{t('localHistory')}</h2>
                    <p className={styles.help}>{t('localHistoryHelp')}</p>
                    <div className={styles.history}>
                        <PagedList items={props.history} label={t('showingItems')} moreLabel={t('showMoreItems')}>
                            {(entry, index) => (
                            <button key={`${entry.timestamp}:${index}`} type="button" onClick={() => props.onRestoreHistory(entry)}>
                                <strong>{formatTime(entry.timestamp, props.locale)}</strong>
                                <span>{entry.reason}</span>
                                <small>{t('lineCount', {count: entry.source.split(/\r?\n/).length})}</small>
                            </button>
                            )}
                        </PagedList>
                        {!props.history.length && <p>{t('historyEmpty')}</p>}
                    </div>
                </React.Fragment>
            )}
        </div>
    </aside>
    );
};

IdeSidebar.propTypes = {
    activeFileName: PropTypes.string,
    activePanel: PropTypes.string.isRequired,
    activeTargetId: PropTypes.string,
    history: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
    id: PropTypes.string,
    locale: PropTypes.string,
    onClose: PropTypes.func.isRequired,
    onInsertResource: PropTypes.func.isRequired,
    onOpenLocation: PropTypes.func.isRequired,
    onOpenResource: PropTypes.func.isRequired,
    onOpenTarget: PropTypes.func.isRequired,
    onPanelChange: PropTypes.func.isRequired,
    onReplaceAll: PropTypes.func.isRequired,
    onReplaceValueChange: PropTypes.func.isRequired,
    onRestoreHistory: PropTypes.func.isRequired,
    onSearch: PropTypes.func.isRequired,
    outline: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
    overlay: PropTypes.bool,
    replaceValue: PropTypes.string.isRequired,
    searchQuery: PropTypes.string.isRequired,
    searchResults: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
    visible: PropTypes.bool.isRequired,
    workspace: PropTypes.shape({
        generatedFiles: PropTypes.arrayOf(PropTypes.string).isRequired,
        modules: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
        resources: PropTypes.arrayOf(PropTypes.shape({})).isRequired
    }).isRequired
};

IdeSidebar.defaultProps = {
    id: 'textwarp-projects-sidebar',
    locale: 'en',
    overlay: false
};

export default IdeSidebar;
