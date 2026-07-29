'use strict';

const HISTORY_DATABASE_NAME = 'textwarp-ide-history';
const HISTORY_DATABASE_VERSION = 1;
const HISTORY_STORE_NAME = 'histories';
const HISTORY_TARGET_BYTE_LIMIT = 1024 * 1024;
const HISTORY_GLOBAL_BYTE_LIMIT = 16 * 1024 * 1024;
const HISTORY_CHECKPOINT_INTERVAL = 10;
const COMPACT_SUFFIX = '.compact';

const memoryHistory = new Map();
const persistenceByHistory = new WeakMap();
let databasePromise = null;

const storageAvailable = storage => storage &&
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function';

const commonPrefixLength = (left, right) => {
    const limit = Math.min(left.length, right.length);
    let index = 0;
    while (index < limit && left[index] === right[index]) index++;
    return index;
};

const commonSuffixLength = (left, right, prefixLength) => {
    const limit = Math.min(left.length, right.length) - prefixLength;
    let length = 0;
    while (
        length < limit &&
        left[left.length - length - 1] === right[right.length - length - 1]
    ) length++;
    return length;
};

const encodeHistory = history => {
    const chronological = Array.from(history || []).slice().reverse();
    let previousSource = '';
    return chronological.map((entry, index) => {
        const source = String(entry.source || '');
        if (index === 0 || index % HISTORY_CHECKPOINT_INTERVAL === 0) {
            previousSource = source;
            return {
                full: source,
                reason: entry.reason,
                timestamp: entry.timestamp
            };
        }
        const prefix = commonPrefixLength(previousSource, source);
        const suffix = commonSuffixLength(previousSource, source, prefix);
        const encoded = {
            insert: source.slice(prefix, source.length - suffix),
            prefix,
            reason: entry.reason,
            suffix,
            timestamp: entry.timestamp
        };
        previousSource = source;
        return encoded;
    });
};

const decodeHistory = encoded => {
    let previousSource = '';
    const chronological = Array.from(encoded || []).map((entry, index) => {
        const source = typeof entry.full === 'string' ?
            entry.full :
            `${previousSource.slice(0, entry.prefix || 0)}${entry.insert || ''}${
                entry.suffix ? previousSource.slice(previousSource.length - entry.suffix) : ''
            }`;
        previousSource = source;
        return {
            reason: entry.reason,
            source,
            timestamp: entry.timestamp
        };
    });
    return chronological.reverse();
};

const encodedBytes = encoded => JSON.stringify(encoded).length * 2;

const fitHistoryToBudget = history => {
    let fitted = Array.from(history || []);
    let encoded = encodeHistory(fitted);
    while (fitted.length > 1 && encodedBytes(encoded) > HISTORY_TARGET_BYTE_LIMIT) {
        fitted = fitted.slice(0, -1);
        encoded = encodeHistory(fitted);
    }
    return {bytes: encodedBytes(encoded), encoded, history: fitted};
};

const indexedDbFactory = () => typeof globalThis !== 'undefined' ? globalThis.indexedDB : null;

const requestResult = request => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
});

const transactionComplete = transaction => new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
});

const openDatabase = () => {
    const factory = indexedDbFactory();
    if (!factory) return Promise.resolve(null);
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
        const request = factory.open(HISTORY_DATABASE_NAME, HISTORY_DATABASE_VERSION);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(HISTORY_STORE_NAME)) {
                const store = database.createObjectStore(HISTORY_STORE_NAME, {keyPath: 'key'});
                store.createIndex('updatedAt', 'updatedAt');
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            databasePromise = null;
            reject(request.error || new Error('Could not open TextWarp history storage.'));
        };
    });
    return databasePromise;
};

