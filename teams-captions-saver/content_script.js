const transcriptArray = [];
let capturing = false;
let observer = null;
let observedElement = null;

function checkCaptions() {
    console.log("Checking for captions...");
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

function startTranscription() {
    const captionsContainer = document.querySelector("[data-tid='closed-captions-renderer']");
    if (!captionsContainer) {
        console.log("Waiting for Live Captions to be turned on...");
        setTimeout(startTranscription, 2000); 
        return;
    }

    console.log("Live Captions are ON. Starting capture process.");
    capturing = true;
    ensureObserverIsActive();
    setInterval(ensureObserverIsActive, 10000);
}

function setupLeaveButtonListener() {
    // A prioritized list of selectors for the "Leave" button.
    // The script will try them in order to find a match.
    const LEAVE_BUTTON_SELECTORS = [
        "button[data-tid='call-leave-button']",
        "div#hangup-button button",
        "button[data-tid='hangup-main-btn']",
        "#hangup-button"
    ];

    let listenerAttached = false;

    const intervalId = setInterval(() => {
        // If chrome.runtime.id doesn't exist, the extension has been reloaded or uninstalled.
        // This is the "zombie" check.
        if (!chrome.runtime || !chrome.runtime.id) {
            console.log("Extension context invalidated. Stopping leave button listener.");
            clearInterval(intervalId);
            return;
        }
        
        chrome.storage.sync.get(['autoSaveOnLeave'], function(result) {
            if (!result.autoSaveOnLeave) {
                if (listenerAttached) listenerAttached = false;
                return;
            }

            if (listenerAttached) {
                return;
            }

            let leaveButton = null;
            for (const selector of LEAVE_BUTTON_SELECTORS) {
                leaveButton = document.querySelector(selector);
                if (leaveButton) {
                    console.log(`Found Leave button with selector: "${selector}"`);
                    break;
                }
            }
            
            if (leaveButton) {
                console.log("Attaching resilient auto-save listener to Leave button.");
                leaveButton.addEventListener('click', () => {
                    if (capturing && transcriptArray.length > 0) {
                        const cleanTranscript = transcriptArray.map(({ key, ...rest }) => rest);
                        chrome.runtime.sendMessage({
                            message: "save_on_leave",
                            transcriptArray: cleanTranscript,
                            meetingTitle: document.title.replace("__Microsoft_Teams", '').replace(/[^a-z0-9 ]/gi, '')
                        });
                    }
                }, { once: true });
                
                listenerAttached = true;
            }
        });
    }, 3000);
}

startTranscription();

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
                meetingTitle: document.title.replace("__Microsoft_Teams", '').replace(/[^a-z0-9 ]/gi, '')
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
                meetingTitle: document.title.replace("__Microsoft_Teams", '').replace(/[^a-z0-9 ]/gi, '')
            });
            break;

        default:
            console.log("Unhandled message type:", request.message);
            break;
    }

    return true; 
});

setupLeaveButtonListener();

console.log("content_script.js is running");