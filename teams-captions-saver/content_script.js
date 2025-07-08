// --- Constants ---
const SELECTORS = {
    CAPTIONS_RENDERER: "[data-tid='closed-caption-v2-window-wrapper'], [data-tid='closed-captions-renderer'], [data-tid*='closed-caption']",
    CHAT_MESSAGE: '.fui-ChatMessageCompact',
    AUTHOR: '[data-tid="author"]',
    CAPTION_TEXT: '[data-tid="closed-caption-text"]',
    LEAVE_BUTTONS: [
        "button[data-tid='hangup-main-btn']",
        "button[data-tid='hangup-leave-button']",
        "button[data-tid='hangup-end-meeting-button']",
        "div#hangup-button button",
        "#hangup-button"
    ].join(','),
    MORE_BUTTON: "button[data-tid='more-button'], button[id='callingButtons-showMoreBtn']",
    MORE_BUTTON_EXPANDED: "button[data-tid='more-button'][aria-expanded='true'], button[id='callingButtons-showMoreBtn'][aria-expanded='true']",
    LANGUAGE_SPEECH_BUTTON: "div[id='LanguageSpeechMenuControl-id']",
    TURN_ON_CAPTIONS_BUTTON: "div[id='closed-captions-button']",
};

// --- State ---
const transcriptArray = [];
let capturing = false;
let meetingTitleOnStart = '';
let recordingStartTime = null;
let observer = null;
let observedElement = null;
let hasInitializedListeners = false;
let wasInMeeting = false;

// --- Utility Functions ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getCleanTranscript = () => transcriptArray.map(({ key, ...rest }) => rest);

const isUserInMeeting = () => document.querySelector(SELECTORS.LEAVE_BUTTONS) !== null;

