import classNames from 'classnames';
import omit from 'lodash.omit';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, FormattedMessage, injectIntl, intlShape} from 'react-intl';
import {connect} from 'react-redux';
import MediaQuery from 'react-responsive';
import {Tab, Tabs, TabList, TabPanel} from 'react-tabs';
import tabStyles from 'react-tabs/style/react-tabs.css';
import VM from 'scratch-vm';

import TextWarpEditor from '../../containers/textwarp-editor.jsx';
import TargetPane from '../../containers/target-pane.jsx';
import StageWrapper from '../../containers/stage-wrapper.jsx';
import Loader from '../loader/loader.jsx';
import Box from '../box/box.jsx';
import MenuBar from '../menu-bar/menu-bar.jsx';
import WorkspaceActivityBar from './workspace-activity-bar.jsx';
import Watermark from '../../containers/watermark.jsx';

import Alerts from '../../containers/alerts.jsx';
import DragLayer from '../../containers/drag-layer.jsx';
import TWSecurityManager from '../../containers/tw-security-manager.jsx';
import TWRestorePointManager from '../../containers/tw-restore-point-manager.jsx';

import {STAGE_SIZE_MODES, FIXED_WIDTH, UNCONSTRAINED_NON_STAGE_WIDTH} from '../../lib/layout-constants';
import {resolveStageSize} from '../../lib/screen-utils';
import {Theme} from '../../lib/themes';

import {isRendererSupported, isBrowserSupported} from '../../lib/tw-environment-support-prober';

import styles from './gui.css';
import addExtensionIcon from './icon--extensions.svg';
import codeIcon from '!../../lib/tw-recolor/build!./icon--code.svg';
import costumesIcon from '!../../lib/tw-recolor/build!./icon--costumes.svg';
import soundsIcon from '!../../lib/tw-recolor/build!./icon--sounds.svg';

const messages = defineMessages({
    addExtension: {
        id: 'gui.gui.addExtension',
        description: 'Button to add an extension in the target pane',
        defaultMessage: 'Add Extension'
    },
    resizeStage: {
        id: 'tw.stageDock.resize',
        description: 'Accessible label for the stage resize handle',
        defaultMessage: 'Resize stage'
    }
});

const getFullscreenBackgroundColor = () => {
    const params = new URLSearchParams(location.search);
    if (params.has('fullscreen-background')) {
        return params.get('fullscreen-background');
    }
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return '#111';
    }
    return 'white';
};

const fullscreenBackgroundColor = getFullscreenBackgroundColor();

const STAGE_LAYOUT_STORAGE_KEY = 'textwarp.workspace.stage-layout';
const ACTIVITY_BAR_STORAGE_KEY = 'textwarp.workspace.activity-bar-visible';
const CostumeTab = React.lazy(() =>
    import(/* webpackChunkName: "costume-editor" */ '../../containers/costume-tab.jsx')
);
const SoundTab = React.lazy(() =>
    import(/* webpackChunkName: "sound-editor" */ '../../containers/sound-tab.jsx')
);
const CostumeLibrary = React.lazy(() =>
    import(/* webpackChunkName: "costume-library" */ '../../containers/costume-library.jsx')
);
const BackdropLibrary = React.lazy(() =>
    import(/* webpackChunkName: "backdrop-library" */ '../../containers/backdrop-library.jsx')
);
const BrowserModal = React.lazy(() =>
    import(/* webpackChunkName: "browser-modal" */ '../browser-modal/browser-modal.jsx')
);
const TipsLibrary = React.lazy(() =>
    import(/* webpackChunkName: "tips-library" */ '../../containers/tips-library.jsx')
);
const Cards = React.lazy(() => import(/* webpackChunkName: "cards" */ '../../containers/cards.jsx'));
const ConnectionModal = React.lazy(() =>
    import(/* webpackChunkName: "connection-modal" */ '../../containers/connection-modal.jsx')
);
const TelemetryModal = React.lazy(() =>
    import(/* webpackChunkName: "telemetry-modal" */ '../telemetry-modal/telemetry-modal.jsx')
);
const TWUsernameModal = React.lazy(() =>
    import(/* webpackChunkName: "username-modal" */ '../../containers/tw-username-modal.jsx')
);
const TWSettingsModal = React.lazy(() =>
    import(/* webpackChunkName: "settings-modal" */ '../../containers/tw-settings-modal.jsx')
);
const TWCustomExtensionModal = React.lazy(() =>
    import(/* webpackChunkName: "custom-extension-modal" */ '../../containers/tw-custom-extension-modal.jsx')
);
const TWFontsModal = React.lazy(() =>
    import(/* webpackChunkName: "fonts-modal" */ '../../containers/tw-fonts-modal.jsx')
);
const TWUnknownPlatformModal = React.lazy(() =>
    import(/* webpackChunkName: "unknown-platform-modal" */ '../../containers/tw-unknown-platform-modal.jsx')
);
const TWInvalidProjectModal = React.lazy(() =>
    import(/* webpackChunkName: "invalid-project-modal" */ '../../containers/tw-invalid-project-modal.jsx')
);

