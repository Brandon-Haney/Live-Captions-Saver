// Shared keyword matching engine used by both viewer.js and content_script.js
// Exposes pure, stateless functions on window.KeywordEngine
(function () {
    'use strict';

    const DEFAULT_SETTINGS = {
        enabled: true,
        flashEnabled: true,
        contextLineCount: 5,
        consolidationWindowMs: 5000,
        toastEnabled: true,
        toastDismissSeconds: 45,
        overlayEnabled: true
    };

    /**
     * Merge enabled keywords from global and session maps into a flat array.
     * @param {Object} globalKeywords - from chrome.storage.sync (hotKeywords)
     * @param {Object} [sessionKeywords={}] - in-memory session keywords
     * @returns {Array<{id: string, keyword: string, isSession: boolean}>}
     */
    function getActiveKeywords(globalKeywords, sessionKeywords) {
        const active = [];

        if (globalKeywords) {
            for (const [id, data] of Object.entries(globalKeywords)) {
                if (data.enabled) {
                    active.push({ id, keyword: data.keyword, isSession: false });
                }
            }
        }

        if (sessionKeywords) {
            for (const [id, data] of Object.entries(sessionKeywords)) {
                if (data.enabled) {
                    active.push({ id, keyword: data.keyword, isSession: true });
                }
            }
        }

        return active;
    }

    /**
     * Case-insensitive substring match on caption.Text only (not speaker name).
     * @param {Object} caption - object with at least { Text: string }
     * @param {Array<{id: string, keyword: string, isSession: boolean}>} activeKeywords
     * @returns {{id: string, keyword: string, isSession: boolean}|null} first match or null
     */
    function checkForMatch(caption, activeKeywords) {
        const text = (caption.Text || '').toLowerCase();
        if (!text) return null;

        for (const entry of activeKeywords) {
            const keywordLower = entry.keyword.toLowerCase();
            if (text.includes(keywordLower)) {
                return entry;
            }
        }

        return null;
    }

    /**
     * Dedup check using caller-owned state map.
     * Returns true to suppress (consolidate), false to fire (and updates lastAlerts).
     * @param {string} keywordId
     * @param {Object} lastAlerts - caller-owned map: keywordId -> timestamp
     * @param {number} windowMs - consolidation window in milliseconds
     * @returns {boolean} true = suppress, false = fire alert
     */
    function shouldConsolidate(keywordId, lastAlerts, windowMs) {
        const now = Date.now();
        const lastAlert = lastAlerts[keywordId];
        const timeSinceLastAlert = lastAlert ? (now - lastAlert) : Infinity;

        if (lastAlert && timeSinceLastAlert < windowMs) {
            return true;
        }

        lastAlerts[keywordId] = now;
        return false;
    }

    /**
     * Async helper to read hotKeywords + hotKeywordSettings from chrome.storage.sync.
     * @returns {Promise<{keywords: Object, settings: Object}>}
     */
    async function loadFromStorage() {
        const result = await chrome.storage.sync.get(['hotKeywords', 'hotKeywordSettings']);
        const keywords = result.hotKeywords || {};
        const settings = { ...DEFAULT_SETTINGS };
        if (result.hotKeywordSettings) {
            Object.assign(settings, result.hotKeywordSettings);
        }
        return { keywords, settings };
    }

    window.KeywordEngine = {
        DEFAULT_SETTINGS,
        getActiveKeywords,
        checkForMatch,
        shouldConsolidate,
        loadFromStorage
    };
})();
