document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const captionsContainer = document.getElementById('captions-container');
    const searchBox = document.getElementById('search-box');
    const speakerFiltersContainer = document.getElementById('speaker-filters');

    // --- State ---
    let allCaptions = [];

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
            }, 1500);
        } catch (err) {
            console.error('Failed to copy text: ', err);
            copyButton.querySelector('.tooltip-text').textContent = 'Error!';
        }
    }
    
    // --- Initialization ---
    function setupEventListeners() {
        searchBox.addEventListener('input', applyFilters);
        speakerFiltersContainer.addEventListener('click', handleSpeakerFilterClick);
        captionsContainer.addEventListener('click', handleCopyClick);
    }

    async function initialize() {
        try {
            const result = await chrome.storage.local.get('captionsToView');
            const transcript = result.captionsToView;

            if (transcript && transcript.length > 0) {
                renderCaptions(transcript);
                populateSpeakerFilters(transcript);
                setupEventListeners();
            } else {
                captionsContainer.innerHTML = '<p class="status-message">No captions found. The data may have been cleared.</p>';
            }
        } catch (error) {
            console.error("Error loading captions:", error);
            captionsContainer.innerHTML = '<p class="status-message">An error occurred while loading the captions.</p>';
        } finally {
            // Clean up storage to prevent re-displaying on next open
            chrome.storage.local.remove('captionsToView');
        }
    }

    initialize();
});