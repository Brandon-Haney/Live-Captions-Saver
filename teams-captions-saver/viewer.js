// Global interval references for cleanup
let connectionCheckInterval = null;

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

    function openImageModal(imageUrl, caption) {
        modalImage.src = imageUrl;
        modalCaption.textContent = caption || '';
        imageModal.classList.add('active');

        // Add keyboard handler for ESC key
        document.addEventListener('keydown', handleModalEscape);
    }

    function closeImageModal() {
        imageModal.classList.remove('active');
        modalImage.src = ''; // Clear the image source

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

    // --- Utility ---
    function escapeHtml(str) {
        const p = document.createElement("p");
        p.textContent = str;
        return p.innerHTML;
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
                updateExistingCaption(caption);
                return;
            }
        }

        // Check if this is actually a new caption or just a fragment
        // For Google Meet, check if we already have a recent caption from this speaker
        const recentCaptionIndex = allCaptions.findIndex(c =>
            c.Name === caption.Name &&
            Math.abs(new Date(c.Time).getTime() - new Date(caption.Time).getTime()) < 10000 // Within 10 seconds
        );

        if (recentCaptionIndex !== -1 && caption.Text.length < 50) {
            // This looks like a fragment, update the existing caption instead
            debug.log('[Viewer] Fragment detected, updating existing caption instead of adding new');
            updateExistingCaption(caption);
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
        
        // Auto-scroll if:
        // 1. User has auto-scroll enabled AND is near bottom, OR
        // 2. User is very close to bottom (within 150px) regardless of setting
        if ((autoScroll && isNearBottom) || isNearBottom) {
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
        
        // Update export button states
        updateExportButtonStates();
        
        // Update last update time
        lastUpdateTime = Date.now();
        updateLiveIndicator();
    }
    
    function updateExistingCaption(caption) {
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
            // Update in data array
            allCaptions[index] = { ...allCaptions[index], ...caption };
            
            // Update in DOM
            const captionElement = captionsContainer.querySelector(`[data-index="${index}"]`);
            if (captionElement) {
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
        } else {
            debug.log('[Viewer] Caption not found for update, adding as new');
            appendNewCaption(caption);
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
    function createCaptionHTML(item, index) {
        const copyIconSVG = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>`;
        
        // Professional SVG icons instead of emojis
        const chatIconSVG = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>`;
        
        const captionIconSVG = `
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>`;
        
        // Handle attendance events differently
        if (item.Type === 'attendance') {
            const actionClass = item.action || (item.Text.includes('joined') ? 'joined' : 'left');
            const displayName = speakerAliases[item.Name] || item.Name;
            return `
                <div class="attendance-event ${actionClass}" data-type="attendance" data-action="${actionClass}">
                    <span class="attendance-icon">●</span>
                    <span class="name">${escapeHtml(displayName)}</span>
                    <span class="attendance-text">${escapeHtml(item.Text)}</span>
                    <span class="time">${escapeHtml(item.Time)}</span>
                </div>
            `;
        }

        // Determine if this is a chat message
        const isChat = item.Type === 'chat';
        const typeClass = isChat ? 'chat-message' : 'caption-message';
        const typeIcon = isChat ? chatIconSVG : captionIconSVG;
        const typeLabel = isChat ? 'Chat' : 'Caption';

        // Apply speaker alias if exists
        const displayName = speakerAliases[item.Name] || item.Name;
        const hasAlias = speakerAliases[item.Name] ? true : false;

        // Check for attachments and remove [Image:] text from display
        let displayText = item.Text;
        let attachmentsHTML = '';

        if (item.attachments && item.attachments.length > 0) {
            console.log(`[Viewer] Rendering ${item.attachments.length} attachments for message:`, item.attachments);
            // Remove [Image:] indicators from text for cleaner display
            displayText = displayText.replace(/\[Image:[^\]]*\]/g, '').trim();

            // Create attachment thumbnails with data attributes instead of onclick
            attachmentsHTML = `
                <div class="attachment-container">
                    ${item.attachments.map((att, attIndex) => {
                        const safeUrl = sanitizeUrl(att.url);
                        if (!safeUrl) {
                            console.warn('[Viewer] Blocked unsafe attachment URL:', att.url);
                            return '';
                        }
                        return `
                        <div class="attachment-thumbnail"
                             data-image-url="${escapeHtml(safeUrl)}"
                             data-image-caption="${escapeHtml(att.filename || att.alt)}"
                             title="${escapeHtml(att.filename || att.alt)}">
                            <img src="${escapeHtml(safeUrl)}"
                                 alt="${escapeHtml(att.alt || 'Image attachment')}"
                                 onerror="this.parentElement.style.display='none'">
                            <div class="attachment-filename">${escapeHtml(att.filename || 'image')}</div>
                        </div>`;
                    }).join('')}
                </div>
            `;
        }

        // Add attachment icon if there are attachments
        const attachmentIcon = item.attachments && item.attachments.length > 0 ?
            '<span class="attachment-icon" title="Has attachments">📎</span>' : '';

        return `
            <div class="caption ${typeClass}" data-speaker="${escapeHtml(item.Name)}" data-original-speaker="${escapeHtml(item.Name)}" data-index="${index}" data-type="${item.Type || 'caption'}">
                <button class="copy-btn" title="Copy this line" aria-label="Copy this line">
                    ${copyIconSVG}
                    <span class="tooltip-text">Copy</span>
                </button>
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

        updateExportButtonStates();
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
        const speakerToFilter = activeSpeakerFilter?.id === 'show-all-btn' ? null : activeSpeakerFilter?.dataset.speaker;

        // Performance: Use cached elements instead of querying DOM
        captionElementsCache.forEach(captionDiv => {
            const text = captionDiv.querySelector('.text').textContent.toLowerCase();
            const speaker = captionDiv.dataset.speaker;

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
        // Handle clicks on the button or its children (except edit icon)
        if (e.target.classList.contains('speaker-edit-icon')) return;

        // Find the actual button element
        // First check if the target itself is a button
        let filterBtn = null;
        if (e.target.classList.contains('speaker-filter-btn') || e.target.id === 'show-all-btn') {
            filterBtn = e.target;
        } else if (e.target.tagName === 'BUTTON') {
            // It's a button but doesn't have the expected classes/id
            // Check if it's inside the speaker filters container
            if (speakerFiltersContainer.contains(e.target)) {
                filterBtn = e.target;
                console.log('[Viewer] Found button without expected class/id:', e.target, 'classes:', Array.from(e.target.classList));
            }
        }

        // If still not found, search up the tree for a parent button
        if (!filterBtn) {
            filterBtn = e.target.closest('.speaker-filter-btn, #show-all-btn');
        }

        if (!filterBtn) {
            console.warn('[Viewer] Could not find filter button for click event');
            console.warn('  Target:', e.target.tagName, e.target);
            console.warn('  Classes:', Array.from(e.target.classList));
            console.warn('  ID:', e.target.id);
            console.warn('  Parent:', e.target.parentElement);
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
    
    function formatTranscriptForExport(captions, format = 'txt') {
        if (!captions || captions.length === 0) {
            return 'No captions to export.';
        }
        
        if (format === 'markdown') {
            return captions.map(entry => `**${entry.Name}** (${entry.Time}): ${entry.Text}`).join('\n\n');
        } else {
            return captions.map(entry => `[${entry.Time}] ${entry.Name}: ${entry.Text}`).join('\n');
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

        // Create download
        const content = formatTranscriptForExport(visibleCaptions);
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        const filename = `filtered-transcript-${dateStr}-${timeStr}.txt`;

        try {
            const blob = new Blob([content], { type: 'text/plain' });
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
        
        // Add slide-in animation
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideInFromRight {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideInFromRight 0.3s ease-out reverse';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
                if (style.parentNode) {
                    style.remove();
                }
            }, 300);
        }, 3000);
    }
    
    // --- Initialization ---
    function setupEventListeners() {
        searchBox.addEventListener('input', debouncedApplyFilters);
        speakerFiltersContainer.addEventListener('click', handleSpeakerFilterClick);
        captionsContainer.addEventListener('click', handleCopyClick);
        copyAllBtn.addEventListener('click', handleCopyAllClick);
        saveAllBtn.addEventListener('click', handleSaveAllClick);
        
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
            const platformName = platform ? platform.toUpperCase().replace('MICROSOFT TEAMS', 'TEAMS').replace('GOOGLE MEET', 'MEET') : '';
            const platformBadge = platform ? `<span class="platform-badge" data-platform="${platformName}">${platformName}</span>` : '';
            h1.innerHTML = `${platformBadge}Live Transcript <span style="font-size: 0.5em; color: #666;">(Historical)</span><span class="meeting-title">${escapeHtml(meetingTitle)}</span>`;

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
        try {
            // Check if SessionManager already exists or load it
            if (typeof SessionManager === 'undefined') {
                const script = document.createElement('script');
                script.src = chrome.runtime.getURL('sessionManager.js');
                document.head.appendChild(script);

                await new Promise((resolve, reject) => {
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Failed to load sessionManager.js'));
                    setTimeout(resolve, 200);
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
            // Check if we have captions passed via storage (from popup)
            const result = await chrome.storage.local.get(['captionsToView', 'viewerData', 'viewerSessionId', 'meetingTitle', 'platform']);

            if (!result) {
                throw new Error('Failed to load data from storage');
            }

            let transcript = result.captionsToView;
            let viewerData = result.viewerData;

            // Store the session ID for filtering live updates
            viewerSessionId = result.viewerSessionId;
            debug.log(`[Viewer] Initialized with session ID: ${viewerSessionId}`);

            // Use viewerData if captionsToView is not available
            if (!transcript && viewerData && viewerData.transcriptArray) {
                transcript = viewerData.transcriptArray;
            }

            if (transcript && transcript.length > 0) {
                // Update meeting title if provided (from either direct meetingTitle or viewerData)
                const meetingTitle = result.meetingTitle || viewerData?.meetingTitle;
                const platform = result.platform || viewerData?.platform || '';
                if (meetingTitle) {
                    const h1 = document.querySelector('h1');
                    const isHistorical = viewerData?.isHistorical;
                    const platformName = platform ? platform.toUpperCase().replace('MICROSOFT TEAMS', 'TEAMS').replace('GOOGLE MEET', 'MEET') : '';
            const platformBadge = platform ? `<span class="platform-badge" data-platform="${platformName}">${platformName}</span>` : '';
                    if (isHistorical) {
                        h1.innerHTML = `${platformBadge}Live Transcript <span style="font-size: 0.5em; color: #666;">(Historical)</span><span class="meeting-title">${escapeHtml(meetingTitle)}</span>`;
                    } else {
                        h1.innerHTML = `${platformBadge}Live Transcript<span class="live-indicator"><span class="live-dot"></span>LIVE</span><span class="meeting-title">${escapeHtml(meetingTitle)}</span>`;
                    }
                }

                // Calculate and display analytics
                const analytics = calculateAnalytics(transcript);
                if (analytics) {
                    displayAnalytics(analytics);
                }

                // Load session-specific aliases before rendering
                await loadSessionAliases();

                // Merge attendance events with transcript if available
                if (viewerData?.attendeeData?.attendeeHistory) {
                    transcript = mergeAttendanceEvents(transcript, viewerData.attendeeData.attendeeHistory);
                }

                renderCaptions(transcript);
                populateSpeakerFilters(transcript);
                setupEventListeners();
                
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
                    const meetingTitle = result.meetingTitle || viewerData?.meetingTitle;
                    const platform = result.platform || viewerData?.platform || '';
                    if (meetingTitle || platform) {
                        const h1 = document.querySelector('h1');
                        const platformName = platform ? platform.toUpperCase().replace('MICROSOFT TEAMS', 'TEAMS').replace('GOOGLE MEET', 'MEET') : '';
                        const platformBadge = platform ? `<span class="platform-badge" data-platform="${platformName}">${platformName}</span>` : '';
                        h1.innerHTML = `${platformBadge}Live Transcript<span class="live-indicator active"><span class="live-dot"></span>LIVE</span>${meetingTitle ? `<span class="meeting-title">${escapeHtml(meetingTitle)}</span>` : ''}`;
                    }
                }

                // Always setup event listeners and live streaming
                setupEventListeners();
                setupLiveStreaming();
            }
        } catch (error) {
            console.error("[Viewer] Failed to initialize:", error);
            captionsContainer.innerHTML = `<p class="status-message">Unable to load captions: ${error.message}<br><br>Please try opening the extension popup again.</p>`;
            captionElementsCache = []; // Clear cache on error
        } finally {
            // Clean up storage to prevent re-displaying on next open
            // But keep viewerSessionId for filtering live updates
            try {
                await chrome.storage.local.remove(['captionsToView', 'viewerData']);
                // Note: viewerSessionId is kept for the duration of this viewer session
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
    
    async function setupLiveStreaming() {
        // Setup message listener for live updates FIRST (before trying to connect)
        // This ensures we don't miss any broadcasts from the content script
        if (!messageListenerSetup) {
            messageListenerSetup = true;
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
            });
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
                                    const platform = transcriptResponse.platform || '';
                                    const platformName = platform ? platform.toUpperCase().replace('MICROSOFT TEAMS', 'TEAMS').replace('GOOGLE MEET', 'MEET') : '';
            const platformBadge = platform ? `<span class="platform-badge" data-platform="${platformName}">${platformName}</span>` : '';
                                    h1.innerHTML = `${platformBadge}Live Transcript<span class="live-indicator active"><span class="live-dot"></span>LIVE</span><span class="meeting-title">${escapeHtml(transcriptResponse.meetingTitle)}</span>`;
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
    function calculateAnalytics(captions) {
        if (!captions || captions.length === 0) return null;
        
        const speakerStats = {};
        let totalWords = 0;
        
        // Calculate speaker statistics
        captions.forEach(caption => {
            const speaker = caption.Name;
            const words = caption.Text.split(/\s+/).length;
            
            if (!speakerStats[speaker]) {
                speakerStats[speaker] = {
                    messageCount: 0,
                    wordCount: 0,
                    firstMessage: caption.Time,
                    lastMessage: caption.Time
                };
            }
            
            speakerStats[speaker].messageCount++;
            speakerStats[speaker].wordCount += words;
            speakerStats[speaker].lastMessage = caption.Time;
            totalWords += words;
        });
        
        // Calculate percentages
        Object.keys(speakerStats).forEach(speaker => {
            speakerStats[speaker].wordPercentage = ((speakerStats[speaker].wordCount / totalWords) * 100).toFixed(1);
        });
        
        return {
            totalMessages: captions.length,
            totalWords: totalWords,
            uniqueSpeakers: Object.keys(speakerStats).length,
            speakerStats: speakerStats
        };
    }
    
    function displayAnalytics(analytics) {
        if (!analytics) return;
        
        // Check if analytics container already exists
        let analyticsContainer = document.getElementById('meeting-analytics');
        
        // Sort speakers by word count
        const sortedSpeakers = Object.entries(analytics.speakerStats)
            .sort((a, b) => b[1].wordCount - a[1].wordCount);
        
        let analyticsHTML = `
                <h3 style="margin-top: 0; color: #495057;">Meeting Analytics</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 15px;">
                    <div>
                        <div style="font-size: 24px; font-weight: bold; color: #17a2b8;">${analytics.totalMessages}</div>
                        <div style="font-size: 12px; color: #6c757d;">Total Messages</div>
                    </div>
                    <div>
                        <div style="font-size: 24px; font-weight: bold; color: #28a745;">${analytics.totalWords}</div>
                        <div style="font-size: 12px; color: #6c757d;">Total Words</div>
                    </div>
                    <div>
                        <div style="font-size: 24px; font-weight: bold; color: #ffc107;">${analytics.uniqueSpeakers}</div>
                        <div style="font-size: 12px; color: #6c757d;">Speakers</div>
                    </div>
                </div>
                <h4 style="margin-top: 15px; margin-bottom: 10px; color: #495057;">Speaker Participation</h4>
                <div style="space-y: 8px;">
        `;
        
        sortedSpeakers.slice(0, 5).forEach(([speaker, stats]) => {
            const percentage = stats.wordPercentage;
            analyticsHTML += `
                <div style="margin-bottom: 8px;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 2px;">
                        <span style="font-size: 14px; color: #495057;">${escapeHtml(speaker)}</span>
                        <span style="font-size: 12px; color: #6c757d;">${stats.wordCount} words (${percentage}%)</span>
                    </div>
                    <div style="background: #e9ecef; border-radius: 4px; height: 20px; overflow: hidden;">
                        <div style="background: linear-gradient(90deg, #17a2b8, #28a745); height: 100%; width: ${percentage}%; transition: width 0.3s ease;"></div>
                    </div>
                </div>
            `;
        });
        
        if (sortedSpeakers.length > 5) {
            analyticsHTML += `<div style="font-size: 12px; color: #6c757d; margin-top: 8px;">...and ${sortedSpeakers.length - 5} more speakers</div>`;
        }
        
        analyticsHTML += `
                </div>
        `;
        
        // Update existing analytics or create new one
        const container = document.getElementById('captions-container');
        
        if (analyticsContainer) {
            // Update existing analytics
            analyticsContainer.innerHTML = analyticsHTML;
        } else {
            // Create new analytics container
            analyticsContainer = document.createElement('div');
            analyticsContainer.id = 'meeting-analytics';
            analyticsContainer.style.cssText = 'background: #f8f9fa; padding: 15px; margin-bottom: 20px; border-radius: 8px; border: 1px solid #dee2e6;';
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