// Live Captions Saver - Background Capture Visibility Shim
//
// Runs in the page's MAIN world (injected via <script> by content_script.js).
//
// Problem: meeting apps (notably Teams) stop rendering new captions into the
// DOM when the browser tab is hidden, and flush them all in when the tab is
// focused again. The extension's MutationObserver is not throttled, so the
// missing captions are caused by the app deferring its own rendering.
//
// Fix: while capture is active, make the app believe the tab is visible and
// focused. This shim:
//   1. Overrides document.hidden / document.visibilityState / document.hasFocus()
//   2. Swallows trusted visibilitychange and window blur events before the
//      app's listeners see them
//   3. Falls back to a timer for requestAnimationFrame while the tab is really
//      hidden (Chrome pauses rAF entirely in hidden tabs), and migrates any
//      frames that were pending at the moment the tab went hidden
//
// It does nothing until activated by the content script via postMessage:
//   window.postMessage({ type: 'LCS_VISIBILITY_SHIM', active: true|false }, origin)
//
// Everything is restored to native behaviour when deactivated.
(function () {
    'use strict';

    if (window.__lcsVisibilityShim) return;

    const LOG_PREFIX = '[Caption Saver] Background capture shim:';
    const MESSAGE_TYPE = 'LCS_VISIBILITY_SHIM';
    const FALLBACK_FRAME_MS = 100; // ~10fps is plenty for caption rendering
    const FAKE_ID_BASE = 1e12;     // Keeps fallback frame ids clear of native ids

    const state = { active: false };
    window.__lcsVisibilityShim = state;

    // --- Native references -------------------------------------------------
    const docProto = Document.prototype;
    const hiddenDesc = Object.getOwnPropertyDescriptor(docProto, 'hidden');
    const visibilityDesc = Object.getOwnPropertyDescriptor(docProto, 'visibilityState');
    const nativeHasFocus = docProto.hasFocus;
    const nativeRAF = window.requestAnimationFrame;
    const nativeCAF = window.cancelAnimationFrame;

    if (!hiddenDesc || !visibilityDesc || !nativeRAF) {
        console.warn(LOG_PREFIX, 'unsupported browser, shim not installed');
        return;
    }

    function reallyHidden() {
        return hiddenDesc.get.call(document);
    }

    // --- Visibility / focus spoofing ----------------------------------------
    Object.defineProperty(docProto, 'hidden', {
        configurable: true,
        enumerable: hiddenDesc.enumerable,
        get() {
            return state.active ? false : hiddenDesc.get.call(this);
        }
    });

    Object.defineProperty(docProto, 'visibilityState', {
        configurable: true,
        enumerable: visibilityDesc.enumerable,
        get() {
            return state.active ? 'visible' : visibilityDesc.get.call(this);
        }
    });

    docProto.hasFocus = function () {
        return state.active ? true : nativeHasFocus.call(this);
    };

    // --- requestAnimationFrame fallback -------------------------------------
    // frames: public id -> { cb, nativeId?, timer? }. A frame is either queued
    // natively (nativeId) or on a timer (timer). Tracking both lets a frame be
    // moved between the two paths without changing the id the caller holds.
    const frames = new Map();
    let nextFakeId = FAKE_ID_BASE;

    function scheduleFallback(id, cb) {
        const timer = setTimeout(() => {
            frames.delete(id);
            try {
                cb(performance.now());
            } catch (e) {
                // Rethrow asynchronously so one bad callback doesn't break the loop
                setTimeout(() => { throw e; }, 0);
            }
        }, FALLBACK_FRAME_MS);
        frames.set(id, { cb, timer });
    }

    function scheduleNative(id, cb) {
        const nativeId = nativeRAF.call(window, function (ts) {
            frames.delete(id);
            cb(ts);
        });
        frames.set(id, { cb, nativeId });
        return nativeId;
    }

    window.requestAnimationFrame = function (cb) {
        if (typeof cb !== 'function') {
            return nativeRAF.call(window, cb); // Let native throw the proper TypeError
        }
        const id = nextFakeId++;
        if (state.active && reallyHidden()) {
            scheduleFallback(id, cb);
        } else {
            scheduleNative(id, cb);
        }
        return id;
    };

    window.cancelAnimationFrame = function (id) {
        const entry = frames.get(id);
        if (!entry) {
            nativeCAF.call(window, id); // Id we never issued; let native handle it
            return;
        }
        frames.delete(id);
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        if (entry.nativeId !== undefined) nativeCAF.call(window, entry.nativeId);
    };

    // When the tab actually goes hidden, native frames that are already queued
    // will not fire until it is visible again. Move them onto the timer path.
    function migratePendingNativeFrames() {
        let moved = 0;
        for (const [id, entry] of frames) {
            if (entry.nativeId === undefined) continue;
            nativeCAF.call(window, entry.nativeId);
            scheduleFallback(id, entry.cb);
            moved++;
        }
        if (moved) console.log(LOG_PREFIX, `migrated ${moved} pending animation frame(s) to timer`);
    }

    // Reverse of the above, used on deactivation: hand timer frames back to
    // native scheduling so the app's render loop keeps its callbacks.
    function restoreFallbackFrames() {
        for (const [id, entry] of frames) {
            if (entry.timer === undefined) continue;
            clearTimeout(entry.timer);
            scheduleNative(id, entry.cb);
        }
    }

    // --- Event suppression ---------------------------------------------------
    // visibilitychange fires on document and bubbles to window. A capture-phase
    // listener on window runs before every document listener and every bubble
    // listener, so stopImmediatePropagation hides the event from the app.
    // (The extension's own content script registers its listener at the same
    // point but earlier, so it still sees the event.)
    window.addEventListener('visibilitychange', (e) => {
        if (!state.active || !e.isTrusted) return;
        if (reallyHidden()) migratePendingNativeFrames();
        e.stopImmediatePropagation();
    }, true);

    window.addEventListener('blur', (e) => {
        // Only the window-level blur (tab lost focus); element blurs must pass
        if (!state.active || !e.isTrusted || e.target !== window) return;
        e.stopImmediatePropagation();
    }, true);

    // --- Activation ------------------------------------------------------------
    function setActive(active) {
        active = !!active;
        if (active === state.active) return;
        state.active = active;

        if (active) {
            if (reallyHidden()) {
                // The app currently believes it is hidden; nudge it to re-read
                // document.hidden (now false) and resume rendering.
                migratePendingNativeFrames();
                document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
            }
            console.log(LOG_PREFIX, 'ACTIVE (tab will appear visible to the page)');
        } else {
            restoreFallbackFrames();
            if (reallyHidden()) {
                // Let the app learn the real state now that we stopped lying
                document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
            }
            console.log(LOG_PREFIX, 'inactive');
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== MESSAGE_TYPE) return;
        setActive(data.active);
    });

    console.log(LOG_PREFIX, 'installed (idle)');
})();
