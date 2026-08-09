import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';
import VM from 'scratch-vm';

import Box from '../box/box.jsx';
import {STAGE_DISPLAY_SIZES} from '../../lib/layout-constants.js';
import StageHeader from '../../containers/stage-header.jsx';
import Stage from '../../containers/stage.jsx';
import Loader from '../loader/loader.jsx';

import styles from './stage-wrapper.css';

const TARGET_DOCK_HEIGHT_RESERVE = 420;
const MINIMUM_STAGE_HEIGHT = 120;

const StageWrapperComponent = function (props) {
    const {
        isEmbedded,
        isFullScreen,
        isRtl,
        isRendererSupported,
        loading,
        stageSize,
        vm
    } = props;
    const [availableWidth, setAvailableWidth] = React.useState(0);
    const [availableHeight, setAvailableHeight] = React.useState(0);
    const [rootElement, setRootElement] = React.useState(null);

    React.useEffect(() => {
        if (!rootElement) return;
        const parentElement = rootElement.parentElement;
        const updateAvailableSize = () => {
            setAvailableWidth(Math.max(0, Math.floor(rootElement.getBoundingClientRect().width - 2)));
            if (isEmbedded || isFullScreen || !parentElement) {
                setAvailableHeight(0);
                return;
            }
            const parentHeight = parentElement.getBoundingClientRect().height;
            setAvailableHeight(Math.max(
                MINIMUM_STAGE_HEIGHT,
                Math.floor(parentHeight - TARGET_DOCK_HEIGHT_RESERVE)
            ));
        };
        updateAvailableSize();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(updateAvailableSize);
        observer.observe(rootElement);
        if (parentElement) observer.observe(parentElement);
        return () => observer.disconnect();
    }, [isEmbedded, isFullScreen, rootElement]);

    return (
        <Box
            className={classNames(
                styles.stageWrapper,
                {
                    [styles.embedded]: isEmbedded,
                    [styles.fullScreen]: isFullScreen,
                    [styles.loading]: loading
                }
            )}
            componentRef={setRootElement}
            dir={isRtl ? 'rtl' : 'ltr'}
        >
            <Box className={styles.stageMenuWrapper}>
                <StageHeader
                    stageSize={stageSize}
                    vm={vm}
                />
            </Box>
            <Box className={styles.stageCanvasWrapper}>
                {
                    isRendererSupported ?
                        <Stage
                            availableHeight={availableHeight}
                            availableWidth={availableWidth}
                            stageSize={stageSize}
                            vm={vm}
                        /> :
                        null
                }
            </Box>
            {loading ? (
                <Loader isFullScreen={isFullScreen} />
            ) : null}
        </Box>
    );
};

StageWrapperComponent.propTypes = {
    isEmbedded: PropTypes.bool,
    isFullScreen: PropTypes.bool,
    isRendererSupported: PropTypes.bool.isRequired,
    isRtl: PropTypes.bool.isRequired,
    loading: PropTypes.bool,
    stageSize: PropTypes.oneOf(Object.keys(STAGE_DISPLAY_SIZES)).isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default StageWrapperComponent;
