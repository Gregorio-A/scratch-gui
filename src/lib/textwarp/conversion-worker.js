'use strict';

const {compileText} = require('./compiler');
const {decompileTarget} = require('./decompiler');

const restoreTarget = snapshot => Object.assign({}, snapshot, {
    getName: () => snapshot.name,
    blocks: {
        _blocks: snapshot.blocks,
        getBlock: id => snapshot.blocks[id]
    }
});

self.onmessage = event => {
    const request = event.data || {};
    try {
        const result = request.operation === 'decompile' ?
            decompileTarget(restoreTarget(request.target), request.options) :
            compileText(request.source, request.options);
        self.postMessage({id: request.id, result});
    } catch (error) {
        self.postMessage({
            id: request.id,
            error: error && error.message ? error.message : String(error)
        });
    }
};
