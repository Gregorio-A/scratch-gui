import PropTypes from 'prop-types';
import React from 'react';

import InterfaceIcon from './interface-icon.jsx';
import styles from './text-editor.css';

class QuickPanel extends React.Component {
    constructor (props) {
        super(props);
        this.panel = null;
        this.returnFocus = null;
        this.handleDocumentPointerDown = this.handleDocumentPointerDown.bind(this);
        this.handleKeyDown = this.handleKeyDown.bind(this);
    }

    componentDidMount () {
        this.returnFocus = document.activeElement;
        document.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('pointerdown', this.handleDocumentPointerDown, true);
        const firstFocusable = this.panel && this.panel.querySelector(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]'
        );
        if (firstFocusable) firstFocusable.focus();
    }

    componentWillUnmount () {
        document.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('pointerdown', this.handleDocumentPointerDown, true);
        if (this.returnFocus && document.contains(this.returnFocus)) this.returnFocus.focus();
    }

    handleKeyDown (event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.props.onClose();
    }

    handleDocumentPointerDown (event) {
        if (
            !this.panel ||
            this.panel.contains(event.target) ||
            this.returnFocus && this.returnFocus.contains(event.target)
        ) return;
        this.props.onClose();
    }

    render () {
        return (
            <section
                aria-label={this.props.label}
                aria-modal="false"
                className={styles.quickPanel}
                id={this.props.id}
                ref={element => {
                    this.panel = element;
                }}
                role="dialog"
            >
                <div className={styles.quickPanelHeader}>
                    <strong>{this.props.label}</strong>
                    <button
                        aria-label={this.props.closeLabel}
                        className={styles.iconButton}
                        type="button"
                        onClick={this.props.onClose}
                    >
                        <InterfaceIcon name="close" />
                    </button>
                </div>
                <div className={styles.quickPanelContent}>{this.props.children}</div>
            </section>
        );
    }
}

QuickPanel.propTypes = {
    children: PropTypes.node.isRequired,
    closeLabel: PropTypes.string.isRequired,
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    onClose: PropTypes.func.isRequired
};

export default QuickPanel;
