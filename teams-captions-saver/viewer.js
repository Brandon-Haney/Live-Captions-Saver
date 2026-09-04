// Global interval references for cleanup
let connectionCheckInterval = null;
let notificationStyleAdded = false;

// Global variables for save functionality
let currentMeetingTitle = 'Untitled Meeting';
let currentPlatform = '';
let currentFilteredSpeaker = null;
let currentAttendeeReport = null;

// Helper to generate platform badge HTML (VW-20: centralized to avoid duplication)
function createPlatformBadge(platform) {
    if (!platform) return '';
    const platformName = platform.toUpperCase().replace('MICROSOFT TEAMS', 'TEAMS').replace('GOOGLE MEET', 'MEET');
    return `<span class="platform-badge" data-platform="${platformName}">${platformName}</span>`;
}

// SRT subtitle format helper functions
function parseSafeTimestamp(timestampValue) {
    if (!timestampValue) return 0;
    try {
        const parsed = new Date(timestampValue).getTime();
        return isNaN(parsed) ? 0 : parsed;
    } catch (error) {
        return 0;
    }
}

function formatSrtTimestamp(ms) {
    if (ms < 0) ms = 0;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

function formatAsSrt(captions, userRecordingStartTime) {
    const validCaptions = captions.filter(entry => entry.Type !== 'attendance' && entry.Type !== 'chat');

    if (validCaptions.length === 0) {
        return '1\n00:00:00,000 --> 00:00:03,000\n(No captions available)\n';
    }

    const recordingStart = new Date(userRecordingStartTime).getTime();
    if (isNaN(recordingStart)) {
        return '1\n00:00:00,000 --> 00:00:03,000\n(Invalid recording start time)\n';
    }

    // Sort by timestamp
    const sortedCaptions = [...validCaptions].sort((a, b) => {
        return parseSafeTimestamp(a.timestamp) - parseSafeTimestamp(b.timestamp);
    });

    const srtEntries = [];

    for (let i = 0; i < sortedCaptions.length; i++) {
        const entry = sortedCaptions[i];
        const captionTime = parseSafeTimestamp(entry.timestamp);
        if (captionTime === 0) continue;

        let startMs = captionTime - recordingStart;
        if (startMs < 0) continue;

        let endMs;
        if (i < sortedCaptions.length - 1) {
            const nextCaptionTime = parseSafeTimestamp(sortedCaptions[i + 1].timestamp);
            endMs = nextCaptionTime - recordingStart - 100;
            if (endMs - startMs > 7000) endMs = startMs + 7000;
        } else {
            const wordCount = (entry.Text || '').split(/\s+/).length;
            endMs = startMs + Math.min(7000, Math.max(2000, wordCount * 300));
        }

        if (endMs <= startMs) endMs = startMs + 2000;

        srtEntries.push({
            index: srtEntries.length + 1,
            startMs,
            endMs,
            speaker: entry.Name || 'Unknown',
            text: entry.Text || ''
        });
    }

    if (srtEntries.length === 0) {
        return '1\n00:00:00,000 --> 00:00:03,000\n(No captions within recording timeframe)\n';
    }

    return srtEntries.map(entry => {
        const startTime = formatSrtTimestamp(entry.startMs);
        const endTime = formatSrtTimestamp(entry.endMs);
        return `${entry.index}\n${startTime} --> ${endTime}\n[${entry.speaker}] ${entry.text}\n`;
    }).join('\n');
}

// Cleanup function to prevent memory leaks
function cleanupViewerIntervals() {
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanupViewerIntervals);
window.addEventListener('unload', cleanupViewerIntervals);

// Wait for DOM to be ready before setting up image modal
document.addEventListener('DOMContentLoaded', () => {
    // Image modal functions
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const modalCaption = document.getElementById('modalCaption');
    const imageModalClose = document.getElementById('imageModalClose');

    // Size the enlarged image to fill the viewport (within 90vw x 85vh) even when
    // the source is small, e.g. a slide captured from PowerPoint Live presenter view
    function fitModalImage() {
        const nw = modalImage.naturalWidth;
        const nh = modalImage.naturalHeight;
        if (!nw || !nh) return;
        const scale = Math.min((window.innerWidth * 0.9) / nw, (window.innerHeight * 0.85) / nh);
        modalImage.style.width = Math.round(nw * scale) + 'px';
        modalImage.style.height = Math.round(nh * scale) + 'px';
    }

    function openImageModal(imageUrl, caption) {
        modalImage.style.width = '';
        modalImage.style.height = '';
        modalImage.onload = fitModalImage;
        modalImage.src = imageUrl;
        if (modalImage.complete) fitModalImage();
        modalCaption.textContent = caption || '';
        imageModal.classList.add('active');

        // Add keyboard handler for ESC key
        document.addEventListener('keydown', handleModalEscape);
    }

    function closeImageModal() {
        imageModal.classList.remove('active');
        modalImage.onload = null;
        modalImage.src = ''; // Clear the image source
        modalImage.style.width = '';
        modalImage.style.height = '';

        // Remove keyboard handler
        document.removeEventListener('keydown', handleModalEscape);
    }

    function handleModalEscape(event) {
        if (event.key === 'Escape') {
            closeImageModal();
        }
    }

    // Set up event listeners for image modal
    if (imageModal) {
        // Click outside to close
        imageModal.addEventListener('click', (event) => {
            if (event.target === imageModal) {
                closeImageModal();
            }
        });

        // Close button
        if (imageModalClose) {
            imageModalClose.addEventListener('click', closeImageModal);
        }

        window.addEventListener('resize', () => {
            if (imageModal.classList.contains('active')) fitModalImage();
        });
    }

    // Event delegation for attachment thumbnails
    document.addEventListener('click', (event) => {
        const thumbnail = event.target.closest('.attachment-thumbnail');
        if (thumbnail) {
            const imageUrl = thumbnail.dataset.imageUrl;
            const imageCaption = thumbnail.dataset.imageCaption;
            if (imageUrl) {
                openImageModal(imageUrl, imageCaption);
            }
        }
    });
});

document.addEventListener('DOMContentLoaded', () => {
    // --- Debug Configuration ---
    // Set to true to enable verbose console logging for troubleshooting
    const DEBUG = false;

    // Debug logger wrapper
    const debug = {
        log: (...args) => DEBUG && console.log(...args),
        warn: (...args) => DEBUG && console.warn(...args),
        error: (...args) => console.error(...args), // Always log errors
        info: (...args) => console.log(...args) // Always log important info
    };

    // --- Security: URL Sanitization ---
    function sanitizeUrl(url) {
        if (!url) return '';

        try {
            const parsed = new URL(url);
            // Only allow http(s) and data protocols for images
            if (!['http:', 'https:', 'data:'].includes(parsed.protocol)) {
                console.warn('[sanitizeUrl] Blocked unsafe URL protocol:', parsed.protocol);
                return '';
            }
            return url;
        } catch (error) {
            console.error('[sanitizeUrl] Invalid URL:', url, error);
            return '';
        }
    }

    // --- DOM Elements ---
    const captionsContainer = document.getElementById('captions-container');
    const searchBox = document.getElementById('search-box');
    const speakerFiltersContainer = document.getElementById('speaker-filters');
    const copyAllBtn = document.getElementById('copy-all-btn');
    const saveAllBtn = document.getElementById('save-all-btn');
    const historyBtn = document.getElementById('history-btn');
    const sessionModal = document.getElementById('sessionModal');
    const sessionListModal = document.getElementById('sessionListModal');
    const closeModal = document.querySelector('.close-modal');

    // Validate critical DOM elements exist
    if (!captionsContainer) {
        console.error('[Viewer] Critical element missing: captions-container');
    }

    // --- State ---
    let allCaptions = [];
    let searchDebounceTimer = null;
    let meetingStartTime = null;
    let meetingEndTime = null;
    const SEARCH_DEBOUNCE_DELAY = 300;

    // Live streaming state
    let isLiveStreaming = false;
    let lastUpdateTime = Date.now();
    let activeSearch = '';
    let autoScroll = true;  // Default to true for auto-following captions
    let pendingUpdates = [];
    let updateTimer = null;
    let viewerSessionId = null;  // Session ID to filter live updates
    let speakerAliases = {};  // Session-specific speaker aliases
    let isNearBottom = true;  // Track if user is near bottom of scroll
    let captionElementsCache = [];  // Performance: Cache caption elements to avoid repeated DOM queries
    let imageCache = {};  // imageId -> data URL (slides, embedded chat attachments)
    let showSlides = true;  // "Slides" toggle in the filter bar

    // Hot Keyword Detection state
    let hotKeywords = {};           // Global keywords (from chrome.storage.sync)
    let sessionKeywords = {};       // Session keywords (in-memory only, cleared on close)
    let hotKeywordSettings = {      // Default settings
        enabled: true,
        flashEnabled: true,
        contextLineCount: 5,
        consolidationWindowMs: 5000
    };
    let lastKeywordAlerts = {};     // Map: keywordId -> timestamp (for consolidation)
    let keywordAlertDismissTimer = null;  // Timer for auto-dismiss
    let captionKeywordDebounceTimers = {};  // Map: captionKey -> timer (debounce keyword checks on updates)
    const KEYWORD_CHECK_DEBOUNCE_MS = 800;  // Wait for caption to settle before checking keywords

    // Clear stale cache entries when switching sessions or clearing view
    function clearCaptionCache() {
        captionElementsCache = [];
    }

    // Rebuild cache from current DOM state - use after filtering or major DOM changes
    function rebuildCaptionCache() {
        captionElementsCache = Array.from(captionsContainer.querySelectorAll('.caption'));
    }

    // --- Utility ---
    function escapeHtml(str) {
        const p = document.createElement("p");
        p.textContent = str;
        return p.innerHTML;
    }

    // --- Hot Keyword Detection Functions ---

    // Load global keywords from storage
    async function loadHotKeywords() {
        try {
            const loaded = await KeywordEngine.loadFromStorage();
            hotKeywords = loaded.keywords;
            hotKeywordSettings = { ...hotKeywordSettings, ...loaded.settings };
            debug.log('[Keywords] Loaded', Object.keys(hotKeywords).length, 'global keywords');
            updateKeywordBadge();
        } catch (error) {
            console.error('[Keywords] Failed to load:', error);
        }
    }

    // Save global keywords to storage
    async function saveHotKeywords() {
        try {
            await chrome.storage.sync.set({ hotKeywords });
            debug.log('[Keywords] Saved', Object.keys(hotKeywords).length, 'global keywords');
            updateKeywordBadge();
        } catch (error) {
            console.error('[Keywords] Failed to save:', error);
            if (error.message?.includes('quota')) {
                showNotification('Too many keywords. Please remove some.', 'error');
            }
        }
    }

    // Save keyword settings
    async function saveHotKeywordSettings() {
        try {
            await chrome.storage.sync.set({ hotKeywordSettings });
        } catch (error) {
            console.error('[Keywords] Failed to save settings:', error);
        }
    }

    // Get all active keywords (global + session)
    function getAllActiveKeywords() {
        return KeywordEngine.getActiveKeywords(hotKeywords, sessionKeywords);
    }

    // Check if caption matches any keywords
    function checkForKeywordMatch(caption) {
        if (!hotKeywordSettings.enabled) {
            console.log('[Keywords] Detection disabled - skipping check');
            return null;
        }

        const activeKeywords = getAllActiveKeywords();

        console.log('[Keywords] Checking caption:', {
            speaker: caption.Name,
            text: (caption.Text || '').substring(0, 50),
            activeKeywordCount: activeKeywords.length,
            keywords: activeKeywords.map(k => k.keyword)
        });

        const match = KeywordEngine.checkForMatch(caption, activeKeywords);
        if (match) {
            console.log('[Keywords] MATCH FOUND:', { keyword: match.keyword, in: (caption.Text || '').substring(0, 100) });
        } else {
            console.log('[Keywords] No match found');
        }
        return match;
    }

    // Check if alert should be consolidated (same keyword within window)
    function shouldConsolidateAlert(keywordId) {
        const windowMs = hotKeywordSettings.consolidationWindowMs || 5000;
        return KeywordEngine.shouldConsolidate(keywordId, lastKeywordAlerts, windowMs);
    }

    // Get context lines before the matched caption
    function getContextLines(captionIndex, lineCount = 5) {
        // Filter to only caption/chat entries (not attendance events)
        const relevantCaptions = allCaptions.filter(c => c.Type !== 'attendance');

        // Find the index in filtered array
        const matchedCaption = allCaptions[captionIndex];
        const filteredIndex = relevantCaptions.findIndex(c => c.key === matchedCaption.key);

        if (filteredIndex === -1) {
            return [{ name: matchedCaption.Name, text: matchedCaption.Text, time: matchedCaption.Time, isMatch: true }];
        }

        const startIndex = Math.max(0, filteredIndex - lineCount + 1);
        const contextCaptions = relevantCaptions.slice(startIndex, filteredIndex + 1);

        return contextCaptions.map((cap, idx) => ({
            name: speakerAliases[cap.Name] || cap.Name,
            text: cap.Text,
            time: cap.Time,
            isMatch: idx === contextCaptions.length - 1
        }));
    }

    // Trigger keyword alert
    function triggerKeywordAlert(caption, match, captionIndex) {
        // Check consolidation
        if (shouldConsolidateAlert(match.id)) {
            // Still highlight the caption but don't show full alert
            highlightKeywordCaption(captionIndex, match.keyword);
            return;
        }

        // Page flash effect
        if (hotKeywordSettings.flashEnabled) {
            document.body.classList.add('page-flash');
            setTimeout(() => document.body.classList.remove('page-flash'), 300);
        }

        // Highlight the caption
        highlightKeywordCaption(captionIndex, match.keyword);

        // Show alert overlay with context (if enabled)
        if (hotKeywordSettings.overlayEnabled !== false) {
            showKeywordAlertOverlay(caption, match, captionIndex);
        }
    }

    // Highlight a caption that contains a keyword match
    function highlightKeywordCaption(captionIndex, keyword) {
        const captionElement = captionsContainer.querySelector(`[data-index="${captionIndex}"]`);
        if (!captionElement) return;

        captionElement.classList.add('keyword-highlight');

        // Highlight the actual keyword in the text
        const textElement = captionElement.querySelector('.text');
        if (textElement) {
            const text = textElement.textContent;
            const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedKeyword})`, 'gi');

            // Clear and rebuild with highlights
            textElement.textContent = '';
            let lastIndex = 0;
            let matchResult;
            const tempText = text;

            // Reset regex state
            regex.lastIndex = 0;

            while ((matchResult = regex.exec(tempText)) !== null) {
                if (matchResult.index > lastIndex) {
                    textElement.appendChild(document.createTextNode(tempText.substring(lastIndex, matchResult.index)));
                }
                const mark = document.createElement('mark');
                mark.className = 'keyword-match';
                mark.textContent = matchResult[0];
                textElement.appendChild(mark);
                lastIndex = matchResult.index + matchResult[0].length;
            }

            if (lastIndex < tempText.length) {
                textElement.appendChild(document.createTextNode(tempText.substring(lastIndex)));
            }
        }

        // Auto-remove highlight after 30 seconds
        setTimeout(() => {
            captionElement.classList.remove('keyword-highlight');
        }, 30000);
    }

    // Show the keyword alert overlay
    function showKeywordAlertOverlay(caption, match, captionIndex) {
        const overlay = document.getElementById('keywordAlertOverlay');
        const contextContainer = document.getElementById('keywordAlertContext');
        const keywordLabel = document.getElementById('keywordAlertKeyword');

        if (!overlay || !contextContainer) return;

        // Update keyword label
        if (keywordLabel) {
            keywordLabel.textContent = `"${match.keyword}"`;
        }

        // Build context HTML
        const contextLines = getContextLines(captionIndex, hotKeywordSettings.contextLineCount);
        const escapedKeyword = match.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const keywordRegex = new RegExp(`(${escapedKeyword})`, 'gi');

        contextContainer.innerHTML = contextLines.map(line => {
            const highlightedText = escapeHtml(line.text).replace(keywordRegex, '<span class="keyword-match">$1</span>');
            const lineClass = line.isMatch ? 'context-line highlight' : 'context-line';
            return `
                <div class="${lineClass}">
                    <span class="context-time">${escapeHtml(line.time)}</span>
                    <span class="context-speaker">${escapeHtml(line.name)}:</span> ${highlightedText}
                </div>
            `;
        }).join('');

        // Store current caption index for scroll action
        overlay.dataset.captionIndex = captionIndex;

        // If overlay is already visible, add a pulse animation to indicate new alert
        const wasAlreadyVisible = overlay.classList.contains('active');

        // Show overlay
        overlay.classList.add('active');

        // Flash the overlay if it was already visible (new keyword while popup open)
        if (wasAlreadyVisible) {
            overlay.style.animation = 'none';
            overlay.offsetHeight; // Trigger reflow
            overlay.style.animation = 'alertPulse 0.3s ease-out';
        }

        // Clear existing timer and set new auto-dismiss
        if (keywordAlertDismissTimer) {
            clearTimeout(keywordAlertDismissTimer);
        }
        const dismissMs = (hotKeywordSettings.toastDismissSeconds || 45) * 1000;
        keywordAlertDismissTimer = setTimeout(() => {
            overlay.classList.remove('active');
        }, dismissMs);
    }

    // Scroll to a keyword-highlighted caption
    function scrollToKeywordCaption(captionIndex) {
        const captionElement = captionsContainer.querySelector(`[data-index="${captionIndex}"]`);
        if (captionElement) {
            captionElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Re-pulse the highlight
            captionElement.style.animation = 'none';
            captionElement.offsetHeight; // Trigger reflow
            captionElement.style.animation = '';
        }
    }

    // Update the keyword count badge (header button)
    function updateKeywordBadge() {
        const badge = document.getElementById('keyword-count-badge');
        if (!badge) return;

        const totalCount = Object.keys(hotKeywords).length + Object.keys(sessionKeywords).length;

        if (totalCount > 0) {
            badge.textContent = totalCount;
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    }

    // Update the count badges in the modal
    function updateKeywordCountBadges() {
        const globalCount = document.getElementById('globalKeywordCount');
        const sessionCount = document.getElementById('sessionKeywordCount');

        const globalLen = Object.keys(hotKeywords).length;
        const sessionLen = Object.keys(sessionKeywords).length;

        if (globalCount) {
            globalCount.textContent = globalLen;
            globalCount.classList.toggle('has-items', globalLen > 0);
        }
        if (sessionCount) {
            sessionCount.textContent = sessionLen;
            sessionCount.classList.toggle('has-items', sessionLen > 0);
        }
    }

    // Render the global keyword list in the modal
    function renderGlobalKeywordList() {
        const listContainer = document.getElementById('globalKeywordList');
        if (!listContainer) return;

        const keywords = Object.entries(hotKeywords);

        if (keywords.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-keywords">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                    </svg>
                    <p>No global keywords yet</p>
                </div>`;
            updateKeywordCountBadges();
            return;
        }

        listContainer.innerHTML = keywords.map(([id, data]) => `
            <div class="keyword-tag ${data.enabled ? '' : 'disabled'}" data-id="${id}" data-scope="global">
                <span class="keyword-text">${escapeHtml(data.keyword)}</span>
                <div class="tag-actions">
                    <label class="toggle-switch tag-toggle" title="Enable/disable">
                        <input type="checkbox" class="keyword-toggle" data-id="${id}" data-scope="global" ${data.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <button class="delete-btn" data-id="${id}" data-scope="global" title="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        updateKeywordCountBadges();
    }

    // Render the session keyword list in the modal
    function renderSessionKeywordList() {
        const listContainer = document.getElementById('sessionKeywordList');
        if (!listContainer) return;

        const keywords = Object.entries(sessionKeywords);

        if (keywords.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-keywords">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                    </svg>
                    <p>No session keywords yet</p>
                </div>`;
            updateKeywordCountBadges();
            return;
        }

        listContainer.innerHTML = keywords.map(([id, data]) => `
            <div class="keyword-tag ${data.enabled ? '' : 'disabled'}" data-id="${id}" data-scope="session">
                <span class="keyword-text">${escapeHtml(data.keyword)}</span>
                <div class="tag-actions">
                    <label class="toggle-switch tag-toggle" title="Enable/disable">
                        <input type="checkbox" class="keyword-toggle" data-id="${id}" data-scope="session" ${data.enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <button class="delete-btn" data-id="${id}" data-scope="session" title="Remove">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');

        updateKeywordCountBadges();
    }

    // Add a global keyword
    async function addGlobalKeyword(keyword) {
        const trimmed = keyword.trim();
        if (!trimmed) {
            showNotification('Please enter a keyword', 'warning');
            return false;
        }

        if (trimmed.length > 100) {
            showNotification('Keyword too long (max 100 characters)', 'warning');
            return false;
        }

        // Check for duplicates in global keywords
        const exists = Object.values(hotKeywords).some(
            k => k.keyword.toLowerCase() === trimmed.toLowerCase()
        );

        if (exists) {
            showNotification('This global keyword already exists', 'warning');
            return false;
        }

        // Check limit
        if (Object.keys(hotKeywords).length >= 20) {
            showNotification('Maximum 20 global keywords allowed', 'warning');
            return false;
        }

        const id = Date.now().toString();
        hotKeywords[id] = {
            keyword: trimmed,
            enabled: true,
            createdAt: new Date().toISOString()
        };

        await saveHotKeywords();
        renderGlobalKeywordList();
        showNotification(`Added global keyword: "${trimmed}"`, 'success');
        return true;
    }

    // Add a session keyword
    function addSessionKeyword(keyword) {
        const trimmed = keyword.trim();
        if (!trimmed) {
            showNotification('Please enter a keyword', 'warning');
            return false;
        }

        if (trimmed.length > 100) {
            showNotification('Keyword too long (max 100 characters)', 'warning');
            return false;
        }

        // Check for duplicates in session keywords
        const exists = Object.values(sessionKeywords).some(
            k => k.keyword.toLowerCase() === trimmed.toLowerCase()
        );

        if (exists) {
            showNotification('This session keyword already exists', 'warning');
            return false;
        }

        // Check limit
        if (Object.keys(sessionKeywords).length >= 10) {
            showNotification('Maximum 10 session keywords allowed', 'warning');
            return false;
        }

        const id = 'session_' + Date.now().toString();
        sessionKeywords[id] = {
            keyword: trimmed,
            enabled: true
        };

        renderSessionKeywordList();
        updateKeywordBadge();
        showNotification(`Added session keyword: "${trimmed}"`, 'success');
        return true;
    }

    // Delete a keyword
    async function deleteKeyword(id, isSession) {
        if (isSession) {
            const keyword = sessionKeywords[id]?.keyword;
            delete sessionKeywords[id];
            renderSessionKeywordList();
            updateKeywordBadge();
            if (keyword) showNotification(`Removed session keyword: "${keyword}"`, 'info');
        } else {
            const keyword = hotKeywords[id]?.keyword;
            delete hotKeywords[id];
            delete lastKeywordAlerts[id];
            await saveHotKeywords();
            renderGlobalKeywordList();
            if (keyword) showNotification(`Removed global keyword: "${keyword}"`, 'info');
        }
    }

    // Toggle a keyword's enabled state
    async function toggleKeyword(id, enabled, isSession) {
        if (isSession) {
            if (sessionKeywords[id]) {
                sessionKeywords[id].enabled = enabled;
            }
        } else {
            if (hotKeywords[id]) {
                hotKeywords[id].enabled = enabled;
                await saveHotKeywords();
            }
        }

        // Update the tag's visual state
        const scope = isSession ? 'session' : 'global';
        const tag = document.querySelector(`.keyword-tag[data-id="${id}"][data-scope="${scope}"]`);
        if (tag) {
            tag.classList.toggle('disabled', !enabled);
        }
    }

    // Set up keyword modal event handlers
    function setupKeywordModalEvents() {
        const keywordsBtn = document.getElementById('keywords-btn');
        const keywordModal = document.getElementById('keywordModal');
        const closeBtn = keywordModal?.querySelector('.close-keyword-modal');
        const masterToggle = document.getElementById('keywordMasterToggle');
        const flashToggle = document.getElementById('keywordFlashToggle');
        const contextSelect = document.getElementById('keywordContextLines');
        const overlayToggle = document.getElementById('keywordOverlayToggle');
        const overlayDurationSelect = document.getElementById('keywordOverlayDuration');
        const globalInput = document.getElementById('globalKeywordInput');
        const addGlobalBtn = document.getElementById('addGlobalKeywordBtn');
        const sessionInput = document.getElementById('sessionKeywordInput');
        const addSessionBtn = document.getElementById('addSessionKeywordBtn');
        const globalList = document.getElementById('globalKeywordList');
        const sessionList = document.getElementById('sessionKeywordList');

        // Open modal
        keywordsBtn?.addEventListener('click', async () => {
            await loadHotKeywords();

            // Update UI state
            if (masterToggle) masterToggle.checked = hotKeywordSettings.enabled;
            if (flashToggle) flashToggle.checked = hotKeywordSettings.flashEnabled;
            if (contextSelect) contextSelect.value = hotKeywordSettings.contextLineCount.toString();
            if (overlayToggle) overlayToggle.checked = hotKeywordSettings.overlayEnabled !== false;
            if (overlayDurationSelect) overlayDurationSelect.value = String(hotKeywordSettings.toastDismissSeconds || 45);

            const optionsDiv = document.getElementById('keywordOptions');
            if (optionsDiv) {
                optionsDiv.style.opacity = hotKeywordSettings.enabled ? '1' : '0.5';
                optionsDiv.style.pointerEvents = hotKeywordSettings.enabled ? 'auto' : 'none';
            }

            renderGlobalKeywordList();
            renderSessionKeywordList();
            keywordModal.style.display = 'block';
        });

        // Close modal
        closeBtn?.addEventListener('click', () => {
            keywordModal.style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            if (e.target === keywordModal) {
                keywordModal.style.display = 'none';
            }
        });

        // Master toggle
        masterToggle?.addEventListener('change', async () => {
            hotKeywordSettings.enabled = masterToggle.checked;
            await saveHotKeywordSettings();

            const optionsDiv = document.getElementById('keywordOptions');
            if (optionsDiv) {
                optionsDiv.style.opacity = masterToggle.checked ? '1' : '0.5';
                optionsDiv.style.pointerEvents = masterToggle.checked ? 'auto' : 'none';
            }
        });

        // Flash toggle
        flashToggle?.addEventListener('change', async () => {
            hotKeywordSettings.flashEnabled = flashToggle.checked;
            await saveHotKeywordSettings();
        });

        // Context lines select
        contextSelect?.addEventListener('change', async () => {
            hotKeywordSettings.contextLineCount = parseInt(contextSelect.value, 10);
            await saveHotKeywordSettings();
        });

        // Overlay toggle
        overlayToggle?.addEventListener('change', async () => {
            hotKeywordSettings.overlayEnabled = overlayToggle.checked;
            await saveHotKeywordSettings();
        });

        // Overlay duration select (reuses toastDismissSeconds)
        overlayDurationSelect?.addEventListener('change', async () => {
            hotKeywordSettings.toastDismissSeconds = parseInt(overlayDurationSelect.value, 10);
            await saveHotKeywordSettings();
        });

        // Add global keyword
        addGlobalBtn?.addEventListener('click', async () => {
            const success = await addGlobalKeyword(globalInput.value);
            if (success) globalInput.value = '';
        });

        globalInput?.addEventListener('keypress', async (e) => {
            if (e.key === 'Enter') {
                const success = await addGlobalKeyword(globalInput.value);
                if (success) globalInput.value = '';
            }
        });

        // Add session keyword
        addSessionBtn?.addEventListener('click', () => {
            const success = addSessionKeyword(sessionInput.value);
            if (success) sessionInput.value = '';
        });

        sessionInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const success = addSessionKeyword(sessionInput.value);
                if (success) sessionInput.value = '';
            }
        });

        // Global keyword list event delegation (toggle + delete)
        globalList?.addEventListener('click', async (e) => {
            const deleteBtn = e.target.closest('.delete-btn');
            if (deleteBtn && deleteBtn.dataset.scope === 'global') {
                await deleteKeyword(deleteBtn.dataset.id, false);
            }
        });

        globalList?.addEventListener('change', async (e) => {
            if (e.target.classList.contains('keyword-toggle') && e.target.dataset.scope === 'global') {
                await toggleKeyword(e.target.dataset.id, e.target.checked, false);
            }
        });

        // Session keyword list event delegation (toggle + delete)
        sessionList?.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.delete-btn');
            if (deleteBtn && deleteBtn.dataset.scope === 'session') {
                deleteKeyword(deleteBtn.dataset.id, true);
            }
        });

        sessionList?.addEventListener('change', (e) => {
            if (e.target.classList.contains('keyword-toggle') && e.target.dataset.scope === 'session') {
                toggleKeyword(e.target.dataset.id, e.target.checked, true);
            }
        });

        // Alert overlay events
        const alertOverlay = document.getElementById('keywordAlertOverlay');
        const alertClose = alertOverlay?.querySelector('.keyword-alert-close');
        const alertScrollTo = document.getElementById('keywordAlertScrollTo');
        const alertDismiss = document.getElementById('keywordAlertDismiss');

        alertClose?.addEventListener('click', () => {
            alertOverlay.classList.remove('active');
            if (keywordAlertDismissTimer) clearTimeout(keywordAlertDismissTimer);
        });

        alertDismiss?.addEventListener('click', () => {
            alertOverlay.classList.remove('active');
            if (keywordAlertDismissTimer) clearTimeout(keywordAlertDismissTimer);
        });

        alertScrollTo?.addEventListener('click', () => {
            const captionIndex = parseInt(alertOverlay.dataset.captionIndex, 10);
            if (!isNaN(captionIndex)) {
                scrollToKeywordCaption(captionIndex);
            }
            alertOverlay.classList.remove('active');
            if (keywordAlertDismissTimer) clearTimeout(keywordAlertDismissTimer);
        });

        // Escape key to dismiss alert
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && alertOverlay?.classList.contains('active')) {
                alertOverlay.classList.remove('active');
                if (keywordAlertDismissTimer) clearTimeout(keywordAlertDismissTimer);
            }
        });
    }

    // --- Smart Scroll Functions ---
    function checkIfNearBottom() {
        // Check the actual scrollable container (body or document element)
        const scrollPosition = window.pageYOffset + window.innerHeight;
        const scrollHeight = document.body.scrollHeight;
        isNearBottom = (scrollHeight - scrollPosition) < 150; // Within 150px of bottom
        // console.log(`[Scroll Check] Position: ${scrollPosition}, Height: ${scrollHeight}, Near bottom: ${isNearBottom}`);
    }
    
    function scrollToBottom() {
        // Scroll to the absolute bottom of the page
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth'
        });

        // Hide the indicator
        const indicator = document.getElementById('new-caption-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }

        // Mark that user is now at bottom (watching live)
        isNearBottom = true;
    }
    
    function showNewCaptionIndicator() {
        let indicator = document.getElementById('new-caption-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'new-caption-indicator';
            indicator.className = 'new-caption-indicator';
            
            const button = document.createElement('button');
            button.textContent = '↓ New captions - Scroll to bottom';
            button.addEventListener('click', scrollToBottom);
            
            indicator.appendChild(button);
            document.body.appendChild(indicator);
        }
        indicator.style.display = 'block';
    }
    
    // --- Speaker Alias Functions ---
    async function loadSessionAliases() {
        if (!viewerSessionId) {
            debug.log('[Viewer] No session ID, skipping alias load');
            return;
        }

        try {
            const key = `aliases_${viewerSessionId}`;
            const result = await chrome.storage.local.get(key);
            speakerAliases = result[key] || {};
            debug.log(`[Viewer] Loaded aliases for session ${viewerSessionId}:`, speakerAliases);
        } catch (error) {
            console.error('[Viewer] Failed to load session aliases:', error);
            speakerAliases = {};
        }
    }

    async function saveSessionAliases() {
        if (!viewerSessionId) {
            console.error('[Viewer] Cannot save aliases: No session ID');
            return;
        }

        try {
            const key = `aliases_${viewerSessionId}`;
            await chrome.storage.local.set({ [key]: speakerAliases });
            debug.log(`[Viewer] Saved aliases for session ${viewerSessionId}:`, speakerAliases);
        } catch (error) {
            console.error('[Viewer] Failed to save session aliases:', error);
            // Show user notification for save failures
            showNotification('Failed to save speaker alias', 'error');
        }
    }
    
    function editSpeakerAlias(originalName, nameSpan, btn) {
        const currentAlias = speakerAliases[originalName] || originalName;
        console.log('[Speaker Edit] Editing speaker:', originalName, 'Current alias:', currentAlias);
        
        // Create inline editor
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentAlias;
        input.className = 'speaker-alias-input';
        input.style.cssText = `
            padding: 4px 8px;
            margin-right: 5px;
            border: 2px solid #0078d4;
            border-radius: 3px;
            font-size: 14px;
            width: 150px;
        `;
        
        // Hide the button temporarily
        btn.style.display = 'none';
        
        // Insert input in its place
        const inputContainer = document.createElement('div');
        inputContainer.style.cssText = 'display: inline-flex; align-items: center; margin-right: 5px;';
        inputContainer.appendChild(input);
        
        // Add save/cancel buttons
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '✓';
        saveBtn.style.cssText = `
            padding: 4px 8px;
            margin-left: 2px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = '✕';
        cancelBtn.style.cssText = `
            padding: 4px 8px;
            margin-left: 2px;
            background: #dc3545;
            color: white;
            border: none;
            border-radius: 3px;
            cursor: pointer;
        `;
        
        inputContainer.appendChild(saveBtn);
        inputContainer.appendChild(cancelBtn);
        btn.parentNode.insertBefore(inputContainer, btn);
        input.focus();
        input.select();
        
        const saveAlias = async () => {
            const newAlias = input.value.trim();
            
            if (newAlias && newAlias !== originalName) {
                speakerAliases[originalName] = newAlias;
                nameSpan.textContent = newAlias;
                btn.setAttribute('aria-label', `Filter by ${newAlias}`);
            } else {
                delete speakerAliases[originalName];
                nameSpan.textContent = originalName;
                btn.setAttribute('aria-label', `Filter by ${originalName}`);
            }
            
            // Save aliases to storage
            await saveSessionAliases();
            
            // Update all instances of this speaker
            updateAllSpeakerInstances(originalName);
            
            // Clean up and show the button again
            inputContainer.remove();
            btn.style.display = '';
        };
        
        const cancelEdit = () => {
            inputContainer.remove();
            btn.style.display = '';
        };
        
        saveBtn.addEventListener('click', saveAlias);
        cancelBtn.addEventListener('click', cancelEdit);
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveAlias();
            } else if (e.key === 'Escape') {
                cancelEdit();
            }
        });
    }
    
    function updateAllSpeakerInstances(originalName) {
        if (!originalName) return;

        const displayName = speakerAliases[originalName] || originalName;
        const hasAlias = !!speakerAliases[originalName];

        // Update all caption instances - use correct selector without 'editable-speaker' class
        document.querySelectorAll(`.caption[data-original-speaker="${originalName}"] .name`).forEach(elem => {
            if (elem) {
                elem.textContent = displayName;
                elem.classList.toggle('has-alias', hasAlias);
                elem.title = hasAlias ? `Original: ${originalName}` : '';
            }
        });

        // Update speaker filter button if it exists
        if (speakerFiltersContainer) {
            const filterBtn = speakerFiltersContainer.querySelector(`button[data-original-speaker="${originalName}"]`);
            if (filterBtn) {
                const nameSpan = filterBtn.querySelector('span:not(.speaker-edit-icon)');
                if (nameSpan) {
                    nameSpan.textContent = displayName;
                }
                filterBtn.setAttribute('aria-label', `Filter by ${displayName}`);
            }
        }
    }
    
    // --- Helper Functions ---
    function removeHighlights(element) {
        const textElement = element.querySelector('.text');
        if (!textElement) return;

        // Get the original text content (removes all <mark> tags)
        const text = textElement.textContent;
        // Reset to plain text
        textElement.textContent = text;
    }

    function highlightSearchTerm(element, searchTerm) {
        if (!searchTerm) {
            removeHighlights(element);
            return;
        }

        const textElement = element.querySelector('.text');
        if (!textElement) return;

        // Security: Use textContent for safe DOM manipulation instead of innerHTML
        // This prevents XSS from malicious search terms
        const text = textElement.textContent;

        // Escape special regex characters in search term
        const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escapedSearch})`, 'gi');

        // Clear existing content safely
        textElement.textContent = '';

        // Split text and add marks safely using DOM methods
        let lastIndex = 0;
        let match;
        const regexGlobal = new RegExp(`(${escapedSearch})`, 'gi');

        while ((match = regexGlobal.exec(text)) !== null) {
            // Add text before match
            if (match.index > lastIndex) {
                textElement.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            }

            // Add highlighted match
            const mark = document.createElement('mark');
            mark.textContent = match[0];
            textElement.appendChild(mark);

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            textElement.appendChild(document.createTextNode(text.substring(lastIndex)));
        }
    }
    
    // --- Live Update Functions ---
    function appendNewCaption(caption) {
        // First check if we already have this caption by key (important for chat messages)
        if (caption.key) {
            const existingIndex = allCaptions.findIndex(c => c.key === caption.key);
            if (existingIndex !== -1) {
                debug.log('[Viewer] Caption with key already exists, updating instead:', caption.key);
                updateExistingCaption(caption, true); // Pass true to prevent infinite recursion
                return;
            }
        }

        // Check if this is actually a new caption or just a fragment
        // For Google Meet, check if we already have a recent caption from this speaker
        // Use 2 second window instead of 10 seconds to avoid incorrectly merging separate short captions
        const recentCaptionIndex = allCaptions.findIndex(c =>
            c.Name === caption.Name &&
            Math.abs(new Date(c.Time).getTime() - new Date(caption.Time).getTime()) < 2000 // Within 2 seconds
        );

        // Only treat as fragment if:
        // 1. Recent caption from same speaker exists (within 2 seconds)
        // 2. New caption is short (< 50 chars)
        // 3. New caption text is similar to (contained in or extends) existing text
        const existingCaption = recentCaptionIndex !== -1 ? allCaptions[recentCaptionIndex] : null;
        const isLikelyFragment = existingCaption &&
            caption.Type !== 'slide' && existingCaption.Type !== 'slide' &&
            caption.Text.length < 50 &&
            (existingCaption.Text.includes(caption.Text) || caption.Text.includes(existingCaption.Text));

        if (isLikelyFragment) {
            // This looks like a fragment, update the existing caption instead
            debug.log('[Viewer] Fragment detected, updating existing caption instead of adding new');
            updateExistingCaption(caption, true); // Pass true to prevent infinite recursion
            return;
        }

        // Add to data array
        allCaptions.push(caption);
        
        // Create HTML for new caption
        const newCaptionHTML = createCaptionHTML(caption, allCaptions.length - 1);
        
        // Remove "no captions" message if it exists
        const statusMessage = captionsContainer.querySelector('.status-message');
        if (statusMessage) {
            statusMessage.remove();
        }
        
        // Append to DOM
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newCaptionHTML;
        const newCaptionElement = tempDiv.firstElementChild;
        captionsContainer.appendChild(newCaptionElement);

        // Performance: Add element to cache
        captionElementsCache.push(newCaptionElement);

        // Shared content slides: reveal the toggle, respect its state
        if (caption.Type === 'slide') {
            updateSlidesToggleVisibility(true);
            if (!showSlides) newCaptionElement.style.display = 'none';
        }

        // Apply search filter if active
        if (activeSearch) {
            const matchesSearch = caption.Text.toLowerCase().includes(activeSearch.toLowerCase()) ||
                                 caption.Name.toLowerCase().includes(activeSearch.toLowerCase());
            if (!matchesSearch) {
                newCaptionElement.style.display = 'none';
            } else {
                highlightSearchTerm(newCaptionElement, activeSearch);
            }
        }
        
        // Smart auto-scroll logic
        checkIfNearBottom();

        // Auto-scroll if user has auto-scroll enabled AND is near bottom
        if (autoScroll && isNearBottom) {
            newCaptionElement.scrollIntoView({ behavior: 'smooth', block: 'end' });
            // Add a small extra scroll to ensure the caption is fully visible
            setTimeout(() => {
                window.scrollBy(0, 50);
            }, 300); // Wait for smooth scroll to finish
        } else {
            // Show indicator if not following and not near bottom
            showNewCaptionIndicator();
        }
        
        // Update analytics
        updateAnalyticsIncremental(caption);

        // Check for keyword matches (hot keyword detection)
        const keywordMatch = checkForKeywordMatch(caption);
        if (keywordMatch) {
            triggerKeywordAlert(caption, keywordMatch, allCaptions.length - 1);
        }

        // Update export button states
        updateExportButtonStates();
        
        // Update last update time
        lastUpdateTime = Date.now();
        updateLiveIndicator();
    }
    
    // Prevent infinite recursion between appendNewCaption and updateExistingCaption
    function updateExistingCaption(caption, fromAppend = false) {
        debug.log('[Viewer] Updating caption with key:', caption.key);

        // First, try to find by key
        let index = allCaptions.findIndex(c => c.key === caption.key);

        // If not found by key, try to find by speaker name (for Google Meet)
        if (index === -1 && caption.Name) {
            debug.log('[Viewer] Key not found, searching by name:', caption.Name);
            // Find the most recent caption from this speaker
            for (let i = allCaptions.length - 1; i >= 0; i--) {
                if (allCaptions[i].Name === caption.Name) {
                    index = i;
                    debug.log('[Viewer] Found caption by name at index:', index);
                    break;
                }
            }
        }

        if (index !== -1) {
            // Store old text BEFORE first update (for keyword detection)
            // We track per-caption to know what text existed before any updates started
            const captionKey = caption.key || `idx_${index}`;
            if (!captionKeywordDebounceTimers[captionKey]) {
                // First update - store the original text
                captionKeywordDebounceTimers[captionKey] = {
                    timer: null,
                    originalText: (allCaptions[index].Text || '').toLowerCase()
                };
            }

            // Update in data array
            allCaptions[index] = { ...allCaptions[index], ...caption };

            // Update in DOM
            const captionElement = captionsContainer.querySelector(`[data-index="${index}"]`);
            if (captionElement && (caption.attachments || caption.imageId)) {
                // Attachments were embedded (or a slide image arrived): re-render the whole entry
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = createCaptionHTML(allCaptions[index], index);
                const fresh = tempDiv.firstElementChild;
                if (fresh) {
                    fresh.style.display = captionElement.style.display;
                    captionElement.replaceWith(fresh);
                    const cacheIdx = captionElementsCache.indexOf(captionElement);
                    if (cacheIdx !== -1) captionElementsCache[cacheIdx] = fresh;
                }
            } else if (captionElement) {
                const textElement = captionElement.querySelector('.text');
                if (textElement) {
                    debug.log('[Viewer] Updating text from:', textElement.textContent, 'to:', caption.Text);
                    textElement.textContent = caption.Text;
                } else {
                    debug.log('[Viewer] Text element not found in caption');
                }
            } else {
                debug.log('[Viewer] Caption element not found at index:', index);
            }

            // Debounced keyword check - wait for caption to settle before checking
            const debounceData = captionKeywordDebounceTimers[captionKey];
            if (debounceData.timer) {
                clearTimeout(debounceData.timer);
            }

            debounceData.timer = setTimeout(() => {
                // Caption has settled - now check for keywords
                const currentCaption = allCaptions[index];
                const keywordMatch = checkForKeywordMatch(currentCaption);
                if (keywordMatch) {
                    // Only trigger if keyword is NEW (wasn't in original text before updates started)
                    const keywordLower = keywordMatch.keyword.toLowerCase();
                    if (!debounceData.originalText.includes(keywordLower)) {
                        console.log('[Keywords] Keyword found in caption UPDATE (debounced):', keywordMatch.keyword);
                        triggerKeywordAlert(currentCaption, keywordMatch, index);
                    } else {
                        console.log('[Keywords] Keyword already existed in original caption, skipping');
                    }
                }
                // Clean up debounce data
                delete captionKeywordDebounceTimers[captionKey];
            }, KEYWORD_CHECK_DEBOUNCE_MS);
        } else if (!fromAppend) {
            // Only add as new if not already called from appendNewCaption (prevent infinite recursion)
            debug.log('[Viewer] Caption not found for update, adding as new');
            appendNewCaption(caption);
        } else {
            debug.log('[Viewer] Caption not found, skipping to prevent recursion');
        }
    }
    
    function batchProcessUpdates() {
        if (pendingUpdates.length === 0) return;
        
        // Process all pending updates
        pendingUpdates.forEach(update => {
            if (update.type === 'new') {
                appendNewCaption(update.caption);
            } else if (update.type === 'update') {
                updateExistingCaption(update.caption);
            }
        });
        
        pendingUpdates = [];
        updateTimer = null;
    }
    
    function queueUpdate(update) {
        debug.log('[Viewer] Queuing update:', update.type, update.caption?.Name);
        pendingUpdates.push(update);

        // Performance: Batch updates every 250ms to reduce DOM updates
        if (!updateTimer) {
            updateTimer = setTimeout(batchProcessUpdates, 250);
        }
    }
    
    function updateAnalyticsIncremental(caption) {
        // Check if this is a new speaker we haven't seen before
        const speakerButton = speakerFiltersContainer.querySelector(`button[data-original-speaker="${caption.Name}"]`);
        if (!speakerButton) {
            // New speaker detected, add their button
            createSpeakerFilterButton(caption.Name);
        }
        
        // Recalculate and display analytics
        const analytics = calculateAnalytics(allCaptions);
        if (analytics) {
            displayAnalytics(analytics);
        }
    }
    
    function updateLiveIndicator() {
        // Just update the existing live indicator, don't create a new one
        const indicator = document.querySelector('.live-indicator');
        if (indicator) {
            // Update indicator status
            indicator.classList.toggle('active', isLiveStreaming);

            // Stop dot animation when not live
            const liveDot = indicator.querySelector('.live-dot');
            if (liveDot) {
                if (!isLiveStreaming) {
                    liveDot.style.animation = 'none';
                } else {
                    liveDot.style.animation = '';
                }
            }
        }
        // Don't create a new indicator - it should already be in the h1 element
    }

    // --- Rendering Functions ---
    // Entry rendering is shared with the HTML export (transcriptRenderer.js).
    // Images (slides, embedded attachments) resolve through the viewer's cache,
    // which is filled from live broadcasts and hydrated from the image store.
    function resolveViewerImage(ref) {
        if (ref && ref.imageId && imageCache[ref.imageId]) return imageCache[ref.imageId];
        return ref && ref.url ? sanitizeUrl(ref.url) : '';
    }

    function createCaptionHTML(item, index) {
        return TranscriptRenderer.renderEntryHTML(item, index, {
            aliases: speakerAliases,
            interactive: true,
            resolveImage: resolveViewerImage
        });
    }

    // Merge attendance events with transcript chronologically
    function mergeAttendanceEvents(transcript, attendeeHistory) {
        if (!attendeeHistory || attendeeHistory.length === 0) {
            return transcript;
        }

        const combinedEvents = [...transcript];

        // Add attendance events
        attendeeHistory.forEach(event => {
            combinedEvents.push({
                Time: event.time,
                Name: event.name,
                Text: event.action === 'joined' ? `joined the meeting${event.role ? ' (' + event.role + ')' : ''}` : 'left the meeting',
                Type: 'attendance',
                action: event.action,
                sortKey: new Date(event.time).getTime()
            });
        });

        // Sort by time
        combinedEvents.sort((a, b) => {
            const timeA = a.sortKey || new Date(a.Time).getTime() || 0;
            const timeB = b.sortKey || new Date(b.Time).getTime() || 0;
            return timeA - timeB;
        });

        debug.log(`[Viewer] Merged ${attendeeHistory.length} attendance events with ${transcript.length} captions`);
        return combinedEvents;
    }

    function renderCaptions(transcriptArray) {
        allCaptions = transcriptArray;
        const htmlContent = transcriptArray.map(createCaptionHTML).join('');
        captionsContainer.innerHTML = htmlContent || '<p class="status-message">No captions to display.</p>';

        // Performance: Rebuild cache after rendering
        captionElementsCache = Array.from(captionsContainer.querySelectorAll('.caption'));

        updateSlidesToggleVisibility(transcriptArray.some(item => item && item.Type === 'slide'));
        updateExportButtonStates();
    }

    // Load pixels for every imageId referenced by the transcript into imageCache
    async function hydrateImages(transcriptArray) {
        if (typeof ImageStore === 'undefined' || typeof TranscriptRenderer === 'undefined') return;
        try {
            const ids = TranscriptRenderer.collectImageIds(transcriptArray).filter(id => !imageCache[id]);
            if (ids.length === 0) return;
            const found = await ImageStore.getDataUrls(ids);
            Object.assign(imageCache, found);
            debug.log(`[Viewer] Hydrated ${Object.keys(found).length}/${ids.length} image(s) from store`);
        } catch (error) {
            console.warn('[Viewer] Failed to load images from store:', error);
        }
    }

    // "Slides" toggle button: only shown once the transcript contains shared content
    function updateSlidesToggleVisibility(hasSlides) {
        const btn = document.getElementById('toggle-slides-btn');
        if (!btn) return;
        if (hasSlides) btn.style.display = '';
        btn.classList.toggle('active', showSlides);
        btn.setAttribute('aria-pressed', showSlides ? 'true' : 'false');
    }

    function populateSpeakerFilters(transcriptArray) {
        // Get all unique speakers from transcript
        const speakers = [...new Set(transcriptArray.map(item => item.Name))];
        
        // Get existing speaker buttons (to track what we already have)
        const existingSpeakers = new Set();
        speakerFiltersContainer.querySelectorAll('button:not(#show-all-btn)').forEach(btn => {
            const originalSpeaker = btn.dataset.originalSpeaker || btn.dataset.speaker;
            existingSpeakers.add(originalSpeaker);
        });
        
        // Only add new speakers that don't already have buttons
        speakers.forEach(speaker => {
            if (!existingSpeakers.has(speaker)) {
                createSpeakerFilterButton(speaker);
            }
        });
    }
    
    function createSpeakerFilterButton(speaker) {
        const btn = document.createElement('button');
        const displayName = speakerAliases[speaker] || speaker;
        btn.dataset.speaker = speaker;
        btn.dataset.originalSpeaker = speaker;
        btn.setAttribute('aria-label', `Filter by ${displayName}`);
        btn.className = 'speaker-filter-btn';
        btn.style.cssText = 'position: relative; padding-right: 24px;'; // Extra padding for edit icon
        
        // Create span for the speaker name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = displayName;
        btn.appendChild(nameSpan);
        
        // Add edit icon as a small superscript-style element
        const editBtn = document.createElement('span');
        editBtn.className = 'speaker-edit-icon';
        editBtn.innerHTML = '✏️';
        editBtn.style.cssText = `
            position: absolute;
            top: 2px;
            right: 4px;
            font-size: 10px;
            cursor: pointer;
            opacity: 0.6;
            transition: opacity 0.2s;
        `;
        editBtn.title = `Edit alias for ${speaker}`;
        editBtn.onclick = (e) => {
            e.stopPropagation();
            editSpeakerAlias(speaker, nameSpan, btn);
        };
        
        btn.appendChild(editBtn);
        speakerFiltersContainer.appendChild(btn);
        
        // Show edit icon more prominently on hover
        btn.addEventListener('mouseenter', () => {
            editBtn.style.opacity = '1';
        });
        btn.addEventListener('mouseleave', () => {
            editBtn.style.opacity = '0.6';
        });
    }

    // --- Interactivity & Filtering ---
    function applyFilters() {
        const searchTerm = searchBox.value.toLowerCase().trim();
        activeSearch = searchTerm; // Store for live updates
        const activeSpeakerFilter = speakerFiltersContainer.querySelector('button.active');
        // Use originalSpeaker for consistency
        const speakerToFilter = activeSpeakerFilter?.id === 'show-all-btn' ? null : (activeSpeakerFilter?.dataset.originalSpeaker || activeSpeakerFilter?.dataset.speaker);

        // Update global filtered speaker for save functionality
        currentFilteredSpeaker = speakerToFilter;

        // Performance: Use cached elements instead of querying DOM
        captionElementsCache.forEach(captionDiv => {
            // Shared content slides have their own toggle
            if (captionDiv.dataset.type === 'slide' && !showSlides) {
                captionDiv.style.display = 'none';
                return;
            }

            const textElement = captionDiv.querySelector('.text');
            // Handle attendance events (joins/leaves) which don't have .text element
            if (!textElement) {
                // For attendance events, show unless there's a search term or speaker filter
                captionDiv.style.display = (searchTerm || speakerToFilter) ? 'none' : 'block';
                return;
            }

            const text = textElement.textContent.toLowerCase();
            // Use originalSpeaker for filtering
            const speaker = captionDiv.dataset.originalSpeaker || captionDiv.dataset.speaker || '';

            const matchesSearch = !searchTerm || text.includes(searchTerm) || speaker.toLowerCase().includes(searchTerm);
            const matchesSpeaker = !speakerToFilter || speaker === speakerToFilter;

            // Show/hide based on filters
            captionDiv.style.display = (matchesSearch && matchesSpeaker) ? 'block' : 'none';

            // Apply or remove highlighting
            if (searchTerm && matchesSearch) {
                highlightSearchTerm(captionDiv, searchTerm);
            } else {
                // Clear highlights when search is empty or caption doesn't match
                removeHighlights(captionDiv);
            }
        });

        // Update export button states
        updateExportButtonStates();
    }
    
    function updateExportButtonStates() {
        const visibleCount = getVisibleCaptions().length;
        const hasVisibleCaptions = visibleCount > 0;
        
        copyAllBtn.disabled = !hasVisibleCaptions;
        saveAllBtn.disabled = !hasVisibleCaptions;
        
        // Update titles with count
        copyAllBtn.title = hasVisibleCaptions 
            ? `Copy ${visibleCount} visible caption(s) to clipboard`
            : 'No visible captions to copy';
        saveAllBtn.title = hasVisibleCaptions 
            ? `Save ${visibleCount} visible caption(s) as file`
            : 'No visible captions to save';
    }

    function debouncedApplyFilters() {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(applyFilters, SEARCH_DEBOUNCE_DELAY);
    }

    function handleSpeakerFilterClick(e) {
        // Handle clicks on the button or its children (except edit icon and alias editing UI)
        if (e.target.classList.contains('speaker-edit-icon')) return;

        // Ignore clicks from speaker alias editing UI
        if (e.target.classList.contains('speaker-alias-input')) return;

        // Check if click is on alias editing save/cancel buttons or their container
        const aliasInput = e.target.closest('.speaker-alias-input')?.parentElement;
        if (aliasInput) return;

        // Simplified button finding logic
        // Use closest() to find button - works whether clicking on button or its children
        let filterBtn = e.target.closest('button.speaker-filter-btn, button#show-all-btn');

        // Fallback: if target is a button element in the container, use it directly
        if (!filterBtn && e.target.tagName === 'BUTTON' && speakerFiltersContainer.contains(e.target)) {
            filterBtn = e.target;
        }

        // Validate the button is still in the DOM and connected (prevents stale reference issues)
        if (!filterBtn || !filterBtn.isConnected || !speakerFiltersContainer.contains(filterBtn)) {
            // Only log if we found something but it was stale
            if (filterBtn) {
                debug.log('[Viewer] Filter button is stale or detached, ignoring click');
            }
            return;
        }

        // Remove active from all filter buttons
        speakerFiltersContainer.querySelectorAll('button').forEach(b => {
            b.classList.remove('active');
        });

        // Add active to clicked button
        filterBtn.classList.add('active');

        // Verify active class was applied
        if (!filterBtn.classList.contains('active')) {
            console.error('[Viewer] Failed to apply active class to filter button');
            // Force add it again
            filterBtn.classList.add('active');
        }

        applyFilters();
    }

    async function handleCopyClick(e) {
        const copyButton = e.target.closest('.copy-btn');
        if (!copyButton) return;

        const captionDiv = copyButton.closest('.caption');
        const index = parseInt(captionDiv.dataset.index, 10);
        const captionData = allCaptions[index];

        if (!captionData) {
            console.error('[Viewer] No caption data found at index:', index);
            return;
        }

        const textToCopy = `[${captionData.Time}] ${captionData.Name}: ${captionData.Text}`;
        try {
            await navigator.clipboard.writeText(textToCopy);
            copyButton.classList.add('copied');
            copyButton.querySelector('.tooltip-text').textContent = 'Copied!';

            setTimeout(() => {
                copyButton.classList.remove('copied');
                copyButton.querySelector('.tooltip-text').textContent = 'Copy';
            }, 1500);
        } catch (err) {
            console.error('[Viewer] Failed to copy text:', err);
            copyButton.querySelector('.tooltip-text').textContent = 'Copy failed';
            // Show user-friendly error using existing notification system
            showNotification(`Failed to copy: ${err.message}`, 'error');
        }
    }
    
    // --- Export Functions ---
    function getVisibleCaptions() {
        const visibleCaptions = [];
        const captionElements = captionsContainer.querySelectorAll('.caption');
        
        captionElements.forEach(captionElement => {
            if (captionElement.style.display !== 'none') {
                const index = parseInt(captionElement.dataset.index, 10);
                if (!isNaN(index) && allCaptions[index]) {
                    visibleCaptions.push(allCaptions[index]);
                }
            }
        });
        
        return visibleCaptions;
    }
    
    function formatTranscriptForExport(captions, format = 'txt', userRecordingStartTime = null) {
        if (!captions || captions.length === 0) {
            return format === 'json' ? '[]' : 'No captions to export.';
        }

        if (format === 'srt') {
            return formatAsSrt(captions, userRecordingStartTime);
        } else if (format === 'json') {
            return JSON.stringify(captions, null, 2);
        } else if (format === 'md') {
            // Build Markdown with metadata header
            let content = '';

            // Add meeting title
            content += `# ${currentMeetingTitle}\n\n`;

            // Add meeting metadata
            content += '## Meeting Information\n\n';
            content += `**Platform:** ${currentPlatform || 'Unknown'}\n\n`;
            content += `**Total Captions:** ${captions.length}\n\n`;

            // Calculate duration if timestamps are available
            if (captions.length > 0 && captions[0].Time && captions[captions.length - 1].Time) {
                content += `**First Caption:** ${captions[0].Time}\n\n`;
                content += `**Last Caption:** ${captions[captions.length - 1].Time}\n\n`;
            }

            // Add filter information if applicable
            if (currentFilteredSpeaker) {
                content += `**Filtered By Speaker:** ${currentFilteredSpeaker}\n\n`;
            }

            content += `**Exported:** ${new Date().toLocaleString()}\n\n`;

            content += '---\n\n';
            content += '## Transcript\n\n';

            // Group by speaker for better readability
            let lastSpeaker = null;
            captions.forEach(entry => {
                const typeIndicator = entry.Type === 'chat' ? '[CHAT] ' : (entry.Type === 'slide' ? '[SLIDE] ' : '');
                if (entry.Name !== lastSpeaker) {
                    lastSpeaker = entry.Name;
                    content += `\n### ${typeIndicator}${entry.Name}\n\n`;
                }
                content += `> **[${entry.Time}]** ${entry.Text}\n\n`;
            });

            return content;
        } else {
            // TXT format with attendee section
            let content = '';

            // Add attendee section - use attendee report if available, otherwise generate from speakers
            let attendeeList = [];
            let totalAttendees = 0;
            let meetingStart = null;

            if (currentAttendeeReport) {
                // Handle both formats of attendee reports (Teams/Meet vs Zoom)
                if (currentAttendeeReport.attendeeList && currentAttendeeReport.totalUniqueAttendees) {
                    attendeeList = currentAttendeeReport.attendeeList;
                    totalAttendees = currentAttendeeReport.totalUniqueAttendees;
                    meetingStart = currentAttendeeReport.meetingStartTime;
                } else if (currentAttendeeReport.allAttendees) {
                    if (currentAttendeeReport.allAttendees instanceof Set) {
                        attendeeList = Array.from(currentAttendeeReport.allAttendees);
                    } else if (Array.isArray(currentAttendeeReport.allAttendees)) {
                        attendeeList = currentAttendeeReport.allAttendees;
                    } else if (typeof currentAttendeeReport.allAttendees === 'object') {
                        attendeeList = Object.values(currentAttendeeReport.allAttendees);
                    }
                    totalAttendees = attendeeList.length;
                    meetingStart = currentAttendeeReport.meetingStartTime;
                }
            }

            // Fallback: If no attendee report, generate from speakers in captions
            if (totalAttendees === 0) {
                const speakers = [...new Set(
                    captions
                        .filter(entry => entry.Type !== 'attendance') // Exclude join/leave events
                        .map(entry => entry.Name)
                        .filter(name => name && name.trim())
                )];
                if (speakers.length > 0) {
                    attendeeList = speakers.sort();
                    totalAttendees = speakers.length;
                    // Try to get meeting start from first caption entry
                    if (captions.length > 0 && captions[0].Time) {
                        meetingStart = captions[0].timestamp || null;
                    }
                }
            }

            // Add attendee header if we have attendees
            if (totalAttendees > 0) {
                content += '=== MEETING ATTENDEES ===\n';
                content += `Total Attendees: ${totalAttendees}\n`;
                if (meetingStart) {
                    content += `Meeting Start: ${new Date(meetingStart).toLocaleString()}\n`;
                }
                content += '\nAttendee List:\n';
                attendeeList.forEach(name => {
                    content += `- ${name}\n`;
                });
                content += '\n=== TRANSCRIPT ===\n';
            }

            // Add captions (including join/leave events if present)
            content += captions.map(entry => {
                if (entry.Type === 'attendance') {
                    return `[${entry.Time}] ● ${entry.Name} ${entry.Text}`;
                } else if (entry.Type === 'chat') {
                    return `[CHAT] [${entry.Time}] ${entry.Name}: ${entry.Text}`;
                } else if (entry.Type === 'slide') {
                    return `[SLIDE] [${entry.Time}] ${entry.Name}: ${entry.Text}`;
                } else {
                    return `[${entry.Time}] ${entry.Name}: ${entry.Text}`;
                }
            }).join('\n');

            return content;
        }
    }
    
    async function handleCopyAllClick() {
        const visibleCaptions = getVisibleCaptions();

        if (visibleCaptions.length === 0) {
            showNotification('No visible captions to copy', 'warning');
            return;
        }

        const textToCopy = formatTranscriptForExport(visibleCaptions);

        try {
            await navigator.clipboard.writeText(textToCopy);
            showButtonSuccess(copyAllBtn, 'Copied!', 'Copy All');
            showNotification(`Copied ${visibleCaptions.length} caption(s) to clipboard`, 'success');
        } catch (err) {
            console.error('[Viewer] Failed to copy all captions:', err);
            showNotification(`Failed to copy to clipboard: ${err.message}`, 'error');
        }
    }
    
    async function handleSaveAllClick() {
        const visibleCaptions = getVisibleCaptions();

        if (visibleCaptions.length === 0) {
            showNotification('No visible captions to save', 'warning');
            return;
        }

        // Get meeting start time for SRT default (from attendee report or first caption)
        let meetingStartTime = currentAttendeeReport?.meetingStartTime;
        if (!meetingStartTime && allCaptions.length > 0 && allCaptions[0].timestamp) {
            meetingStartTime = allCaptions[0].timestamp;
        }

        // Show format selection dialog (returns { format, userRecordingStartTime } or null)
        const result = await showFormatDialog(meetingStartTime);
        if (!result) return; // User cancelled

        const { format, userRecordingStartTime } = result;

        // Create download
        let content;
        if (format === 'html') {
            await hydrateImages(visibleCaptions);
            const images = {};
            TranscriptRenderer.collectImageIds(visibleCaptions).forEach(id => { if (imageCache[id]) images[id] = imageCache[id]; });
            content = TranscriptRenderer.buildStandaloneDocument({
                meetingTitle: currentMeetingTitle,
                platform: currentPlatform,
                entries: visibleCaptions,
                attendeeReport: currentAttendeeReport,
                images,
                aliases: speakerAliases,
                recordingStartTime: meetingStartTime,
                includeAttendance: false // visible list already contains merged join/leave rows
            });
        } else {
            content = formatTranscriptForExport(visibleCaptions, format, userRecordingStartTime);
        }
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');

        // Sanitize title (same logic as service_worker.js getSanitizedMeetingName)
        let cleanTitle = currentMeetingTitle || 'Meeting';
        const parts = cleanTitle.split('|');
        const meetingName = parts.length > 2 ? parts[1] : parts[0];
        cleanTitle = meetingName.replace('Microsoft Teams', '').replace('Google Meet', '').replace('Zoom', '').trim();
        cleanTitle = cleanTitle.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        // If title ended up empty after cleaning, use fallback
        if (!cleanTitle || cleanTitle === '_') cleanTitle = 'Meeting';

        // Add filter suffix if applicable
        const filterSuffix = currentFilteredSpeaker ? `-filtered-${currentFilteredSpeaker.replace(/[^a-z0-9]/gi, '_')}` : '';

        // Build filename: {date}_{title}{filterSuffix}_{time}.{extension}
        const filename = `${dateStr}_${cleanTitle}${filterSuffix}_${timeStr}.${format}`;

        try {
            let mimeType;
            if (format === 'json') {
                mimeType = 'application/json';
            } else if (format === 'md') {
                mimeType = 'text/markdown';
            } else if (format === 'html') {
                mimeType = 'text/html';
            } else {
                // txt and srt both use text/plain
                mimeType = 'text/plain';
            }
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);

            try {
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);

                showButtonSuccess(saveAllBtn, 'Saved!', 'Save');
                showNotification(`Saved ${visibleCaptions.length} caption(s) to ${filename}`, 'success');

                // Update meeting ended message to show it's been saved
                if (document.getElementById('meeting-ended-message')) {
                    await addMeetingEndedMessage(true);
                }
            } finally {
                // Always revoke the blob URL to prevent memory leak
                URL.revokeObjectURL(url);
            }
        } catch (err) {
            console.error('[Viewer] Failed to save transcript:', err);
            showNotification(`Failed to save file: ${err.message}`, 'error');
        }
    }
    
    // Show format selection dialog
    // meetingStartTime: optional ISO string to use as SRT default
    function showFormatDialog(meetingStartTime = null) {
        return new Promise((resolve) => {
            // Create modal
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: white;
                padding: 24px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                max-width: 400px;
            `;

            dialog.innerHTML = `
                <h3 style="margin: 0 0 16px 0; font-size: 18px;">Select Save Format</h3>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <button data-format="txt" style="padding: 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        TXT (Plain Text)
                    </button>
                    <button data-format="json" style="padding: 12px; background: #0078d4; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        JSON (Structured Data)
                    </button>
                    <button data-format="md" style="padding: 12px; background: #6f42c1; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        Markdown (Formatted)
                    </button>
                    <button data-format="html" style="padding: 12px; background: #e34c26; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        HTML (Viewer page with images)
                    </button>
                    <button data-format="srt" style="padding: 12px; background: #fd7e14; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        SRT (Subtitles for Video)
                    </button>
                    <button data-format="cancel" style="padding: 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        Cancel
                    </button>
                </div>
            `;

            modal.appendChild(dialog);
            document.body.appendChild(modal);

            // Handle clicks
            dialog.addEventListener('click', async (e) => {
                if (e.target.tagName === 'BUTTON') {
                    const format = e.target.dataset.format;
                    document.body.removeChild(modal);

                    if (format === 'cancel') {
                        resolve(null);
                    } else if (format === 'srt') {
                        const srtResult = await showSrtDialog(meetingStartTime);
                        resolve(srtResult);
                    } else {
                        resolve({ format, userRecordingStartTime: null });
                    }
                }
            });

            // Close on background click
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                    resolve(null);
                }
            });
        });
    }

    // Show SRT export dialog with recording start time input
    // meetingStartTime: optional ISO string to use as default
    function showSrtDialog(meetingStartTime = null) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;

            // Use meeting start time if provided, otherwise fall back to current time
            const defaultTime = meetingStartTime ? new Date(meetingStartTime) : new Date();
            const dateStr = defaultTime.toISOString().split('T')[0];
            const timeStr = defaultTime.toTimeString().slice(0, 5);

            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: white;
                padding: 24px;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                max-width: 420px;
                width: 90%;
            `;

            dialog.innerHTML = `
                <h3 style="margin: 0 0 8px 0; font-size: 18px;">Export as SRT Subtitles</h3>
                <p style="margin: 0 0 16px 0; font-size: 13px; color: #666;">
                    Enter when you started your external recording (OBS, etc.) to sync subtitles with your video.
                </p>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 14px;">Recording Start Date</label>
                    <input type="date" id="srt-date" value="${dateStr}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
                </div>
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 14px;">Recording Start Time</label>
                    <input type="time" id="srt-time" value="${timeStr}" step="1" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
                </div>
                <p style="margin: 0 0 16px 0; font-size: 12px; color: #888;">
                    Tip: You may need to adjust by a few seconds in your video editor for perfect sync.
                </p>
                <div style="display: flex; gap: 8px;">
                    <button id="srt-export-btn" style="flex: 1; padding: 12px; background: #fd7e14; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">
                        Export SRT
                    </button>
                    <button id="srt-cancel-btn" style="flex: 1; padding: 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                        Cancel
                    </button>
                </div>
            `;

            modal.appendChild(dialog);
            document.body.appendChild(modal);

            const dateInput = dialog.querySelector('#srt-date');
            const timeInput = dialog.querySelector('#srt-time');
            const exportBtn = dialog.querySelector('#srt-export-btn');
            const cancelBtn = dialog.querySelector('#srt-cancel-btn');

            exportBtn.addEventListener('click', () => {
                const date = dateInput.value;
                const time = timeInput.value;
                if (!date || !time) {
                    alert('Please enter both date and time');
                    return;
                }
                const userRecordingStartTime = new Date(`${date}T${time}`).toISOString();
                document.body.removeChild(modal);
                resolve({ format: 'srt', userRecordingStartTime });
            });

            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(null);
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    document.body.removeChild(modal);
                    resolve(null);
                }
            });
        });
    }

    function showButtonSuccess(button, successText, originalText) {
        const originalHtml = button.innerHTML;
        button.classList.add('success');
        const svg = button.querySelector('svg');
        button.innerHTML = `${svg.outerHTML}${successText}`;

        setTimeout(() => {
            button.classList.remove('success');
            button.innerHTML = originalHtml;
        }, 2000);
    }
    
    function showNotification(message, type = 'info') {
        // Remove existing notification if any
        const existingNotification = document.getElementById('notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        const notification = document.createElement('div');
        notification.id = 'notification';
        notification.textContent = message;
        
        const colors = {
            success: '#28a745',
            error: '#dc3545',
            warning: '#ffc107',
            info: '#17a2b8'
        };
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${colors[type] || colors.info};
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            z-index: 10000;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideInFromRight 0.3s ease-out;
        `;
        
        // Add slide-in animation style once
        if (!notificationStyleAdded) {
            const style = document.createElement('style');
            style.textContent = `@keyframes slideInFromRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
            document.head.appendChild(style);
            notificationStyleAdded = true;
        }

        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideInFromRight 0.3s ease-out reverse';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, 300);
        }, 3000);
    }
    
    // --- Initialization ---
    let eventListenersSetup = false; // Prevent duplicate event listeners

    function setupEventListeners() {
        // Prevent duplicate event listener setup
        if (eventListenersSetup) {
            debug.log('[Viewer] Event listeners already set up, skipping');
            return;
        }
        eventListenersSetup = true;

        searchBox.addEventListener('input', debouncedApplyFilters);
        speakerFiltersContainer.addEventListener('click', handleSpeakerFilterClick);
        captionsContainer.addEventListener('click', handleCopyClick);
        copyAllBtn.addEventListener('click', handleCopyAllClick);
        saveAllBtn.addEventListener('click', handleSaveAllClick);

        // Shared content slides toggle
        const slidesToggle = document.getElementById('toggle-slides-btn');
        if (slidesToggle) {
            slidesToggle.addEventListener('click', () => {
                showSlides = !showSlides;
                updateSlidesToggleVisibility(true);
                applyFilters();
            });
        }

        // Handle image load errors using event delegation (CSP-compliant)
        captionsContainer.addEventListener('error', (event) => {
            if (event.target.classList.contains('attachment-image')) {
                // Hide the parent thumbnail container when image fails to load
                const thumbnail = event.target.closest('.attachment-thumbnail');
                if (thumbnail) {
                    thumbnail.style.display = 'none';
                }
            }
        }, true); // Use capture phase to catch error events

        // No longer need inline caption editing since we use filter buttons

        // Smart scroll monitoring
        window.addEventListener('scroll', () => {
            checkIfNearBottom();
            // Hide new caption indicator if user scrolled to bottom
            if (isNearBottom) {
                const indicator = document.getElementById('new-caption-indicator');
                if (indicator) {
                    indicator.style.display = 'none';
                }
            }
        });

        // Session history handlers
        historyBtn.addEventListener('click', showSessionHistory);
        closeModal.addEventListener('click', () => sessionModal.style.display = 'none');
        window.addEventListener('click', (e) => {
            if (e.target === sessionModal) {
                sessionModal.style.display = 'none';
            }
        });

        // Hot keyword detection modal handlers
        setupKeywordModalEvents();

        // Check URL parameter to auto-open keyword modal (from popup settings link)
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('openKeywords') === 'true') {
            // Trigger the keywords button click to open modal
            setTimeout(() => {
                document.getElementById('keywords-btn')?.click();
            }, 100);
        }
    }
    
    // --- Session History Functions ---

    // Define loadSessionFromHistory first, before it's used in loadSessionHistory
    const loadSessionFromHistory = async function(sessionId) {
        try {
            console.log('[Session History] Loading session:', sessionId);
            const sessionManager = new SessionManager();
            const sessionData = await sessionManager.loadSessionData(sessionId);

            // Close modal
            sessionModal.style.display = 'none';

            // Load the transcript
            allCaptions = sessionData.transcript;
            isLiveStreaming = false; // Historical data, not live

            // Update title with proper format
            const h1 = document.querySelector('h1');
            const meetingTitle = sessionData.metadata?.meetingTitle || sessionData.metadata?.title || 'Untitled Meeting';
            const platform = sessionData.metadata?.platform || '';

            // Set global variables for save functionality
            currentMeetingTitle = meetingTitle;
            currentPlatform = platform;
            currentAttendeeReport = sessionData.attendeeReport || null;

            h1.innerHTML = `${createPlatformBadge(platform)}Live Transcript <span style="font-size: 0.5em; color: #666;">(Historical)</span><span class="meeting-title">${escapeHtml(meetingTitle)}</span>`;

            // Calculate and display analytics
            const analytics = calculateAnalytics(allCaptions);
            if (analytics) {
                displayAnalytics(analytics);
            }

            // Render the transcript
            renderCaptions(allCaptions);
            populateSpeakerFilters(allCaptions);

            // Clear any live indicators
            const liveIndicator = document.getElementById('live-indicator');
            if (liveIndicator) {
                liveIndicator.classList.remove('active');
            }

            console.log('[Session History] Successfully loaded session with', allCaptions.length, 'captions');

        } catch (error) {
            console.error('[Session History] Failed to load session:', error);
            alert('Failed to load session');
        }
    }

    async function showSessionHistory() {
        sessionModal.style.display = 'block';
        await loadSessionHistory();
    }
    
    async function loadSessionHistory() {
        if (!sessionListModal) {
            console.error('[Session History] sessionListModal element not found');
            return;
        }
        try {
            // Check if SessionManager already exists or load it
            if (typeof SessionManager === 'undefined') {
                const script = document.createElement('script');
                script.src = chrome.runtime.getURL('sessionManager.js');
                document.head.appendChild(script);

                await new Promise((resolve, reject) => {
                    let resolved = false;
                    script.onload = () => {
                        if (!resolved) {
                            resolved = true;
                            resolve();
                        }
                    };
                    script.onerror = () => {
                        if (!resolved) {
                            resolved = true;
                            reject(new Error('Failed to load sessionManager.js'));
                        }
                    };
                    // Timeout as fallback, but only resolve if script hasn't errored
                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            // Check if SessionManager is now defined
                            if (typeof SessionManager !== 'undefined') {
                                resolve();
                            } else {
                                reject(new Error('Timeout waiting for sessionManager.js'));
                            }
                        }
                    }, 2000); // Increased timeout for slower connections
                });
            }

            const sessionManager = new SessionManager();
            const sessions = await sessionManager.getSessionIndex();
            
            if (!sessions || sessions.length === 0) {
                sessionListModal.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">No saved sessions available</div>';
                return;
            }
            
            let html = '';
            for (const session of sessions) {
                const timeAgo = getTimeAgo(new Date(session.timestamp));
                html += `
                    <div class="session-item" data-session-id="${session.id}">
                        <div class="session-title">${escapeHtml(session.title)}</div>
                        <div class="session-meta">
                            ${session.date} • ${session.duration} • ${session.captionCount} captions • ${timeAgo}
                        </div>
                    </div>
                `;
            }

            sessionListModal.innerHTML = html;

            // Add click handlers to session items
            sessionListModal.querySelectorAll('.session-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const sessionId = item.dataset.sessionId;
                    await loadSessionFromHistory(sessionId);
                });
            });
            
        } catch (error) {
            console.error('[Session History] Failed to load:', error);
            sessionListModal.innerHTML = '<div style="text-align: center; color: #dc3545; padding: 20px;">Error loading sessions</div>';
        }
    }
    
    
    function getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        const intervals = {
            year: 31536000,
            month: 2592000,
            week: 604800,
            day: 86400,
            hour: 3600,
            minute: 60
        };
        
        for (const [unit, secondsInUnit] of Object.entries(intervals)) {
            const interval = Math.floor(seconds / secondsInUnit);
            if (interval >= 1) {
                return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
            }
        }
        return 'just now';
    }

    async function initialize() {
        try {
            // Check if we have a session parameter in the URL
            const urlParams = new URLSearchParams(window.location.search);
            const sessionKey = urlParams.get('session');

            let result;
            let viewerData;
            let transcript;

            if (sessionKey) {
                // Load from unique session key (for historical sessions)
                console.log('[Viewer] Loading historical session from key:', sessionKey);
                const sessionResult = await chrome.storage.local.get(sessionKey);
                viewerData = sessionResult[sessionKey];

                if (viewerData) {
                    transcript = viewerData.transcriptArray;
                    console.log('[Viewer] Loaded historical session data:', {
                        meetingTitle: viewerData.meetingTitle,
                        platform: viewerData.platform,
                        captionCount: transcript?.length,
                        hasDebug: !!viewerData._debug
                    });
                }
            } else {
                // Fallback to old method (for live sessions or backwards compatibility)
                result = await chrome.storage.local.get(['captionsToView', 'viewerData', 'viewerSessionId', 'meetingTitle', 'platform', 'scrollToIndex']);

                if (!result) {
                    throw new Error('Failed to load data from storage');
                }

                transcript = result.captionsToView;
                viewerData = result.viewerData;

                // Store the session ID for filtering live updates
                viewerSessionId = result.viewerSessionId;
                debug.log(`[Viewer] Initialized with session ID: ${viewerSessionId}`);

                // Use viewerData if captionsToView is not available
                if (!transcript && viewerData && viewerData.transcriptArray) {
                    transcript = viewerData.transcriptArray;
                }
            }

            if (transcript && transcript.length > 0) {
                // Update meeting title if provided (from either direct meetingTitle or viewerData)
                const meetingTitle = result?.meetingTitle || viewerData?.meetingTitle;
                const platform = result?.platform || viewerData?.platform || '';

                // Set global variables for save functionality
                currentMeetingTitle = meetingTitle || 'Untitled Meeting';
                currentPlatform = platform;
                currentAttendeeReport = viewerData?.attendeeReport || null;

                console.log('[Viewer] Loading session with data:', {
                    meetingTitle,
                    platform,
                    isHistorical: viewerData?.isHistorical,
                    hasViewerData: !!viewerData,
                    viewerDataKeys: viewerData ? Object.keys(viewerData) : [],
                    DEBUG_INFO: viewerData?._debug
                });

                // Log debug info if available
                if (viewerData?._debug) {
                    console.log('[Viewer] Session Load Details:', viewerData._debug);
                }

                if (meetingTitle) {
                    const h1 = document.querySelector('h1');
                    const isHistorical = viewerData?.isHistorical;
                    const badge = createPlatformBadge(platform);
                    if (isHistorical) {
                        h1.innerHTML = `${badge}Live Transcript <span style="font-size: 0.5em; color: #666;">(Historical)</span><span class="meeting-title">${escapeHtml(meetingTitle)}</span>`;
                    } else {
                        h1.innerHTML = `${badge}Live Transcript<span class="live-indicator"><span class="live-dot"></span>LIVE</span><span class="meeting-title">${escapeHtml(meetingTitle)}</span>`;
                    }
                } else {
                    console.warn('[Viewer] No meeting title found! viewerData:', viewerData, 'result:', result);
                }

                // Calculate and display analytics
                const analytics = calculateAnalytics(transcript);
                if (analytics) {
                    displayAnalytics(analytics);
                }

                // Load session-specific aliases before rendering
                await loadSessionAliases();

                // Load hot keyword settings
                await loadHotKeywords();

                // Merge attendance events with transcript if available
                if (viewerData?.attendeeData?.attendeeHistory) {
                    transcript = mergeAttendanceEvents(transcript, viewerData.attendeeData.attendeeHistory);
                }

                // Pull slide/attachment pixels from the image store before rendering
                await hydrateImages(transcript);

                renderCaptions(transcript);
                populateSpeakerFilters(transcript);
                setupEventListeners();

                // If opened from a keyword toast, scroll to the target caption
                const scrollIdx = result?.scrollToIndex ?? viewerData?.scrollToIndex;
                if (scrollIdx != null && scrollIdx >= 0) {
                    // Small delay to let the DOM settle after render
                    setTimeout(() => {
                        const el = captionsContainer.querySelector(`[data-index="${scrollIdx}"]`);
                        if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            el.classList.add('keyword-highlight');
                        }
                    }, 300);
                    // Clean up so it doesn't re-trigger
                    chrome.storage.local.remove('scrollToIndex').catch(() => {});
                }

                // Setup live streaming after initial load
                setupLiveStreaming();
                
                // Check if this is a completed meeting (not live)
                // If we have captions but no live connection after setup, show meeting ended
                setTimeout(async () => {
                    if (!isLiveStreaming && transcript.length > 0) {
                        await addMeetingEndedMessage();
                    }
                }, 1000);
            } else {
                // Check if user navigated directly to the page
                const isDirectNavigation = !result.captionsToView && !result.viewerData;
                if (isDirectNavigation) {
                    captionsContainer.innerHTML = '<p class="status-message">No transcript data available.<br><br>Please use the "View Transcript" button in the extension popup to load a transcript.</p>';
                    captionElementsCache = []; // Clear cache when showing status message
                } else {
                    captionsContainer.innerHTML = '<p class="status-message">Waiting for live captions...</p>';
                    captionElementsCache = []; // Clear cache when showing status message

                    // Update meeting title and platform if provided even when waiting for captions
                    const meetingTitle = result?.meetingTitle || viewerData?.meetingTitle;
                    const platform = result?.platform || viewerData?.platform || '';
                    if (meetingTitle || platform) {
                        const h1 = document.querySelector('h1');
                        h1.innerHTML = `${createPlatformBadge(platform)}Live Transcript<span class="live-indicator"><span class="live-dot"></span>LIVE</span>${meetingTitle ? `<span class="meeting-title">${escapeHtml(meetingTitle)}</span>` : ''}`;
                    }
                }

                // Load hot keyword settings
                await loadHotKeywords();

                // Always setup event listeners and live streaming
                setupEventListeners();
                setupLiveStreaming();
            }
        } catch (error) {
            console.error("[Viewer] Failed to initialize:", error);
            captionsContainer.innerHTML = `<p class="status-message">Unable to load captions: ${error.message}<br><br>Please try opening the extension popup again.</p>`;
            captionElementsCache = []; // Clear cache on error
        } finally {
            // Clean up storage to prevent stale data on next open
            try {
                await chrome.storage.local.remove(['captionsToView', 'viewerData', 'scrollToIndex', 'meetingTitle', 'platform', 'viewerSessionId']);
            } catch (cleanupError) {
                console.error('[Viewer] Failed to cleanup storage:', cleanupError);
                // Non-critical error, continue
            }
        }
    }
    
    async function addMeetingEndedMessage() {
        // Check if message already exists
        if (document.getElementById('meeting-ended-message')) return;
        
        // Check if auto-save is enabled
        const { autoSaveOnEnd } = await chrome.storage.sync.get('autoSaveOnEnd');
        
        const endedMessage = document.createElement('div');
        endedMessage.id = 'meeting-ended-message';
        endedMessage.style.cssText = `
            text-align: center;
            padding: 20px;
            margin: 20px 0;
            background: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 8px;
            color: #6c757d;
            font-size: 16px;
        `;
        
        let subtext = autoSaveOnEnd 
            ? 'The transcript has been auto-saved.'
            : 'The transcript is ready to save.';
            
        endedMessage.innerHTML = `<strong>Meeting Ended</strong><br><span style="font-size: 14px;">${subtext}</span>`;
        
        captionsContainer.appendChild(endedMessage);
        
        // Smart auto-scroll to show the message
        checkIfNearBottom();
        if (autoScroll && isNearBottom) {
            endedMessage.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }
    
    function removeMeetingEndedMessage() {
        const message = document.getElementById('meeting-ended-message');
        if (message) {
            message.remove();
        }
    }
    
    // --- Live Streaming Setup ---
    let messageListenerSetup = false;
    let viewerMessageHandler = null; // Store reference to remove old listener

    async function setupLiveStreaming() {
        // Setup message listener for live updates FIRST (before trying to connect)
        // This ensures we don't miss any broadcasts from the content script
        if (!messageListenerSetup) {
            messageListenerSetup = true;

            // Define the handler so we can reference it for removal if needed
            viewerMessageHandler = (request, sender, sendResponse) => {
                // Don't use async here to avoid automatic Promise return behavior
                // Handle async operations with IIFE when needed

                // Accept live updates from service worker (no sender.tab) or marked as fromServiceWorker
                const isFromServiceWorker = !sender.tab || request.fromServiceWorker;

                // For live updates, only process from service worker to avoid duplicates
                if (!isFromServiceWorker && (request.message === 'live_caption_update' || request.message === 'live_attendee_update')) {
                    // This is a live update directly from content script - ignore it
                    debug.log('[Viewer] Ignoring direct live update from content script');
                    return false; // Explicitly return false for early exit
                }

                const source = sender.tab ? `tab ${sender.tab.id}` : 'service worker';
                debug.log('[Viewer] Received message:', request?.message || 'undefined', 'from', source, 'Full request:', request);

                // Log test messages
                if (request.test) {
                    debug.log('[Viewer] Received TEST broadcast with live update');
                }
                if (request.message === "live_caption_update") {
                    // Filter by session ID if we have one
                    if (viewerSessionId && request.sessionId && request.sessionId !== viewerSessionId) {
                        debug.log(`[Viewer] Ignoring caption from different session: ${request.sessionId} (viewing ${viewerSessionId})`);
                        return false; // Explicitly return false for early exit
                    }

                    isLiveStreaming = true;
                    lastUpdateTime = Date.now(); // Update timestamp when receiving messages
                    // Slides and embedded attachments travel with the update for instant display
                    if (request.images && typeof request.images === 'object') {
                        Object.assign(imageCache, request.images);
                    }
                    queueUpdate(request);

                    // Remove "Meeting Ended" message if we're receiving updates again
                    removeMeetingEndedMessage();

                    debug.log("[Viewer] Processing live caption update:", request.type, request.caption?.Name, request.caption?.Text?.substring(0, 30));
                } else if (request.message === "live_attendee_update") {
                    // Filter by session ID if we have one
                    if (viewerSessionId && request.sessionId && request.sessionId !== viewerSessionId) {
                        debug.log(`[Viewer] Ignoring attendee update from different session: ${request.sessionId}`);
                        return false; // Explicitly return false for early exit
                    }

                    // Handle attendee updates if needed
                    console.log("Attendee update:", request);
                    lastUpdateTime = Date.now(); // Update timestamp for attendee updates too
                } else if (request.message === "meeting_ended") {
                    // Handle explicit meeting end signal - use async IIFE for await
                    (async () => {
                        isLiveStreaming = false;
                        updateLiveIndicator();
                        await addMeetingEndedMessage();
                    })();
                }

                return false; // No async response needed for these messages
            };

            chrome.runtime.onMessage.addListener(viewerMessageHandler);
        }
        
        // Try to connect to content script if it exists
        // Also request current transcript if viewer opened mid-meeting
        try {
            // Check for Teams (both work and personal), Google Meet, and Zoom tabs
            const teamsWorkTabs = await chrome.tabs.query({ url: "https://teams.microsoft.com/*" });
            const teamsPersonalTabs = await chrome.tabs.query({ url: "https://teams.live.com/*" });
            const meetTabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
            const zoomTabs = await chrome.tabs.query({ url: "https://*.zoom.us/*" });
            const tabs = [...teamsWorkTabs, ...teamsPersonalTabs, ...meetTabs, ...zoomTabs];
            
            // Try each tab until we find one with a content script
            for (const tab of tabs) {
                try {
                    // First, announce viewer is ready
                    const response = await chrome.tabs.sendMessage(tab.id, { message: "viewer_ready" });
                    if (response && response.streaming) {
                        isLiveStreaming = true;
                        lastUpdateTime = Date.now(); // Initialize timestamp
                        updateLiveIndicator();
                        // If captions container is empty, request current transcript
                        if (allCaptions.length === 0 && response.captionCount > 0) {
                            // Request the current transcript to populate viewer
                            const transcriptResponse = await chrome.tabs.sendMessage(tab.id, { 
                                message: "get_transcript_for_viewer" 
                            });
                            
                            if (transcriptResponse && transcriptResponse.transcriptArray) {
                                // Load the existing captions
                                allCaptions = transcriptResponse.transcriptArray;

                                // Update meeting title if provided
                                if (transcriptResponse.meetingTitle) {
                                    const h1 = document.querySelector('h1');
                                    h1.innerHTML = `${createPlatformBadge(transcriptResponse.platform)}Live Transcript<span class="live-indicator active"><span class="live-dot"></span>LIVE</span><span class="meeting-title">${escapeHtml(transcriptResponse.meetingTitle)}</span>`;
                                }

                                renderCaptions(allCaptions);
                                populateSpeakerFilters(allCaptions);
                                
                                // Calculate and display analytics
                                const analytics = calculateAnalytics(allCaptions);
                                if (analytics) {
                                    displayAnalytics(analytics);
                                }
                            }
                        }
                        break; // Stop after finding first active tab
                    }
                } catch (tabError) {
                    // This tab doesn't have content script, try next
                    console.log(`Tab ${tab.id} not ready:`, tabError.message);
                }
            }
        } catch (error) {
            console.log("Initial connection attempt failed (this is normal):", error.message);
            // This is OK - we'll receive broadcasts anyway when content script sends updates
        }

        // If no live stream found, update the placeholder message
        if (!isLiveStreaming) {
            const statusMsg = captionsContainer.querySelector('.status-message');
            if (statusMsg && statusMsg.textContent === 'Waiting for live captions...') {
                statusMsg.innerHTML = 'No active meeting found.<br><br>Join a meeting and enable captions, then use "View Transcript" to see the live feed.';
            }
        }

        // Setup auto-scroll toggle
        setupAutoScrollToggle();
        
        // Heartbeat to check connection
        if (connectionCheckInterval) {
            clearInterval(connectionCheckInterval);
        }
        connectionCheckInterval = setInterval(checkConnectionStatus, 5000);
    }
    
    function setupAutoScrollToggle() {
        // Create controls container if it doesn't exist
        let controlsContainer = document.getElementById('viewer-controls');
        if (!controlsContainer) {
            controlsContainer = document.createElement('div');
            controlsContainer.id = 'viewer-controls';
            controlsContainer.style.cssText = `
                display: flex;
                gap: 10px;
                margin-bottom: 10px;
                align-items: center;
            `;
            const searchContainer = document.querySelector('.search-container');
            if (searchContainer) {
                searchContainer.parentNode.insertBefore(controlsContainer, searchContainer.nextSibling);
            }
        }
        
        // Create auto-scroll toggle
        if (!document.getElementById('auto-scroll-toggle')) {
            const autoScrollContainer = document.createElement('div');
            autoScrollContainer.style.cssText = 'display: flex; align-items: center; gap: 5px;';
            
            const autoScrollCheckbox = document.createElement('input');
            autoScrollCheckbox.type = 'checkbox';
            autoScrollCheckbox.id = 'auto-scroll-toggle';
            autoScrollCheckbox.checked = autoScroll;
            autoScrollCheckbox.onchange = () => {
                autoScroll = autoScrollCheckbox.checked;
                autoScrollLabel.textContent = `Follow Live Captions`;
                if (autoScroll && isNearBottom) {
                    const lastCaption = captionsContainer.lastElementChild;
                    if (lastCaption) {
                        lastCaption.scrollIntoView({ behavior: 'smooth', block: 'end' });
                    }
                }
            };
            
            const autoScrollLabel = document.createElement('label');
            autoScrollLabel.htmlFor = 'auto-scroll-toggle';
            autoScrollLabel.textContent = `Follow Live Captions`;
            autoScrollLabel.style.cursor = 'pointer';
            
            autoScrollContainer.appendChild(autoScrollCheckbox);
            autoScrollContainer.appendChild(autoScrollLabel);
            controlsContainer.appendChild(autoScrollContainer);
        }
        
        // Add scroll to bottom button
        if (!document.getElementById('scroll-to-bottom-btn')) {
            const scrollBtn = document.createElement('button');
            scrollBtn.id = 'scroll-to-bottom-btn';
            scrollBtn.textContent = '↓ Jump to Live';
            scrollBtn.style.cssText = `
                padding: 5px 10px;
                background: #007bff;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            `;
            scrollBtn.onclick = scrollToBottom;
            controlsContainer.appendChild(scrollBtn);
        }
    }
    
    async function checkConnectionStatus() {
        if (!isLiveStreaming) return;

        try {
            // Check if we're still receiving updates
            const timeSinceLastUpdate = Date.now() - lastUpdateTime;
            if (timeSinceLastUpdate > 60000) { // 60 seconds without updates
                isLiveStreaming = false;
                updateLiveIndicator();
                console.log("[Viewer] Lost connection to live stream");

                // Add "Meeting Ended" message
                await addMeetingEndedMessage();

                // Try to reconnect
                const teamsWorkTabs = await chrome.tabs.query({ url: "https://teams.microsoft.com/*" });
                const teamsPersonalTabs = await chrome.tabs.query({ url: "https://teams.live.com/*" });
                const meetTabs = await chrome.tabs.query({ url: "https://meet.google.com/*" });
                const zoomTabs = await chrome.tabs.query({ url: "https://*.zoom.us/*" });
                const tabs = [...teamsWorkTabs, ...teamsPersonalTabs, ...meetTabs, ...zoomTabs];

                if (tabs.length > 0) {
                    try {
                        const response = await chrome.tabs.sendMessage(tabs[0].id, { message: "viewer_ready" });
                        if (response && response.streaming) {
                            isLiveStreaming = true;
                            lastUpdateTime = Date.now();
                            updateLiveIndicator();
                            console.log("[Viewer] Reconnected to live stream");
                            removeMeetingEndedMessage();
                        }
                    } catch (reconnectError) {
                        console.error('[Viewer] Reconnection failed:', reconnectError);
                        // Continue with disconnected state
                    }
                }
            }
        } catch (error) {
            console.error('[Viewer] Error checking connection status:', error);
            // Don't change streaming state on error
        }
    }

    // --- Analytics Functions ---
    // Analytics are shared with the HTML export (transcriptRenderer.js)
    function calculateAnalytics(captions) {
        return TranscriptRenderer.calculateAnalytics(captions);
    }

    function displayAnalytics(analytics) {
        if (!analytics) return;

        const analyticsHTML = TranscriptRenderer.renderAnalyticsHTML(analytics, speakerAliases);
        let analyticsContainer = document.getElementById('meeting-analytics');
        const container = document.getElementById('captions-container');

        if (analyticsContainer) {
            analyticsContainer.innerHTML = analyticsHTML;
        } else {
            analyticsContainer = document.createElement('div');
            analyticsContainer.id = 'meeting-analytics';
            analyticsContainer.innerHTML = analyticsHTML;
            container.parentNode.insertBefore(analyticsContainer, container);
        }
    }
    
    // --- Keyboard Shortcuts ---
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + F for search focus
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            searchBox.focus();
        }
        
        // Escape to clear search
        if (e.key === 'Escape' && document.activeElement === searchBox) {
            searchBox.value = '';
            applyFilters();
        }
    });

    initialize();
});