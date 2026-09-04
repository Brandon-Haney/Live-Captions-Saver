// Live Captions Saver - Export package
//
// When the "Include images with exports" setting is on, text exports (TXT,
// Markdown, JSON, AI) are delivered as a zip: the transcript file plus a
// slides/ folder (and attachments/ for embedded chat images). The transcript
// references each image by relative path so a file-reading agent such as
// Claude Code can open a slide only when it needs it.
//
// Shared by service_worker.js (importScripts) and viewer.js (script tag).
// Everything here works in both a worker and a page: OffscreenCanvas,
// createImageBitmap and fetch(data:) are available in both.
//
// The zip writer uses the "stored" method (no compression). PNG/JPEG are
// already compressed and the transcript text is small, so deflate would buy
// almost nothing and would need a library.
const ExportPackage = (() => {
    'use strict';

    // Long edge for exported slides. ~1600px keeps dense slide text readable
    // for a vision model at roughly 1,900 tokens per image on current Claude
    // models; smaller images cost proportionally less.
    const IMAGE_MAX_LONG_EDGE = 1600;
    const JPEG_QUALITY = 0.9;
    const TEXT_FORMATS = ['txt', 'md', 'json', 'ai'];
    const MERGE_GAP_MS = 60 * 1000; // consecutive captions from one speaker within this gap become one paragraph

    // --- Zip (stored) ---
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function dosTime(d) {
        return ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
    }

    function dosDate(d) {
        return (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    }

    /**
     * Build a zip archive.
     * @param {Array<{name: string, data: Uint8Array|string}>} files
     * @returns {Uint8Array}
     */
    function buildZip(files) {
        const enc = new TextEncoder();
        const now = new Date();
        const time = dosTime(now), date = dosDate(now);
        const locals = [];
        const centrals = [];
        let offset = 0;

        for (const f of files) {
            const nameBytes = enc.encode(f.name.replace(/\\/g, '/'));
            const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
            const crc = crc32(data);

            const local = new Uint8Array(30 + nameBytes.length + data.length);
            const lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);
            lv.setUint16(4, 20, true);        // version needed
            lv.setUint16(6, 0x0800, true);    // flags: UTF-8 names
            lv.setUint16(8, 0, true);         // method: stored
            lv.setUint16(10, time, true);
            lv.setUint16(12, date, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, data.length, true);
            lv.setUint32(22, data.length, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);
            local.set(nameBytes, 30);
            local.set(data, 30 + nameBytes.length);
            locals.push(local);

            const central = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(central.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);        // version made by
            cv.setUint16(6, 20, true);        // version needed
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, 0, true);
            cv.setUint16(12, time, true);
            cv.setUint16(14, date, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, data.length, true);
            cv.setUint32(24, data.length, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint16(30, 0, true);        // extra
            cv.setUint16(32, 0, true);        // comment
            cv.setUint16(34, 0, true);        // disk
            cv.setUint16(36, 0, true);        // internal attrs
            cv.setUint32(38, 0, true);        // external attrs
            cv.setUint32(42, offset, true);
            central.set(nameBytes, 46);
            centrals.push(central);

            offset += local.length;
        }

        const cdSize = centrals.reduce((n, c) => n + c.length, 0);
        const end = new Uint8Array(22);
        const ev = new DataView(end.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(4, 0, true);
        ev.setUint16(6, 0, true);
        ev.setUint16(8, files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, cdSize, true);
        ev.setUint32(16, offset, true);
        ev.setUint16(20, 0, true);

        const out = new Uint8Array(offset + cdSize + 22);
        let p = 0;
        for (const l of locals) { out.set(l, p); p += l.length; }
        for (const c of centrals) { out.set(c, p); p += c.length; }
        out.set(end, p);
        return out;
    }

    function base64FromBytes(bytes) {
        let s = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(s);
    }

    // --- Images ---
    const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function safeName(s) {
        return String(s || 'image').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 40) || 'image';
    }

    async function decode(dataUrl) {
        const blob = await (await fetch(dataUrl)).blob();
        return blob;
    }

    /**
     * Resize an image so its long edge is at most `maxLongEdge`. Returns
     * { bytes, mime, width, height }. GIFs are passed through untouched so
     * animation survives; images already small enough keep their bytes.
     */
    async function prepareImage(dataUrl, maxLongEdge) {
        const blob = await decode(dataUrl);
        const mime = blob.type || 'image/png';
        if (mime === 'image/gif') {
            return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width: 0, height: 0 };
        }
        const bitmap = await createImageBitmap(blob);
        try {
            const long = Math.max(bitmap.width, bitmap.height);
            if (long <= maxLongEdge && EXT[mime]) {
                return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width: bitmap.width, height: bitmap.height };
            }
            const scale = Math.min(1, maxLongEdge / long);
            const w = Math.max(1, Math.round(bitmap.width * scale));
            const h = Math.max(1, Math.round(bitmap.height * scale));
            const canvas = new OffscreenCanvas(w, h);
            canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
            const outMime = mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
            const out = await canvas.convertToBlob(outMime === 'image/jpeg' ? { type: outMime, quality: JPEG_QUALITY } : { type: outMime });
            return { bytes: new Uint8Array(await out.arrayBuffer()), mime: outMime, width: w, height: h };
        } finally {
            bitmap.close();
        }
    }

    function hasImages(entries) {
        return (entries || []).some(e => e && (e.imageId || (e.attachments || []).some(a => a && a.imageId)));
    }

    /**
     * Turn the images referenced by a transcript into zip entries.
     * @param {Array}  entries  transcript entries
     * @param {Object} images   imageId -> data URL (or record with dataUrl)
     * @param {Object} [opts]   { maxLongEdge }
     * @returns {Promise<{files: Array<{name, data}>, paths: Object}>} paths: imageId -> relative file path
     */
    async function collectImageFiles(entries, images, opts) {
        const maxLongEdge = (opts && opts.maxLongEdge) || IMAGE_MAX_LONG_EDGE;
        const files = [];
        const paths = {};
        let attachmentIndex = 0;
        const dataUrlFor = (id) => {
            const rec = images && images[id];
            return typeof rec === 'string' ? rec : (rec && rec.dataUrl) || null;
        };

        for (const entry of entries || []) {
            if (!entry) continue;
            if (entry.Type === 'slide' && entry.imageId && !paths[entry.imageId]) {
                const dataUrl = dataUrlFor(entry.imageId);
                if (!dataUrl) continue;
                try {
                    const img = await prepareImage(dataUrl, maxLongEdge);
                    const n = entry.slideNumber || (Object.keys(paths).length + 1);
                    const name = `slides/slide-${pad(n)}.${EXT[img.mime] || 'png'}`;
                    files.push({ name, data: img.bytes });
                    paths[entry.imageId] = name;
                } catch (e) {
                    console.warn('[ExportPackage] Could not prepare slide image', entry.imageId, e);
                }
            }
            for (const att of entry.attachments || []) {
                if (!att || !att.imageId || paths[att.imageId]) continue;
                const dataUrl = dataUrlFor(att.imageId);
                if (!dataUrl) continue;
                try {
                    const img = await prepareImage(dataUrl, maxLongEdge);
                    attachmentIndex++;
                    const name = `attachments/${pad(attachmentIndex)}-${safeName(att.filename)}.${EXT[img.mime] || 'png'}`;
                    files.push({ name, data: img.bytes });
                    paths[att.imageId] = name;
                } catch (e) {
                    console.warn('[ExportPackage] Could not prepare attachment image', att.imageId, e);
                }
            }
        }
        return { files, paths };
    }

    // --- Transcript helpers ---
    function entryTime(entry) {
        if (entry.sortKey) return entry.sortKey;
        if (entry.timestamp) { const t = new Date(entry.timestamp).getTime(); if (!isNaN(t)) return t; }
        return 0;
    }

    /**
     * Merge consecutive captions from the same speaker into one paragraph when
     * they fall within MERGE_GAP_MS. Chat, slides and join/leave events are
     * left alone and break a run. Cuts the per-fragment timestamp/speaker
     * overhead that dominates Teams caption streams.
     */
    function compactCaptions(entries, gapMs) {
        const gap = gapMs || MERGE_GAP_MS;
        const out = [];
        let last = null;
        for (const entry of entries || []) {
            if (!entry) continue;
            const isCaption = !entry.Type || entry.Type === 'caption';
            if (isCaption && last && last.Name === entry.Name && (entryTime(entry) - last._end) <= gap) {
                last.Text = `${last.Text} ${(entry.Text || '').trim()}`.trim();
                last._end = entryTime(entry);
                last.mergedCount++;
                continue;
            }
            const copy = { ...entry };
            if (isCaption) { copy._end = entryTime(entry); copy.mergedCount = 1; }
            out.push(copy);
            last = isCaption ? copy : null;
        }
        return out.map(e => { const c = { ...e }; delete c._end; return c; });
    }

    /** "Slide 3 shown" / "Slide 3 shown again" label for a slide entry. */
    function slideLabel(entry) {
        const n = entry.slideNumber ? `Slide ${entry.slideNumber}` : 'Shared content';
        return entry.seenEarlier ? `${n} shown again` : `${n} shown`;
    }

    /** Ordered index of unique slides: [{ slideNumber, time, presenter, path, imageId }]. */
    function slideIndex(entries, paths) {
        const seen = new Map();
        for (const e of entries || []) {
            if (!e || e.Type !== 'slide' || !e.imageId || seen.has(e.imageId)) continue;
            seen.set(e.imageId, {
                slideNumber: e.slideNumber || seen.size + 1,
                time: e.Time,
                presenter: e.Name,
                path: (paths && paths[e.imageId]) || null,
                imageId: e.imageId
            });
        }
        return [...seen.values()];
    }

    return {
        IMAGE_MAX_LONG_EDGE,
        TEXT_FORMATS,
        buildZip,
        base64FromBytes,
        collectImageFiles,
        hasImages,
        compactCaptions,
        slideLabel,
        slideIndex
    };
})();
