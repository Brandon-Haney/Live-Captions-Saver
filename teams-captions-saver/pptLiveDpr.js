// Live Captions Saver - PowerPoint Live render scale
//
// Runs in the MAIN world of the PowerPoint Live slideshow frame at
// document_start, before the viewer boots. The viewer sizes its WebGL canvas
// from window.devicePixelRatio, so on a 1x monitor the slide is drawn at its
// on-screen size (roughly 540-780px wide in presenter view), which is too
// little for captured text to stay readable. Reporting a ratio of 2 makes the
// viewer draw the slide exactly as it would on a HiDPI display: twice the
// pixels, same layout and hit-testing, and pptLiveCapture.js captures the
// larger backing store.
//
// 3x was chosen after a live test: 2x gave 1078x606 from the ~540px presenter
// view canvas, readable but soft for dense text; 3x gives ~1617x909, on par with
// a full-size slide export. A 4K monitor at ratio 2 already makes the viewer
// draw ~3800px wide, so 3x of a small canvas is well inside what it handles.
// slideCapture.js caps stored images at MAX_WIDTH anyway.
(() => {
    'use strict';
    if (!/slideshow/i.test(location.pathname)) return;
    const TARGET = 3;
    let real = 1;
    try { real = window.devicePixelRatio || 1; } catch (e) { /* keep 1 */ }
    if (real >= TARGET) return;
    try {
        Object.defineProperty(window, 'devicePixelRatio', {
            configurable: true,
            enumerable: true,
            get: () => TARGET
        });
    } catch (e) {
        // Property not configurable in this engine; capture will use the native size
    }
})();
