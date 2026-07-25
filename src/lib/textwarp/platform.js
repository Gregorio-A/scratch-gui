import downloadBlob from '../download-blob';

let platform = {};

const createDownloadHandle = (suggestedName, mimeType = 'application/octet-stream') => {
    const name = suggestedName || 'project.textwarp';
    return {
        name,
        createWritable () {
            let chunks = [];
            return Promise.resolve({
                write (value) {
                    chunks.push(value);
                    return Promise.resolve();
                },
                close () {
                    downloadBlob(name, new Blob(chunks, {type: mimeType}));
                    chunks = [];
                    return Promise.resolve();
                },
                abort () {
                    chunks = [];
                    return Promise.resolve();
                }
            });
        }
    };
};

const defaultShowSaveFilePicker = options => {
    if (
        typeof window !== 'undefined' &&
        typeof window.showSaveFilePicker === 'function' &&
        !(navigator.userAgent || '').includes('Android')
    ) {
        return window.showSaveFilePicker(options);
    }
    const accept = options && options.types && options.types[0] && options.types[0].accept;
    const mimeType = (accept && Object.keys(accept)[0]) || 'application/octet-stream';
    return Promise.resolve(createDownloadHandle(options && options.suggestedName, mimeType));
};

const defaultShowOpenFilePicker = options => {
    if (typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function') {
        return window.showOpenFilePicker(options);
    }
    const error = new Error('File System Access API is unavailable.');
    error.name = 'NotSupportedError';
    return Promise.reject(error);
};

const configureTextwarpPlatform = nextPlatform => {
    platform = Object.assign({}, platform, nextPlatform || {});
};

const resetTextwarpPlatform = () => {
    platform = {};
};

const showTextwarpSaveFilePicker = options => (
    platform.showSaveFilePicker ? platform.showSaveFilePicker(options) : defaultShowSaveFilePicker(options)
);

const showTextwarpOpenFilePicker = options => (
    platform.showOpenFilePicker ? platform.showOpenFilePicker(options) : defaultShowOpenFilePicker(options)
);

const notifyTextwarpFileOpened = handle => {
    if (platform.onFileOpened) platform.onFileOpened(handle);
};

export {
    configureTextwarpPlatform,
    notifyTextwarpFileOpened,
    resetTextwarpPlatform,
    showTextwarpOpenFilePicker,
    showTextwarpSaveFilePicker
};
