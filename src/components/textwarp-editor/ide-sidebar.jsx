import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import {createTranslator, normalizeLocale} from '../../lib/textwarp/i18n';
import styles from './ide-sidebar.css';

const iconFor = kind => ({
    actor: 'A', stage: 'P', variable: 'V', list: 'L', broadcast: 'M', costume: 'F', sound: 'S'
}[kind] || '•');

const formatTime = (timestamp, locale) => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? '' :
        date.toLocaleTimeString(locale || [], {hour: '2-digit', minute: '2-digit'});
};

const IdeSidebar = props => {
    const t = createTranslator(props.locale);
    const portuguese = normalizeLocale(props.locale) === 'pt';
    return (
    <aside
        className={classNames(styles.root, !props.visible && styles.hidden, props.overlay && styles.overlay)}
        aria-label={t('editorNavigation')}
    >
        <div className={styles.tabs} role="tablist" aria-label={t('tools')}>
            {[
                ['explorer', t('explorer')],
                ['search', t('search')],
                ['symbols', portuguese ? 'Símbolos' : 'Symbols'],
                ['history', t('history')]
            ].map(([id, label]) => (
                <button
                    aria-selected={props.activePanel === id}
                    className={props.activePanel === id ? styles.activeTab : ''}
                    key={id}
                    role="tab"
                    title={label}
                    type="button"
                    onClick={() => props.onPanelChange(id)}
                >{label}</button>
            ))}
        </div>
        <div className={styles.content}>
            {props.activePanel === 'explorer' && (
                <React.Fragment>
                    <h2>{portuguese ? 'Scripts editáveis' : 'Editable scripts'}</h2>
                    <div className={styles.tree}>
                        {props.workspace.modules.map(module => (
                            <button
                                className={module.id === props.activeTargetId ? styles.activeItem : ''}
                                key={module.id}
                                type="button"
                                onClick={() => props.onOpenTarget(module.id)}
                            >
                                <span className={classNames(styles.icon, module.isStage && styles.stageIcon)}>{module.isStage ? 'P' : 'A'}</span>
                                <span>{module.fileName}</span>
                                {module.breakpoints.length > 0 && <small>{module.breakpoints.length}</small>}
                            </button>
                        ))}
                    </div>
                    <h2>{t('projectResources')}</h2>
                    <div className={styles.resources}>
                        {props.workspace.resources.filter(resource => !['actor', 'stage'].includes(resource.kind)).map(resource => (
                            <div key={`${resource.kind}:${resource.ownerId}:${resource.id}`}>
                                <button type="button" title={resource.detail} onClick={() => props.onOpenResource(resource)}>
                                    <span className={styles.icon}>{iconFor(resource.kind)}</span>
                                    <span>{resource.name}</span>
                                    <small>{resource.ownerName}</small>
                                </button>
                                <button
                                    className={styles.insertButton}
                                    title={portuguese ?
                                        `Inserir referência segura a ${resource.name}` :
                                        `Insert a safe reference to ${resource.name}`}
                                    type="button"
                                    onClick={() => props.onInsertResource(resource)}
                                >＋</button>
                            </div>
                        ))}
                    </div>
                    <h2>{portuguese ? 'Gerados — somente leitura' : 'Generated — read only'}</h2>
                    <div className={styles.generated}>
                        {props.workspace.generatedFiles.map(file => <span key={file}>◈ {file}</span>)}
                    </div>
                </React.Fragment>
            )}
            {props.activePanel === 'search' && (
                <React.Fragment>
                    <label className={styles.search}>
                        <span>{portuguese ? 'Buscar em todos os scripts' : 'Search all scripts'}</span>
                        <input
                            autoFocus
                            placeholder={portuguese ? 'Texto em todo o projeto…' : 'Text across the project…'}
                            type="search"
                            value={props.searchQuery}
                            onChange={event => props.onSearch(event.target.value)}
                        />
                    </label>
                    <label className={styles.search}>
                        <span>{portuguese ? 'Substituir por' : 'Replace with'}</span>
                        <input
                            placeholder={portuguese ? 'Novo texto…' : 'New text…'}
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
                    >{portuguese ? 'Substituir em todos os scripts' : 'Replace in all scripts'}</button>
                    <div className={styles.resultCount}>{props.searchResults.length} {
                        portuguese ? 'resultado(s)' : 'result(s)'
                    }</div>
                    <div className={styles.results}>
                        {props.searchResults.map((result, index) => (
                            <button
                                key={`${result.targetId}:${result.line}:${index}`}
                                type="button"
                                onClick={() => props.onOpenLocation(result)}
                            >
                                <strong>{result.fileName}</strong>
                                <small>L{result.line}:{result.column}</small>
                                <code>{result.text}</code>
                            </button>
                        ))}
                    </div>
                </React.Fragment>
            )}
            {props.activePanel === 'symbols' && (
                <React.Fragment>
                    <h2>{portuguese ? 'Estrutura de' : 'Outline of'} {props.activeFileName}</h2>
                    <div className={styles.symbols}>
                        {props.outline.map((symbol, index) => (
                            <button key={`${symbol.kind}:${symbol.name}:${index}`} type="button" onClick={() => props.onOpenLocation({
                                targetId: props.activeTargetId,
                                line: symbol.range.startLineNumber,
                                column: symbol.range.startColumn
                            })}>
                                <span className={styles.icon}>{iconFor(symbol.kind)}</span>
                                <span>{symbol.name}</span>
                                <small>{symbol.detail}</small>
                            </button>
                        ))}
                        {!props.outline.length && <p>{t('noSymbols')}</p>}
                    </div>
                </React.Fragment>
            )}
            {props.activePanel === 'history' && (
                <React.Fragment>
                    <h2>{portuguese ? 'Histórico local' : 'Local history'}</h2>
                    <p className={styles.help}>{portuguese ?
                        'Snapshots automáticos ficam neste computador e independem do Git.' :
                        'Automatic snapshots stay on this device and do not depend on Git.'}</p>
                    <div className={styles.history}>
                        {props.history.map((entry, index) => (
                            <button key={`${entry.timestamp}:${index}`} type="button" onClick={() => props.onRestoreHistory(entry)}>
                                <strong>{formatTime(entry.timestamp, props.locale)}</strong>
                                <span>{entry.reason}</span>
                                <small>{entry.source.split(/\r?\n/).length} {portuguese ? 'linhas' : 'lines'}</small>
                            </button>
                        ))}
                        {!props.history.length && <p>{portuguese ?
                            'O histórico aparecerá depois da primeira edição.' :
                            'History will appear after the first edit.'}</p>}
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
    locale: PropTypes.string,
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
    locale: 'en',
    overlay: false
};

export default IdeSidebar;
