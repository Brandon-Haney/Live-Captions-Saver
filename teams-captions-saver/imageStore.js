// Live Captions Saver - Image Store
//
// IndexedDB-backed store for images captured during a meeting: shared-content
// slides and chat attachments. Loaded by the service worker (importScripts) and
// by extension pages such as the viewer (<script>). Both run in the extension
// origin, so they share the same database.
//
// Transcript entries stay small: they carry an `imageId`, and the pixels live
// here. Sessions can hold many megabytes of images, which would never fit the
// chunked chrome.storage.local session store.
//
// Record shape:
//   { id, sessionId, kind: 'slide' | 'attachment', dataUrl, hash, width, height, bytes, createdAt }
(function (root) {
    'use strict';

    const DB_NAME = 'LiveCaptionsSaverImages';
    const DB_VERSION = 1;
    const STORE = 'images';

    let dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            let request;
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION);
            } catch (e) {
                dbPromise = null;
                reject(e);
                return;
            }
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const store = db.createObjectStore(STORE, { keyPath: 'id' });
                    store.createIndex('sessionId', 'sessionId', { unique: false });
                    store.createIndex('sessionHash', ['sessionId', 'hash'], { unique: false });
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => { db.close(); dbPromise = null; };
                db.onclose = () => { dbPromise = null; };
                resolve(db);
            };
            request.onerror = () => { dbPromise = null; reject(request.error); };
            request.onblocked = () => { dbPromise = null; reject(new Error('ImageStore open blocked')); };
        });
        return dbPromise;
    }

    const requestToPromise = (req) => new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    const transactionDone = (tx) => new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
    });

    function estimateBytes(dataUrl) {
        if (!dataUrl) return 0;
        const comma = dataUrl.indexOf(',');
        return Math.round((dataUrl.length - (comma + 1)) * 0.75);
    }

    /** Insert or replace one image record. Returns the id. */
    async function put(record) {
        if (!record || !record.id || !record.dataUrl) throw new Error('ImageStore.put: id and dataUrl are required');
        const full = {
            kind: 'slide',
            hash: null,
            width: 0,
            height: 0,
            createdAt: Date.now(),
            ...record,
            bytes: record.bytes || estimateBytes(record.dataUrl)
        };
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(full);
        await transactionDone(tx);
        return full.id;
    }

    /** One record or undefined. */
    async function get(id) {
        if (!id) return undefined;
        const db = await openDb();
        return requestToPromise(db.transaction(STORE).objectStore(STORE).get(id));
    }

    /** Map of id -> record for every id that exists. Missing ids are simply absent. */
    async function getMany(ids) {
        const unique = [...new Set((ids || []).filter(Boolean))];
        if (unique.length === 0) return {};
        const db = await openDb();
        const store = db.transaction(STORE).objectStore(STORE);
        const out = {};
        await Promise.all(unique.map(async (id) => {
            const rec = await requestToPromise(store.get(id));
            if (rec) out[id] = rec;
        }));
        return out;
    }

    /** Map of id -> dataUrl for the given ids. Convenience for renderers. */
    async function getDataUrls(ids) {
        const records = await getMany(ids);
        const out = {};
        for (const id of Object.keys(records)) out[id] = records[id].dataUrl;
        return out;
    }

    /** All records for a session (includes pixels; use for exports). */
    async function listBySession(sessionId) {
        if (!sessionId) return [];
        const db = await openDb();
        return requestToPromise(db.transaction(STORE).objectStore(STORE).index('sessionId').getAll(sessionId));
    }

    /** Find an image already stored for this session with an identical hash. */
    async function findByHash(sessionId, hash) {
        if (!sessionId || !hash) return undefined;
        const db = await openDb();
        return requestToPromise(db.transaction(STORE).objectStore(STORE).index('sessionHash').get([sessionId, hash]));
    }

    /** Byte total and count for one session, without loading pixels into memory at once. */
    async function sessionUsage(sessionId) {
        const usage = { count: 0, bytes: 0 };
        if (!sessionId) return usage;
        const db = await openDb();
        const index = db.transaction(STORE).objectStore(STORE).index('sessionId');
        await new Promise((resolve, reject) => {
            const cursorReq = index.openCursor(sessionId);
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) { resolve(); return; }
                usage.count++;
                usage.bytes += cursor.value.bytes || 0;
                cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error);
        });
        return usage;
    }

    /**
     * Byte total and count per session in one pass, plus the overall total.
     * Returns { total: { count, bytes }, bySession: { [sessionId]: { count, bytes } } }.
     */
    async function usageBySession() {
        const result = { total: { count: 0, bytes: 0 }, bySession: {} };
        const db = await openDb();
        const store = db.transaction(STORE).objectStore(STORE);
        await new Promise((resolve, reject) => {
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) { resolve(); return; }
                const rec = cursor.value;
                const bytes = rec.bytes || 0;
                const key = rec.sessionId || 'unknown';
                if (!result.bySession[key]) result.bySession[key] = { count: 0, bytes: 0 };
                result.bySession[key].count++;
                result.bySession[key].bytes += bytes;
                result.total.count++;
                result.total.bytes += bytes;
                cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error);
        });
        return result;
    }

    /** Delete one image. */
    async function remove(id) {
        if (!id) return;
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        await transactionDone(tx);
    }

    /** Delete every image belonging to a session. Returns the number removed. */
    async function deleteBySession(sessionId) {
        if (!sessionId) return 0;
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite');
        const index = tx.objectStore(STORE).index('sessionId');
        let removed = 0;
        await new Promise((resolve, reject) => {
            const cursorReq = index.openKeyCursor(sessionId);
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) { resolve(); return; }
                tx.objectStore(STORE).delete(cursor.primaryKey);
                removed++;
                cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error);
        });
        await transactionDone(tx);
        return removed;
    }

    /** Remove images whose session is no longer known. Returns the number removed. */
    async function pruneOrphans(knownSessionIds) {
        const keep = new Set(knownSessionIds || []);
        const db = await openDb();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        let removed = 0;
        await new Promise((resolve, reject) => {
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) { resolve(); return; }
                if (!keep.has(cursor.value.sessionId)) {
                    cursor.delete();
                    removed++;
                }
                cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error);
        });
        await transactionDone(tx);
        return removed;
    }

    /** Overall storage estimate for the extension origin, when the API is available. */
    async function storageEstimate() {
        try {
            if (root.navigator && root.navigator.storage && root.navigator.storage.estimate) {
                return await root.navigator.storage.estimate();
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    root.ImageStore = {
        put,
        get,
        getMany,
        getDataUrls,
        listBySession,
        findByHash,
        sessionUsage,
        usageBySession,
        remove,
        deleteBySession,
        pruneOrphans,
        storageEstimate,
        estimateBytes
    };
})(typeof self !== 'undefined' ? self : globalThis);
