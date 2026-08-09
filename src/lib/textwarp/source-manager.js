'use strict';

const {DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage} = require('./language-registry');

const freezeSnapshot = snapshot => {
    snapshot.files.forEach(file => {
        Object.freeze(file.metadata);
        Object.freeze(file);
    });
    Object.freeze(snapshot.files);
    return Object.freeze(snapshot);
};

class SourceManager {
    constructor (documents = []) {
        this.documents = new Map();
        this.projectVersion = 0;
        this.activeDocumentId = null;
        documents.forEach(document => this.openDocument(document));
    }

    openDocument (document) {
        if (!document || !document.id) throw new Error('SourceDocument requires a stable id.');
        const current = this.documents.get(document.id);
        const content = String(document.content || '');
        const sourceLanguage = normalizeCodeLanguage(document.sourceLanguage ||
            current && current.sourceLanguage || DEFAULT_CODE_LANGUAGE);
        if (current && current.content === content && current.sourceLanguage === sourceLanguage) return current;
        const next = {
            id: document.id,
            content,
            sourceLanguage,
            version: current ? current.version + 1 : 1,
            dirty: typeof document.dirty === 'boolean' ? document.dirty : Boolean(current),
            metadata: Object.assign({}, current && current.metadata, document.metadata)
        };
        this.documents.set(next.id, next);
        this.projectVersion++;
        if (!this.activeDocumentId) this.activeDocumentId = next.id;
        return next;
    }

    updateDocument (id, content) {
        const current = this.documents.get(id);
        if (!current) throw new Error(`Unknown SourceDocument: ${id}.`);
        if (current.content === content) return current;
        return this.openDocument(Object.assign({}, current, {content, dirty: true}));
    }

    setSourceLanguage (id, sourceLanguage, content) {
        const current = this.documents.get(id);
        if (!current) throw new Error(`Unknown SourceDocument: ${id}.`);
        return this.openDocument(Object.assign({}, current, {
            content: typeof content === 'string' ? content : current.content,
            dirty: true,
            sourceLanguage
        }));
    }

    setActiveDocument (id) {
        if (!this.documents.has(id)) throw new Error(`Unknown SourceDocument: ${id}.`);
        this.activeDocumentId = id;
    }

    closeDocument (id) {
        if (!this.documents.delete(id)) return false;
        this.projectVersion++;
        if (this.activeDocumentId === id) {
            this.activeDocumentId = this.documents.keys().next().value || null;
        }
        return true;
    }

    retainDocuments (ids) {
        const retained = new Set(ids || []);
        Array.from(this.documents.keys()).forEach(id => {
            if (!retained.has(id)) this.closeDocument(id);
        });
    }

    getDocument (id) {
        const document = this.documents.get(id);
        return document ? Object.assign({}, document, {metadata: Object.assign({}, document.metadata)}) : null;
    }

    createSnapshot () {
        return freezeSnapshot({
            version: this.projectVersion,
            activeDocumentId: this.activeDocumentId,
            files: Array.from(this.documents.values()).map(document => ({
                id: document.id,
                content: document.content,
                version: document.version,
                dirty: document.dirty,
                sourceLanguage: document.sourceLanguage,
                metadata: Object.assign({}, document.metadata)
            }))
        });
    }

    isCurrent (snapshot) {
        return Boolean(snapshot && snapshot.version === this.projectVersion && snapshot.files.every(file => {
            const current = this.documents.get(file.id);
            return current && current.version === file.version;
        }));
    }

    markCommitted (snapshot) {
        if (!this.isCurrent(snapshot)) return false;
        snapshot.files.forEach(file => {
            const current = this.documents.get(file.id);
            this.documents.set(file.id, Object.assign({}, current, {dirty: false}));
        });
        return true;
    }
}

module.exports = {SourceManager};
