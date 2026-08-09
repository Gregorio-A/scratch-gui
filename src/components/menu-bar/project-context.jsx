import classNames from 'classnames';
import locales from '@turbowarp/scratch-l10n';
import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {defineMessages, injectIntl, intlShape} from 'react-intl';

import {selectLocale} from '../../reducers/locales';
import ProjectTitleInput from './project-title-input.jsx';

import styles from './project-context.css';

/* eslint-disable react/jsx-no-bind */

const messages = defineMessages({
    context: {
        id: 'tw.projectContext.open',
        defaultMessage: 'Project languages',
        description: 'Open project language context'
    },
    interfaceLanguage: {
        id: 'tw.projectContext.interfaceLanguage',
        defaultMessage: 'Editor interface',
        description: 'Editor interface language'
    },
    syntaxLanguage: {
        id: 'tw.projectContext.syntaxLanguage',
        defaultMessage: 'TextWarp syntax',
        description: 'TextWarp code syntax language'
    },
    help: {
        id: 'tw.projectContext.languageHelp',
        defaultMessage: 'Interface changes labels. Syntax converts commands in every TextWarp file.',
        description: 'Explanation of the two project language settings'
    }
});

class ProjectContext extends React.Component {
    constructor (props) {
        super(props);
        this.state = {codeLanguage: 'en-US', open: false};
        this.root = null;
        this.handleCodeLanguageState = this.handleCodeLanguageState.bind(this);
        this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }
    componentDidMount () {
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
        document.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('textwarp-code-language-state', this.handleCodeLanguageState);
        document.dispatchEvent(new CustomEvent('textwarp-request-code-language'));
    }
    componentWillUnmount () {
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
        document.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('textwarp-code-language-state', this.handleCodeLanguageState);
    }
    handleCodeLanguageState (event) {
        const codeLanguage = event && event.detail && event.detail.codeLanguage;
        if (['en-US', 'pt-BR'].includes(codeLanguage)) this.setState({codeLanguage});
    }
    handleDocumentPointerDown (event) {
        if (this.state.open && this.root && !this.root.contains(event.target)) this.setState({open: false});
    }
    handleKeyDown (event) {
        if (event.key === 'Escape' && this.state.open) this.setState({open: false});
    }
    render () {
        const interfaceLabel = this.props.intl.formatMessage(messages.interfaceLanguage);
        const syntaxLabel = this.props.intl.formatMessage(messages.syntaxLanguage);
        return (
            <div
                className={classNames(styles.root, this.props.className)}
                ref={element => {
                    this.root = element;
                }}
            >
                <ProjectTitleInput className={styles.title} />
                <button
                    aria-expanded={this.state.open}
                    aria-haspopup="dialog"
                    aria-label={this.props.intl.formatMessage(messages.context)}
                    className={styles.toggle}
                    title={this.props.intl.formatMessage(messages.context)}
                    type="button"
                    onClick={() => this.setState(state => ({open: !state.open}))}
                >
                    <span>{this.props.currentLocale.toUpperCase()}</span>
                    <span aria-hidden="true">{'·'}</span>
                    <span>{this.state.codeLanguage === 'pt-BR' ? 'Sintaxe PT' : 'Syntax EN'}</span>
                    <span aria-hidden="true">{'⌄'}</span>
                </button>
                {this.state.open && (
                    <div
                        aria-label={this.props.intl.formatMessage(messages.context)}
                        className={styles.panel}
                        role="dialog"
                    >
                        <label>
                            <span>{interfaceLabel}</span>
                            <select
                                aria-label={interfaceLabel}
                                value={this.props.currentLocale}
                                onChange={event => this.props.onChangeInterfaceLanguage(event.target.value)}
                            >
                                {Object.keys(locales).map(locale => (
                                    <option
                                        key={locale}
                                        value={locale}
                                    >
                                        {locales[locale].name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            <span>{syntaxLabel}</span>
                            <select
                                aria-label={syntaxLabel}
                                value={this.state.codeLanguage}
                                onChange={event => document.dispatchEvent(new CustomEvent(
                                    'textwarp-change-code-language',
                                    {detail: {codeLanguage: event.target.value}}
                                ))}
                            >
                                <option value="pt-BR">{'Português (Brasil)'}</option>
                                <option value="en-US">{'English'}</option>
                            </select>
                        </label>
                        <p>{this.props.intl.formatMessage(messages.help)}</p>
                    </div>
                )}
            </div>
        );
    }
}

ProjectContext.propTypes = {
    className: PropTypes.string,
    currentLocale: PropTypes.string.isRequired,
    intl: intlShape.isRequired,
    onChangeInterfaceLanguage: PropTypes.func.isRequired
};

const mapStateToProps = state => ({
    currentLocale: state.locales.locale
});

const mapDispatchToProps = dispatch => ({
    onChangeInterfaceLanguage: locale => {
        dispatch(selectLocale(locale));
        document.documentElement.lang = locale;
    }
});

export default injectIntl(connect(
    mapStateToProps,
    mapDispatchToProps
)(ProjectContext));
/* eslint-enable react/jsx-no-bind */
