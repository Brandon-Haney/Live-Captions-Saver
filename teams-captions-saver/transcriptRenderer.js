// Live Captions Saver - Transcript Renderer
//
// Shared rendering + analytics used by three consumers:
//   - viewer.js (live viewer): renderEntryHTML / calculateAnalytics / renderAnalyticsHTML
//   - service_worker.js (HTML export via importScripts): buildStandaloneDocument
//   - viewer.js "Save as HTML": buildStandaloneDocument
//
// Entry types: 'caption' (default), 'chat', 'attendance', 'slide'.
// Images are referenced by `imageId` (slides, embedded attachments) and resolved
// through opts.resolveImage so the viewer can serve them from its cache and the
// standalone export can inline them as data URLs.
const TranscriptRenderer = (() => {
    'use strict';

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Only allow image sources that cannot run script in the exported page.
    function safeImageSrc(url) {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (/^data:image\//i.test(trimmed)) return trimmed;
        if (/^blob:/i.test(trimmed)) return trimmed;
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        return null;
    }

    const ICONS = {
        copy: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>',
        chat: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
        caption: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
        slide: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
    };

    function displayNameFor(item, aliases) {
        const original = item.Name || '';
        const alias = aliases && original ? aliases[original] : null;
        return { displayName: alias || original || 'Unknown', hasAlias: !!alias };
    }

    /** Every imageId referenced by a list of entries (slides and embedded attachments). */
    function collectImageIds(entries) {
        const ids = new Set();
        (entries || []).forEach(item => {
            if (item.imageId) ids.add(item.imageId);
            (item.attachments || []).forEach(att => { if (att.imageId) ids.add(att.imageId); });
        });
        return [...ids];
    }

    function defaultResolveImage(ref) {
        return safeImageSrc(ref && ref.url);
    }

    function renderAttachments(item, resolveImage) {
        if (!item.attachments || item.attachments.length === 0) return '';
        const thumbs = item.attachments.map(att => {
            const src = safeImageSrc(resolveImage({ imageId: att.imageId, url: att.url }));
            if (!src) return '';
            const label = att.filename || att.alt || 'Image attachment';
            return `
                <div class="attachment-thumbnail"
                     data-image-url="${escapeHtml(src)}"
                     data-image-caption="${escapeHtml(label)}"
                     title="${escapeHtml(label)}">
                    <img src="${escapeHtml(src)}" alt="${escapeHtml(att.alt || 'Image attachment')}" class="attachment-image" loading="lazy">
                </div>`;
        }).join('');
        return thumbs ? `<div class="attachment-container">${thumbs}</div>` : '';
    }

    function renderAttendance(item, aliases) {
        const actionClass = item.action || ((item.Text || '').includes('joined') ? 'joined' : 'left');
        const { displayName } = displayNameFor(item, aliases);
        return `
            <div class="attendance-event ${actionClass}" data-type="attendance" data-action="${actionClass}">
                <span class="attendance-icon">●</span>
                <span class="name">${escapeHtml(displayName)}</span>
                <span class="attendance-text">${escapeHtml(item.Text)}</span>
                <span class="time">${escapeHtml(item.Time)}</span>
            </div>
        `;
    }

    function renderSlide(item, index, opts) {
        const { displayName, hasAlias } = displayNameFor(item, opts.aliases);
        const src = safeImageSrc(opts.resolveImage({ imageId: item.imageId, url: null }));
        const slideLabel = item.slideNumber ? `Slide ${item.slideNumber}` : 'Shared content';
        const caption = `${slideLabel}${displayName && displayName !== 'Unknown' ? ' — ' + displayName : ''} (${item.Time || ''})`;
        const imageHtml = src
            ? `<div class="attachment-thumbnail slide-thumbnail"
                     data-image-url="${escapeHtml(src)}"
                     data-image-caption="${escapeHtml(caption)}"
                     title="${escapeHtml(caption)}">
                    <img src="${escapeHtml(src)}" alt="${escapeHtml(slideLabel)}" class="attachment-image slide-image" loading="lazy">
                </div>`
            : `<div class="slide-missing">Image not available</div>`;
        const seen = item.seenEarlier ? '<span class="slide-seen" title="This slide was shown earlier in the meeting">seen earlier</span>' : '';
        return `
            <div class="caption slide-entry" data-speaker="${escapeHtml(item.Name)}" data-original-speaker="${escapeHtml(item.Name)}" data-index="${index}" data-type="slide" data-image-id="${escapeHtml(item.imageId || '')}">
                <span class="time">${escapeHtml(item.Time)}</span>
                <div class="caption-content">
                    <span class="message-type" title="Shared content">${ICONS.slide}</span>
                    <span class="caption-header">
                        <span class="name ${hasAlias ? 'has-alias' : ''}"
                              data-original="${escapeHtml(item.Name)}"
                              title="${hasAlias ? 'Original: ' + escapeHtml(item.Name) : ''}">
                            ${escapeHtml(displayName)}
                        </span>
                        <span class="slide-badge">${escapeHtml(slideLabel)}</span>
                        ${seen}
                    </span>
                    <span class="text">${escapeHtml(item.Text || slideLabel)}</span>
                    <div class="slide-image-wrap">${imageHtml}</div>
                </div>
            </div>
        `;
    }

    /**
     * Render one transcript entry.
     * @param {Object} item   transcript entry
     * @param {number} index  position in the rendered list (used for data-index)
     * @param {Object} [opts] { aliases, resolveImage({imageId,url}) -> src|null, interactive }
     */
    function renderEntryHTML(item, index, opts) {
        opts = Object.assign({ aliases: {}, resolveImage: defaultResolveImage, interactive: false }, opts || {});
        if (!item) return '';
        if (item.Type === 'attendance') return renderAttendance(item, opts.aliases);
        if (item.Type === 'slide') return renderSlide(item, index, opts);

        const isChat = item.Type === 'chat';
        const typeClass = isChat ? 'chat-message' : 'caption-message';
        const typeIcon = isChat ? ICONS.chat : ICONS.caption;
        const typeLabel = isChat ? 'Chat' : 'Caption';
        const { displayName, hasAlias } = displayNameFor(item, opts.aliases);

        let displayText = item.Text || '';
        const hasAttachments = item.attachments && item.attachments.length > 0;
        if (hasAttachments) displayText = displayText.replace(/\[Image:[^\]]*\]/g, '').trim();
        const attachmentsHTML = renderAttachments(item, opts.resolveImage);
        const attachmentIcon = hasAttachments ? '<span class="attachment-icon" title="Has attachments">📎</span>' : '';

        const copyButton = opts.interactive
            ? `<button class="copy-btn" title="Copy this line" aria-label="Copy this line">${ICONS.copy}<span class="tooltip-text">Copy</span></button>`
            : '';

        return `
            <div class="caption ${typeClass}" data-speaker="${escapeHtml(item.Name)}" data-original-speaker="${escapeHtml(item.Name)}" data-index="${index}" data-type="${item.Type || 'caption'}">
                ${copyButton}
                <span class="time">${escapeHtml(item.Time)}</span>
                <div class="caption-content">
                    <span class="message-type" title="${typeLabel}">${typeIcon}</span>
                    <span class="caption-header">
                        <span class="name ${hasAlias ? 'has-alias' : ''}"
                              data-original="${escapeHtml(item.Name)}"
                              title="${hasAlias ? 'Original: ' + escapeHtml(item.Name) : ''}">
                            ${escapeHtml(displayName)}
                        </span>
                        ${attachmentIcon}
                    </span>
                    <span class="text">${escapeHtml(displayText)}</span>
                    ${attachmentsHTML}
                </div>
            </div>
        `;
    }

    /** Speaker statistics over spoken captions, plus slide counts per presenter. */
    function calculateAnalytics(entries) {
        if (!entries || entries.length === 0) return null;
        const spoken = entries.filter(e => e && e.Type !== 'attendance' && e.Type !== 'chat' && e.Type !== 'slide');
        const slides = entries.filter(e => e && e.Type === 'slide');
        const chats = entries.filter(e => e && e.Type === 'chat');
        if (spoken.length === 0 && slides.length === 0 && chats.length === 0) return null;

        const speakerStats = {};
        let totalWords = 0;
        spoken.forEach(caption => {
            const speaker = caption.Name;
            if (!speaker) return;
            const words = (caption.Text || '').split(/\s+/).filter(w => w.length > 0).length;
            if (!speakerStats[speaker]) {
                speakerStats[speaker] = { messageCount: 0, wordCount: 0, slideCount: 0, firstMessage: caption.Time, lastMessage: caption.Time };
            }
            speakerStats[speaker].messageCount++;
            speakerStats[speaker].wordCount += words;
            speakerStats[speaker].lastMessage = caption.Time;
            totalWords += words;
        });
        slides.forEach(slide => {
            const presenter = slide.Name;
            if (!presenter) return;
            if (!speakerStats[presenter]) {
                speakerStats[presenter] = { messageCount: 0, wordCount: 0, slideCount: 0, firstMessage: slide.Time, lastMessage: slide.Time };
            }
            speakerStats[presenter].slideCount++;
        });
        Object.keys(speakerStats).forEach(speaker => {
            speakerStats[speaker].wordPercentage = totalWords > 0
                ? ((speakerStats[speaker].wordCount / totalWords) * 100).toFixed(1)
                : '0.0';
        });

        return {
            totalMessages: spoken.length,
            totalWords,
            totalChat: chats.length,
            totalSlides: slides.length,
            uniqueSlides: new Set(slides.map(s => s.imageId).filter(Boolean)).size,
            uniqueSpeakers: Object.keys(speakerStats).length,
            speakerStats
        };
    }

    /** Inner HTML for the analytics panel (viewer and standalone share it). */
    function renderAnalyticsHTML(analytics, aliases) {
        if (!analytics) return '';
        const name = (speaker) => escapeHtml((aliases && aliases[speaker]) || speaker);
        const sorted = Object.entries(analytics.speakerStats).sort((a, b) => b[1].wordCount - a[1].wordCount);
        const tile = (value, label, color) => `
            <div class="analytics-tile">
                <div class="analytics-value" style="color:${color}">${value}</div>
                <div class="analytics-label">${label}</div>
            </div>`;
        let html = `
            <h3 class="analytics-title">Meeting Analytics</h3>
            <div class="analytics-grid">
                ${tile(analytics.totalMessages, 'Total Messages', '#17a2b8')}
                ${tile(analytics.totalWords, 'Total Words', '#28a745')}
                ${tile(analytics.uniqueSpeakers, 'Speakers', '#ffc107')}
                ${analytics.totalSlides ? tile(`${analytics.totalSlides}${analytics.uniqueSlides && analytics.uniqueSlides !== analytics.totalSlides ? ' <small>(' + analytics.uniqueSlides + ' unique)</small>' : ''}`, 'Slides Shared', '#6f42c1') : ''}
                ${analytics.totalChat ? tile(analytics.totalChat, 'Chat Messages', '#0078d4') : ''}
            </div>
            <h4 class="analytics-subtitle">Speaker Participation</h4>
            <div class="analytics-speakers">`;
        sorted.slice(0, 5).forEach(([speaker, stats]) => {
            const extra = stats.slideCount ? ` · ${stats.slideCount} slide${stats.slideCount === 1 ? '' : 's'}` : '';
            html += `
                <div class="analytics-speaker">
                    <div class="analytics-speaker-row">
                        <span class="analytics-speaker-name">${name(speaker)}</span>
                        <span class="analytics-speaker-stat">${stats.wordCount} words (${stats.wordPercentage}%)${extra}</span>
                    </div>
                    <div class="analytics-bar"><div class="analytics-bar-fill" style="width:${stats.wordPercentage}%"></div></div>
                </div>`;
        });
        if (sorted.length > 5) {
            html += `<div class="analytics-more">...and ${sorted.length - 5} more speakers</div>`;
        }
        html += '</div>';
        return html;
    }

    /** Merge attendee join/leave history into the transcript chronologically. */
    function mergeAttendanceEvents(transcript, attendeeHistory) {
        const combined = [...(transcript || [])];
        (attendeeHistory || []).forEach(event => {
            combined.push({
                Time: event.time,
                Name: event.name,
                Text: event.action === 'joined' ? `joined the meeting${event.role ? ' (' + event.role + ')' : ''}` : 'left the meeting',
                Type: 'attendance',
                action: event.action,
                sortKey: new Date(event.time).getTime()
            });
        });
        combined.sort((a, b) => {
            const ta = a.sortKey || (a.timestamp ? new Date(a.timestamp).getTime() : 0) || new Date(a.Time).getTime() || 0;
            const tb = b.sortKey || (b.timestamp ? new Date(b.timestamp).getTime() : 0) || new Date(b.Time).getTime() || 0;
            return ta - tb;
        });
        return combined;
    }

    function attendeeListFor(entries, attendeeReport) {
        if (attendeeReport && attendeeReport.totalUniqueAttendees > 0 && Array.isArray(attendeeReport.attendeeList)) {
            return attendeeReport.attendeeList;
        }
        return [...new Set(
            (entries || [])
                .filter(e => e && e.Type !== 'attendance' && e.Type !== 'slide')
                .map(e => e.Name)
                .filter(n => n && n.trim())
        )].sort();
    }

    const STANDALONE_CSS = `
:root { color-scheme: light dark; --bg:#f5f6f8; --panel:#ffffff; --text:#1f2937; --muted:#6b7280; --line:#e5e7eb; --accent:#0078d4; --chat:#f0f7ff; --slide:#f6f2fb; --slide-border:#6f42c1; --join:#16a34a; --leave:#dc2626; --hl:#fff3b0; }
@media (prefers-color-scheme: dark) { :root { --bg:#111418; --panel:#1b1f26; --text:#e5e7eb; --muted:#9ca3af; --line:#2a2f38; --chat:#15233a; --slide:#221b33; --hl:#6b5b00; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; font-size:15px; line-height:1.5; }
.page { max-width:1100px; margin:0 auto; padding:24px 16px 60px; }
header.meta { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:20px 24px; margin-bottom:16px; }
header.meta h1 { margin:0 0 8px; font-size:24px; }
.meta-row { color:var(--muted); font-size:13px; display:flex; flex-wrap:wrap; gap:6px 18px; }
.meta-row b { color:var(--text); font-weight:600; }
details.attendees { margin-top:10px; font-size:13px; color:var(--muted); }
details.attendees ul { margin:6px 0 0; padding-left:18px; columns:2; }
#meeting-analytics { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px 20px; margin-bottom:16px; }
.analytics-title { margin:0 0 12px; font-size:16px; } .analytics-subtitle { margin:14px 0 8px; font-size:14px; color:var(--muted); }
.analytics-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; }
.analytics-value { font-size:24px; font-weight:700; } .analytics-value small { font-size:12px; font-weight:400; color:var(--muted); }
.analytics-label { font-size:12px; color:var(--muted); }
.analytics-speaker { margin-bottom:8px; } .analytics-speaker-row { display:flex; justify-content:space-between; font-size:13px; margin-bottom:2px; }
.analytics-speaker-stat, .analytics-more { color:var(--muted); font-size:12px; }
.analytics-bar { background:var(--line); border-radius:4px; height:14px; overflow:hidden; }
.analytics-bar-fill { background:linear-gradient(90deg,#17a2b8,#28a745); height:100%; }
.toolbar { position:sticky; top:0; z-index:5; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:12px 16px; margin-bottom:12px; display:flex; flex-wrap:wrap; gap:10px; align-items:center; }
.toolbar input[type=search] { flex:1 1 220px; padding:8px 10px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--text); font-size:14px; }
.toolbar .types label { margin-right:10px; font-size:13px; color:var(--muted); cursor:pointer; white-space:nowrap; }
.speakers { display:flex; flex-wrap:wrap; gap:6px; width:100%; }
.speakers button { border:1px solid var(--line); background:var(--bg); color:var(--text); border-radius:14px; padding:3px 10px; font-size:12px; cursor:pointer; }
.speakers button.active { background:var(--accent); border-color:var(--accent); color:#fff; }
.count { font-size:12px; color:var(--muted); margin-left:auto; }
#captions-container { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:4px 20px; }
.caption { padding:12px 0; border-bottom:1px solid var(--line); position:relative; display:flex; gap:14px; }
.caption:last-child { border-bottom:none; }
.caption > .time { flex:0 0 78px; color:var(--muted); font-size:12px; padding-top:3px; font-variant-numeric:tabular-nums; }
.caption-content { flex:1; min-width:0; }
.message-type { display:inline-block; vertical-align:middle; margin-right:6px; color:var(--muted); }
.message-type svg { width:14px; height:14px; vertical-align:-2px; }
.caption-header { display:inline; } .caption-header .name { font-weight:600; }
.caption .text { display:block; margin-top:2px; white-space:pre-wrap; word-break:break-word; }
.chat-message { background:var(--chat); border-left:3px solid var(--accent); padding-left:12px; margin:4px 0; border-radius:4px; }
.slide-entry { background:var(--slide); border-left:3px solid var(--slide-border); padding-left:12px; margin:6px 0; border-radius:4px; }
.slide-badge { display:inline-block; margin-left:8px; font-size:11px; font-weight:600; color:#fff; background:var(--slide-border); border-radius:10px; padding:1px 8px; vertical-align:middle; }
.slide-seen { display:inline-block; margin-left:6px; font-size:11px; color:var(--muted); font-style:italic; }
.slide-entry .text { font-size:12px; color:var(--muted); }
.slide-image-wrap { margin-top:8px; }
.slide-missing { font-size:12px; color:var(--muted); font-style:italic; }
.attachment-container { margin-top:8px; }
.attachment-thumbnail { display:inline-block; cursor:zoom-in; border:1px solid var(--line); border-radius:8px; overflow:hidden; background:#111; max-width:100%; }
.attachment-thumbnail img { display:block; max-width:min(100%,720px); max-height:420px; }
.attendance-event { background:var(--bg); border-left:3px solid #9ca3af; padding:6px 12px; margin:8px 0; text-align:center; font-style:italic; color:var(--muted); border-radius:4px; font-size:13px; }
.attendance-event.joined { border-left-color:var(--join); } .attendance-event.left { border-left-color:var(--leave); }
.attendance-event .name { font-weight:600; margin:0 4px; } .attendance-event .time { margin-left:8px; font-size:11px; }
mark { background:var(--hl); color:inherit; padding:0 1px; border-radius:2px; }
.hidden { display:none !important; }
#lightbox { position:fixed; inset:0; background:rgba(0,0,0,.88); display:none; align-items:center; justify-content:center; flex-direction:column; z-index:50; cursor:zoom-out; padding:20px; }
#lightbox.active { display:flex; }
#lightbox img { max-width:96vw; max-height:86vh; box-shadow:0 10px 40px rgba(0,0,0,.6); border-radius:6px; }
#lightbox .lb-caption { color:#e5e7eb; margin-top:12px; font-size:14px; }
footer { margin-top:20px; font-size:12px; color:var(--muted); text-align:center; }
@media print { .toolbar, #lightbox { display:none !important; } .caption { break-inside:avoid; } body { background:#fff; } }
`;

    const STANDALONE_JS = `
(function () {
  var search = document.getElementById('search-box');
  var container = document.getElementById('captions-container');
  var rows = Array.prototype.slice.call(container.querySelectorAll('.caption, .attendance-event'));
  var speakerBtns = Array.prototype.slice.call(document.querySelectorAll('.speakers button'));
  var typeBoxes = Array.prototype.slice.call(document.querySelectorAll('.types input'));
  var countEl = document.getElementById('visible-count');
  var lightbox = document.getElementById('lightbox');
  var lbImg = lightbox.querySelector('img');
  var lbCap = lightbox.querySelector('.lb-caption');
  var activeSpeaker = null;

  function unmark(el) {
    el.querySelectorAll('mark').forEach(function (m) { var t = document.createTextNode(m.textContent); m.parentNode.replaceChild(t, m); });
    el.normalize();
  }
  function mark(el, term) {
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = []; var n;
    while ((n = walker.nextNode())) nodes.push(n);
    var re = new RegExp(term.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'), 'ig');
    nodes.forEach(function (node) {
      if (!re.test(node.textContent)) return;
      re.lastIndex = 0;
      var frag = document.createDocumentFragment(); var last = 0; var text = node.textContent; var m;
      while ((m = re.exec(text))) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var mk = document.createElement('mark'); mk.textContent = m[0]; frag.appendChild(mk);
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }
  function apply() {
    var term = (search.value || '').trim().toLowerCase();
    var types = {};
    typeBoxes.forEach(function (b) { types[b.value] = b.checked; });
    var visible = 0;
    rows.forEach(function (row) {
      var type = row.getAttribute('data-type') || 'caption';
      var speaker = row.getAttribute('data-original-speaker') || (row.querySelector('.name') || {}).textContent || '';
      var textEl = row.querySelector('.text');
      var text = (textEl ? textEl.textContent : row.textContent).toLowerCase();
      var ok = types[type] !== false;
      if (ok && activeSpeaker && type !== 'attendance' && speaker.trim() !== activeSpeaker) ok = false;
      if (ok && activeSpeaker && type === 'attendance') ok = false;
      if (ok && term && text.indexOf(term) === -1 && speaker.toLowerCase().indexOf(term) === -1) ok = false;
      row.classList.toggle('hidden', !ok);
      unmark(row);
      if (ok && term && textEl) mark(textEl, term);
      if (ok) visible++;
    });
    countEl.textContent = visible + ' of ' + rows.length + ' shown';
  }
  search.addEventListener('input', apply);
  typeBoxes.forEach(function (b) { b.addEventListener('change', apply); });
  speakerBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      speakerBtns.forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeSpeaker = btn.getAttribute('data-speaker') || null;
      apply();
    });
  });
  // Scale the enlarged image to fill the viewport even when the source is small
  function fitLb() {
    var nw = lbImg.naturalWidth, nh = lbImg.naturalHeight;
    if (!nw || !nh) return;
    var s = Math.min(window.innerWidth * 0.96 / nw, window.innerHeight * 0.86 / nh);
    lbImg.style.width = Math.round(nw * s) + 'px';
    lbImg.style.height = Math.round(nh * s) + 'px';
  }
  lbImg.addEventListener('load', fitLb);
  window.addEventListener('resize', function () { if (lightbox.classList.contains('active')) fitLb(); });
  container.addEventListener('click', function (e) {
    var thumb = e.target.closest('.attachment-thumbnail');
    if (!thumb) return;
    lbImg.style.width = ''; lbImg.style.height = '';
    lbImg.src = thumb.getAttribute('data-image-url');
    if (lbImg.complete) fitLb();
    lbCap.textContent = thumb.getAttribute('data-image-caption') || '';
    lightbox.classList.add('active');
  });
  function closeLb() { lightbox.classList.remove('active'); lbImg.src = ''; lbImg.style.width = ''; lbImg.style.height = ''; }
  lightbox.addEventListener('click', closeLb);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLb(); if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); search.focus(); } });
  apply();
})();
`;

    /**
     * Build a self-contained HTML document.
     * @param {Object} p
     * @param {string} p.meetingTitle
     * @param {string} [p.platform]
     * @param {Array}  p.entries            transcript entries (captions, chat, slides)
     * @param {Object} [p.attendeeReport]   { attendeeList, totalUniqueAttendees, attendeeHistory, meetingStartTime }
     * @param {Object} [p.images]           imageId -> data URL (or record with dataUrl)
     * @param {Object} [p.aliases]          original name -> display name
     * @param {string|Date} [p.recordingStartTime]
     * @param {boolean} [p.includeAttendance=true]
     */
    function buildStandaloneDocument(p) {
        p = p || {};
        const title = p.meetingTitle || 'Meeting Transcript';
        const aliases = p.aliases || {};
        const images = p.images || {};
        const report = p.attendeeReport || null;
        const includeAttendance = p.includeAttendance !== false;

        const resolveImage = (ref) => {
            if (ref && ref.imageId && images[ref.imageId]) {
                const rec = images[ref.imageId];
                return typeof rec === 'string' ? rec : rec.dataUrl;
            }
            return safeImageSrc(ref && ref.url);
        };

        const entries = includeAttendance && report && Array.isArray(report.attendeeHistory)
            ? mergeAttendanceEvents(p.entries, report.attendeeHistory)
            : [...(p.entries || [])];

        const attendees = attendeeListFor(p.entries, report);
        const analytics = calculateAnalytics(entries);
        const speakers = [...new Set(entries.filter(e => e.Type !== 'attendance').map(e => e.Name).filter(Boolean))];
        const counts = { caption: 0, chat: 0, slide: 0, attendance: 0 };
        entries.forEach(e => { const t = e.Type === 'chat' || e.Type === 'slide' || e.Type === 'attendance' ? e.Type : 'caption'; counts[t]++; });

        const start = p.recordingStartTime ? new Date(p.recordingStartTime) : (report && report.meetingStartTime ? new Date(report.meetingStartTime) : null);
        const startText = start && !isNaN(start.getTime()) ? start.toLocaleString() : '';
        const generated = new Date().toLocaleString();

        const body = entries.map((item, i) => renderEntryHTML(item, i, { aliases, resolveImage, interactive: false })).join('');

        const typeBox = (value, label, count) => count
            ? `<label><input type="checkbox" value="${value}" checked> ${label} (${count})</label>`
            : '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STANDALONE_CSS}</style>
</head>
<body>
<div class="page">
  <header class="meta">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta-row">
      ${p.platform ? `<span><b>Platform:</b> ${escapeHtml(p.platform)}</span>` : ''}
      ${startText ? `<span><b>Started:</b> ${escapeHtml(startText)}</span>` : ''}
      <span><b>Captions:</b> ${counts.caption}</span>
      ${counts.chat ? `<span><b>Chat:</b> ${counts.chat}</span>` : ''}
      ${counts.slide ? `<span><b>Slides:</b> ${counts.slide}</span>` : ''}
      <span><b>Attendees:</b> ${attendees.length}</span>
    </div>
    ${attendees.length ? `<details class="attendees"><summary>Attendee list</summary><ul>${attendees.map(a => `<li>${escapeHtml((aliases[a]) || a)}</li>`).join('')}</ul></details>` : ''}
  </header>
  ${analytics ? `<div id="meeting-analytics">${renderAnalyticsHTML(analytics, aliases)}</div>` : ''}
  <div class="toolbar">
    <input type="search" id="search-box" placeholder="Search transcript..." aria-label="Search transcript">
    <span class="types">
      ${typeBox('caption', 'Captions', counts.caption)}
      ${typeBox('chat', 'Chat', counts.chat)}
      ${typeBox('slide', 'Slides', counts.slide)}
      ${typeBox('attendance', 'Joins & leaves', counts.attendance)}
    </span>
    <span class="count" id="visible-count"></span>
    <div class="speakers">
      <button class="active" data-speaker="">All speakers</button>
      ${speakers.map(s => `<button data-speaker="${escapeHtml(s)}">${escapeHtml(aliases[s] || s)}</button>`).join('')}
    </div>
  </div>
  <div id="captions-container">${body || '<p>No captions to display.</p>'}</div>
  <footer>Exported by Live Captions Saver on ${escapeHtml(generated)}</footer>
</div>
<div id="lightbox" role="dialog" aria-label="Image preview"><img alt=""><div class="lb-caption"></div></div>
<script>${STANDALONE_JS}</script>
</body>
</html>`;
    }

    return {
        escapeHtml,
        safeImageSrc,
        ICONS,
        collectImageIds,
        renderEntryHTML,
        calculateAnalytics,
        renderAnalyticsHTML,
        mergeAttendanceEvents,
        attendeeListFor,
        buildStandaloneDocument
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = TranscriptRenderer;
}
