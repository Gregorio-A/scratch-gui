'use strict';

class CompilationManager {
    constructor (compiler) {
        if (typeof compiler !== 'function') throw new Error('CompilationManager requires a compiler function.');
        this.compiler = compiler;
        this.latestGeneration = 0;
        this.currentController = null;
    }

    cancel () {
        this.latestGeneration++;
        if (this.currentController) this.currentController.abort();
        this.currentController = null;
    }

    async compile (snapshot, optionsForDocument = () => ({})) {
        if (!snapshot || !Array.isArray(snapshot.files)) throw new Error('A complete project snapshot is required.');
        if (this.currentController) this.currentController.abort();
        const controller = typeof AbortController === 'undefined' ? {signal: {aborted: false}, abort () {
            this.signal.aborted = true;
        }} : new AbortController();
        const generation = ++this.latestGeneration;
        this.currentController = controller;
        const documents = await Promise.all(snapshot.files.map(async file => {
            if (controller.signal.aborted) return null;
            const options = Object.assign({}, optionsForDocument(file), {
                codeLanguage: file.sourceLanguage,
                signal: controller.signal
            });
            const compilation = await this.compiler(file.content, options);
            return {file, compilation};
        }));
        if (
            controller.signal.aborted ||
            generation !== this.latestGeneration ||
            documents.some(document => !document)
        ) return null;
        if (this.currentController === controller) this.currentController = null;
        const diagnostics = documents.flatMap(document => document.compilation.diagnostics.map(diagnostic =>
            Object.assign({documentId: document.file.id}, diagnostic)
        ));
        return Object.freeze({
            generation,
            snapshot,
            snapshotVersion: snapshot.version,
            documents,
            diagnostics,
            success: documents.every(document => document.compilation.success)
        });
    }
}

module.exports = {CompilationManager};
