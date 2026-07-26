import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';
import DOMPurify from 'dompurify';
import {marked} from 'marked';

import guideMarkdown from '../../../TEXTWARP.md';
import guideMarkdownEnglish from '../../../TEXTWARP.en.md';
import ideMarkdown from '../../../TEXTWARP_IDE.md';
import ideMarkdownEnglish from '../../../TEXTWARP_IDE.en.md';
import legalMarkdown from '../../../TEXTWARP_LEGAL.md';
import legalMarkdownEnglish from '../../../TEXTWARP_LEGAL.en.md';
import prioritiesMarkdown from '../../../TEXTWARP_PRIORIDADES.md';
import prioritiesMarkdownEnglish from '../../../TEXTWARP_PRIORIDADES.en.md';
import referenceMarkdown from '../../../TEXTWARP_BLOCOS.md';
import referenceMarkdownEnglish from '../../../TEXTWARP_BLOCOS.en.md';
import {buildDocumentationSections, filterDocumentationSections} from '../../lib/textwarp/documentation-content';
import {createTranslator, normalizeLocale} from '../../lib/textwarp/i18n';
import styles from './documentation-pane.css';

const DOCUMENT_LINKS = Object.freeze({
    'TEXTWARP.md': 'manual-visao-geral',
    'TEXTWARP_IDE.md': 'ide-visao-geral-da-ide',
    'TEXTWARP_BLOCOS.md': 'reference-sobre-a-referencia',
    'TEXTWARP_PRIORIDADES.md': 'status-visao-geral-do-status',
    'TEXTWARP_LEGAL.md': 'legal-visao-geral-legal',
    'TEXTWARP_LEGAL.en.md': 'legal-legal-overview'
});

const groupSections = sections => Array.from(new Set(sections.map(section => section.group))).map(group => ({
    group,
    sections: sections.filter(section => section.group === group)
})).filter(item => item.sections.length);

class DocumentationPane extends React.PureComponent {
    constructor (props) {
        super(props);
        this.state = {activeId: null, query: props.initialQuery || ''};
        this.article = null;
        this.markdownBody = null;
        this.copyTimer = null;
        this.handleMarkdownClick = this.handleMarkdownClick.bind(this);
    }

    componentDidMount () {
        this.addCopyButtons();
    }

    componentDidUpdate (previousProps) {
        if (previousProps.initialQuery !== this.props.initialQuery && this.props.initialQuery !== this.state.query) {
            this.setState({query: this.props.initialQuery || ''});
            return;
        }
        this.addCopyButtons();
    }

    componentWillUnmount () {
        clearTimeout(this.copyTimer);
    }

    getSections () {
        const english = normalizeLocale(this.props.locale) !== 'pt';
        return buildDocumentationSections({
            extensionCatalog: this.props.extensionCatalog,
            extensionPalette: this.props.extensionPalette,
            guideMarkdown: english ? guideMarkdownEnglish : guideMarkdown,
            ideMarkdown: english ? ideMarkdownEnglish : ideMarkdown,
            legalMarkdown: english ? legalMarkdownEnglish : legalMarkdown,
            locale: this.props.locale,
            prioritiesMarkdown: english ? prioritiesMarkdownEnglish : prioritiesMarkdown,
            referenceMarkdown: english ? referenceMarkdownEnglish : referenceMarkdown
        });
    }

    selectSection (activeId) {
        this.setState({activeId}, () => {
            if (this.article) this.article.scrollTop = 0;
        });
    }

