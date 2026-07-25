import GUI from './containers/gui.jsx';
import AppStateHOC from './lib/app-state-hoc.jsx';
import GuiReducer, {guiInitialState, guiMiddleware, initEmbedded, initFullScreen, initPlayer} from './reducers/gui';
import LocalesReducer, {localesInitialState, initLocale} from './reducers/locales';
import {ScratchPaintReducer} from 'scratch-paint';
import {setFullScreen, setPlayer} from './reducers/mode';
import {remixProject} from './reducers/project-state';
import {setAppElement} from 'react-modal';
import {importTextwarpProject} from './lib/textwarp/textwarp-package';
import {
    clearTextwarpHandle,
    getTextwarpHandle,
    setTextwarpHandle
} from './lib/textwarp/textwarp-session';
import {configureTextwarpPlatform} from './lib/textwarp/platform';

const guiReducers = {
    locales: LocalesReducer,
    scratchGui: GuiReducer,
    scratchPaint: ScratchPaintReducer
};

export {
    GUI as default,
    AppStateHOC,
    clearTextwarpHandle,
    configureTextwarpPlatform,
    getTextwarpHandle,
    importTextwarpProject,
    setAppElement,
    setTextwarpHandle,
    guiReducers,
    guiInitialState,
    guiMiddleware,
    initEmbedded,
    initPlayer,
    initFullScreen,
    initLocale,
    localesInitialState,
    remixProject,
    setFullScreen,
    setPlayer
};
