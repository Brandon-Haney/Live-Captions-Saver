document.addEventListener('DOMContentLoaded', () => {
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
        const lastCaption = captionsContainer.lastElementChild;
        if (lastCaption) {
            lastCaption.scrollIntoView({ behavior: 'smooth', block: 'end' });
            // Add a small extra scroll to ensure the last caption is fully visible
            setTimeout(() => {
                window.scrollBy(0, 50);
            }, 300); // Wait for smooth scroll to finish
        }
        const indicator = document.getElementById('new-caption-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }
    
    function showNewCaptionIndicator() {
        let indicator = document.getElementById('new-caption-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'new-caption-indicator';
            indicator.className = 'new-caption-indicator';
            
            const button = document.createElement('button');
            button.textContent = '↓ New captions available';
            button.addEventListener('click', scrollToBottom);
            
            indicator.appendChild(button);
            document.body.appendChild(indicator);
        }
        indicator.style.display = 'block';
    }
    
    // --- Speaker Alias Functions ---
    async function loadSessionAliases() {
        if (!viewerSessionId) return;
        
        try {
            const key = `aliases_${viewerSessionId}`;
            const result = await chrome.storage.local.get(key);
            speakerAliases = result[key] || {};
            console.log(`[Viewer] Loaded aliases for session ${viewerSessionId}:`, speakerAliases);
        } catch (error) {
            console.error('Error loading session aliases:', error);
            speakerAliases = {};
        }
    }
    
    async function saveSessionAliases() {
        if (!viewerSessionId) return;
        
        try {
            const key = `aliases_${viewerSessionId}`;
            await chrome.storage.local.set({ [key]: speakerAliases });
            console.log(`[Viewer] Saved aliases for session ${viewerSessionId}:`, speakerAliases);
        } catch (error) {
            console.error('Error saving session aliases:', error);
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
        const displayName = speakerAliases[originalName] || originalName;
        const hasAlias = !!speakerAliases[originalName];
        
        // Update all caption instances - use correct selector without 'editable-speaker' class
        document.querySelectorAll(`.caption[data-original-speaker="${originalName}"] .name`).forEach(elem => {
            elem.textContent = displayName;
            elem.classList.toggle('has-alias', hasAlias);
            elem.title = hasAlias ? `Original: ${originalName}` : '';
        });
        
        // Update speaker filter button if it exists
        const filterBtn = speakerFiltersContainer.querySelector(`button[data-original-speaker="${originalName}"]`);
        if (filterBtn) {
            const nameSpan = filterBtn.querySelector('span:not(.speaker-edit-icon)');
            if (nameSpan) {
                nameSpan.textContent = displayName;
            }
            filterBtn.setAttribute('aria-label', `Filter by ${displayName}`);
        }
    }
    
    // --- Helper Functions ---
    function highlightSearchTerm(element, searchTerm) {
        if (!searchTerm) return;
        
        const textElement = element.querySelector('.text');
        if (!textElement) return;
        
        const text = textElement.textContent;
        const regex = new RegExp(`(${searchTerm})`, 'gi');
        const highlightedText = text.replace(regex, '<mark>$1</mark>');
        textElement.innerHTML = highlightedText;
    }
    
    // --- Live Update Functions ---
    function appendNewCaption(caption) {
        // Check if this is actually a new caption or just a fragment
        // For Google Meet, check if we already have a recent caption from this speaker
        const recentCaptionIndex = allCaptions.findIndex(c => 
            c.Name === caption.Name && 
            Math.abs(new Date(c.Time).getTime() - new Date(caption.Time).getTime()) < 10000 // Within 10 seconds
        );
        
        if (recentCaptionIndex !== -1 && caption.Text.length < 50) {
            // This looks like a fragment, update the existing caption instead
            console.log('[Viewer] Fragment detected, updating existing caption instead of adding new');
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
        console.log('[Viewer] Updating caption with key:', caption.key);
        
        // First, try to find by key
        let index = allCaptions.findIndex(c => c.key === caption.key);
        
        // If not found by key, try to find by speaker name (for Google Meet)
        if (index === -1 && caption.Name) {
            console.log('[Viewer] Key not found, searching by name:', caption.Name);
            // Find the most recent caption from this speaker
            for (let i = allCaptions.length - 1; i >= 0; i--) {
                if (allCaptions[i].Name === caption.Name) {
                    index = i;
                    console.log('[Viewer] Found caption by name at index:', index);
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
                    console.log('[Viewer] Updating text from:', textElement.textContent, 'to:', caption.Text);
                    textElement.textContent = caption.Text;
                } else {
                    console.log('[Viewer] Text element not found in caption');
                }
            } else {
                console.log('[Viewer] Caption element not found at index:', index);
            }
        } else {
            console.log('[Viewer] Caption not found for update, adding as new');
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
        console.log('[Viewer] Queuing update:', update.type, update.caption?.Name);
        pendingUpdates.push(update);
        
        // Batch updates every 100ms for performance
        if (!updateTimer) {
            updateTimer = setTimeout(batchProcessUpdates, 100);
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
        const indicator = document.getElementById('live-indicator');
        if (!indicator) {
            // Create live indicator if it doesn't exist
            const headerElement = document.querySelector('h1');
            if (headerElement) {
                const liveIndicator = document.createElement('span');
                liveIndicator.id = 'live-indicator';
                liveIndicator.className = 'live-indicator';
                liveIndicator.innerHTML = '<span class="live-dot"></span> LIVE';
                headerElement.appendChild(liveIndicator);
            }
        } else {
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
        
        // Determine if this is a chat message
        const isChat = item.Type === 'chat';
        const typeClass = isChat ? 'chat-message' : 'caption-message';
        const typeIcon = isChat ? chatIconSVG : captionIconSVG;
        const typeLabel = isChat ? 'Chat' : 'Caption';
        
        // Apply speaker alias if exists
        const displayName = speakerAliases[item.Name] || item.Name;
        const hasAlias = speakerAliases[item.Name] ? true : false;
        
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
                    </span>
                    <span class="text">${escapeHtml(item.Text)}</span>
                </div>
            </div>
        `;
    }

    function renderCaptions(transcriptArray) {
        allCaptions = transcriptArray;
        const htmlContent = transcriptArray.map(createCaptionHTML).join('');
        captionsContainer.innerHTML = htmlContent || '<p class="status-message">No captions to display.</p>';
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

        document.querySelectorAll('.caption').forEach(captionDiv => {
            const text = captionDiv.querySelector('.text').textContent.toLowerCase();
            const speaker = captionDiv.dataset.speaker;

            const matchesSearch = !searchTerm || text.includes(searchTerm) || speaker.toLowerCase().includes(searchTerm);
            const matchesSpeaker = !speakerToFilter || speaker === speakerToFilter;

            captionDiv.style.display = (matchesSearch && matchesSpeaker) ? 'block' : 'none';
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
        
        // Find the actual button element (could be the target or its parent)
        let filterBtn = e.target;
        if (!filterBtn.classList.contains('speaker-filter-btn') && filterBtn.id !== 'show-all-btn') {
            filterBtn = e.target.closest('.speaker-filter-btn');
            if (!filterBtn && e.target.parentElement?.id !== 'show-all-btn') {
                filterBtn = e.target.closest('#show-all-btn');
            }
        }
        
        if (!filterBtn) return;
        
        // Remove active from all buttons
        speakerFiltersContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        speakerFiltersContainer.querySelectorAll('.speaker-filter-btn').forEach(b => b.classList.remove('active'));
        
        filterBtn.classList.add('active');
        applyFilters();
    }

    async function handleCopyClick(e) {
        const copyButton = e.target.closest('.copy-btn');
        if (!copyButton) return;

        const captionDiv = copyButton.closest('.caption');
        const index = parseInt(captionDiv.dataset.index, 10);
        const captionData = allCaptions[index];

        if (!captionData) return;

        const textToCopy = `[${captionData.Time}] ${captionData.Name}: ${captionData.Text}`;
        try {
            await navigator.clipboard.writeText(textToCopy);
            copyButton.classList.add('copied');
            copyButton.querySelector('.tooltip-text').textContent = 'Copied!';
            
            setTimeout(() => {
                copyButton.classList.remove('copied');
                copyButton.querySelector('.tooltip-text').textContent = 'Copy';
            }, 1500); // TODO: Extract to TIMING constant
        } catch (err) {
            console.error('Failed to copy text: ', err);
            copyButton.querySelector('.tooltip-text').textContent = 'Copy failed';
            // Show user-friendly error
            const errorMsg = document.createElement('div');
            errorMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #dc3545; color: white; padding: 10px; border-radius: 4px; z-index: 1000;';
            errorMsg.textContent = 'Failed to copy text to clipboard';
            document.body.appendChild(errorMsg);
            setTimeout(() => document.body.removeChild(errorMsg), 3000);
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
            console.error('Failed to copy transcript: ', err);
            showNotification('Failed to copy to clipboard', 'error');
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
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showButtonSuccess(saveAllBtn, 'Saved!', 'Save');
            showNotification(`Saved ${visibleCaptions.length} caption(s) to ${filename}`, 'success');
            
            // Update meeting ended message to show it's been saved
            if (document.getElementById('meeting-ended-message')) {
                await addMeetingEndedMessage(true);
            }
        } catch (err) {
            console.error('Failed to save transcript: ', err);
            showNotification('Failed to save file', 'error');
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
                
                await new Promise(resolve => {
                    script.onload = resolve;
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
                    <div class="session-item" onclick="loadSessionFromHistory('${session.id}')">
                        <div class="session-title">${escapeHtml(session.title)}</div>
                        <div class="session-meta">
                            ${session.date} • ${session.duration} • ${session.captionCount} captions • ${timeAgo}
                        </div>
                    </div>
                `;
            }
            
            sessionListModal.innerHTML = html;
            
        } catch (error) {
            console.error('[Session History] Failed to load:', error);
            sessionListModal.innerHTML = '<div style="text-align: center; color: #dc3545; padding: 20px;">Error loading sessions</div>';
        }
    }
    
    window.loadSessionFromHistory = async function(sessionId) {
        try {
            const sessionManager = new SessionManager();
            const sessionData = await sessionManager.loadSession(sessionId);
            
            // Close modal
            sessionModal.style.display = 'none';
            
            // Load the transcript
            allCaptions = sessionData.transcript;
            isLiveStreaming = false; // Historical data, not live
            
            // Update title
            document.querySelector('h1').innerHTML = `${escapeHtml(sessionData.metadata.title)} <span style="font-size: 0.5em; color: #666;">(Historical)</span>`;
            
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
            
        } catch (error) {
            console.error('[Session History] Failed to load session:', error);
            alert('Failed to load session');
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
            const result = await chrome.storage.local.get(['captionsToView', 'viewerData', 'viewerSessionId']);
            let transcript = result.captionsToView;
            let viewerData = result.viewerData;
            
            // Store the session ID for filtering live updates
            viewerSessionId = result.viewerSessionId;
            console.log(`[Viewer] Initialized with session ID: ${viewerSessionId}`);
            
            // Use viewerData if captionsToView is not available
            if (!transcript && viewerData && viewerData.transcriptArray) {
                transcript = viewerData.transcriptArray;
                // Update title if it's historical data
                if (viewerData.isHistorical && viewerData.meetingTitle) {
                    document.querySelector('h1').innerHTML = `${escapeHtml(viewerData.meetingTitle)} <span style="font-size: 0.5em; color: #666;">(Historical)</span>`;
                }
            }

            if (transcript && transcript.length > 0) {
                // Calculate and display analytics
                const analytics = calculateAnalytics(transcript);
                if (analytics) {
                    displayAnalytics(analytics);
                }
                
                // Load session-specific aliases before rendering
                await loadSessionAliases();
                
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
                } else {
                    captionsContainer.innerHTML = '<p class="status-message">Waiting for live captions...</p>';
                }
                
                // Always setup event listeners and live streaming
                setupEventListeners();
                setupLiveStreaming();
            }
        } catch (error) {
            console.error("Error loading captions:", error);
            captionsContainer.innerHTML = '<p class="status-message">Unable to load captions. Please try opening the extension popup again.</p>';
        } finally {
            // Clean up storage to prevent re-displaying on next open
            // But keep viewerSessionId for filtering live updates
            chrome.storage.local.remove(['captionsToView', 'viewerData']);
            // Note: viewerSessionId is kept for the duration of this viewer session
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
            chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
                // Accept live updates from service worker (no sender.tab) or marked as fromServiceWorker
                const isFromServiceWorker = !sender.tab || request.fromServiceWorker;
                
                // For live updates, only process from service worker to avoid duplicates
                if (!isFromServiceWorker && (request.message === 'live_caption_update' || request.message === 'live_attendee_update')) {
                    // This is a live update directly from content script - ignore it
                    console.log('[Viewer] Ignoring direct live update from content script');
                    return;
                }
                
                const source = sender.tab ? `tab ${sender.tab.id}` : 'service worker';
                console.log('[Viewer] Received message:', request?.message || 'undefined', 'from', source, 'Full request:', request);
                
                // Log test messages
                if (request.test) {
                    console.log('[Viewer] Received TEST broadcast with live update');
                }
                if (request.message === "live_caption_update") {
                    // Filter by session ID if we have one
                    if (viewerSessionId && request.sessionId && request.sessionId !== viewerSessionId) {
                        console.log(`[Viewer] Ignoring caption from different session: ${request.sessionId} (viewing ${viewerSessionId})`);
                        return;
                    }
                    
                    isLiveStreaming = true;
                    lastUpdateTime = Date.now(); // Update timestamp when receiving messages
                    queueUpdate(request);
                    
                    // Remove "Meeting Ended" message if we're receiving updates again
                    removeMeetingEndedMessage();
                    
                    console.log("[Viewer] Processing live caption update:", request.type, request.caption?.Name, request.caption?.Text?.substring(0, 30));
                } else if (request.message === "live_attendee_update") {
                    // Filter by session ID if we have one
                    if (viewerSessionId && request.sessionId && request.sessionId !== viewerSessionId) {
                        console.log(`[Viewer] Ignoring attendee update from different session: ${request.sessionId}`);
                        return;
                    }
                    
                    // Handle attendee updates if needed
                    console.log("Attendee update:", request);
                    lastUpdateTime = Date.now(); // Update timestamp for attendee updates too
                } else if (request.message === "meeting_ended") {
                    // Handle explicit meeting end signal
                    isLiveStreaming = false;
                    updateLiveIndicator();
                    await addMeetingEndedMessage();
                }
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
        setInterval(checkConnectionStatus, 5000);
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
        
        // Check if we're still receiving updates
        const timeSinceLastUpdate = Date.now() - lastUpdateTime;
        if (timeSinceLastUpdate > 60000) { // 60 seconds without updates (increased from 30)
            isLiveStreaming = false;
            updateLiveIndicator();
            console.log("Lost connection to live stream");
            
            // Add "Meeting Ended" message
            await addMeetingEndedMessage();
            
            // Try to reconnect
            // Check for Teams (both work and personal), Google Meet, and Zoom tabs
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
                        lastUpdateTime = Date.now(); // Reset timeout
                        updateLiveIndicator();
                        console.log("Reconnected to live stream");
                        
                        // Remove "Meeting Ended" message if reconnected
                        removeMeetingEndedMessage();
                    }
                } catch (error) {
                    // Silent fail
                }
            }
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