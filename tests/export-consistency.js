#!/usr/bin/env node
'use strict';
/**
 * Export consistency check.
 *
 * Loads the extension's real formatter code (service worker + viewer) into Node
 * with a stubbed Chrome API, runs one session through every export path, and
 * reports where the outputs disagree on facts that must not depend on format:
 * attendee list, event counts and order, first/last caption, slide references.
 *
 * Usage:
 *   node tests/export-consistency.js               # built-in fixture (all edge cases)
 *   node tests/export-consistency.js export.json   # a real JSON export from the extension
 *
 * Exit code is the number of divergences found (0 = every format agrees).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.resolve(__dirname, '..', 'teams-captions-saver');
const read = (f) => fs.readFileSync(path.join(EXT, f), 'utf8');

// ---------------------------------------------------------------------------
// Load the service worker (and everything it importScripts) in a sandbox
// ---------------------------------------------------------------------------
function makeChromeStub() {
    const fn = function () { return Promise.resolve({}); };
    const proxy = new Proxy(fn, {
        get(_t, prop) {
            if (prop === 'then') return undefined;
            if (prop === 'QUOTA_BYTES') return 10 * 1024 * 1024;
            if (prop === 'lastError') return undefined;
            if (prop === 'id') return 'test-extension-id';
            return proxy;
        },
        apply() { return Promise.resolve({}); }
    });
    return proxy;
}

const quiet = { log() {}, info() {}, debug() {}, warn() {}, error() {} };

function loadServiceWorker() {
    const sandbox = {
        console: quiet,
        TextEncoder, TextDecoder, URL,
        setTimeout, clearTimeout,
        setInterval: () => 0, clearInterval: () => {},
        atob: (s) => Buffer.from(s, 'base64').toString('binary'),
        btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
        navigator: {},
        chrome: makeChromeStub()
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    sandbox.importScripts = (...files) => files.forEach(f => vm.runInContext(read(f), sandbox, { filename: f }));
    vm.runInContext(read('service_worker.js'), sandbox, { filename: 'service_worker.js' });
    return {
        get: (name) => vm.runInContext(name, sandbox)
    };
}

// ---------------------------------------------------------------------------
// Extract the viewer's private formatters (they live inside a DOMContentLoaded
// closure and reference page-level state, so they are sliced out by name)
// ---------------------------------------------------------------------------
function sliceFunction(src, name, indent) {
    const start = src.indexOf(`${indent}function ${name}(`);
    if (start === -1) throw new Error(`viewer.js: function ${name} not found`);
    let next = src.indexOf(`\n${indent}function `, start + 1);
    const nextAsync = src.indexOf(`\n${indent}async function `, start + 1);
    if (nextAsync !== -1 && (next === -1 || nextAsync < next)) next = nextAsync;
    return src.slice(start, next === -1 ? undefined : next);
}

function loadViewerFormatters() {
    const src = read('viewer.js');
    const body = [
        sliceFunction(src, 'imageRefsFor', '    '),
        sliceFunction(src, 'formatTranscriptForExport', '    '),
        sliceFunction(src, 'mergeAttendanceEvents', '    '),
        'return { formatTranscriptForExport, mergeAttendanceEvents };'
    ].join('\n');
    const factory = new Function(
        'currentMeetingTitle', 'currentPlatform', 'currentFilteredSpeaker', 'currentAttendeeReport', 'formatAsSrt', 'debug',
        body
    );
    return (state) => factory(state.meetingTitle, state.platform, null, state.attendeeReport, () => '', quiet);
}

// ---------------------------------------------------------------------------
// Fixture: every shape we have seen go wrong this week
// ---------------------------------------------------------------------------
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function buildFixture() {
    const base = new Date('2026-09-08T14:00:00').getTime(); // local time
    const at = (s) => new Date(base + s * 1000);
    const iso = (s) => at(s).toISOString();
    const tm = (s) => at(s).toLocaleTimeString('en-US');
    const cap = (s, Name, Text) => ({ Name, Text, Time: tm(s), timestamp: iso(s), Type: 'caption', key: `c_${s}` });
    const slide = (s, n, seenEarlier) => ({
        Name: 'Kevin Kong', Text: `Shared content (slide ${n}${seenEarlier ? ', seen earlier' : ''})`, Time: tm(s), timestamp: iso(s),
        Type: 'slide', key: `s_${s}`, imageId: `img_slide_${n}`, imageHash: `h${n}`, slideNumber: n, seenEarlier
    });

    const transcript = [
        cap(5, 'Kevin Kong', 'Good morning everyone.'),
        cap(9, 'Kevin Kong', 'Let us get started with the release review.'),
        slide(12, 1, false),
        cap(20, 'Lexi Lambert', 'Question on the timeline.'),
        { Name: 'Chad Collins', Text: 'here is the screenshot', Time: tm(25), timestamp: iso(25), Type: 'chat', key: 'ch_25',
          attachments: [{ type: 'image', filename: 'shot.png', imageId: 'img_att_1', url: 'blob:https://teams.microsoft.com/abc' }] },
        slide(30, 2, false),
        cap(33, 'Unknown user', 'Hi Kevin, this is Anuj, I just joined.'),
        cap(90, 'Kevin Kong', 'Back to slide one for a second.'),
        slide(92, 1, true),
        cap(95, 'Lexi Lambert', 'Thanks all, talk soon.')
    ];

    const attendeeReport = {
        meetingStartTime: iso(0),
        totalUniqueAttendees: 4,
        attendeeList: ['Kevin Kong', 'Lexi Lambert', 'Chad Collins', 'Brandon Haney'],
        currentAttendees: [],
        attendeeHistory: [
            { name: 'Kevin Kong', role: 'Organizer', action: 'joined', time: tm(1), timestamp: base + 1000 },
            { name: 'Lexi Lambert', role: 'Attendee', action: 'joined', time: tm(2), timestamp: base + 2000 },
            { name: 'Chad Collins', role: 'Attendee', action: 'joined', time: tm(2) },                 // legacy: no numeric timestamp
            { name: 'Brandon Haney', role: 'Speaker', action: 'detected from transcript', time: tm(15) }, // legacy bookkeeping entry
            { name: 'Chad Collins', action: 'left', time: tm(60), timestamp: base + 60000 }
        ]
    };

    return {
        label: 'fixture',
        meetingTitle: 'Fixture Sync',
        platform: 'teams',
        recordingStartTime: iso(0),
        transcript,
        attendeeReport,
        images: { img_slide_1: TINY_PNG, img_slide_2: TINY_PNG, img_att_1: TINY_PNG },
        imagePaths: { img_slide_1: 'slides/slide-01.png', img_slide_2: 'slides/slide-02.png', img_att_1: 'attachments/01-shot.png' }
    };
}

// Same meeting as it would have been stored before the serialisable snapshot fix:
// attendeeData sent raw, so Set/Map became {} and only the history survived.
function legacyVariant(fx) {
    return {
        ...fx,
        label: 'fixture (legacy stored attendee report)',
        attendeeReport: { meetingStartTime: fx.attendeeReport.meetingStartTime, allAttendees: {}, currentAttendees: {}, attendeeHistory: fx.attendeeReport.attendeeHistory }
    };
}

function loadJsonExport(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const transcript = Array.isArray(data) ? data : (data.transcript || []);
    return {
        label: path.basename(file),
        meetingTitle: data.meetingTitle || 'Meeting',
        platform: data.platform || '',
        recordingStartTime: data.recordingStartTime || null,
        transcript,
        attendeeReport: data.attendees || data.attendeeReport || null,
        images: {},
        imagePaths: {}
    };
}

// ---------------------------------------------------------------------------
// Run every export path
// ---------------------------------------------------------------------------
async function renderAll(sw, viewerFactory, fx) {
    const out = {};
    const T = sw.get('TranscriptRenderer');

    out['sw:txt'] = sw.get('formatAsTxt')(fx.transcript, fx.attendeeReport, fx.imagePaths);
    out['sw:md'] = sw.get('formatAsMarkdown')(fx.transcript, fx.attendeeReport, fx.meetingTitle, fx.recordingStartTime, fx.imagePaths);
    out['sw:ai'] = await sw.get('formatForAi')(fx.transcript, fx.meetingTitle, fx.recordingStartTime, fx.attendeeReport, fx.imagePaths);
    out['sw:json'] = JSON.stringify({
        meetingTitle: fx.meetingTitle, recordingStartTime: fx.recordingStartTime,
        transcript: sw.get('withImageFiles')(fx.transcript, fx.imagePaths), attendees: fx.attendeeReport
    }, null, 2);
    out['sw:doc'] = sw.get('formatAsDoc')(fx.transcript, fx.attendeeReport);
    out['sw:html'] = T.buildStandaloneDocument({
        meetingTitle: fx.meetingTitle, platform: fx.platform, entries: fx.transcript,
        attendeeReport: fx.attendeeReport, images: fx.images, recordingStartTime: fx.recordingStartTime
    });

    // The viewer merges join/leave rows into its caption list on load, then formats that list
    const v = viewerFactory(fx);
    const merged = fx.attendeeReport && Array.isArray(fx.attendeeReport.attendeeHistory)
        ? v.mergeAttendanceEvents(fx.transcript, fx.attendeeReport.attendeeHistory)
        : fx.transcript;
    out['viewer:txt'] = v.formatTranscriptForExport(merged, 'txt', null, fx.imagePaths);
    out['viewer:md'] = v.formatTranscriptForExport(merged, 'md', null, fx.imagePaths);
    out['viewer:json'] = v.formatTranscriptForExport(merged, 'json', null, fx.imagePaths);
    return out;
}

// ---------------------------------------------------------------------------
// Extract format-independent facts from each output
// ---------------------------------------------------------------------------
function factsFromLines(text) {
    const f = { events: [], attendees: null, slideFiles: [] };
    const lines = text.split(/\r?\n/);
    let inAttendeeList = false;
    for (const line of lines) {
        let m;
        if (/^Attendee List:/.test(line)) { inAttendeeList = true; f.attendees = []; continue; }
        if (inAttendeeList) {
            if ((m = line.match(/^- (.+)$/))) { f.attendees.push(m[1].trim()); continue; }
            if (line.trim() === '') continue;
            inAttendeeList = false;
        }
        if ((m = line.match(/^Attendees \((\d+)\): (.+)$/))) { f.attendees = m[2].split(',').map(s => s.trim()); continue; }
        if ((m = line.match(/^\[(.+?)\] ● (.+?) (joined the meeting.*|left the meeting)$/))) { f.events.push({ type: 'attendance', time: m[1], name: m[2], text: m[3] }); continue; }
        if ((m = line.match(/^\[CHAT\] \[(.+?)\] (.+?): (.*)$/))) { f.events.push({ type: 'chat', time: m[1], name: m[2], text: m[3] }); continue; }
        if ((m = line.match(/^\[SLIDE\] \[(.+?)\] (.*)$/))) {
            const fileM = m[2].match(/-> (\S+)/);
            if (fileM) f.slideFiles.push(fileM[1]);
            f.events.push({ type: 'slide', time: m[1], text: m[2] });
            continue;
        }
        if ((m = line.match(/^\[(\d{1,2}:\d{2}(?::\d{2})?(?: [AP]M)?)\] (.+?): (.*)$/))) { f.events.push({ type: 'caption', time: m[1], name: m[2], text: m[3] }); continue; }
    }
    return f;
}

function factsFromMarkdown(text) {
    const f = { events: [], attendees: null, slideFiles: [] };
    const lines = text.split(/\r?\n/);
    let section = null, speaker = null, type = 'caption';
    for (const line of lines) {
        let m;
        if ((m = line.match(/^## (.+)$/))) { section = m[1].trim(); if (section === 'Attendees') f.attendees = []; continue; }
        if (section === 'Attendees' && (m = line.match(/^- (.+)$/))) { f.attendees.push(m[1].trim()); continue; }
        if ((m = line.match(/^\*● (.+?) (joined the meeting.*?|left the meeting)\* \((.+?)\)$/))) { f.events.push({ type: 'attendance', time: m[3], name: m[1], text: m[2] }); continue; }
        if ((m = line.match(/^### (\[CHAT\] |\[SLIDE\] )?(.+)$/))) { type = m[1] ? (m[1].includes('CHAT') ? 'chat' : 'slide') : 'caption'; speaker = m[2].trim(); continue; }
        if ((m = line.match(/^> \*\*\[(.+?)\]\*\* (.*)$/))) {
            // Classify by content, not only by the heading: Markdown emits a heading only when the
            // speaker changes, so a slide right after that speaker's caption sits under a plain heading
            let t = type;
            if (/^Shared content \(slide/.test(m[2])) t = 'slide';
            else if (/^(joined the meeting|left the meeting)/.test(m[2])) t = 'attendance';
            f.events.push({ type: t, time: m[1], name: speaker, text: m[2] });
            continue;
        }
        if ((m = line.match(/^!\[Slide[^\]]*\]\((.+)\)$/))) { f.slideFiles.push(m[1]); continue; }
    }
    return f;
}

function factsFromJson(text) {
    const data = JSON.parse(text);
    const entries = Array.isArray(data) ? data : data.transcript;
    const f = { events: [], attendees: null, slideFiles: [] };
    for (const e of entries) {
        const type = e.Type === 'attendance' ? 'attendance' : (e.Type === 'chat' ? 'chat' : (e.Type === 'slide' ? 'slide' : 'caption'));
        f.events.push({ type, time: e.Time, name: e.Name, text: e.Text });
        if (e.Type === 'slide' && e.imageFile) f.slideFiles.push(e.imageFile);
    }
    if (!Array.isArray(data) && data.attendees) {
        const a = data.attendees;
        if (Array.isArray(a.attendeeList) && a.attendeeList.length) f.attendees = a.attendeeList.slice();
    }
    return f;
}

function factsFromHtml(text) {
    const f = { events: [], attendees: null, slideFiles: [] };
    const attendeesM = text.match(/<details class="attendees">[\s\S]*?<ul>([\s\S]*?)<\/ul>/);
    if (attendeesM) f.attendees = [...attendeesM[1].matchAll(/<li>(.*?)<\/li>/g)].map(m => decode(m[1]));
    const container = text.slice(text.indexOf('<div id="captions-container">'), text.indexOf('<footer>'));
    const blocks = container.split(/(?=<div class="(?:caption[ "]|attendance-event[ "]))/).slice(1);
    for (const b of blocks) {
        const type = (b.match(/data-type="(\w+)"/) || [])[1] || 'caption';
        const time = decode((b.match(/<span class="time">(.*?)<\/span>/) || [])[1] || '');
        const name = decode(((b.match(/data-speaker="(.*?)"/) || [])[1] || ((b.match(/<span class="name">([\s\S]*?)<\/span>/) || [])[1] || '').replace(/<[^>]+>/g, ''))).trim();
        const textM = b.match(/<span class="text">([\s\S]*?)<\/span>/);
        const attText = b.match(/class="attendance-text">([\s\S]*?)<\/span>/) || b.match(/(joined the meeting[^<]*|left the meeting)/);
        const txt = textM ? decode(textM[1].replace(/<[^>]+>/g, '')).trim() : (attText ? decode(attText[1]).trim() : '');
        f.events.push({ type, time, name, text: txt });
    }
    return f;
}

function factsFromDoc(text) {
    const f = { events: [], attendees: null, slideFiles: [] };
    for (const m of text.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)) {
        const p = m[1];
        let mm;
        if ((mm = p.match(/^\[SLIDE\] <b>(.*?)<\/b> \(<i>(.*?)<\/i>\): (.*)$/))) f.events.push({ type: 'slide', time: decode(mm[2]), name: decode(mm[1]), text: decode(mm[3]) });
        else if ((mm = p.match(/^\[CHAT\] <b>(.*?)<\/b> \(<i>(.*?)<\/i>\): (.*)$/))) f.events.push({ type: 'chat', time: decode(mm[2]), name: decode(mm[1]), text: decode(mm[3]) });
        else if ((mm = p.match(/● (.*?) (joined the meeting[^<]*?|left the meeting) - <i>(.*?)<\/i>/))) f.events.push({ type: 'attendance', time: decode(mm[3]), name: decode(mm[1]), text: decode(mm[2]).trim() });
        else if ((mm = p.match(/^<b>(.*?)<\/b> \(<i>(.*?)<\/i>\): (.*)$/))) f.events.push({ type: 'caption', time: decode(mm[2]), name: decode(mm[1]), text: decode(mm[3]) });
    }
    const list = text.match(/Attendee List[\s\S]*?<ul>([\s\S]*?)<\/ul>/i) || text.match(/<ul>([\s\S]*?)<\/ul>/);
    if (list) f.attendees = [...list[1].matchAll(/<li>(.*?)<\/li>/g)].map(m => decode(m[1]));
    return f;
}

function decode(s) {
    return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#96;/g, '`');
}

const EXTRACTORS = {
    'sw:txt': factsFromLines, 'sw:ai': factsFromLines, 'viewer:txt': factsFromLines,
    'sw:md': factsFromMarkdown, 'viewer:md': factsFromMarkdown,
    'sw:json': factsFromJson, 'viewer:json': factsFromJson,
    'sw:html': factsFromHtml, 'sw:doc': factsFromDoc
};

// Reduce raw facts to the comparable summary
function summarise(name, f) {
    const counts = { caption: 0, chat: 0, slide: 0, attendance: 0 };
    f.events.forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });
    const captions = f.events.filter(e => e.type === 'caption');
    const nonCaptionOrder = f.events.filter(e => e.type !== 'caption').map(e => `${e.type[0]}@${e.time}`).join(' ');
    const attendance = f.events.filter(e => e.type === 'attendance').map(e => `${e.name}:${e.text.startsWith('joined') ? 'in' : 'out'}`).join(', ');
    return {
        attendees: f.attendees ? f.attendees.slice().sort().join(', ') : '(none)',
        attendance,
        'slides (count)': String(counts.slide),
        'chat (count)': String(counts.chat),
        'captions (count)': String(counts.caption),
        'non-caption order': nonCaptionOrder,
        'first caption': captions.length ? `${captions[0].time} ${captions[0].name}` : '(none)',
        'last caption text': captions.length ? captions[captions.length - 1].text.slice(-60) : '(none)',
        'slide files': f.slideFiles.join(', ') || '(none)',
        _compacted: name === 'sw:ai'
    };
}

// Facts that legitimately differ for a format are excused here, everything else must agree
const EXCUSED = {
    'sw:ai': new Set(['captions (count)', 'first caption']),            // paragraphs are merged by design
    'sw:doc': new Set(['slide files']),                                 // Word export has no packaged images
    'sw:html': new Set(['slide files']),                                // HTML inlines images instead
    'sw:json': new Set(['attendance', 'non-caption order']),            // raw entries: attendance lives in a separate object
    'viewer:json': new Set([])
};

function compare(summaries) {
    const names = Object.keys(summaries);
    const facts = Object.keys(summaries[names[0]]).filter(k => !k.startsWith('_'));
    const divergences = [];
    for (const fact of facts) {
        const groups = new Map();
        for (const n of names) {
            if (EXCUSED[n] && EXCUSED[n].has(fact)) continue;
            let v = summaries[n][fact];
            if (fact === 'last caption text' && summaries[n]._compacted) {
                // AI merges paragraphs: compare on the tail of the text only
                const others = names.filter(o => o !== n && !summaries[o]._compacted).map(o => summaries[o][fact]);
                if (others.some(o => v.endsWith(o.slice(-30)))) v = others[0];
            }
            if (!groups.has(v)) groups.set(v, []);
            groups.get(v).push(n);
        }
        if (groups.size > 1) divergences.push({ fact, groups: [...groups.entries()] });
    }
    return { facts, divergences };
}

// ---------------------------------------------------------------------------
async function main() {
    const arg = process.argv[2];
    const sw = loadServiceWorker();
    await new Promise(r => setTimeout(r, 50)); // let the sandboxed session manager finish its (stubbed) init
    const viewerFactory = loadViewerFormatters();

    const inputs = arg ? [loadJsonExport(path.resolve(arg))] : (() => { const fx = buildFixture(); return [fx, legacyVariant(fx)]; })();
    let total = 0;

    for (const fx of inputs) {
        console.log(`\n=== ${fx.label}: ${fx.transcript.length} entries, ${fx.attendeeReport && fx.attendeeReport.attendeeHistory ? fx.attendeeReport.attendeeHistory.length : 0} attendance history rows ===`);
        const outputs = await renderAll(sw, viewerFactory, fx);
        const summaries = {};
        for (const [name, text] of Object.entries(outputs)) {
            try { summaries[name] = summarise(name, EXTRACTORS[name](text)); }
            catch (e) { summaries[name] = { error: e.message }; console.log(`  ${name}: could not parse output (${e.message})`); }
        }
        const { facts, divergences } = compare(summaries);

        // Fact table
        const names = Object.keys(summaries);
        const col = Math.max(...names.map(n => n.length));
        for (const fact of facts) {
            console.log(`\n  ${fact}`);
            for (const n of names) console.log(`    ${n.padEnd(col)}  ${summaries[n][fact]}`);
        }

        console.log(`\n  ${divergences.length === 0 ? 'All formats agree.' : divergences.length + ' divergence(s):'}`);
        for (const d of divergences) {
            console.log(`  - ${d.fact}`);
            for (const [value, who] of d.groups) console.log(`      ${who.join(', ')}: ${value}`);
        }
        total += divergences.length;

        if (process.env.DUMP_DIR) {
            fs.mkdirSync(process.env.DUMP_DIR, { recursive: true });
            for (const [name, text] of Object.entries(outputs)) fs.writeFileSync(path.join(process.env.DUMP_DIR, `${fx.label.replace(/[^a-z0-9]+/gi, '_')}-${name.replace(':', '-')}.txt`), text);
        }
    }

    console.log(`\nTotal divergences: ${total}`);
    process.exit(Math.min(total, 100));
}

main().catch(err => { console.error(err); process.exit(101); });
