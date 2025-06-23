const transcriptArray = [];
let capturing = false;
let observer = null;
let observedElement = null;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function isUserInMeeting() {
    const LEAVE_BUTTON_SELECTORS = [
        "button[data-tid='hangup-main-btn']",
        "button[data-tid='hangup-leave-button']",
        "button[data-tid='hangup-end-meeting-button']",
        "div#hangup-button button",
        "#hangup-button"
    ];
    // If any of these buttons exist on the page, we're in a meeting.
    return document.querySelector(LEAVE_BUTTON_SELECTORS.join(',')) !== null;
}

function checkCaptions() {
    // Teams v2 - Updated for new HTML structure
    const closedCaptionsContainer = document.querySelector("[data-tid='closed-captions-renderer']");
    if (!closedCaptionsContainer) {
        // "Please, click 'More' > 'Language and speech' > 'Turn on life captions'"
        return;
    }
    
    // New selector for caption items
    const transcripts = closedCaptionsContainer.querySelectorAll('.fui-ChatMessageCompact');

    transcripts.forEach(transcript => {
        // Get author name
        const authorElement = transcript.querySelector('[data-tid="author"]');
        if (!authorElement) return; // Skip if no author found
        
        const Name = authorElement.innerText.trim();
        
        // Get caption text
        const textElement = transcript.querySelector('[data-tid="closed-caption-text"]');
        if (!textElement) return; // Skip if no text found
        
        const Text = textElement.innerText.trim();
        
        if (Text.length === 0) return;
        
        let captionId = transcript.getAttribute('data-caption-id');
        if (!captionId) {
            captionId = `caption_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            transcript.setAttribute('data-caption-id', captionId);
        }

        const existingIndex = transcriptArray.findIndex(entry => entry.key === captionId);
        const Time = new Date().toLocaleTimeString();

        if (existingIndex !== -1) {
            if (transcriptArray[existingIndex].Text !== Text) {
                transcriptArray[existingIndex].Text = Text;
                transcriptArray[existingIndex].Time = Time;
            }
        } else {
            transcriptArray.push({ Name, Text, Time, key: captionId });
        }
    });
}

function ensureObserverIsActive() {
    if (!capturing) return;
    const currentContainer = document.querySelector("[data-tid='closed-captions-renderer']");
    if (!currentContainer || currentContainer !== observedElement) {
        if (observer) observer.disconnect();
        if (currentContainer) {
            observer = new MutationObserver(checkCaptions);
            observer.observe(currentContainer, { 
                childList: true, 
                subtree: true, 
                characterData: true // Also watch for text changes
            });
            observedElement = currentContainer;
            // Do an initial check
            checkCaptions();
        } else {
            observedElement = null;
        }
    }
}

function setupLeaveButtonListener() {
    // A prioritized list of selectors for the "Leave" button.
    // The script will try them in order to find a match.
    const LEAVE_BUTTON_SELECTORS = [
        "button[data-tid='hangup-main-btn']",
        "button[data-tid='hangup-leave-button']",
        "button[data-tid='hangup-end-meeting-button']",
        "div#hangup-button button",
        "#hangup-button"
    ];

    const handleLeaveClick = () => {
        if (capturing && transcriptArray.length > 0) {
            console.log("Leave button clicked, triggering auto-save.");
            const cleanTranscript = transcriptArray.map(({ key, ...rest }) => rest);
            chrome.runtime.sendMessage({
                message: "save_on_leave",
                transcriptArray: cleanTranscript,
                meetingTitle: document.title
            });
        }
    };

    const intervalId = setInterval(() => {
        // If chrome.runtime.id doesn't exist, the extension has been reloaded or uninstalled.
        // This is the "zombie" check.
        if (!chrome.runtime || !chrome.runtime.id) {
            console.log("Extension context invalidated. Stopping leave button listener.");
            clearInterval(intervalId);
            return;
        }
        
        chrome.storage.sync.get(['autoSaveStandard', 'autoSaveAi'], function(result) {
            if (!result.autoSaveStandard && !result.autoSaveAi) {
                return;
            }

            const buttons = document.querySelectorAll(LEAVE_BUTTON_SELECTORS.join(', '));
            buttons.forEach(button => {
                if (button.dataset.listenerAttached) return;
                console.log('Found new leave button, attaching listener:', button);
                button.addEventListener('click', handleLeaveClick, { once: true });
                button.dataset.listenerAttached = 'true';
            });
        });
    }, 3000);
}


async function main() {
    if (!isUserInMeeting()) {
        setTimeout(main, 2000); 
        return;
    }
    
    const captionsOn = document.querySelector("[data-tid='closed-captions-renderer']");
    if (captionsOn) {
        console.log("Live Captions are ON. Initializing capture process.");
        capturing = true;
        
        ensureObserverIsActive();
        setInterval(ensureObserverIsActive, 10000);
        setupLeaveButtonListener();
        return; 
    }

    const settings = await chrome.storage.sync.get(['autoEnableCaptions']);
    if (settings.autoEnableCaptions) {
        console.log("Auto-enable setting is on. Attempting to turn on captions...");
        try {
            const moreButton = document.querySelector("button[data-tid='more-button'], button[id='callingButtons-showMoreBtn']");
            
            if (moreButton) {
                moreButton.click();
                await delay(400);

                const langAndSpeechButton = document.querySelector("div[id='LanguageSpeechMenuControl-id']");
                if (langAndSpeechButton) {
                    langAndSpeechButton.click();
                    await delay(400);

                    const turnOnCaptionsButton = document.querySelector("div[id='closed-captions-button']");
                    if (turnOnCaptionsButton) {
                        turnOnCaptionsButton.click();
                    } else {
                        console.error("Auto-enable FAILED: Could not find 'Turn on live captions' button after clicking 'Language and speech'.");
                    }
                } else {
                     console.error("Auto-enable FAILED: Could not find 'Language and speech' button after clicking 'More'.");
                }
                
                // Try to close the menu again
                const moreButtonAfter = document.querySelector("button[data-tid='more-button'][aria-expanded='true'], button[id='callingButtons-showMoreBtn'][aria-expanded='true']");
                if (moreButtonAfter) moreButtonAfter.click();
            } else {
                console.error("Auto-enable FAILED: Could not find any 'More' button.");
            }
        } catch (e) {
            console.error("Error during auto-enable attempt:", e);
        }
    }

    setTimeout(main, 5000);
}

main();

// Listen for messages from the popup.js or service_worker.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Content script received message:", request);
    
    switch (request.message) {
        case 'get_status':
            sendResponse({ capturing, captionCount: transcriptArray.length });
            break;

        case 'return_transcript':
            console.log("return_transcript request received:", transcriptArray);
            if (!capturing || transcriptArray.length === 0) {
                alert("Oops! No captions were captured. Please make sure captions are turned on.");
                break;
            }

            // Prepare data for the background script to handle the download.
            chrome.runtime.sendMessage({
                message: "download_captions",
                transcriptArray: transcriptArray.map(({ key, ...rest }) => rest), // Remove ID property
                meetingTitle: document.title
            });
            break;

        case 'get_captions_for_viewing':
            console.log("get_captions_for_viewing request received:", transcriptArray);
            if (!capturing || transcriptArray.length === 0) {
                alert("Oops! No captions were captured. Please make sure captions are turned on.");
                break;
            }

            // Send the transcript to the background script to display in a new tab.
            chrome.runtime.sendMessage({
                message: "display_captions",
                transcriptArray: transcriptArray.map(({ key, ...rest }) => rest) // Remove ID property
            });
            break;

        case 'return_transcript_for_ai':
            console.log("return_transcript_for_ai request received:", transcriptArray);
            if (!capturing || transcriptArray.length === 0) {
                alert("Oops! No captions were captured. Please make sure captions are turned on.");
                break;
            }

            // Prepare data for the background script to handle the download.
            chrome.runtime.sendMessage({
                message: "download_ai_captions",
                transcriptArray: transcriptArray.map(({ key, ...rest }) => rest), // Remove ID property
                meetingTitle: document.title
            });
            break;

        default:
            console.log("Unhandled message type:", request.message);
            break;
    }

    return true; 
});

console.log("content_script.js is running");