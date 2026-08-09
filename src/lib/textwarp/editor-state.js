'use strict';

const EDITOR_STATES = Object.freeze(['clean', 'dirty', 'compiling', 'error', 'ready', 'running']);

const createEditorStatus = () => ({
    state: 'clean',
    sourceVersion: 0,
    buildVersion: null,
    runtimeVersion: null
});

const transitionEditorStatus = (status, event, version = null) => {
    const next = Object.assign({}, status);
    switch (event) {
    case 'edit':
        next.sourceVersion = Number.isInteger(version) ? version : next.sourceVersion + 1;
        next.state = 'dirty';
        break;
    case 'compile':
        next.state = 'compiling';
        break;
    case 'compile-error':
        next.state = 'error';
        break;
    case 'compile-success':
        next.buildVersion = Number.isInteger(version) ? version : next.sourceVersion;
        next.state = 'ready';
        break;
    case 'run':
        if (next.buildVersion !== next.sourceVersion) throw new Error('The current source must be compiled before Run.');
        next.runtimeVersion = next.buildVersion;
        next.state = 'running';
        break;
    case 'stop':
        next.state = next.buildVersion === next.sourceVersion ? 'ready' : 'dirty';
        break;
    case 'save':
        if (next.state === 'dirty' && next.buildVersion === next.sourceVersion) next.state = 'clean';
        break;
    default:
        throw new Error(`Unknown editor state event: ${event}.`);
    }
    return next;
};

module.exports = {EDITOR_STATES, createEditorStatus, transitionEditorStatus};