const readStageLayout = () => {
    const defaultLayout = {
        mobileHeight: 320,
        visible: typeof window === 'undefined' || window.innerWidth > 640,
        width: 510
    };
    try {
        const saved = JSON.parse(window.localStorage.getItem(STAGE_LAYOUT_STORAGE_KEY));
        if (!saved || typeof saved !== 'object') return defaultLayout;
        return {
            mobileHeight: Math.max(180, Math.min(600, Number(saved.mobileHeight) || defaultLayout.mobileHeight)),
            visible: saved.visible !== false,
            width: Math.max(300, Math.min(720, Number(saved.width) || defaultLayout.width))
        };
    } catch (error) {
        return defaultLayout;
    }
};

const persistStageLayout = layout => {
    try {
        window.localStorage.setItem(STAGE_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
    } catch (error) {
        // The layout remains active for this session when browser storage is unavailable.
    }
};

const readActivityBarVisibility = () => {
    try {
        return window.localStorage.getItem(ACTIVITY_BAR_STORAGE_KEY) !== 'false';
    } catch (error) {
        return true;
    }
};

/* eslint-disable react/jsx-no-bind */
const ResizableStagePane = ({
    isFullScreen,
    intl,
    isRendererSupported: rendererSupported,
    isRtl,
    layout,
    onLayoutChange,
    stageSize,
    vm
}) => {
    const resizeSession = React.useRef(null);
    React.useEffect(() => {
        const handlePointerMove = event => {
            if (!resizeSession.current) return;
            if (resizeSession.current.mobile) {
                const rawHeight = resizeSession.current.bottom - event.clientY;
                const maxHeight = Math.max(240, Math.min(600, window.innerHeight * 0.7));
                onLayoutChange(current => Object.assign({}, current, {
                    mobileHeight: Math.max(180, Math.min(maxHeight, rawHeight))
                }));
                return;
            }
            const rawWidth = resizeSession.current.isRtl ?
                event.clientX - resizeSession.current.left :
                resizeSession.current.right - event.clientX;
            const maxWidth = Math.max(320, Math.min(720, window.innerWidth * 0.7));
            onLayoutChange(current => Object.assign({}, current, {
                width: Math.max(300, Math.min(maxWidth, rawWidth))
            }));
        };
        const handlePointerUp = () => {
            if (!resizeSession.current) return;
            resizeSession.current = null;
            document.body.classList.remove('textwarp-resizing');
            onLayoutChange(current => {
                persistStageLayout(current);
                return current;
            });
            window.dispatchEvent(new Event('resize'));
        };
        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            document.body.classList.remove('textwarp-resizing');
        };
    }, []);
    if (!layout.visible) return null;
    const renderedStageSize = layout.width < 410 ? STAGE_SIZE_MODES.small : stageSize;
    return (
        <Box
            className={classNames(styles.stageAndTargetWrapper, styles.stageDock)}
            style={{
                '--textwarp-stage-pane-height': `${layout.mobileHeight}px`,
                '--textwarp-stage-pane-width': `${layout.width}px`
            }}
        >
            <div
                aria-label={intl.formatMessage(messages.resizeStage)}
                className={styles.stageResizeHandle}
                role="separator"
                tabIndex="0"
                onPointerDown={event => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    const bounds = event.currentTarget.parentElement.getBoundingClientRect();
                    resizeSession.current = {
                        bottom: bounds.bottom,
                        isRtl,
                        left: bounds.left,
                        mobile: window.innerWidth <= 640,
                        right: bounds.right
                    };
                    document.body.classList.add('textwarp-resizing');
                }}
                onKeyDown={event => {
                    const mobile = window.innerWidth <= 640;
                    const supportedKeys = mobile ?
                        ['ArrowUp', 'ArrowDown', 'Home'] :
                        ['ArrowLeft', 'ArrowRight', 'Home'];
                    if (!supportedKeys.includes(event.key)) return;
                    event.preventDefault();
                    if (mobile) {
                        const mobileHeight = event.key === 'Home' ? 320 :
                            Math.max(180, Math.min(
                                600,
                                layout.mobileHeight + (event.key === 'ArrowUp' ? 20 : -20)
                            ));
                        const nextLayout = Object.assign({}, layout, {mobileHeight});
                        onLayoutChange(nextLayout);
                        persistStageLayout(nextLayout);
                        window.dispatchEvent(new Event('resize'));
                        return;
                    }
                    const width = event.key === 'Home' ? 510 :
                        Math.max(300, Math.min(720, layout.width + (event.key === 'ArrowLeft' ? 20 : -20)));
                    const nextLayout = Object.assign({}, layout, {width});
                    onLayoutChange(nextLayout);
                    persistStageLayout(nextLayout);
                    window.dispatchEvent(new Event('resize'));
                }}
            />
            <StageWrapper
                isFullScreen={isFullScreen}
                isRendererSupported={rendererSupported}
                isRtl={isRtl}
                stageSize={renderedStageSize}
                vm={vm}
            />
            <Box className={styles.targetWrapper}>
                <TargetPane
                    stageSize={renderedStageSize}
                    vm={vm}
                />
            </Box>
        </Box>
    );
};