// --- Core Logic ---
function processCaptionUpdates() {
    const closedCaptionsContainer = document.querySelector(SELECTORS.CAPTIONS_RENDERER);
    if (!closedCaptionsContainer) return;

    const transcriptElements = closedCaptionsContainer.querySelectorAll(SELECTORS.CHAT_MESSAGE);

    transcriptElements.forEach(element => {
        const authorElement = element.querySelector(SELECTORS.AUTHOR);
        const textElement = element.querySelector(SELECTORS.CAPTION_TEXT);

        if (!authorElement || !textElement) return;

        const name = authorElement.innerText.trim();
        const text = textElement.innerText.trim();
        if (text.length === 0) return;

        let captionId = element.getAttribute('data-caption-id');
        if (!captionId) {
            captionId = `caption_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            element.setAttribute('data-caption-id', captionId);
        }

        const existingIndex = transcriptArray.findIndex(entry => entry.key === captionId);
        const time = new Date().toLocaleTimeString();

        if (existingIndex !== -1) {
            // Update existing entry if text has changed
            if (transcriptArray[existingIndex].Text !== text) {
                transcriptArray[existingIndex].Text = text;
                transcriptArray[existingIndex].Time = time;
            }
        } else {
            // Add new entry
            transcriptArray.push({ Name: name, Text: text, Time: time, key: captionId });
        }
    });
}

function ensureObserverIsActive() {
    if (!capturing) return;

    const captionContainer = document.querySelector(SELECTORS.CAPTIONS_RENDERER);
    
    // If the container doesn't exist or has changed, re-initialize the observer
    if (!captionContainer || captionContainer !== observedElement) {
        if (observer) {
            observer.disconnect();
        }

        if (captionContainer) {
            observer = new MutationObserver(processCaptionUpdates);
            observer.observe(captionContainer, {
                childList: true,
                subtree: true,
                characterData: true,
            });
            observedElement = captionContainer;
            processCaptionUpdates(); // Initial scan
        } else {
            observedElement = null;
        }
    }
}

function startCaptureSession() {
    if (capturing) return;

    console.log("New caption session detected. Starting capture.");
    transcriptArray.length = 0;
    chrome.storage.session.remove('speakerAliases');

    capturing = true;
    meetingTitleOnStart = document.title;
    recordingStartTime = new Date();
    
    console.log(`Capture started. Title: "${meetingTitleOnStart}", Time: ${recordingStartTime.toLocaleString()}`);
    chrome.runtime.sendMessage({ message: "update_badge_status", capturing: true });
    
    ensureObserverIsActive();
}

function stopCaptureSession() {
    if (!capturing) return;

    console.log("Captions turned off or meeting ended. Capture stopped. Data preserved.");
    capturing = false;
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    observedElement = null;
    chrome.runtime.sendMessage({ message: "update_badge_status", capturing: false });
}

// --- Automated Features ---
async function attemptAutoEnableCaptions() {
    try {
        const moreButton = document.querySelector(SELECTORS.MORE_BUTTON);
        if (!moreButton) {
            console.error("Auto-enable FAILED: Could not find 'More' button.");
            return;
        }
        moreButton.click();
        await delay(400);

        const langAndSpeechButton = document.querySelector(SELECTORS.LANGUAGE_SPEECH_BUTTON);
        if (!langAndSpeechButton) {
            console.error("Auto-enable FAILED: Could not find 'Language and speech' menu item.");
            return;
        }
        langAndSpeechButton.click();
        await delay(400);

        const turnOnCaptionsButton = document.querySelector(SELECTORS.TURN_ON_CAPTIONS_BUTTON);
        if (turnOnCaptionsButton) {
            turnOnCaptionsButton.click();
        } else {
            console.error("Auto-enable FAILED: Could not find 'Turn on live captions' button.");
        }

        // Attempt to close the 'More' menu
        const expandedMoreButton = document.querySelector(SELECTORS.MORE_BUTTON_EXPANDED);
        if (expandedMoreButton) {
            expandedMoreButton.click();
        }
    } catch (e) {
        console.error("Error during auto-enable captions attempt:", e);
    }
}

// --- Main Loop & Initialization ---
async function main() {
    if (!hasInitializedListeners) {
        setInterval(ensureObserverIsActive, 10000); // Periodically check observer status
        hasInitializedListeners = true;
    }
    const nowInMeeting = isUserInMeeting();
    if (wasInMeeting && !nowInMeeting) {
        console.log("Meeting transition detected: In -> Out. Checking for auto-save.");
        const { autoSaveOnEnd } = await chrome.storage.sync.get('autoSaveOnEnd');
        if (autoSaveOnEnd && transcriptArray.length > 0) {
            console.log("Auto-save is ON and transcript has data. Triggering save.");
            chrome.runtime.sendMessage({
                message: "save_on_leave",
                transcriptArray: getCleanTranscript(),
                meetingTitle: meetingTitleOnStart,
                recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString()
            });
        }
    }
    wasInMeeting = nowInMeeting;
    if (!nowInMeeting) {
        stopCaptureSession();
        setTimeout(main, 2000); // Check again in 2 seconds
        return;
    }

    const captionsContainer = document.querySelector(SELECTORS.CAPTIONS_RENDERER);
    if (captionsContainer) {
        startCaptureSession();
    } else {
        stopCaptureSession();
        const { autoEnableCaptions } = await chrome.storage.sync.get('autoEnableCaptions');
        if (autoEnableCaptions) {
            await attemptAutoEnableCaptions();
        }
    }

    setTimeout(main, 5000); // Main loop polling interval
}

main();

// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.message) {
        case 'get_status':
            sendResponse({
                capturing: capturing,
                captionCount: transcriptArray.length,
                isInMeeting: isUserInMeeting()
            });
            break;

        case 'return_transcript':
            if (transcriptArray.length > 0) {
                chrome.runtime.sendMessage({
                    message: "download_captions",
                    transcriptArray: getCleanTranscript(),
                    meetingTitle: meetingTitleOnStart,
                    format: request.format,
                    recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString()
                });
            } else {
                alert("No captions were captured. Please ensure captions are turned on in the meeting.");
            }
            break;

        case 'get_transcript_for_copying':
            sendResponse({ transcriptArray: getCleanTranscript() });
            break;

        case 'get_captions_for_viewing':
            if (transcriptArray.length > 0) {
                chrome.runtime.sendMessage({
                    message: "display_captions",
                    transcriptArray: getCleanTranscript()
                });
            } else {
                alert("No captions were captured. Please ensure captions are turned on in the meeting.");
            }
            break;

        case 'get_unique_speakers':
            const speakers = [...new Set(transcriptArray.map(item => item.Name))];
            sendResponse({ speakers });
            break;
        
        default:
            console.log("Unhandled message received in content script:", request.message);
            break;
    }

    return true; // Indicates an asynchronous response may be sent.
});

console.log("Teams Captions Saver content script is running.");