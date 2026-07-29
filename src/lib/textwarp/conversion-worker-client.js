'use strict';

const {compileText} = require('./compiler');
const {decompileTarget} = require('./decompiler');

const serializableTarget = target => ({
    id: target.id,
    isStage: Boolean(target.isStage),
    name: target.getName ? target.getName() : target.sprite && target.sprite.name || 'Actor',
    sprite: target.sprite ? {name: target.sprite.name} : null,
    variables: target.variables || {},
    comments: target.comments || {},
    blocks: target.blocks && target.blocks._blocks || {}
});

class ConversionWorkerClient {
    constructor () {
        this.nextId = 1;
        this.pending = new Map();
        this.worker = null;
    }

    ensureWorker () {
        if (this.worker || typeof Worker === 'undefined') return this.worker;
        const root = process.env.ROOT || '/';
        this.worker = new Worker(`${root}js/textwarp-conversion-worker.js`);
        this.worker.onmessage = event => {
            const response = event.data || {};
            const pending = this.pending.get(response.id);
            if (!pending) return;
            this.pending.delete(response.id);
            if (response.error) pending.reject(new Error(response.error));
            else pending.resolve(response.result);
        };
        this.worker.onerror = error => {
            this.pending.forEach(pending => pending.reject(error));
            this.pending.clear();
            this.worker.terminate();
            this.worker = null;
        };
        return this.worker;
    }

    request (payload, fallback) {
        let worker;
        try {
            worker = this.ensureWorker();
        } catch (error) {
            return Promise.resolve().then(fallback);
        }
        if (!worker) return Promise.resolve().then(fallback);
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, {resolve, reject});
            try {
                worker.postMessage(Object.assign({id}, payload));
            } catch (error) {
                this.pending.delete(id);
                Promise.resolve().then(fallback).then(resolve, reject);
            }
        });
    }

    compile (source, options) {
        return this.request(
            {operation: 'compile', source, options},
            () => compileText(source, options)
        );
    }

    decompile (target, options) {
        const snapshot = serializableTarget(target);
        const normalizedOptions = Object.assign({}, options);
        if (normalizedOptions.stageTarget) {
            normalizedOptions.stageTarget = serializableTarget(normalizedOptions.stageTarget);
        }
        return this.request(
            {operation: 'decompile', target: snapshot, options: normalizedOptions},
            () => decompileTarget(target, options)
        );
    }

    cancelPending () {
        this.pending.forEach(pending => pending.reject(new Error('Conversão cancelada.')));
        this.pending.clear();
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
        }
    }
}

module.exports = {
    ConversionWorkerClient,
    serializableTarget
};