ResizableStagePane.propTypes = {
    isFullScreen: PropTypes.bool,
    intl: intlShape.isRequired,
    isRendererSupported: PropTypes.bool.isRequired,
    isRtl: PropTypes.bool.isRequired,
    layout: PropTypes.shape({
        mobileHeight: PropTypes.number.isRequired,
        visible: PropTypes.bool.isRequired,
        width: PropTypes.number.isRequired
    }).isRequired,
    onLayoutChange: PropTypes.func.isRequired,
    stageSize: PropTypes.string.isRequired,
    vm: PropTypes.instanceOf(VM).isRequired
};
/* eslint-enable react/jsx-no-bind */

const GUIComponent = props => {
    const {
        accountNavOpen,
        activeTabIndex,
        alertsVisible,
        authorId,
        authorThumbnailUrl,
        authorUsername,
        basePath,
        backdropLibraryVisible,
        backpackHost,
        backpackVisible,
        blocksId,
        blocksTabVisible,
        cardsVisible,
        canChangeLanguage,
        canChangeTheme,
        canCreateNew,
        canEditTitle,
        canManageFiles,
        canRemix,
        canSave,
        canCreateCopy,
        canShare,
        canUseCloud,
        children,
        connectionModalVisible,
        costumeLibraryVisible,
        costumesTabVisible,
        customStageSize,
        enableCommunity,
        intl,
        isCreating,
        isEmbedded,
        isFullScreen,
        isPlayerOnly,
        isRtl,
        isShared,
        isWindowFullScreen,
        isTelemetryEnabled,
        isTotallyNormal,
        loading,
        logo,
        renderLogin,
        onClickAbout,
        onClickAccountNav,
        onCloseAccountNav,
        onClickAddonSettings,
        onClickDesktopSettings,
        onClickNewWindow,
        onClickPackager,
        onLogOut,
        onOpenRegistration,
        onToggleLoginOpen,
        onActivateCostumesTab,
        onActivateSoundsTab,
        onActivateTab,
        onClickLogo,
        onExtensionButtonClick,
        onOpenCustomExtensionModal,
        onProjectTelemetryEvent,
        onRequestCloseBackdropLibrary,
        onRequestCloseCostumeLibrary,
        onRequestCloseTelemetryModal,
        onSeeCommunity,
        onShare,
        onShowPrivacyPolicy,
        onStartSelectingFileUpload,
        onTelemetryModalCancel,
        onTelemetryModalOptIn,
        onTelemetryModalOptOut,
        securityManager,
        showComingSoon,
        showOpenFilePicker,
        showSaveFilePicker,
        soundsTabVisible,
        stageSizeMode,
        targetIsStage,
        telemetryModalVisible,
        theme,
        tipsLibraryVisible,
        usernameModalVisible,
        settingsModalVisible,
        customExtensionModalVisible,
        fontsModalVisible,
        unknownPlatformModalVisible,
        invalidProjectModalVisible,
        vm,
        ...componentProps
    } = omit(props, 'dispatch');
    const [stageLayout, setStageLayout] = React.useState(readStageLayout);
    const [activityBarVisible, setActivityBarVisible] = React.useState(readActivityBarVisibility);
    const setStageDockVisible = visible => {
        setStageLayout(current => {
            const nextLayout = Object.assign({}, current, {visible});
            persistStageLayout(nextLayout);
            return nextLayout;
        });
        setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    };
    const toggleActivityBar = () => {
        setActivityBarVisible(current => {
            const next = !current;
            try {
                window.localStorage.setItem(ACTIVITY_BAR_STORAGE_KEY, String(next));
            } catch (error) {
                // The layout remains active for this session when browser storage is unavailable.
            }
            return next;
        });
        setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    };
    const toggleStageDock = () => setStageDockVisible(!stageLayout.visible);
    if (children) {
        return <Box {...componentProps}>{children}</Box>;
    }

    const tabClassNames = {
        tabs: styles.tabs,
        tab: classNames(tabStyles.reactTabsTab, styles.tab),
        tabList: classNames(tabStyles.reactTabsTabList, styles.tabList),
        tabPanel: classNames(tabStyles.reactTabsTabPanel, styles.tabPanel),
        tabPanelSelected: classNames(tabStyles.reactTabsTabPanelSelected, styles.isSelected),
        tabSelected: classNames(tabStyles.reactTabsTabSelected, styles.isSelected)
    };

    const unconstrainedWidth = (
        UNCONSTRAINED_NON_STAGE_WIDTH +
        FIXED_WIDTH +
        Math.max(0, customStageSize.width - FIXED_WIDTH)
    );
    return (<MediaQuery minWidth={unconstrainedWidth}>{isUnconstrained => (
        <MediaQuery maxWidth={800}>{isCompact => {
            const stageSize = isCompact ?
                STAGE_SIZE_MODES.small :
                resolveStageSize(stageSizeMode, isUnconstrained);

            const alwaysEnabledModals = (
                <React.Fragment>
                    <TWSecurityManager securityManager={securityManager} />
                    <TWRestorePointManager />
                    <React.Suspense fallback={null}>
                        {usernameModalVisible && <TWUsernameModal />}
                        {settingsModalVisible && <TWSettingsModal />}
                        {customExtensionModalVisible && <TWCustomExtensionModal />}
                        {fontsModalVisible && <TWFontsModal />}
                        {unknownPlatformModalVisible && <TWUnknownPlatformModal />}
                        {invalidProjectModalVisible && <TWInvalidProjectModal />}
                    </React.Suspense>
                </React.Fragment>
            );

            return isPlayerOnly ? (
                <React.Fragment>
                    {/* TW: When the window is fullscreen, use an element to display the background color */}
                    {/* The default transparency color is inconsistent between browsers. */}
                    {/* There is no other element that fills the entire screen for us to style. */}
                    {isWindowFullScreen ? (
                        <div
                            className={styles.fullscreenBackground}
                            style={{
                                backgroundColor: fullscreenBackgroundColor
                            }}
                        />
                    ) : null}
                    <StageWrapper
                        isFullScreen={isFullScreen}
                        isEmbedded={isEmbedded}
                        isRendererSupported={isRendererSupported()}
                        isRtl={isRtl}
                        loading={loading}
                        stageSize={STAGE_SIZE_MODES.full}
                        vm={vm}
                    >
                        {alertsVisible ? (
                            <Alerts className={styles.alertsContainer} />
                        ) : null}
                    </StageWrapper>
                    {alwaysEnabledModals}
                </React.Fragment>
            ) : (
                <Box
                    className={styles.pageWrapper}
                    dir={isRtl ? 'rtl' : 'ltr'}
                    style={{
                        minWidth: isCompact ? 0 : 1024 + Math.max(0, customStageSize.width - 480),
                        minHeight: isCompact ? 0 : 640 + Math.max(0, customStageSize.height - 360)
                    }}
                    {...componentProps}
                >
                    {alwaysEnabledModals}
                    <React.Suspense fallback={null}>
                        {telemetryModalVisible ? (
                            <TelemetryModal
                                isRtl={isRtl}
                                isTelemetryEnabled={isTelemetryEnabled}
                                onCancel={onTelemetryModalCancel}
                                onOptIn={onTelemetryModalOptIn}
                                onOptOut={onTelemetryModalOptOut}
                                onRequestClose={onRequestCloseTelemetryModal}
                                onShowPrivacyPolicy={onShowPrivacyPolicy}
                            />
                        ) : null}
                        {loading ? (
                            <Loader isFullScreen />
                        ) : null}
                        {isCreating ? (
                            <Loader
                                isFullScreen
                                messageId="gui.loader.creating"
                            />
                        ) : null}
                        {isBrowserSupported() ? null : (
                            <BrowserModal
                                isRtl={isRtl}
                                onClickDesktopSettings={onClickDesktopSettings}
                            />
                        )}
                        {tipsLibraryVisible ? (
                            <TipsLibrary />
                        ) : null}
                        {cardsVisible ? (
                            <Cards />
                        ) : null}
                        {alertsVisible ? (
                            <Alerts className={styles.alertsContainer} />
                        ) : null}
                        {connectionModalVisible ? (
                            <ConnectionModal
                                vm={vm}
                            />
                        ) : null}
                        {costumeLibraryVisible ? (
                            <CostumeLibrary
                                vm={vm}
                                onRequestClose={onRequestCloseCostumeLibrary}
                            />
                        ) : null}
                        {backdropLibraryVisible ? (
                            <BackdropLibrary
                                vm={vm}
                                onRequestClose={onRequestCloseBackdropLibrary}
                            />
                        ) : null}
                    </React.Suspense>
                    <MenuBar
                        accountNavOpen={accountNavOpen}
                        authorId={authorId}
                        authorThumbnailUrl={authorThumbnailUrl}
                        authorUsername={authorUsername}
                        canChangeLanguage={canChangeLanguage}
                        canChangeTheme={canChangeTheme}
                        canCreateCopy={canCreateCopy}
                        canCreateNew={canCreateNew}
                        canEditTitle={canEditTitle}
                        canManageFiles={canManageFiles}
                        canRemix={canRemix}
                        canSave={canSave}
                        canShare={canShare}
                        className={styles.menuBarPosition}
                        enableCommunity={enableCommunity}
                        isShared={isShared}
                        isTotallyNormal={isTotallyNormal}
                        logo={logo}
                        renderLogin={renderLogin}
                        showComingSoon={showComingSoon}
                        showOpenFilePicker={showOpenFilePicker}
                        showSaveFilePicker={showSaveFilePicker}
                        onClickAbout={onClickAbout}
                        onClickAccountNav={onClickAccountNav}
                        onClickAddonSettings={onClickAddonSettings}
                        onClickDesktopSettings={onClickDesktopSettings}
                        onClickNewWindow={onClickNewWindow}
                        onClickPackager={onClickPackager}
                        onClickLogo={onClickLogo}
                        onCloseAccountNav={onCloseAccountNav}
                        onLogOut={onLogOut}
                        onOpenRegistration={onOpenRegistration}
                        onProjectTelemetryEvent={onProjectTelemetryEvent}
                        onSeeCommunity={onSeeCommunity}
                        onShare={onShare}
                        onStartSelectingFileUpload={onStartSelectingFileUpload}
                        onToggleLoginOpen={onToggleLoginOpen}
                        onActivateTab={onActivateTab}
                        activityBarVisible={activityBarVisible}
                        rightSidebarVisible={stageLayout.visible}
                        /* eslint-disable react/jsx-no-bind */
                        onToggleActivityBar={toggleActivityBar}
                        onToggleRightSidebar={toggleStageDock}
                        /* eslint-enable react/jsx-no-bind */
                    />
                    <Box className={styles.bodyWrapper}>
                        <Box className={styles.flexWrapper}>
                            {activityBarVisible && (
                                <WorkspaceActivityBar
                                    activeTabIndex={activeTabIndex}
                                    targetIsStage={targetIsStage}
                                    onSelect={onActivateTab}
                                />
                            )}
                            <Box className={styles.editorWrapper}>
                                <Tabs
                                    forceRenderTabPanel
                                    className={tabClassNames.tabs}
                                    selectedIndex={activeTabIndex}
                                    selectedTabClassName={tabClassNames.tabSelected}
                                    selectedTabPanelClassName={tabClassNames.tabPanelSelected}
                                    onSelect={onActivateTab}
                                >
                                    <TabList className={classNames(tabClassNames.tabList, styles.visuallyHiddenTabs)}>
                                        <Tab className={tabClassNames.tab}>
                                            <img
                                                draggable={false}
                                                src={codeIcon()}
                                            />
                                            <FormattedMessage
                                                defaultMessage="Programming"
                                                description="Button to get to the programming panel"
                                                id="tw.gui.programmingTab"
                                            />
                                        </Tab>
                                        <Tab
                                            className={tabClassNames.tab}
                                            onClick={onActivateCostumesTab}
                                        >
                                            <img
                                                draggable={false}
                                                src={costumesIcon()}
                                            />
                                            {targetIsStage ? (
                                                <FormattedMessage
                                                    defaultMessage="Backdrops"
                                                    description="Button to get to the backdrops panel"
                                                    id="gui.gui.backdropsTab"
                                                />
                                            ) : (
                                                <FormattedMessage
                                                    defaultMessage="Costumes"
                                                    description="Button to get to the costumes panel"
                                                    id="gui.gui.costumesTab"
                                                />
                                            )}
                                        </Tab>
                                        <Tab
                                            className={tabClassNames.tab}
                                            onClick={onActivateSoundsTab}
                                        >
                                            <img
                                                draggable={false}
                                                src={soundsIcon()}
                                            />
                                            <FormattedMessage
                                                defaultMessage="Sounds"
                                                description="Button to get to the sounds panel"
                                                id="gui.gui.soundsTab"
                                            />
                                        </Tab>
                                    </TabList>
                                    <TabPanel className={tabClassNames.tabPanel}>
                                        <Box className={styles.blocksWrapper}>
                                            <TextWarpEditor
                                                backpackHost={backpackHost}
                                                backpackVisible={backpackVisible}
                                                key={`${blocksId}/${theme.id}`}
                                                canUseCloud={canUseCloud}
                                                grow={1}
                                                isVisible={blocksTabVisible}
                                                options={{
                                                    media: `${basePath}static/${theme.getBlocksMediaFolder()}/`
                                                }}
                                                stageSize={stageSize}
                                                onOpenCustomExtensionModal={onOpenCustomExtensionModal}
                                                onOpenExtensionLibrary={onExtensionButtonClick}
                                                theme={theme}
                                                vm={vm}
                                            />
                                        </Box>
                                        <Box className={styles.extensionButtonContainer}>
                                            <button
                                                className={styles.extensionButton}
                                                title={intl.formatMessage(messages.addExtension)}
                                                onClick={onExtensionButtonClick}
                                            >
                                                <img
                                                    className={styles.extensionButtonIcon}
                                                    draggable={false}
                                                    src={addExtensionIcon}
                                                />
                                            </button>
                                        </Box>
                                        <Box className={styles.watermark}>
                                            <Watermark />
                                        </Box>
                                    </TabPanel>
                                    <TabPanel className={tabClassNames.tabPanel}>
                                        <React.Suspense fallback={<Loader />}>
                                            {costumesTabVisible ? <CostumeTab
                                                vm={vm}
                                            /> : null}
                                        </React.Suspense>
                                    </TabPanel>
                                    <TabPanel className={tabClassNames.tabPanel}>
                                        <React.Suspense fallback={<Loader />}>
                                            {soundsTabVisible ? <SoundTab vm={vm} /> : null}
                                        </React.Suspense>
                                    </TabPanel>
                                </Tabs>
                            </Box>

                            <ResizableStagePane
                                isFullScreen={isFullScreen}
                                intl={intl}
                                isRendererSupported={isRendererSupported()}
                                isRtl={isRtl}
                                layout={stageLayout}
                                onLayoutChange={setStageLayout}
                                stageSize={stageSize}
                                vm={vm}
                            />
                        </Box>
                    </Box>
                    <DragLayer />
                </Box>
            );
        }}</MediaQuery>
    )}</MediaQuery>);
};