    async copyCode (button, code) {
        const t = createTranslator(this.props.locale);
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(code);
            } else {
                const input = document.createElement('textarea');
                input.value = code;
                input.style.position = 'fixed';
                input.style.opacity = '0';
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                input.remove();
            }
            button.textContent = t('copied');
            clearTimeout(this.copyTimer);
            this.copyTimer = setTimeout(() => {
                if (button.isConnected) button.textContent = t('copy');
            }, 1500);
        } catch (error) {
            button.textContent = t('copyFailed');
        }
    }

    addCopyButtons () {
        if (!this.markdownBody) return;
        const t = createTranslator(this.props.locale);
        Array.from(this.markdownBody.querySelectorAll('pre')).forEach(block => {
            if (block.querySelector(`.${styles.copyButton}`)) return;
            const button = document.createElement('button');
            button.className = styles.copyButton;
            button.textContent = t('copy');
            button.type = 'button';
            button.setAttribute('aria-label', t('copyCode'));
            button.addEventListener('click', () => {
                const code = block.querySelector('code');
                this.copyCode(button, code ? code.textContent : block.textContent);
            });
            block.appendChild(button);
        });
    }

    handleMarkdownClick (event) {
        const link = event.target.closest && event.target.closest('a');
        if (!link) return;
        const href = link.getAttribute('href');
        if (!DOCUMENT_LINKS[href]) return;
        event.preventDefault();
        this.selectSection(DOCUMENT_LINKS[href]);
    }

    renderExtensionReference (section) {
        const t = createTranslator(this.props.locale);
        return (
            <div className={styles.runtimeReference}>
                <p className={styles.lead}>{section.summary}</p>
                {section.entries.length ? (
                    <div className={styles.referenceList}>
                        {section.entries.map(entry => (
                            <article className={styles.referenceEntry} key={entry.name}>
                                <div className={styles.referenceTitle}>
                                    <code>{entry.syntax}</code>
                                    <span>{entry.kind}</span>
                                </div>
                                <p>{entry.description}</p>
                                <div className={styles.referenceMeta}>
                                    <span>{entry.extensionName}</span>
                                    <code>{entry.opcode}</code>
                                    <span>{entry.scope}</span>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : <div className={styles.emptyState}>{t('noResults')}</div>}
                {section.palette.length > 0 && (
                    <React.Fragment>
                        <h2>{t('documentationPaletteTitle')}</h2>
                        <p>{t('documentationPaletteDescription')}</p>
                        <div className={styles.paletteList}>
                            {section.palette.map((entry, index) => (
                                <div key={`${entry.name}:${index}`}>
                                    <span>{entry.kind}</span>
                                    <code>{entry.name}</code>
                                    <p>{entry.description}</p>
                                </div>
                            ))}
                        </div>
                    </React.Fragment>
                )}
            </div>
        );
    }

    render () {
        const t = createTranslator(this.props.locale);
        const sections = this.getSections();
        const filtered = filterDocumentationSections(sections, this.state.query);
        const active = filtered.find(section => section.id === this.state.activeId) || filtered[0] || null;
        const executableCount = Object.keys(this.props.extensionCatalog || {}).length;
        return (
            <div className={classNames(styles.root, this.props.compact && styles.compact)}>
                <aside className={styles.sidebar} aria-label={t('documentationIndex')}>
                    <div className={styles.sidebarHeader}>
                        <span className={styles.eyebrow}>{t('versionLabel', {version: '0.3'})}</span>
                        <strong>{t('documentation')}</strong>
                        <p>{t('documentationDescription')}</p>
                    </div>
                    <label className={styles.search}>
                        <span>{t('documentationSearch')}</span>
                        <input
                            placeholder={t('documentationSearchPlaceholder')}
                            type="search"
                            value={this.state.query}
                            onChange={event => this.setState({query: event.target.value})}
                        />
                    </label>
                    <nav className={styles.navigation}>
                        {groupSections(filtered).map(item => (
                            <section key={item.group}>
                                <h2>{item.group}</h2>
                                {item.sections.map(section => (
                                    <button
                                        aria-current={active && active.id === section.id ? 'page' : undefined}
                                        className={active && active.id === section.id ? styles.activeItem : ''}
                                        key={section.id}
                                        type="button"
                                        onClick={() => this.selectSection(section.id)}
                                    >
                                        <span>{section.title}</span>
                                        {section.type === 'extensions' && <small>{section.entries.length}</small>}
                                    </button>
                                ))}
                            </section>
                        ))}
                        {!filtered.length && (
                            <div className={styles.noResults}>
                                <strong>{t('noResults')}</strong>
                                <button type="button" onClick={() => this.setState({query: ''})}>
                                    {t('documentationClearSearch')}
                                </button>
                            </div>
                        )}
                    </nav>
                    <div className={styles.sidebarFooter}>
                        <span>{t('topics', {count: sections.length})}</span>
                        <span>{t('documentationExtensionBlockCount', {count: executableCount})}</span>
                    </div>
                </aside>
                <main className={styles.article} ref={element => { this.article = element; }}>
                    {active && (
                        <div className={styles.articleInner}>
                            <div className={styles.breadcrumb}>{active.group}</div>
                            <h1>{active.title}</h1>
                            {active.type === 'markdown' ? (
                                <div
                                    className={styles.markdown}
                                    dangerouslySetInnerHTML={{
                                        __html: DOMPurify.sanitize(marked.parse(active.markdown), {
                                            USE_PROFILES: {html: true}
                                        })
                                    }}
                                    ref={element => { this.markdownBody = element; }}
                                    onClick={this.handleMarkdownClick}
                                />
                            ) : this.renderExtensionReference(active)}
                        </div>
                    )}
                </main>
            </div>
        );
    }
}

DocumentationPane.propTypes = {
    compact: PropTypes.bool,
    extensionCatalog: PropTypes.objectOf(PropTypes.shape({})),
    extensionPalette: PropTypes.arrayOf(PropTypes.shape({})),
    initialQuery: PropTypes.string,
    locale: PropTypes.string
};

DocumentationPane.defaultProps = {
    compact: false,
    extensionCatalog: {},
    extensionPalette: [],
    initialQuery: '',
    locale: 'en'
};

export default DocumentationPane;
