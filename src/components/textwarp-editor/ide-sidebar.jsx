import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import {DEFAULT_LIST_LIMIT, getVisibleItems} from '../../lib/textwarp/interface-state';
import {createTranslator} from '../../lib/textwarp/i18n';
import InterfaceIcon from './interface-icon.jsx';
import styles from './ide-sidebar.css';

/* eslint-disable react/jsx-no-bind */
const iconFor = kind => ({
    actor: 'A',
    broadcast: 'M',
    costume: 'F',
    event: 'E',
    list: 'L',
    procedure: 'P',
    sound: 'S',
    stage: 'P',
    variable: 'V'
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
    const panelLabels = {
        actors: t('actors'),
        explorer: t('files'),
        extensions: t('extensions'),
        history: t('history'),
        search: t('search'),
        symbols: t('outline')
    };
    const resources = props.workspace.resources.filter(resource => !['actor', 'stage'].includes(resource.kind));
    const actors = props.workspace.modules.filter(module => !module.isStage);
    const stages = props.workspace.modules.filter(module => module.isStage);
    const outlineGroups = [
        {
            id: 'variables',
            label: t('outlineVariables'),
            items: props.outline.filter(symbol => ['variable', 'list'].includes(symbol.kind))
        },
        {
            id: 'procedures',
            label: t('outlineProcedures'),
            items: props.outline.filter(symbol => symbol.kind === 'procedure')
        },
        {
            id: 'events',
            label: t('outlineEvents'),
            items: props.outline.filter(symbol => symbol.kind === 'event')
        }
    ];
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
                <strong>{panelLabels[props.activePanel] || t('files')}</strong>
                <span>{props.activeFileName}</span>
                <button
                    aria-label={t('outline')}
                    className={props.activePanel === 'symbols' ? styles.activeHeaderButton : ''}
                    title={t('outline')}
                    type="button"
                    onClick={() => props.onPanelChange('symbols')}
                >
                    <InterfaceIcon name="files" />
                </button>
                <button
                    aria-label={t('history')}
                    className={props.activePanel === 'history' ? styles.activeHeaderButton : ''}
                    title={t('history')}
                    type="button"
                    onClick={() => props.onPanelChange('history')}
                >
                    <InterfaceIcon name="reset" />
                </button>
                <button
                    aria-label={t('closeSidebar')}
                    type="button"
                    onClick={props.onClose}
                >
                    <InterfaceIcon name="close" />
                </button>
            </div>
            <div
                aria-label={panelLabels[props.activePanel]}
                className={styles.content}
                id={`${props.id}-panel-${props.activePanel}`}
                role="region"
                tabIndex="0"
            >
                {props.activePanel === 'explorer' && (
                    <React.Fragment>
                        <h2>{t('editableScripts')}</h2>
                        <div className={styles.tree}>
                            <strong className={styles.projectRoot}>{t('project')}</strong>
                            {[
                                ['actors', t('actors'), actors],
                                ['stages', t('stage'), stages]
                            ].map(([id, label, modules]) => (
                                <section
                                    className={styles.treeGroup}
                                    key={id}
                                >
                                    <h3>{label}</h3>
                                    {modules.map(module => (
                                        <button
                                            aria-current={module.id === props.activeTargetId ? 'page' : null}
                                            className={module.id === props.activeTargetId ? styles.activeItem : ''}
                                            key={module.id}
                                            title={module.fileName}
                                            type="button"
                                            onClick={() => props.onOpenTarget(module.id)}
                                        >
                                            <span
                                                className={classNames(styles.icon, module.isStage && styles.stageIcon)}
                                            >{module.isStage ? 'P' : 'A'}</span>
                                            <span>{module.fileName}</span>
                                            {module.breakpoints.length > 0 && (
                                                <small>{module.breakpoints.length}</small>
                                            )}
                                        </button>
                                    ))}
                                </section>
                            ))}
                        </div>
                        <h2>{t('projectResources')}</h2>
                        <div className={styles.resources}>
                            <PagedList
                                items={resources}
                                label={t('showingItems')}
                                moreLabel={t('showMoreItems')}
                            >
                                {resource => (
                                    <div key={`${resource.kind}:${resource.ownerId}:${resource.id}`}>
                                        <button
                                            type="button"
                                            title={resource.detail}
                                            onClick={() => props.onOpenResource(resource)}
                                        >
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
                            {props.workspace.generatedFiles.map(file => (
                                <span key={file}>{'◈ '}{file}</span>
                            ))}
                        </div>
                    </React.Fragment>
                )}
                {props.activePanel === 'actors' && (
                    <React.Fragment>
                        <h2>{t('actors')}</h2>
                        <div className={styles.targetCards}>
                            <PagedList
                                items={actors}
                                label={t('showingItems')}
                                moreLabel={t('showMoreItems')}
                            >
                                {module => (
                                    <button
                                        aria-current={module.id === props.activeTargetId ? 'page' : null}
                                        className={module.id === props.activeTargetId ? styles.activeItem : ''}
                                        key={module.id}
                                        type="button"
                                        onClick={() => props.onOpenTarget(module.id)}
                                    >
                                        <span className={styles.targetAvatar}>{'A'}</span>
                                        <span>
                                            <strong>{module.name || module.fileName.replace(/\.tw$/i, '')}</strong>
                                            <small>{t('actor')}</small>
                                        </span>
                                        <InterfaceIcon name="arrow-right" />
                                    </button>
                                )}
                            </PagedList>
                        </div>
                        <h2>{t('stages')}</h2>
                        <div className={styles.targetCards}>
                            {stages.map(module => (
                                <button
                                    aria-current={module.id === props.activeTargetId ? 'page' : null}
                                    className={module.id === props.activeTargetId ? styles.activeItem : ''}
                                    key={module.id}
                                    type="button"
                                    onClick={() => props.onOpenTarget(module.id)}
                                >
                                    <span
                                        className={classNames(styles.targetAvatar, styles.stageAvatar)}
                                    >{'P'}</span>
                                    <span>
                                        <strong>{module.name || module.fileName.replace(/\.tw$/i, '')}</strong>
                                        <small>{t('stage')}</small>
                                    </span>
                                    <InterfaceIcon name="arrow-right" />
                                </button>
                            ))}
                        </div>
                    </React.Fragment>
                )}
                {props.activePanel === 'extensions' && (
                    <React.Fragment>
                        <div className={styles.extensionHeading}>
                            <div>
                                <h2>{t('extensions')}</h2>
                                <p>{t('extensionSidebarSummary', {
                                    blocks: props.extensionSummary.blockCount,
                                    count: props.extensionSummary.extensionCount
                                })}</p>
                            </div>
                            {props.onOpenExtensionLibrary && (
                                <button
                                    className={styles.addExtension}
                                    title={t('addExtension')}
                                    type="button"
                                    onClick={props.onOpenExtensionLibrary}
                                >
                                    <InterfaceIcon name="plus" />
                                    <span>{t('add')}</span>
                                </button>
                            )}
                        </div>
                        <div className={styles.extensionList}>
                            {props.extensionSummary.extensions.map(extension => (
                                <div key={extension}>
                                    <span className={styles.extensionIcon}>
                                        <InterfaceIcon name="extensions" />
                                    </span>
                                    <span>
                                        <strong>{extension}</strong>
                                        <small>{t('extensionLoaded')}</small>
                                    </span>
                                </div>
                            ))}
                            {!props.extensionSummary.extensions.length && <p>{t('noExtensions')}</p>}
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
                        <div className={styles.resultCount}>
                            {t('resultCount', {count: props.searchResults.length})}
                        </div>
                        <div className={styles.results}>
                            <PagedList
                                items={props.searchResults}
                                label={t('showingItems')}
                                moreLabel={t('showMoreItems')}
                            >
                                {(result, index) => (
                                    <button
                                        key={`${result.targetId}:${result.line}:${index}`}
                                        type="button"
                                        onClick={() => props.onOpenLocation(result)}
                                    >
                                        <strong>{result.fileName}</strong>
                                        <small>{`L${result.line}:${result.column}`}</small>
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
                            <strong className={styles.outlineRoot}>
                                {props.activeFileName.replace(/\.tw$/i, '')}
                            </strong>
                            {outlineGroups.map(group => (
                                <section
                                    className={styles.symbolGroup}
                                    key={group.id}
                                >
                                    <h3>
                                        <span>{group.label}</span>
                                        <small>{group.items.length}</small>
                                    </h3>
                                    <PagedList
                                        items={group.items}
                                        label={t('showingItems')}
                                        moreLabel={t('showMoreItems')}
                                    >
                                        {(symbol, index) => (
                                            <button
                                                key={`${symbol.kind}:${symbol.name}:${index}`}
                                                type="button"
                                                onClick={() => props.onOpenLocation({
                                                    targetId: props.activeTargetId,
                                                    line: symbol.range.startLineNumber,
                                                    column: symbol.range.startColumn
                                                })}
                                            >
                                                <span className={styles.icon}>{iconFor(symbol.kind)}</span>
                                                <span>{symbol.name}</span>
                                                <small>{symbol.detail}</small>
                                            </button>
                                        )}
                                    </PagedList>
                                </section>
                            ))}
                            {!props.outline.length && <p>{t('noSymbols')}</p>}
                        </div>
                    </React.Fragment>
                )}
                {props.activePanel === 'history' && (
                    <React.Fragment>
                        <h2>{t('localHistory')}</h2>
                        <p className={styles.help}>{t('localHistoryHelp')}</p>
                        <div className={styles.history}>
                            <PagedList
                                items={props.history}
                                label={t('showingItems')}
                                moreLabel={t('showMoreItems')}
                            >
                                {(entry, index) => (
                                    <button
                                        key={`${entry.timestamp}:${index}`}
                                        type="button"
                                        onClick={() => props.onRestoreHistory(entry)}
                                    >
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
    extensionSummary: PropTypes.shape({
        blockCount: PropTypes.number.isRequired,
        extensionCount: PropTypes.number.isRequired,
        extensions: PropTypes.arrayOf(PropTypes.string).isRequired
    }).isRequired,
    history: PropTypes.arrayOf(PropTypes.shape({})).isRequired,
    id: PropTypes.string,
    locale: PropTypes.string,
    onClose: PropTypes.func.isRequired,
    onInsertResource: PropTypes.func.isRequired,
    onOpenLocation: PropTypes.func.isRequired,
    onOpenExtensionLibrary: PropTypes.func,
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
    extensionSummary: {
        blockCount: 0,
        extensionCount: 0,
        extensions: []
    },
    id: 'textwarp-ide-sidebar',
    locale: 'en',
    overlay: false
};

export default IdeSidebar;
