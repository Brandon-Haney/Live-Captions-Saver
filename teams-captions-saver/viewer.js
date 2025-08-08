document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const captionsContainer = document.getElementById('captions-container');
    const searchBox = document.getElementById('search-box');
    const speakerFiltersContainer = document.getElementById('speaker-filters');

    // --- State ---
    let allCaptions = [];
    let searchDebounceTimer = null;
    let meetingStartTime = null;
    let meetingEndTime = null;
    const SEARCH_DEBOUNCE_DELAY = 300;

    // --- Utility ---
    function escapeHtml(str) {
        const p = document.createElement("p");
        p.textContent = str;
        return p.innerHTML;
    }

    // --- Rendering Functions ---
    function createCaptionHTML(item, index) {
        const copyIconSVG = `
            <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>`;
        
        return `
            <div class="caption" data-speaker="${escapeHtml(item.Name)}" data-index="${index}">
                <button class="copy-btn" title="Copy this line" aria-label="Copy this line">
                    ${copyIconSVG}
                    <span class="tooltip-text">Copy</span>
                </button>
                <div class="caption-header">
                    <span class="name">${escapeHtml(item.Name)}</span>
                    <span class="time">${escapeHtml(item.Time)}</span>
                </div>
                <p class="text">${escapeHtml(item.Text)}</p>
            </div>
        `;
    }

    function renderCaptions(transcriptArray) {
        allCaptions = transcriptArray;
        const htmlContent = transcriptArray.map(createCaptionHTML).join('');
        captionsContainer.innerHTML = htmlContent || '<p class="status-message">No captions to display.</p>';
    }

    function populateSpeakerFilters(transcriptArray) {
        const speakers = [...new Set(transcriptArray.map(item => item.Name))];
        speakers.forEach(speaker => {
            const btn = document.createElement('button');
            btn.textContent = speaker;
            btn.dataset.speaker = speaker;
            btn.setAttribute('aria-label', `Filter by ${speaker}`);
            speakerFiltersContainer.appendChild(btn);
        });
    }

    // --- Interactivity & Filtering ---
    function applyFilters() {
        const searchTerm = searchBox.value.toLowerCase().trim();
        const activeSpeakerFilter = speakerFiltersContainer.querySelector('button.active');
        const speakerToFilter = activeSpeakerFilter.id === 'show-all-btn' ? null : activeSpeakerFilter.dataset.speaker;

        document.querySelectorAll('.caption').forEach(captionDiv => {
            const text = captionDiv.querySelector('.text').textContent.toLowerCase();
            const speaker = captionDiv.dataset.speaker;

            const matchesSearch = !searchTerm || text.includes(searchTerm) || speaker.toLowerCase().includes(searchTerm);
            const matchesSpeaker = !speakerToFilter || speaker === speakerToFilter;

            captionDiv.style.display = (matchesSearch && matchesSpeaker) ? 'block' : 'none';
        });
    }

    function debouncedApplyFilters() {
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = setTimeout(applyFilters, SEARCH_DEBOUNCE_DELAY);
    }

    function handleSpeakerFilterClick(e) {
        if (e.target.tagName !== 'BUTTON') return;
        
        speakerFiltersContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
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
    
    // --- Initialization ---
    function setupEventListeners() {
        searchBox.addEventListener('input', debouncedApplyFilters);
        speakerFiltersContainer.addEventListener('click', handleSpeakerFilterClick);
        captionsContainer.addEventListener('click', handleCopyClick);
    }

    async function initialize() {
        try {
            const result = await chrome.storage.local.get('captionsToView');
            const transcript = result.captionsToView;

            if (transcript && transcript.length > 0) {
                // Calculate and display analytics
                const analytics = calculateAnalytics(transcript);
                if (analytics) {
                    displayAnalytics(analytics);
                }
                
                renderCaptions(transcript);
                populateSpeakerFilters(transcript);
                setupEventListeners();
            } else {
                captionsContainer.innerHTML = '<p class="status-message">No captions found. The data may have been cleared.</p>';
            }
        } catch (error) {
            console.error("Error loading captions:", error);
            captionsContainer.innerHTML = '<p class="status-message">Unable to load captions. Please try opening the extension popup again.</p>';
        } finally {
            // Clean up storage to prevent re-displaying on next open
            chrome.storage.local.remove('captionsToView');
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
        
        // Sort speakers by word count
        const sortedSpeakers = Object.entries(analytics.speakerStats)
            .sort((a, b) => b[1].wordCount - a[1].wordCount);
        
        let analyticsHTML = `
            <div id="meeting-analytics" style="background: #f8f9fa; padding: 15px; margin-bottom: 20px; border-radius: 8px; border: 1px solid #dee2e6;">
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
            </div>
        `;
        
        // Insert analytics before captions container
        const container = document.getElementById('captions-container');
        const analyticsDiv = document.createElement('div');
        analyticsDiv.innerHTML = analyticsHTML;
        container.parentNode.insertBefore(analyticsDiv, container);
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