GUIComponent.propTypes = {
    accountNavOpen: PropTypes.bool,
    activeTabIndex: PropTypes.number,
    authorId: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]), // can be false
    authorThumbnailUrl: PropTypes.string,
    authorUsername: PropTypes.oneOfType([PropTypes.string, PropTypes.bool]), // can be false
    backdropLibraryVisible: PropTypes.bool,
    backpackHost: PropTypes.string,
    backpackVisible: PropTypes.bool,
    basePath: PropTypes.string,
    blocksTabVisible: PropTypes.bool,
    blocksId: PropTypes.string,
    canChangeLanguage: PropTypes.bool,
    canChangeTheme: PropTypes.bool,
    canCreateCopy: PropTypes.bool,
    canCreateNew: PropTypes.bool,
    canEditTitle: PropTypes.bool,
    canManageFiles: PropTypes.bool,
    canRemix: PropTypes.bool,
    canSave: PropTypes.bool,
    canShare: PropTypes.bool,
    canUseCloud: PropTypes.bool,
    cardsVisible: PropTypes.bool,
    children: PropTypes.node,
    costumeLibraryVisible: PropTypes.bool,
    costumesTabVisible: PropTypes.bool,
    customStageSize: PropTypes.shape({
        width: PropTypes.number,
        height: PropTypes.number
    }),
    enableCommunity: PropTypes.bool,
    intl: intlShape.isRequired,
    isCreating: PropTypes.bool,
    isEmbedded: PropTypes.bool,
    isFullScreen: PropTypes.bool,
    isPlayerOnly: PropTypes.bool,
    isRtl: PropTypes.bool,
    isShared: PropTypes.bool,
    isWindowFullScreen: PropTypes.bool,
    isTotallyNormal: PropTypes.bool,
    loading: PropTypes.bool,
    logo: PropTypes.string,
    onActivateCostumesTab: PropTypes.func,
    onActivateSoundsTab: PropTypes.func,
    onActivateTab: PropTypes.func,
    onClickAccountNav: PropTypes.func,
    onClickAddonSettings: PropTypes.func,
    onClickDesktopSettings: PropTypes.func,
    onClickNewWindow: PropTypes.func,
    onClickPackager: PropTypes.func,
    onClickLogo: PropTypes.func,
    onCloseAccountNav: PropTypes.func,
    onExtensionButtonClick: PropTypes.func,
    onOpenCustomExtensionModal: PropTypes.func,
    onLogOut: PropTypes.func,
    onOpenRegistration: PropTypes.func,
    onRequestCloseBackdropLibrary: PropTypes.func,
    onRequestCloseCostumeLibrary: PropTypes.func,
    onRequestCloseTelemetryModal: PropTypes.func,
    onSeeCommunity: PropTypes.func,
    onShare: PropTypes.func,
    onShowPrivacyPolicy: PropTypes.func,
    onStartSelectingFileUpload: PropTypes.func,
    onTabSelect: PropTypes.func,
    onTelemetryModalCancel: PropTypes.func,
    onTelemetryModalOptIn: PropTypes.func,
    onTelemetryModalOptOut: PropTypes.func,
    onToggleLoginOpen: PropTypes.func,
    renderLogin: PropTypes.func,
    securityManager: PropTypes.shape({}),
    showComingSoon: PropTypes.bool,
    showOpenFilePicker: PropTypes.func,
    showSaveFilePicker: PropTypes.func,
    soundsTabVisible: PropTypes.bool,
    stageSizeMode: PropTypes.oneOf(Object.keys(STAGE_SIZE_MODES)),
    targetIsStage: PropTypes.bool,
    telemetryModalVisible: PropTypes.bool,
    theme: PropTypes.instanceOf(Theme),
    tipsLibraryVisible: PropTypes.bool,
    usernameModalVisible: PropTypes.bool,
    settingsModalVisible: PropTypes.bool,
    customExtensionModalVisible: PropTypes.bool,
    fontsModalVisible: PropTypes.bool,
    unknownPlatformModalVisible: PropTypes.bool,
    invalidProjectModalVisible: PropTypes.bool,
    vm: PropTypes.instanceOf(VM).isRequired
};
GUIComponent.defaultProps = {
    backpackHost: null,
    backpackVisible: false,
    basePath: './',
    blocksId: 'original',
    canChangeLanguage: true,
    canChangeTheme: true,
    canCreateNew: false,
    canEditTitle: false,
    canManageFiles: true,
    canRemix: false,
    canSave: false,
    canCreateCopy: false,
    canShare: false,
    canUseCloud: false,
    enableCommunity: false,
    isCreating: false,
    isShared: false,
    isTotallyNormal: false,
    loading: false,
    showComingSoon: false,
    stageSizeMode: STAGE_SIZE_MODES.large
};

const mapStateToProps = state => ({
    customStageSize: state.scratchGui.customStageSize,
    isWindowFullScreen: state.scratchGui.tw.isWindowFullScreen,
    // This is the button's mode, as opposed to the actual current state
    blocksId: state.scratchGui.timeTravel.year.toString(),
    stageSizeMode: state.scratchGui.stageSize.stageSize,
    theme: state.scratchGui.theme.theme
});

export default injectIntl(connect(
    mapStateToProps
)(GUIComponent));
