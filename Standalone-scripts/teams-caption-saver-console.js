// == MS Teams Live Captions Saver (Console Edition) v1.0 ==
//
// HOW TO USE:
// 1. In a Microsoft Teams meeting in your browser (Chrome, Edge, Firefox).
// 2. Open the Developer Tools (press F12 or Ctrl+Shift+I).
// 3. Go to the "Console" tab.
// 4. (Optional) To try the auto-enable feature, change the line below to `true`.
// 5. Copy this entire script and paste it into the console, then press Enter.
//
(() => {
    // --- CONFIGURATION ---
    const AUTO_ENABLE_CAPTIONS_EXPERIMENTAL = true; // Change to `false` to disable

    // --- PREVENT DUPLICATE EXECUTION ---
    if (document.getElementById('teams-caption-saver-ui')) {
        alert("Caption Saver is already running. Please use the existing control panel or refresh the page to start over.");
        return;
    }

    // --- SCRIPT STATE ---
    const transcriptArray = [];
    let capturing = false;
    let meetingTitleOnStart = '';
    let recordingStartTime = null;
    let observer = null;
    let observedElement = null;
    let mainLoopInterval = null;
    let hasAttemptedAutoEnable = false;

    // --- CORE LOGIC ---
    const SELECTORS = {
        CAPTIONS_RENDERER: "[data-tid='closed-captions-renderer']",
        CHAT_MESSAGE: '.fui-ChatMessageCompact',
        AUTHOR: '[data-tid="author"]',
        CAPTION_TEXT: '[data-tid="closed-caption-text"]',
        LEAVE_BUTTONS: "button[data-tid='hangup-main-btn'], button[data-tid='hangup-leave-button'], div#hangup-button button",
        MORE_BUTTON: "button[data-tid='more-button'], button[id='callingButtons-showMoreBtn']",
        MORE_BUTTON_EXPANDED: "button[data-tid='more-button'][aria-expanded='true'], button[id='callingButtons-showMoreBtn'][aria-expanded='true']",
        LANGUAGE_SPEECH_BUTTON: "div[id='LanguageSpeechMenuControl-id']",
        TURN_ON_CAPTIONS_BUTTON: "div[id='closed-captions-button']",
    };

    function processCaptionUpdates() {
        const container = document.querySelector(SELECTORS.CAPTIONS_RENDERER);
        if (!container) return;
        container.querySelectorAll(SELECTORS.CHAT_MESSAGE).forEach(element => {
            const authorEl = element.querySelector(SELECTORS.AUTHOR);
            const textEl = element.querySelector(SELECTORS.CAPTION_TEXT);
            if (!authorEl || !textEl) return;
            const name = authorEl.innerText.trim();
            const text = textEl.innerText.trim();
            if (text.length === 0) return;
            let captionId = element.getAttribute('data-caption-id-script');
            if (!captionId) {
                captionId = `caption_${Date.now()}_${Math.random()}`;
                element.setAttribute('data-caption-id-script', captionId);
            }
            const existingIndex = transcriptArray.findIndex(e => e.key === captionId);
            const time = new Date().toLocaleTimeString();
            if (existingIndex !== -1) {
                if (transcriptArray[existingIndex].Text !== text) {
                    transcriptArray[existingIndex].Text = text;
                    transcriptArray[existingIndex].Time = time;
                }
            } else {
                transcriptArray.push({ Name: name, Text: text, Time: time, key: captionId });
            }
        });
        updateUIMessage();
    }

    function ensureObserverIsActive() {
        if (!capturing) return;
        const captionContainer = document.querySelector(SELECTORS.CAPTIONS_RENDERER);
        if (!captionContainer || captionContainer !== observedElement) {
            if (observer) observer.disconnect();
            if (captionContainer) {
                observer = new MutationObserver(processCaptionUpdates);
                observer.observe(captionContainer, { childList: true, subtree: true, characterData: true });
                observedElement = captionContainer;
                processCaptionUpdates();
            } else {
                observedElement = null;
            }
        }
    }

    function startCaptureSession() {
        if (capturing) return;
        capturing = true;
        meetingTitleOnStart = document.title;
        recordingStartTime = new Date();
        console.log("Caption capture STARTED.");
        updateUIMessage();
        ensureObserverIsActive();
    }

    function stopCaptureSession() {
        if (!capturing) return;
        capturing = false;
        if (observer) observer.disconnect();
        observer = null;
        observedElement = null;
        console.log("Caption capture STOPPED. Data is preserved for download.");
        updateUIMessage();
    }

    // --- AUTO-ENABLE FEATURE ---
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    async function attemptAutoEnableCaptions() {
        hasAttemptedAutoEnable = true;
        const statusEl = document.getElementById('tcs-status');
        if (statusEl) {
            statusEl.textContent = `⚙️ Attempting to auto-enable...`;
            statusEl.style.color = '#ffc107';
        }
        console.log("Attempting to auto-enable captions...");
        try {
            const moreButton = document.querySelector(SELECTORS.MORE_BUTTON);
            if (!moreButton) throw new Error("Could not find 'More' button.");
            moreButton.click();
            await delay(400);

            const langAndSpeechButton = document.querySelector(SELECTORS.LANGUAGE_SPEECH_BUTTON);
            if (!langAndSpeechButton) throw new Error("Could not find 'Language and speech' menu item.");
            langAndSpeechButton.click();
            await delay(400);

            const turnOnCaptionsButton = document.querySelector(SELECTORS.TURN_ON_CAPTIONS_BUTTON);
            if (turnOnCaptionsButton) {
                turnOnCaptionsButton.click();
                console.log("Successfully clicked 'Turn on live captions'.");
            } else {
                console.log("'Turn on live captions' button not found, captions might already be on.");
            }
            await delay(200);

            const expandedMoreButton = document.querySelector(SELECTORS.MORE_BUTTON_EXPANDED);
            if (expandedMoreButton) expandedMoreButton.click();
        } catch (e) {
            console.error("Auto-enable FAILED:", e.message);
            updateUIMessage();
        }
    }
    
    // --- UI and Actions ---
    function injectUI() {
        function createElement(tag, options = {}) {
            const el = document.createElement(tag);
            if (options.id) el.id = options.id;
            if (options.className) el.className = options.className;
            if (options.text) el.textContent = options.text;
            if (options.css) Object.assign(el.style, options.css);
            if (options.attributes) {
                for (const [key, value] of Object.entries(options.attributes)) {
                    el.setAttribute(key, value);
                }
            }
            return el;
        }

        const uiContainer = createElement('div', {
            id: 'teams-caption-saver-ui',
            css: {
                position: 'fixed', top: '20px', right: '20px', zIndex: '99999',
                backgroundColor: 'rgba(255, 255, 255, 0.95)', border: '1px solid #ccc',
                borderRadius: '8px', padding: '15px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                width: '280px', cursor: 'move', userSelect: 'none'
            }
        });

        const title = createElement('div', { text: 'Teams Caption Saver', css: { fontWeight: 'bold', fontSize: '16px', marginBottom: '10px', textAlign: 'center', color: '#333' } });

        const status = createElement('div', {
            id: 'tcs-status', text: 'Initializing...',
            css: { fontSize: '14px', marginBottom: '15px', textAlign: 'center', color: '#555', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'pre-wrap' }
        });

        const buttonRow = createElement('div', { css: { display: 'flex', gap: '10px' } });

        // --- Create Split Buttons ---
        const formats = [
            { label: 'as TXT', type: 'txt' },
            { label: 'as Markdown', type: 'md' },
            { label: 'as JSON', type: 'json' },
            { label: 'as YAML', type: 'yaml' }
        ];

        // SAVE BUTTON
        const saveSplitButton = createSplitButton('Save', formats, (format) => downloadTranscript(format));
        buttonRow.appendChild(saveSplitButton);
        
        // COPY BUTTON
        const copySplitButton = createSplitButton('Copy', formats, (format) => copyTranscript(format));
        buttonRow.appendChild(copySplitButton);

        const closeButton = createElement('button', {
            id: 'tcs-close', text: 'Close & Clean Up',
            css: { width: '100%', marginTop: '15px', backgroundColor: '#dc3545', color: 'white', border: 'none', padding: '8px', borderRadius: '4px', fontSize: '13px', cursor: 'pointer' }
        });
        closeButton.addEventListener('click', cleanUp);

        uiContainer.appendChild(title);
        uiContainer.appendChild(status);
        uiContainer.appendChild(buttonRow);
        uiContainer.appendChild(closeButton);
        document.body.appendChild(uiContainer);

        const style = createElement('style', {
            text: `
                .tcs-split-button { position: relative; display: flex; flex-grow: 1; }
                .tcs-main-btn { flex-grow: 1; background-color: #0078d4; color: white; border: none; padding: 10px; border-radius: 4px 0 0 4px; font-size: 14px; cursor: pointer; transition: background-color 0.2s; }
                .tcs-dropdown-btn { background-color: #0078d4; color: white; border: none; border-left: 1px solid rgba(255,255,255,0.3); padding: 10px 8px; border-radius: 0 4px 4px 0; cursor: pointer; transition: background-color 0.2s; }
                .tcs-main-btn:hover, .tcs-dropdown-btn:hover { background-color: #005a9e; }
                .tcs-main-btn:disabled, .tcs-dropdown-btn:disabled { background-color: #ccc !important; cursor: not-allowed; }
                .tcs-options { display: none; position: absolute; top: 100%; left: 0; width: 100%; background-color: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); z-index: 10; overflow: hidden; }
                .tcs-option { display: block; padding: 10px 15px; color: black; text-decoration: none; font-size: 13px; cursor: pointer; }
                .tcs-option:hover { background-color: #f0f0f0; }
                #tcs-close:hover { background-color: #c82333; }
            `
        });
        document.head.appendChild(style);

        // Close dropdowns when clicking elsewhere
        document.addEventListener('click', (e) => {
            document.querySelectorAll('.tcs-options').forEach(el => {
                if (!el.parentElement.contains(e.target)) {
                    el.style.display = 'none';
                }
            });
        });

        // Draggable logic
        let isDragging = false, offsetX, offsetY;
        uiContainer.addEventListener('mousedown', (e) => { if (e.target.closest('button')) return; isDragging = true; offsetX = e.clientX - uiContainer.getBoundingClientRect().left; offsetY = e.clientY - uiContainer.getBoundingClientRect().top; uiContainer.style.transition = 'none'; });
        document.addEventListener('mousemove', (e) => { if (!isDragging) return; uiContainer.style.left = `${e.clientX - offsetX}px`; uiContainer.style.top = `${e.clientY - offsetY}px`; });
        document.addEventListener('mouseup', () => { isDragging = false; uiContainer.style.transition = ''; });
    }

    function createSplitButton(baseLabel, formats, actionCallback) {
        function createElement(tag, options = {}) {
            const el = document.createElement(tag);
            if (options.id) el.id = options.id;
            if (options.className) el.className = options.className;
            if (options.text) el.textContent = options.text;
            if (options.css) Object.assign(el.style, options.css);
            return el;
        }

        const container = createElement('div', { className: 'tcs-split-button' });
        const mainBtn = createElement('button', { className: 'tcs-main-btn', text: `${baseLabel} ${formats[0].label}` });
        const dropdownBtn = createElement('button', { className: 'tcs-dropdown-btn', text: '▾' });
        const optionsDiv = createElement('div', { className: 'tcs-options' });

        mainBtn.addEventListener('click', () => actionCallback(formats[0].type));
        
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            optionsDiv.style.display = optionsDiv.style.display === 'block' ? 'none' : 'block';
        });

        formats.forEach(format => {
            const option = createElement('a', { className: 'tcs-option', text: `${baseLabel} ${format.label}` });
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                mainBtn.textContent = `${baseLabel} ${format.label}`;
                actionCallback(format.type);
                optionsDiv.style.display = 'none';
            });
            optionsDiv.appendChild(option);
        });

        container.appendChild(mainBtn);
        container.appendChild(dropdownBtn);
        container.appendChild(optionsDiv);
        return container;
    }

    function updateUIMessage() {
        const statusEl = document.getElementById('tcs-status');
        const buttons = document.querySelectorAll('.tcs-main-btn, .tcs-dropdown-btn');
        if (!statusEl) return;

        if (capturing) {
            statusEl.textContent = `✅ Capturing...\n(${transcriptArray.length} lines recorded)`;
            statusEl.style.color = '#28a745';
        } else if (document.querySelector(SELECTORS.LEAVE_BUTTONS)) {
            statusEl.textContent = `⚠️ In meeting, but captions are off.\n(Turn them on to start capture)`;
            statusEl.style.color = '#ffc107';
        } else {
            statusEl.textContent = `Not in a meeting.\n${transcriptArray.length > 0 ? `(${transcriptArray.length} lines available)` : ''}`;
            statusEl.style.color = '#6c757d';
        }
        
        const hasData = transcriptArray.length > 0;
        buttons.forEach(btn => btn.disabled = !hasData);
    }
    
    // --- FORMATTING & ACTIONS ---
    function formatTranscript(format) {
        const cleanTranscript = transcriptArray.map(({ key, ...rest }) => rest);
        let content;
        switch(format) {
            case 'txt':
                content = cleanTranscript.map(e => `[${e.Time}] ${e.Name}: ${e.Text}`).join('\n');
                break;
            case 'md':
                let lastSpeaker = null;
                content = cleanTranscript.map(e => {
                    if (e.Name !== lastSpeaker) {
                        lastSpeaker = e.Name;
                        return `\n**${e.Name}** (${e.Time}):\n> ${e.Text}`;
                    }
                    return `> ${e.Text}`;
                }).join('\n').trim();
                break;
            case 'json':
                content = JSON.stringify(cleanTranscript, null, 2);
                break;
            case 'yaml':
                content = cleanTranscript.map(e => `-\n  Name: ${e.Name}\n  Text: ${e.Text}\n  Time: ${e.Time}`).join('\n');
                break;
        }
        return content;
    }

    async function copyTranscript(format) {
        if (transcriptArray.length === 0) {
            alert("No captions were captured to copy.");
            return;
        }
        const content = formatTranscript(format);
        try {
            await navigator.clipboard.writeText(content);
            const statusEl = document.getElementById('tcs-status');
            const originalText = statusEl.textContent;
            statusEl.textContent = 'Copied to clipboard!';
            statusEl.style.color = '#28a745';
            setTimeout(() => {
                statusEl.textContent = originalText;
                updateUIMessage(); // Restore original color and state
            }, 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
            alert('Failed to copy text to clipboard.');
        }
    }

    function downloadTranscript(format) {
        if (transcriptArray.length === 0) {
            alert("No captions were captured to download.");
            return;
        }

        const content = formatTranscript(format);
        const meetingName = (meetingTitleOnStart.split('|')[0] || "Meeting").trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
        const date = recordingStartTime || new Date();
        const datePrefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        
        let mimeType, extension;
        switch(format) {
            case 'txt': mimeType = 'text/plain'; extension = 'txt'; break;
            case 'md': mimeType = 'text/markdown'; extension = 'md'; break;
            case 'json': mimeType = 'application/json'; extension = 'json'; break;
            case 'yaml': mimeType = 'application/x-yaml'; extension = 'yaml'; break;
        }

        const filename = `${datePrefix} - ${meetingName}.${extension}`;
        const dataStr = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
        const downloadNode = document.createElement('a');
        downloadNode.setAttribute("href", dataStr);
        downloadNode.setAttribute("download", filename);
        document.body.appendChild(downloadNode);
        downloadNode.click();
        downloadNode.remove();
    }

    // --- MAIN LOOP & CLEANUP ---
    function main() {
        const inMeeting = !!document.querySelector(SELECTORS.LEAVE_BUTTONS);
        const captionsOn = !!document.querySelector(SELECTORS.CAPTIONS_RENDERER);

        if (inMeeting) {
            if (captionsOn) {
                startCaptureSession();
            } else {
                stopCaptureSession();
                if (AUTO_ENABLE_CAPTIONS_EXPERIMENTAL && !hasAttemptedAutoEnable) {
                    attemptAutoEnableCaptions();
                }
            }
        } else {
            stopCaptureSession();
            hasAttemptedAutoEnable = false;
        }
        ensureObserverIsActive();
    }

    function cleanUp() {
        stopCaptureSession();
        if (mainLoopInterval) clearInterval(mainLoopInterval);
        const ui = document.getElementById('teams-caption-saver-ui');
        if (ui) ui.remove();
        const style = document.head.querySelector('style');
        if (style && style.textContent.includes('.tcs-split-button')) style.remove();
        console.log("Teams Caption Saver has been shut down and cleaned up.");
    }

    // --- SCRIPT INITIALIZATION ---
    injectUI();
    mainLoopInterval = setInterval(main, 3000);
    main();
    console.log("Teams Caption Saver (Console Edition) is running. A control panel should be visible on your screen.");

})();