// Live Captions Saver - PowerPoint Live frame capture
//
// Runs inside the PowerPoint Live viewer that Teams embeds as a cross-origin
// iframe (https://<region>.pods.officeapps.live.com/slideshow.aspx). The Teams
// page cannot see into that frame, so this script samples the slideshow
// canvases here and hands settled frames to the service worker, which relays
// them to the Teams top frame of the same tab. content_script.js then dedupes,
// numbers and stores them exactly like screen-share slides.
//
// Verified DOM (2026-09-04): #slideshow-canvas-container holds one WebGL canvas
// (#webgl-canvas) plus 2D overlay canvases of the same size; none are tainted
// and toDataURL() returns pixels. They are composited in DOM order so ink and
// pointer overlays land on top of the slide.
(() => {
    'use strict';

    if (typeof SlideCapture === 'undefined') return;
    if (window.top === window.self) return; // PowerPoint Live is always embedded

    const CONTAINER_SELECTOR = '#slideshow-canvas-container, #slideshow-app-container';
    const LOG_PREFIX = '[Caption Saver] [PowerPoint Live]';

    let composite = null;

    function log(...args) {
        console.log(LOG_PREFIX, ...args);
    }

    function getFrame() {
        const container = document.querySelector(CONTAINER_SELECTOR);
        if (!container) return null;
        const canvases = [...container.querySelectorAll('canvas')]
            .filter(c => c.width > 0 && c.height > 0 && c.clientWidth > 0 && c.clientHeight > 0);
        if (canvases.length === 0) return null;

        let width = 0, height = 0;
        for (const c of canvases) {
            if (c.width * c.height > width * height) { width = c.width; height = c.height; }
        }
        if (canvases.length === 1) {
            return { source: canvases[0], width, height, presenter: null };
        }

        if (!composite) composite = document.createElement('canvas');
        if (composite.width !== width || composite.height !== height) {
            composite.width = width;
            composite.height = height;
        }
        const ctx = composite.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        for (const c of canvases) ctx.drawImage(c, 0, 0, width, height);
        return { source: composite, width, height, presenter: null };
    }

    function onSlide(frame) {
        try {
            chrome.runtime.sendMessage({
                message: 'shared_content_frame',
                source: 'powerpoint-live',
                frame
            }, () => { void chrome.runtime.lastError; });
        } catch (e) {
            // Extension reloaded while the frame was open; nothing to do
        }
    }

    async function apply() {
        let enabled = false;
        try {
            const result = await chrome.storage.sync.get('captureSharedContent');
            enabled = !!result.captureSharedContent;
        } catch (e) {
            return;
        }
        if (enabled && !SlideCapture.isActive()) {
            SlideCapture.start({ getFrame, onSlide, log });
        } else if (!enabled && SlideCapture.isActive()) {
            SlideCapture.stop();
        }
    }

    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.captureSharedContent) apply();
        });
    } catch (e) { /* storage unavailable */ }

    apply();
})();
