'use strict';

const DEFAULT_FONT_SIZE = 15;
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 28;
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_BOTTOM_PANEL_HEIGHT = 176;
const MIN_BOTTOM_PANEL_HEIGHT = 112;
const MAX_BOTTOM_PANEL_HEIGHT = 520;
const DEFAULT_SPLIT_RATIO = 50;
const MIN_SPLIT_RATIO = 25;
const MAX_SPLIT_RATIO = 75;

const clamp = (value, minimum, maximum, fallback) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
};

const clampFontSize = value => Math.round(clamp(value, MIN_FONT_SIZE, MAX_FONT_SIZE, DEFAULT_FONT_SIZE));
const clampSidebarWidth = value => Math.round(clamp(
    value,
    MIN_SIDEBAR_WIDTH,
    MAX_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH
));
const clampBottomPanelHeight = value => Math.round(clamp(
    value,
    MIN_BOTTOM_PANEL_HEIGHT,
    MAX_BOTTOM_PANEL_HEIGHT,
    DEFAULT_BOTTOM_PANEL_HEIGHT
));
const clampSplitRatio = value => Math.round(clamp(
    value,
    MIN_SPLIT_RATIO,
    MAX_SPLIT_RATIO,
    DEFAULT_SPLIT_RATIO
));

const chooseSecondaryTargetId = (modules, primaryTargetId, requestedTargetId) => {
    const available = (modules || []).filter(module => module && module.id !== primaryTargetId);
    if (available.some(module => module.id === requestedTargetId)) return requestedTargetId;
    return available.length ? available[0].id : null;
};

module.exports = {
    DEFAULT_BOTTOM_PANEL_HEIGHT,
    DEFAULT_FONT_SIZE,
    DEFAULT_SIDEBAR_WIDTH,
    DEFAULT_SPLIT_RATIO,
    MAX_BOTTOM_PANEL_HEIGHT,
    MAX_FONT_SIZE,
    MAX_SIDEBAR_WIDTH,
    MAX_SPLIT_RATIO,
    MIN_BOTTOM_PANEL_HEIGHT,
    MIN_FONT_SIZE,
    MIN_SIDEBAR_WIDTH,
    MIN_SPLIT_RATIO,
    chooseSecondaryTargetId,
    clampBottomPanelHeight,
    clampFontSize,
    clampSidebarWidth,
    clampSplitRatio
};
