'use strict';

const PANEL_IDS = Object.freeze(['problems', 'console', 'debugger', 'output', 'backpack']);
const SIDEBAR_PANEL_IDS = Object.freeze([
    'explorer', 'commands', 'search', 'actors', 'extensions', 'symbols', 'history'
]);
const VIEW_IDS = Object.freeze(['code', 'blocks', 'split', 'docs']);
const DEFAULT_LIST_LIMIT = 100;

const clampListLimit = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(DEFAULT_LIST_LIMIT, Math.floor(parsed)) : DEFAULT_LIST_LIMIT;
};

const getLayoutMode = (containerWidth, viewportWidth = containerWidth) => {
    const width = Math.min(Number(containerWidth) || Number(viewportWidth) || 0, Number(viewportWidth) || Infinity);
    if (width < 600) return 'narrow';
    if (width < 850) return 'compact';
    if (width < 1180) return 'condensed';
    return 'wide';
};

const getNextTabId = (ids, currentId, key) => {
    if (!Array.isArray(ids) || !ids.length) return currentId;
    const currentIndex = Math.max(0, ids.indexOf(currentId));
    if (key === 'Home') return ids[0];
    if (key === 'End') return ids[ids.length - 1];
    if (key === 'ArrowRight' || key === 'ArrowDown') return ids[(currentIndex + 1) % ids.length];
    if (key === 'ArrowLeft' || key === 'ArrowUp') return ids[(currentIndex - 1 + ids.length) % ids.length];
    return currentId;
};

const getVisibleItems = (items, limit) => {
    const source = Array.isArray(items) ? items : [];
    const safeLimit = clampListLimit(limit);
    return {
        hiddenCount: Math.max(0, source.length - safeLimit),
        items: source.slice(0, safeLimit),
        totalCount: source.length
    };
};

const normalizeUiState = value => {
    const source = value && typeof value === 'object' ? value : {};
    return {
        activeBottomPanel: PANEL_IDS.includes(source.activeBottomPanel) ? source.activeBottomPanel : 'problems',
        bottomPanelCollapsed: Boolean(source.bottomPanelCollapsed),
        sidebarPanel: SIDEBAR_PANEL_IDS.includes(source.sidebarPanel) ? source.sidebarPanel : 'explorer',
        sidebarVisible: source.sidebarVisible !== false,
        viewMode: VIEW_IDS.includes(source.viewMode) ? source.viewMode : 'code'
    };
};

module.exports = {
    DEFAULT_LIST_LIMIT,
    PANEL_IDS,
    SIDEBAR_PANEL_IDS,
    VIEW_IDS,
    clampListLimit,
    getLayoutMode,
    getNextTabId,
    getVisibleItems,
    normalizeUiState
};
