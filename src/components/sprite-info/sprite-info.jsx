import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import Box from '../box/box.jsx';
import Label from '../forms/label.jsx';
import Input from '../forms/input.jsx';
import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import DirectionPicker from '../../containers/direction-picker.jsx';

import {injectIntl, intlShape, defineMessages, FormattedMessage} from 'react-intl';

import {STAGE_DISPLAY_SIZES} from '../../lib/layout-constants.js';
import {isWideLocale} from '../../lib/locale-utils.js';

import styles from './sprite-info.css';

const BufferedInput = BufferedInputHOC(Input);

const messages = defineMessages({
    appearance: {
        id: 'tw.spriteInfo.appearance',
        defaultMessage: 'Appearance',
        description: 'Heading for sprite appearance controls'
    },
    position: {
        id: 'tw.spriteInfo.position',
        defaultMessage: 'Position',
        description: 'Heading for sprite position controls'
    },
    spritePlaceholder: {
        id: 'gui.SpriteInfo.spritePlaceholder',
        defaultMessage: 'Name',
        description: 'Placeholder text for sprite name'
    },
    showSpriteAction: {
        id: 'gui.SpriteInfo.showSpriteAction',
        defaultMessage: 'Show sprite',
        description: 'Tooltip for show sprite button'
    },
    hideSpriteAction: {
        id: 'gui.SpriteInfo.hideSpriteAction',
        defaultMessage: 'Hide sprite',
        description: 'Tooltip for hide sprite button'
    }
});

