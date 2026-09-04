// Live Captions Saver - Shared Content (Slide) Capture
//
// Samples a drawable frame source on a timer and reports one snapshot each
// time the content changes and settles, which in practice means one image per
// slide. Two sources use it:
//   - content_script.js (Teams page): the shared-screen <video> tile
//   - pptLiveCapture.js (PowerPoint Live frame on officeapps.live.com): the
//     slideshow canvases, composited into one frame
//
// Pipeline per tick:
//   1. Ask `getFrame()` for the current { source, width, height, presenter }.
//      `source` is anything drawImage() accepts (video, canvas, image).
//   2. Draw it to a tiny grayscale thumbnail and compare against the last kept
//      frame. Small differences (cursor, caret) are ignored.
//   3. A changed frame becomes a candidate; it is kept only after it stays
//      stable for STABLE_SAMPLES consecutive ticks, filtering scrolls and
//      transition animations.
//   4. A kept frame is rendered at full resolution to JPEG and fingerprinted
//      with a difference hash, then handed to `onSlide`. Session-level
//      deduplication ("seen earlier"), numbering and the storage budget live in
//      content_script.js so slides from every source share one sequence.
//
// Timer-based sampling keeps working while the tab is hidden; the video keeps
// decoding and the visibility shim keeps the meeting app rendering.
const SlideCapture = (() => {
    'use strict';

    const CONFIG = {
        SAMPLE_INTERVAL_MS: 1000,   // with STABLE_SAMPLES 2 a new slide lands 1-2s after it appears
        THUMB_W: 64,
        THUMB_H: 36,
        CHANGE_THRESHOLD: 6,      // mean abs gray diff (0-255) vs last kept slide to count as new content
        STABLE_THRESHOLD: 1.5,    // mean abs gray diff between consecutive samples to count as settled
        STABLE_SAMPLES: 2,        // consecutive settled samples before keeping
        MAX_WIDTH: 1920,
        PNG_MAX_BYTES: 1024 * 1024, // PNG keeps slide text crisp; fall back to JPEG above this size (photos, busy desktops)
        JPEG_QUALITY: 0.9,
        HASH_DISTANCE: 6,         // max Hamming distance (of 64 bits) to treat two slides as the same
        MAX_SLIDES_PER_SESSION: 300,
        MAX_BYTES_PER_SESSION: 60 * 1024 * 1024
    };

    let state = null;

    function log(...args) {
        if (state && state.log) state.log(...args);
    }

    function makeCanvas(w, h) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        return c;
    }

    /**
     * Frame source for a shared-screen <video> found by selector.
     * @param {Object} config platformConfig.sharedContent: { videoSelector, getPresenter(video) }
     * @returns {Function} getFrame() -> { source, width, height, presenter } | null
     */
    function videoFrameSource(config) {
        return () => {
            if (!config || !config.videoSelector) return null;
            const candidates = document.querySelectorAll(config.videoSelector);
            let best = null;
            for (const v of candidates) {
                if (!(v instanceof HTMLVideoElement)) continue;
                if (v.videoWidth === 0 || v.readyState < 2) continue;
                if (!best || v.videoWidth * v.videoHeight > best.videoWidth * best.videoHeight) best = v;
            }
            if (!best) return null;
            let presenter = null;
            try {
                const name = config.getPresenter ? config.getPresenter(best) : null;
                presenter = (name && String(name).trim()) || null;
            } catch (e) { /* presenter is optional */ }
            return { source: best, width: best.videoWidth, height: best.videoHeight, presenter };
        };
    }

    function grayThumb(frame) {
        const { THUMB_W, THUMB_H } = CONFIG;
        const ctx = state.thumbCtx;
        ctx.drawImage(frame.source, 0, 0, THUMB_W, THUMB_H);
        const d = ctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
        const g = new Float32Array(THUMB_W * THUMB_H);
        for (let p = 0; p < g.length; p++) {
            g[p] = (d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2]) / 3;
        }
        return g;
    }

    function meanDiff(a, b) {
        if (!a || !b || a.length !== b.length) return Infinity;
        let sum = 0;
        for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
        return sum / a.length;
    }

    // 64-bit difference hash from a 9x8 grayscale downscale, as 16 hex chars.
    function dHash(frame) {
        const ctx = state.hashCtx;
        ctx.drawImage(frame.source, 0, 0, 9, 8);
        const d = ctx.getImageData(0, 0, 9, 8).data;
        const gray = (x, y) => { const i = (y * 9 + x) * 4; return (d[i] + d[i + 1] + d[i + 2]) / 3; };
        let hex = '';
        for (let y = 0; y < 8; y++) {
            let byte = 0;
            for (let x = 0; x < 8; x++) {
                byte = (byte << 1) | (gray(x, y) < gray(x + 1, y) ? 1 : 0);
            }
            hex += byte.toString(16).padStart(2, '0');
        }
        return hex;
    }

    function hammingHex(a, b) {
        if (!a || !b || a.length !== b.length) return 64;
        let dist = 0;
        for (let i = 0; i < a.length; i++) {
            let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
            while (x) { dist += x & 1; x >>= 1; }
        }
        return dist;
    }

    function renderFull(frame) {
        const scale = Math.min(1, CONFIG.MAX_WIDTH / frame.width);
        const w = Math.max(1, Math.round(frame.width * scale));
        const h = Math.max(1, Math.round(frame.height * scale));
        const canvas = makeCanvas(w, h);
        canvas.getContext('2d').drawImage(frame.source, 0, 0, w, h);
        const sizeOf = (url) => Math.round((url.length - (url.indexOf(',') + 1)) * 0.75);
        // Slides are mostly text on flat colour: PNG is small and lossless. Anything
        // photographic blows past the PNG budget and goes to high-quality JPEG instead.
        let dataUrl = canvas.toDataURL('image/png');
        let bytes = sizeOf(dataUrl);
        if (bytes > CONFIG.PNG_MAX_BYTES) {
            dataUrl = canvas.toDataURL('image/jpeg', CONFIG.JPEG_QUALITY);
            bytes = sizeOf(dataUrl);
        }
        return { dataUrl, width: w, height: h, bytes };
    }

    function keep(frame, gray) {
        const hash = dHash(frame);
        const full = renderFull(frame);
        state.kept++;
        state.lastKeptGray = gray;
        state.candidate = null;
        log(`[Slide Capture] Content settled (${full.width}x${full.height}, ${Math.round(full.bytes / 1024)} KB)${frame.presenter ? ' from ' + frame.presenter : ''}`);
        try {
            state.onSlide({ ...full, hash, presenter: frame.presenter || null });
        } catch (e) {
            log('[Slide Capture] onSlide handler failed:', e.message);
        }
    }

    function tick() {
        if (!state) return;
        let frame;
        try {
            frame = state.getFrame();
        } catch (e) {
            return;
        }

        if (!frame || !frame.source || !frame.width || !frame.height) {
            if (state.lastKeptGray || state.candidate) {
                log('[Slide Capture] Shared content no longer visible');
            }
            // Next share of the same content should be captured again (as "seen earlier")
            state.lastKeptGray = null;
            state.candidate = null;
            return;
        }

        let gray;
        try {
            gray = grayThumb(frame);
        } catch (e) {
            // Source detached mid-draw or canvas tainted; try again next tick
            return;
        }

        const diffFromKept = state.lastKeptGray ? meanDiff(gray, state.lastKeptGray) : Infinity;
        if (diffFromKept < CONFIG.CHANGE_THRESHOLD) {
            state.candidate = null; // Still showing the kept slide
            return;
        }

        if (state.candidate && meanDiff(gray, state.candidate.gray) < CONFIG.STABLE_THRESHOLD) {
            state.candidate.stable++;
            state.candidate.gray = gray;
        } else {
            state.candidate = { gray, stable: 1 };
        }

        if (state.candidate.stable >= CONFIG.STABLE_SAMPLES) {
            try {
                keep(frame, gray);
            } catch (e) {
                log('[Slide Capture] Failed to keep slide:', e.message);
                state.candidate = null;
            }
        }
    }

    /**
     * Start sampling.
     * @param {Object} opts
     * @param {Function} opts.getFrame  returns { source, width, height, presenter? } or null when nothing is shared
     * @param {Function} opts.onSlide   called with { dataUrl, hash, width, height, bytes, presenter }
     * @param {Function} [opts.log]
     * @param {number}   [opts.sampleIntervalMs] override CONFIG.SAMPLE_INTERVAL_MS
     */
    function start(opts) {
        if (state) return false;
        if (!opts || typeof opts.getFrame !== 'function' || typeof opts.onSlide !== 'function') return false;
        const interval = Math.max(250, Number(opts.sampleIntervalMs) || CONFIG.SAMPLE_INTERVAL_MS);
        state = {
            getFrame: opts.getFrame,
            onSlide: opts.onSlide,
            log: opts.log || null,
            kept: 0,
            lastKeptGray: null,
            candidate: null,
            thumbCtx: makeCanvas(CONFIG.THUMB_W, CONFIG.THUMB_H).getContext('2d', { willReadFrequently: true }),
            hashCtx: makeCanvas(9, 8).getContext('2d', { willReadFrequently: true }),
            timer: null
        };
        state.timer = setInterval(tick, interval);
        log(`[Slide Capture] Started (sampling every ${interval} ms)`);
        return true;
    }

    function stop() {
        if (!state) return;
        clearInterval(state.timer);
        log(`[Slide Capture] Stopped (${state.kept} frame(s) kept)`);
        state = null;
    }

    function isActive() {
        return !!state;
    }

    return { start, stop, isActive, videoFrameSource, hammingHex, CONFIG, _internal: { meanDiff, hammingHex } };
})();
