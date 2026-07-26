'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    DEFAULT_LIST_LIMIT,
    getLayoutMode,
    getNextTabId,
    getVisibleItems,
    normalizeUiState
} = require('../../src/lib/textwarp/interface-state');

test('responsive layout uses the measured editor width instead of only the viewport', () => {
    assert.equal(getLayoutMode(1440, 1440), 'wide');
    assert.equal(getLayoutMode(1024, 1440), 'condensed');
    assert.equal(getLayoutMode(768, 1440), 'compact');
    assert.equal(getLayoutMode(600, 1440), 'compact');
    assert.equal(getLayoutMode(320, 1440), 'narrow');
    assert.equal(getLayoutMode(1200, 600), 'compact');
});

test('tab navigation wraps and supports Home and End', () => {
    const tabs = ['code', 'blocks', 'split'];
    assert.equal(getNextTabId(tabs, 'code', 'ArrowLeft'), 'split');
    assert.equal(getNextTabId(tabs, 'split', 'ArrowRight'), 'code');
    assert.equal(getNextTabId(tabs, 'blocks', 'Home'), 'code');
    assert.equal(getNextTabId(tabs, 'blocks', 'End'), 'split');
    assert.equal(getNextTabId(tabs, 'blocks', 'Enter'), 'blocks');
});

test('large interface lists are paged and report hidden entries', () => {
    const items = Array.from({length: 250}, (_, index) => ({index}));
    const firstPage = getVisibleItems(items, DEFAULT_LIST_LIMIT);
    const secondPage = getVisibleItems(items, DEFAULT_LIST_LIMIT * 2);

    assert.equal(firstPage.items.length, 100);
    assert.equal(firstPage.hiddenCount, 150);
    assert.equal(firstPage.totalCount, 250);
    assert.equal(secondPage.items.length, 200);
    assert.equal(secondPage.hiddenCount, 50);
});

test('persisted interface state accepts only known views and panels', () => {
    assert.deepEqual(normalizeUiState({
        activeBottomPanel: 'console',
        bottomPanelCollapsed: true,
        sidebarPanel: 'history',
        sidebarVisible: false,
        viewMode: 'dual'
    }), {
        activeBottomPanel: 'console',
        bottomPanelCollapsed: true,
        sidebarPanel: 'history',
        sidebarVisible: false,
        viewMode: 'dual'
    });

    assert.deepEqual(normalizeUiState({
        activeBottomPanel: 'unknown',
        sidebarPanel: 'unknown',
        viewMode: 'unknown'
    }), {
        activeBottomPanel: 'problems',
        bottomPanelCollapsed: false,
        sidebarPanel: 'explorer',
        sidebarVisible: true,
        viewMode: 'code'
    });
});