class SpriteInfo extends React.Component {
    constructor (props) {
        super(props);
        this.handleResetDirection = this.handleResetDirection.bind(this);
        this.handleResetSize = this.handleResetSize.bind(this);
        this.handleResetX = this.handleResetX.bind(this);
        this.handleResetY = this.handleResetY.bind(this);
    }
    shouldComponentUpdate (nextProps) {
        return (
            this.props.rotationStyle !== nextProps.rotationStyle ||
            this.props.disabled !== nextProps.disabled ||
            this.props.name !== nextProps.name ||
            this.props.stageSize !== nextProps.stageSize ||
            this.props.visible !== nextProps.visible ||
            // Only update these if rounded value has changed
            Math.round(this.props.direction) !== Math.round(nextProps.direction) ||
            Math.round(this.props.size) !== Math.round(nextProps.size) ||
            Math.round(this.props.x) !== Math.round(nextProps.x) ||
            Math.round(this.props.y) !== Math.round(nextProps.y)
        );
    }
    handleResetDirection () {
        if (!this.props.disabled) this.props.onChangeDirection(90);
    }
    handleResetSize () {
        if (!this.props.disabled) this.props.onChangeSize(100);
    }
    handleResetX () {
        if (!this.props.disabled) this.props.onChangeX(0);
    }
    handleResetY () {
        if (!this.props.disabled) this.props.onChangeY(0);
    }
    render () {
        const sprite = (
            <FormattedMessage
                defaultMessage="Sprite"
                description="Sprite info label"
                id="gui.SpriteInfo.sprite"
            />
        );
        const showLabel = (
            <FormattedMessage
                defaultMessage="Show"
                description="Sprite info show label"
                id="gui.SpriteInfo.show"
            />
        );
        const sizeLabel = (
            <FormattedMessage
                defaultMessage="Size"
                description="Sprite info size label"
                id="gui.SpriteInfo.size"
            />
        );

        const labelAbove = isWideLocale(this.props.intl.locale);

        const spriteNameInput = (
            <BufferedInput
                className={classNames(
                    styles.spriteInput,
                    {
                        [styles.columnInput]: labelAbove
                    }
                )}
                disabled={this.props.disabled}
                placeholder={this.props.intl.formatMessage(messages.spritePlaceholder)}
                tabIndex="0"
                type="text"
                value={this.props.disabled ? '' : this.props.name}
                onSubmit={this.props.onChangeName}
            />
        );

        const xPosition = (
            <div className={styles.group}>
                <Label text="x">
                    <BufferedInput
                        small
                        disabled={this.props.disabled}
                        placeholder="x"
                        tabIndex="0"
                        type="number"
                        value={this.props.disabled ? '' : Math.round(this.props.x)}
                        onDoubleClick={this.handleResetX}
                        onSubmit={this.props.onChangeX}
                    />
                </Label>
            </div>
        );

        const yPosition = (
            <div className={styles.group}>
                <Label text="y">
                    <BufferedInput
                        small
                        disabled={this.props.disabled}
                        placeholder="y"
                        tabIndex="0"
                        type="number"
                        value={this.props.disabled ? '' : Math.round(this.props.y)}
                        onDoubleClick={this.handleResetY}
                        onSubmit={this.props.onChangeY}
                    />
                </Label>
            </div>
        );

        return (
            <Box className={styles.spriteInfo}>
                <div className={styles.nameRow}>
                    <Label
                        above
                        text={sprite}
                    >
                        {spriteNameInput}
                    </Label>
                </div>
                <div className={styles.inspectorSection}>
                    <strong>{this.props.intl.formatMessage(messages.position)}</strong>
                    <div className={styles.positionGrid}>
                        {xPosition}
                        {yPosition}
                    </div>
                </div>
                <div className={styles.inspectorSection}>
                    <strong>{this.props.intl.formatMessage(messages.appearance)}</strong>
                    <div className={classNames(styles.row, styles.rowSecondary)}>
                        <div className={labelAbove ? styles.column : styles.group}>
                            <button
                                aria-checked={this.props.visible && !this.props.disabled}
                                className={styles.visibilitySwitch}
                                disabled={this.props.disabled}
                                role="switch"
                                title={this.props.intl.formatMessage(
                                    this.props.visible ? messages.hideSpriteAction : messages.showSpriteAction
                                )}
                                type="button"
                                onClick={this.props.visible ? this.props.onClickNotVisible : this.props.onClickVisible}
                            >
                                <span aria-hidden="true"><span /></span>
                                {showLabel}
                            </button>
                        </div>
                        <div className={classNames(styles.group, styles.largerInput)}>
                            <Label
                                secondary
                                above={labelAbove}
                                text={sizeLabel}
                            >
                                <span className={styles.unitInput}>
                                    <BufferedInput
                                        small
                                        disabled={this.props.disabled}
                                        label={sizeLabel}
                                        tabIndex="0"
                                        type="number"
                                        value={this.props.disabled ? '' : Math.round(this.props.size)}
                                        onDoubleClick={this.handleResetSize}
                                        onSubmit={this.props.onChangeSize}
                                    />
                                    <span>{'%'}</span>
                                </span>
                            </Label>
                        </div>
                        <div
                            className={classNames(styles.group, styles.largerInput)}
                            onDoubleClick={this.handleResetDirection}
                        >
                            <DirectionPicker
                                direction={Math.round(this.props.direction)}
                                disabled={this.props.disabled}
                                labelAbove={labelAbove}
                                rotationStyle={this.props.rotationStyle}
                                onChangeDirection={this.props.onChangeDirection}
                                onChangeRotationStyle={this.props.onChangeRotationStyle}
                            />
                        </div>
                    </div>
                </div>
            </Box>
        );
    }
}

SpriteInfo.propTypes = {
    direction: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number
    ]),
    disabled: PropTypes.bool,
    intl: intlShape,
    name: PropTypes.string,
    onChangeDirection: PropTypes.func,
    onChangeName: PropTypes.func,
    onChangeRotationStyle: PropTypes.func,
    onChangeSize: PropTypes.func,
    onChangeX: PropTypes.func,
    onChangeY: PropTypes.func,
    onClickNotVisible: PropTypes.func,
    onClickVisible: PropTypes.func,
    rotationStyle: PropTypes.string,
    size: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number
    ]),
    stageSize: PropTypes.oneOf(Object.keys(STAGE_DISPLAY_SIZES)).isRequired,
    visible: PropTypes.bool,
    x: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number
    ]),
    y: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.number
    ])
};

export default injectIntl(SpriteInfo);