const enforceGlobalBudget = async database => {
    const readTransaction = database.transaction(HISTORY_STORE_NAME, 'readonly');
    const readComplete = transactionComplete(readTransaction);
    const records = await requestResult(readTransaction.objectStore(HISTORY_STORE_NAME).getAll());
    await readComplete;
    let total = records.reduce((sum, record) => sum + (record.bytes || 0), 0);
    if (total <= HISTORY_GLOBAL_BYTE_LIMIT) return;
    const transaction = database.transaction(HISTORY_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(HISTORY_STORE_NAME);
    records.sort((left, right) => left.updatedAt - right.updatedAt).forEach(record => {
        if (total <= HISTORY_GLOBAL_BYTE_LIMIT) return;
        store.delete(record.key);
        memoryHistory.delete(record.key);
        total -= record.bytes || 0;
    });
    await transactionComplete(transaction);
};

const readFallback = (storage, key) => {
    if (!storageAvailable(storage)) return [];
    try {
        const compact = JSON.parse(storage.getItem(`${key}${COMPACT_SUFFIX}`));
        if (Array.isArray(compact)) return decodeHistory(compact);
        const legacy = JSON.parse(storage.getItem(key));
        return Array.isArray(legacy) ? legacy : [];
    } catch (error) {
        return [];
    }
};

const persistFallback = (storage, key, encoded) => {
    if (!storageAvailable(storage)) return;
    storage.setItem(`${key}${COMPACT_SUFFIX}`, JSON.stringify(encoded));
    if (typeof storage.removeItem === 'function') storage.removeItem(key);
};

const persistHistory = async (storage, key, projectId, history) => {
    const fitted = fitHistoryToBudget(history);
    memoryHistory.set(key, fitted.history);
    let database;
    try {
        database = await openDatabase();
    } catch (error) {
        persistFallback(storage, key, fitted.encoded);
        return fitted.history;
    }
    if (!database) {
        persistFallback(storage, key, fitted.encoded);
        return fitted.history;
    }
    const transaction = database.transaction(HISTORY_STORE_NAME, 'readwrite');
    transaction.objectStore(HISTORY_STORE_NAME).put({
        bytes: fitted.bytes,
        entries: fitted.encoded,
        key,
        projectId,
        updatedAt: Date.now()
    });
    await transactionComplete(transaction);
    await enforceGlobalBudget(database);
    return fitted.history;
};

const loadHistory = (storage, key) => {
    if (memoryHistory.has(key)) return memoryHistory.get(key);
    const history = readFallback(storage, key);
    memoryHistory.set(key, history);
    return history;
};

const loadHistoryAsync = async (storage, key) => {
    let database;
    try {
        database = await openDatabase();
    } catch (error) {
        return loadHistory(storage, key);
    }
    if (!database) return loadHistory(storage, key);
    const transaction = database.transaction(HISTORY_STORE_NAME, 'readonly');
    const complete = transactionComplete(transaction);
    const record = await requestResult(transaction.objectStore(HISTORY_STORE_NAME).get(key));
    await complete;
    if (!record || !Array.isArray(record.entries)) return loadHistory(storage, key);
    const history = decodeHistory(record.entries);
    memoryHistory.set(key, history);
    return history;
};

const saveHistory = (storage, key, projectId, history) => {
    const snapshot = Array.from(history || []);
    memoryHistory.set(key, snapshot);
    const persistence = new Promise((resolve, reject) => {
        setTimeout(() => {
            persistHistory(storage, key, projectId, snapshot).then(resolve, reject);
        }, 0);
    });
    persistenceByHistory.set(snapshot, persistence);
    return snapshot;
};

const whenHistoryPersisted = history => persistenceByHistory.get(history) || Promise.resolve(history);

const resetHistoryStorageForTests = () => {
    memoryHistory.clear();
    databasePromise = null;
};

module.exports = {
    HISTORY_GLOBAL_BYTE_LIMIT,
    HISTORY_CHECKPOINT_INTERVAL,
    HISTORY_TARGET_BYTE_LIMIT,
    decodeHistory,
    encodeHistory,
    fitHistoryToBudget,
    loadHistory,
    loadHistoryAsync,
    resetHistoryStorageForTests,
    saveHistory,
    whenHistoryPersisted
};
