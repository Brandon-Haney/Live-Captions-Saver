// --- Platform Detection and Configuration ---
let platformConfig = null;
let SELECTORS = {};

// Initialize platform configuration
function initializePlatform() {
    platformConfig = getCurrentPlatformConfig();
    if (!platformConfig) {
        console.error('[Caption Saver] Unsupported platform');
        return false;
    }
    
    SELECTORS = platformConfig.selectors;
    console.log(`[Caption Saver] Initialized for ${platformConfig.name}`);
    return true;
}

// --- Constants ---
const TIMING = {
    BUTTON_CLICK_DELAY: 400,
    RETRY_DELAY: 2000,
    MAIN_LOOP_INTERVAL: 5000,
    OBSERVER_CHECK_INTERVAL: 10000,
    TOOLTIP_DISPLAY_DURATION: 1500,
    ATTENDEE_UPDATE_INTERVAL: 60000,
    INITIAL_ATTENDEE_DELAY: 1500,
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
let meetingObserver = null;
let captionsObserver = null;
let cachedElements = new Map();
let autoEnableInProgress = false;
let autoEnableLastAttempt = 0;
let autoEnableDebounceTimer = null;
let autoSaveTriggered = false;
let lastMeetingId = null;
let captionRetryInProgress = false;
// Store current user's name for Google Meet
window.currentUserName = null;

// --- Attendee Tracking State ---
let attendeeUpdateInterval = null;
let backupInterval = null;
let attendeeData = {
    allAttendees: new Set(), // All unique attendees who joined
    currentAttendees: new Map(), // Currently in meeting (name -> role)
    attendeeHistory: [], // Detailed tracking with timestamps
    lastUpdated: null,
    meetingStartTime: null,
};

// --- Real-time Broadcasting ---
function broadcastCaptionUpdate(data) {
    try {
        // Send message and handle response
        chrome.runtime.sendMessage({
            message: "live_caption_update",
            ...data
        });
    } catch (error) {
        // Silent fail - viewer might not be open
    }
}

async function broadcastAttendeeUpdate(data) {
    try {
        // Send message to all extension pages (viewer, popup, etc.)
        await chrome.runtime.sendMessage({
            message: "live_attendee_update",
            ...data
        });
    } catch (error) {
        // This is normal if viewer is not open - silent fail
    }
}

// --- Error Handling & Logging ---
class ErrorHandler {
    static log(error, context = '', silent = false) {
        const timestamp = new Date().toISOString();
        const errorInfo = {
            timestamp,
            context,
            message: error.message || String(error),
            stack: error.stack,
            url: window.location.href
        };
        
        console.error(`[Teams Caption Saver] ${context}:`, errorInfo);
        
        if (!silent) {
            // Could send to analytics or show user notification
            chrome.runtime.sendMessage({
                message: "error_logged",
                error: errorInfo
            }).catch(() => {}); // Prevent recursive errors
        }
        
        return errorInfo;
    }
    
    static wrap(fn, context = '', fallback = null) {
        return async function(...args) {
            try {
                return await fn.apply(this, args);
            } catch (error) {
                ErrorHandler.log(error, context);
                return fallback;
            }
        };
    }
}

// --- Retry Mechanism ---
class RetryHandler {
    static async withRetry(fn, context = '', maxAttempts = 3, baseDelay = 1000) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                
                if (attempt === maxAttempts) {
                    ErrorHandler.log(error, `${context} - Final attempt failed`, false);
                    throw error;
                }
                
                const delayTime = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
                console.log(`[Teams Caption Saver] ${context} - Attempt ${attempt} failed, retrying in ${delayTime}ms:`, error.message || error);
                await delay(delayTime);
            }
        }
        
        throw lastError;
    }
}

// --- Utility Functions ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getCleanTranscript = () => transcriptArray.map(({ key, ...rest }) => rest);

// --- DOM Element Caching ---
function getCachedElement(selector, expiry = 5000) {
    const now = Date.now();
    const cached = cachedElements.get(selector);
    
    if (cached && (now - cached.timestamp) < expiry && document.contains(cached.element)) {
        return cached.element;
    }
    
    const element = document.querySelector(selector);
    if (element) {
        cachedElements.set(selector, { element, timestamp: now });
    }
    return element;
}

function clearElementCache() {
    cachedElements.clear();
}

const isUserInMeeting = () => {
    if (!platformConfig) return false;
    return platformConfig.isMeetingActive();
};

// --- Core Logic ---
const processCaptionUpdates = ErrorHandler.wrap(function() {
    if (!platformConfig) return;
    
    const closedCaptionsContainer = getCachedElement(SELECTORS.captionsContainer);
    if (!closedCaptionsContainer) return;

    const transcriptElements = closedCaptionsContainer.querySelectorAll(SELECTORS.captionBlock);

    transcriptElements.forEach(element => {
        try {
            const captionData = platformConfig.getCaptionData(element);
            if (!captionData) return;

            const { Name: name, Text: text, Time: time } = captionData;
            if (text.length === 0) return;

            let captionId = element.getAttribute('data-caption-id');
            if (!captionId) {
                captionId = `caption_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                element.setAttribute('data-caption-id', captionId);
            }

            const existingIndex = transcriptArray.findIndex(entry => entry.key === captionId);

            if (existingIndex !== -1) {
                const existingEntry = transcriptArray[existingIndex];
                
                // For Google Meet: Just update the existing caption with the new text
                // Google Meet continuously updates the same caption element
                if (platformConfig.name === 'Google Meet') {
                    const speakerChanged = existingEntry.Name !== name;
                    
                    if (speakerChanged) {
                        // New speaker - create a new caption entry
                        const newCaptionId = `${captionId}_${Date.now()}`;
                        const newCaption = { 
                            Name: name, 
                            Text: text, 
                            Time: time, 
                            key: newCaptionId 
                        };
                        transcriptArray.push(newCaption);
                        
                        // Broadcast new caption to viewer
                        broadcastCaptionUpdate({
                            type: 'new',
                            caption: newCaption
                        });
                        
                        // Update the element ID for next comparison
                        element.setAttribute('data-caption-id', newCaptionId);
                    } else {
                        // Same speaker - just update the existing caption in place
                        if (existingEntry.Text !== text) {
                            existingEntry.Text = text;
                            existingEntry.Time = time;
                            
                            // Broadcast update to viewer
                            broadcastCaptionUpdate({
                                type: 'update',
                                caption: existingEntry
                            });
                        }
                    }
                } else {
                    // For other platforms, use original logic
                    if (existingEntry.Text !== text) {
                        existingEntry.Text = text;
                        existingEntry.Time = time;
                        // Broadcast update to viewer
                        broadcastCaptionUpdate({
                            type: 'update',
                            caption: existingEntry
                        });
                    }
                }
            } else {
                // Add new entry
                const newCaption = { Name: name, Text: text, Time: time, key: captionId };
                transcriptArray.push(newCaption);
                // Broadcast new caption to viewer
                broadcastCaptionUpdate({
                    type: 'new',
                    caption: newCaption
                });
            }
        } catch (error) {
            ErrorHandler.log(error, 'Processing individual caption element', true);
        }
    });
}, 'Caption updates processing');

// --- Attendee Tracking Functions ---
function updateAttendeesFromTranscript() {
    // Fallback method: Extract unique speakers from transcript
    const speakers = [...new Set(transcriptArray.map(item => item.Name))];
    const currentTime = new Date().toLocaleTimeString();
    
    speakers.forEach(name => {
        if (!attendeeData.allAttendees.has(name)) {
            attendeeData.allAttendees.add(name);
            attendeeData.currentAttendees.set(name, 'Speaker');
            
            attendeeData.attendeeHistory.push({
                name,
                role: 'Speaker',
                action: 'detected from transcript',
                time: currentTime
            });
            
            console.log(`Speaker detected from transcript: ${name}`);
        }
    });
    
    attendeeData.lastUpdated = currentTime;
    console.log(`Attendee update from transcript. Speakers found: ${speakers.length}`);
}
function updateAttendeeList() {
    try {
        // Platform-specific attendee list selector
        const attendeeListSelector = SELECTORS.attendeeList || SELECTORS.ATTENDEE_TREE;
        const attendeeTree = document.querySelector(attendeeListSelector);
        if (!attendeeTree) {
            console.log("Attendee tree not found, roster might not be open");
            // Fallback: Add speakers from transcript as attendees
            updateAttendeesFromTranscript();
            return;
        }
        
        // Platform-specific attendee item selector
        const attendeeItemSelector = SELECTORS.attendeeItem || SELECTORS.ATTENDEE_ITEM;
        const attendeeItems = document.querySelectorAll(attendeeItemSelector);
        const currentTime = new Date().toLocaleTimeString();
        
        // Clear current attendees for fresh update
        const previousAttendees = new Set(attendeeData.currentAttendees.keys());
        attendeeData.currentAttendees.clear();
        
        // Process each attendee
        attendeeItems.forEach(item => {
            // Use platform-specific attendee data extraction if available
            let attendeeInfo = null;
            
            if (platformConfig && platformConfig.getAttendeeData) {
                attendeeInfo = platformConfig.getAttendeeData(item);
            }
            
            if (!attendeeInfo) {
                // Fallback to generic extraction
                const nameElement = item.querySelector(SELECTORS.attendeeName || SELECTORS.ATTENDEE_NAME || '.participant-name, .attendee-name');
                const roleElement = item.querySelector(SELECTORS.attendeeRole || SELECTORS.ATTENDEE_ROLE || '.participant-role, .attendee-role');
                
                if (nameElement) {
                    attendeeInfo = {
                        name: nameElement.textContent.trim(),
                        role: roleElement ? roleElement.textContent.trim() : 'Attendee'
                    };
                }
            }
            
            if (attendeeInfo && attendeeInfo.name) {
                const { name, role, isCurrentUser } = attendeeInfo;
                
                // Skip "(You)" suffix for Google Meet
                const cleanName = name.replace(/\s*\(You\)\s*$/, '');
                
                // If this is the current user on Google Meet, store their name
                if (isCurrentUser && platformConfig && platformConfig.name === 'Google Meet') {
                    window.currentUserName = cleanName;
                    console.log(`[Caption Saver] Detected current user name: ${cleanName}`);
                }
                
                // Add to current attendees
                attendeeData.currentAttendees.set(cleanName, role);
                
                // Track in all attendees
                if (!attendeeData.allAttendees.has(cleanName)) {
                    attendeeData.allAttendees.add(cleanName);
                    
                    // Add to history as new join
                    attendeeData.attendeeHistory.push({
                        name: cleanName,
                        role,
                        action: 'joined',
                        time: currentTime
                    });
                    
                    console.log(`New attendee detected: ${cleanName} (${role})`);
                }
            }
        });
        
        // Check for attendees who left
        previousAttendees.forEach(name => {
            if (!attendeeData.currentAttendees.has(name)) {
                attendeeData.attendeeHistory.push({
                    name,
                    action: 'left',
                    time: currentTime
                });
                console.log(`Attendee left: ${name}`);
            }
        });
        
        attendeeData.lastUpdated = currentTime;
        
        // Get count from header
        const countElement = document.querySelector(SELECTORS.ATTENDEE_COUNT);
        if (countElement) {
            const countMatch = countElement.textContent.match(/\((\d+)\)/);
            if (countMatch) {
                console.log(`Total attendees in meeting: ${countMatch[1]}`);
            }
        }
        
        console.log(`Attendee update complete. Current: ${attendeeData.currentAttendees.size}, Total: ${attendeeData.allAttendees.size}`);
        
    } catch (error) {
        ErrorHandler.log(error, 'Updating attendee list', true);
    }
}

async function tryOpenParticipantPanel() {
    try {
        // Check if platform has its own openAttendeePanel method (Google Meet)
        if (platformConfig && platformConfig.openAttendeePanel) {
            const opened = await platformConfig.openAttendeePanel();
            if (opened) {
                console.log("Attendee panel opened via platform method");
                await delay(500); // Wait for panel to fully open
                return true;
            }
        }
        
        // For Google Meet, check if side panel is already open
        if (platformConfig && platformConfig.isPanelOpen && platformConfig.isPanelOpen()) {
            console.log("Participant panel is already open");
            return true;
        }
        
        // Fallback to generic method
        const peopleBtnSelector = SELECTORS.peopleButton || SELECTORS.PEOPLE_BUTTON;
        const peopleButton = document.querySelector(peopleBtnSelector);
        
        // Check button state - different platforms use different attributes
        const isPressed = peopleButton?.getAttribute('aria-pressed') === 'true' || 
                         peopleButton?.getAttribute('aria-expanded') === 'true';
        
        if (peopleButton && !isPressed) {
            console.log("Attempting to open participant panel for attendee tracking...");
            peopleButton.click();
            await delay(500); // Wait for panel to open
            return true;
        }
        return false;
    } catch (error) {
        console.log("Could not open participant panel:", error);
        return false;
    }
}

async function startAttendeeTracking() {
    // Check if attendee tracking is enabled
    const { trackAttendees, autoOpenAttendees } = await chrome.storage.sync.get(['trackAttendees', 'autoOpenAttendees']);
    if (trackAttendees === false) {
        console.log("Attendee tracking is disabled in settings");
        return;
    }
    
    if (attendeeUpdateInterval) {
        clearInterval(attendeeUpdateInterval);
    }
    
    // Reset attendee data for new meeting
    attendeeData = {
        allAttendees: new Set(),
        currentAttendees: new Map(),
        attendeeHistory: [],
        lastUpdated: null,
        meetingStartTime: new Date().toISOString(),
    };
    
    console.log("Starting attendee tracking...");
    
    // Initial update after delay
    setTimeout(async () => {
        // Only auto-open participant panel if setting is enabled
        if (autoOpenAttendees) {
            await tryOpenParticipantPanel();
        }
        
        updateAttendeeList();
        
        // Then update every minute
        attendeeUpdateInterval = setInterval(updateAttendeeList, TIMING.ATTENDEE_UPDATE_INTERVAL);
    }, TIMING.INITIAL_ATTENDEE_DELAY);
}

function stopAttendeeTracking() {
    if (attendeeUpdateInterval) {
        clearInterval(attendeeUpdateInterval);
        attendeeUpdateInterval = null;
        console.log("Stopped attendee tracking");
    }
}

async function getAttendeeReport() {
    // Check if attendee tracking is enabled
    const { trackAttendees } = await chrome.storage.sync.get('trackAttendees');
    if (trackAttendees === false) {
        return null; // Return null if tracking is disabled
    }
    
    const report = {
        meetingStartTime: attendeeData.meetingStartTime,
        lastUpdated: attendeeData.lastUpdated,
        totalUniqueAttendees: attendeeData.allAttendees.size,
        currentAttendeeCount: attendeeData.currentAttendees.size,
        attendeeList: Array.from(attendeeData.allAttendees),
        currentAttendees: Array.from(attendeeData.currentAttendees.entries()).map(([name, role]) => ({
            name,
            role
        })),
        attendeeHistory: attendeeData.attendeeHistory
    };
    
    console.log("[Teams Caption Saver] Attendee report generated:", {
        totalAttendees: report.totalUniqueAttendees,
        attendees: report.attendeeList
    });
    
    return report;
}

// --- Event-Driven Meeting Detection ---
let meetingStateDebounceTimer = null;
let captionsStateDebounceTimer = null;
let leaveButtonListener = null;

function setupMeetingObserver() {
    if (meetingObserver) return;
    
    meetingObserver = new MutationObserver((mutations) => {
        // For Google Meet, check if meeting ended message appeared
        if (platformConfig && platformConfig.name === 'Google Meet') {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const h1 = node.querySelector?.('h1.roSPhc') || (node.tagName === 'H1' && node.classList?.contains('roSPhc') ? node : null);
                        if (h1 && (h1.textContent?.includes('Your host ended the meeting') || 
                                  h1.textContent?.includes('You left the meeting'))) {
                            console.log('[Caption Saver] Meeting end message detected:', h1.textContent);
                            wasInMeeting = true; // Ensure we were in a meeting
                            setTimeout(() => {
                                handleMeetingStateChange();
                            }, 100);
                            return;
                        }
                    }
                }
            }
        }
        
        // Debounce other meeting state changes
        if (meetingStateDebounceTimer) {
            clearTimeout(meetingStateDebounceTimer);
        }
        meetingStateDebounceTimer = setTimeout(() => {
            handleMeetingStateChange();
            
            // For Google Meet, also setup leave button listener
            if (platformConfig && platformConfig.name === 'Google Meet') {
                setupLeaveButtonListener();
            }
        }, 1000);
    });
    
    // Watch for different attributes based on platform
    const attributeFilter = platformConfig && platformConfig.name === 'Google Meet' 
        ? ['aria-label', 'data-panel-id', 'jsname']
        : ['data-tid'];
    
    meetingObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributeFilter: attributeFilter
    });
}

function setupLeaveButtonListener() {
    // Remove existing listener if any
    if (leaveButtonListener) {
        document.removeEventListener('click', leaveButtonListener);
    }
    
    // Add listener for leave button clicks
    leaveButtonListener = (event) => {
        const target = event.target;
        const leaveButton = target.closest('button[aria-label="Leave call"], button[aria-label*="End call"]');
        
        if (leaveButton) {
            console.log('[Caption Saver] Leave button clicked, triggering immediate meeting end detection');
            
            // Mark that we were in a meeting before leaving
            wasInMeeting = true;
            
            // Trigger meeting state change after a short delay for DOM to update
            setTimeout(() => {
                console.log('[Caption Saver] Checking meeting state after leave button click');
                handleMeetingStateChange();
            }, 500);
        }
    };
    
    document.addEventListener('click', leaveButtonListener, true);
}

function setupCaptionsObserver() {
    if (captionsObserver) return;
    
    captionsObserver = new MutationObserver(() => {
        // Debounce captions state changes to prevent excessive calls
        if (captionsStateDebounceTimer) {
            clearTimeout(captionsStateDebounceTimer);
        }
        captionsStateDebounceTimer = setTimeout(() => {
            handleCaptionsStateChange();
        }, 1500);
    });
    
    // Watch for different attributes based on platform
    const attributeFilter = platformConfig && platformConfig.name === 'Google Meet' 
        ? ['aria-label', 'class']
        : ['data-tid'];
    
    captionsObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributeFilter: attributeFilter
    });
}

const handleMeetingStateChange = ErrorHandler.wrap(async function() {
    const nowInMeeting = isUserInMeeting();
    
    console.log(`[Caption Saver] Meeting state check - Was: ${wasInMeeting}, Now: ${nowInMeeting}`);
    
    if (wasInMeeting && !nowInMeeting) {
        console.log("Meeting transition detected: In -> Out. Checking for auto-save.");
        
        // Send meeting ended signal to viewer
        try {
            chrome.runtime.sendMessage({
                message: "meeting_ended"
            }).catch(() => {
                // Viewer might not be open, ignore error
            });
        } catch (error) {
            // Silent fail if no listeners
        }
        
        // Generate a unique meeting session ID
        const currentMeetingId = `${meetingTitleOnStart}_${recordingStartTime?.toISOString() || Date.now()}`;
        
        // Prevent duplicate auto-saves for the same meeting session
        if (autoSaveTriggered && lastMeetingId === currentMeetingId) {
            console.log("Auto-save already triggered for this meeting session, skipping...");
            clearElementCache();
            wasInMeeting = nowInMeeting;
            return;
        }
        
        try {
            const { autoSaveOnEnd } = await chrome.storage.sync.get('autoSaveOnEnd');
            if (autoSaveOnEnd && transcriptArray.length > 0) {
                console.log("Auto-save is ON and transcript has data. Triggering save.");
                
                // Mark auto-save as triggered before sending message
                autoSaveTriggered = true;
                lastMeetingId = currentMeetingId;
                
                // Send save message without retry (let service worker handle retries if needed)
                const attendeeReport = await getAttendeeReport();
                await chrome.runtime.sendMessage({
                    message: "save_on_leave",
                    transcriptArray: getCleanTranscript(),
                    meetingTitle: meetingTitleOnStart,
                    recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                    attendeeReport: attendeeReport
                });
                
                console.log("Auto-save message sent successfully.");
            }
        } catch (error) {
            ErrorHandler.log(error, 'Auto-save on meeting end', false);
            // Reset auto-save state on error so it can be retried
            autoSaveTriggered = false;
        }
        
        clearElementCache();
    }
    
    wasInMeeting = nowInMeeting;
    
    if (!nowInMeeting) {
        stopCaptureSession();
        stopAttendeeTracking();
        return;
    } else if (!wasInMeeting && nowInMeeting) {
        // Reset auto-save state when joining a new meeting
        console.log("Meeting transition detected: Out -> In. Resetting auto-save state.");
        autoSaveTriggered = false;
        lastMeetingId = null;
        captionRetryInProgress = false; // Reset retry flag
        // Start attendee tracking when entering meeting
        startAttendeeTracking();
        
        // For Google Meet, setup leave button listener and check if we need to auto-enable captions
        if (platformConfig && platformConfig.name === 'Google Meet') {
            setupLeaveButtonListener();
            
            // Try to auto-enable captions after a delay
            setTimeout(async () => {
                const { autoEnableCaptions } = await chrome.storage.sync.get('autoEnableCaptions');
                if (autoEnableCaptions) {
                    console.log('[Caption Saver] Checking if captions need to be auto-enabled...');
                    const captionsEnabled = platformConfig.areCaptionsEnabled();
                    
                    if (!captionsEnabled) {
                        console.log('[Caption Saver] Captions not enabled, attempting to enable...');
                        await attemptAutoEnableCaptions();
                    } else {
                        console.log('[Caption Saver] Captions already enabled');
                    }
                }
                
                // Then check caption state
                handleCaptionsStateChange();
            }, 3000); // Give meeting UI more time to load
        }
    }
    
    handleCaptionsStateChange();
}, 'Meeting state change handler');

const handleCaptionsStateChange = ErrorHandler.wrap(async function() {
    if (!isUserInMeeting()) return;
    
    const { trackCaptions } = await chrome.storage.sync.get('trackCaptions');
    if (trackCaptions === false) {
        console.log("Caption tracking disabled, skipping caption state handling");
        return;
    }
    
    const captionsContainer = getCachedElement(SELECTORS.captionsContainer);
    
    // For Google Meet, check if captions container actually has caption blocks
    let hasCaptions = false;
    if (captionsContainer && platformConfig && platformConfig.name === 'Google Meet') {
        const captionBlocks = captionsContainer.querySelectorAll(SELECTORS.captionBlock);
        hasCaptions = captionBlocks.length > 0;
    } else if (captionsContainer) {
        hasCaptions = true; // For Teams, container presence is enough
    }
    
    if (captionsContainer && hasCaptions) {
        startCaptureSession();
    } else {
        // For Google Meet, if captions are off and auto-enable is on, enable them
        if (platformConfig && platformConfig.name === 'Google Meet') {
            const { autoEnableCaptions } = await chrome.storage.sync.get('autoEnableCaptions');
            if (autoEnableCaptions) {
                // Check if captions are disabled
                const captionsEnabled = platformConfig.areCaptionsEnabled();
                console.log(`[Caption Saver] Google Meet captions enabled: ${captionsEnabled}`);
                
                if (!captionsEnabled) {
                    console.log("[Caption Saver] Captions are off, auto-enabling...");
                    debouncedAutoEnableCaptions();
                } else {
                    // Captions are on but container not found yet, wait and retry
                    console.log("[Caption Saver] Captions enabled, waiting for container...");
                    
                    // Only retry if not already retrying
                    if (!captionRetryInProgress) {
                        captionRetryInProgress = true;
                        setTimeout(() => {
                            clearElementCache(); // Clear cache to get fresh element
                            const retryContainer = getCachedElement(SELECTORS.captionsContainer);
                            if (retryContainer) {
                                startCaptureSession();
                            } else {
                                console.log("[Caption Saver] Caption container still not found");
                            }
                            captionRetryInProgress = false;
                        }, 2000);
                    }
                }
            }
        } else {
            // Teams logic
            stopCaptureSession();
            
            const { autoEnableCaptions } = await chrome.storage.sync.get('autoEnableCaptions');
            if (autoEnableCaptions) {
                // Use debounced version to prevent rapid firing
                debouncedAutoEnableCaptions();
            }
        }
    }
}, 'Captions state change handler');

function ensureObserverIsActive() {
    if (!capturing || !platformConfig) return;

    const captionContainer = getCachedElement(SELECTORS.captionsContainer);
    
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

async function startCaptureSession() {
    // Check if caption tracking is enabled
    const { trackCaptions } = await chrome.storage.sync.get('trackCaptions');
    if (trackCaptions === false) {
        console.log("Caption tracking is disabled in settings");
        // Still start attendee tracking if captions are disabled
        startAttendeeTracking();
        return;
    }
    
    if (capturing) return;

    console.log("New caption session detected. Starting capture.");
    transcriptArray.length = 0;
    
    // Try to clear speaker aliases, but don't fail if storage is restricted
    try {
        await chrome.storage.session.remove('speakerAliases');
    } catch (e) {
        // Expected on Google Meet, ignore
    }

    capturing = true;
    wasInMeeting = true; // Ensure we know we're in a meeting when capturing starts
    meetingTitleOnStart = document.title;
    recordingStartTime = new Date();
    
    console.log(`Capture started. Title: "${meetingTitleOnStart}", Time: ${recordingStartTime.toLocaleString()}`);
    
    // Start periodic backup
    startPeriodicBackup();
    
    // Start attendee tracking
    startAttendeeTracking();
    
    chrome.runtime.sendMessage({ message: "update_badge_status", capturing: true });
    
    ensureObserverIsActive();
}

function startPeriodicBackup() {
    // Clear any existing backup interval
    if (backupInterval) {
        clearInterval(backupInterval);
    }
    
    // Backup transcript every 30 seconds
    backupInterval = setInterval(async () => {
        if (transcriptArray.length > 0) {
            try {
                // Check if we have access to storage API
                if (chrome.storage && chrome.storage.local) {
                    await chrome.storage.local.set({
                        transcriptBackup: {
                            transcript: transcriptArray,
                            meetingTitle: meetingTitleOnStart,
                            recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : null,
                            lastBackup: new Date().toISOString(),
                            attendeeData: attendeeData
                        }
                    });
                    console.log(`[Caption Saver] Backup saved: ${transcriptArray.length} entries`);
                }
            } catch (error) {
                // Silently fail on Google Meet if storage is restricted
                if (platformConfig && platformConfig.name === 'Google Meet') {
                    // Expected on Google Meet in some contexts
                } else {
                    console.error("[Caption Saver] Backup failed:", error);
                }
            }
        }
    }, 30000); // 30 seconds
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
    
    // Stop periodic backup
    if (backupInterval) {
        clearInterval(backupInterval);
        backupInterval = null;
    }
    
    // Final backup before stopping
    if (transcriptArray.length > 0) {
        chrome.storage.local.set({
            transcriptBackup: {
                transcript: transcriptArray,
                meetingTitle: meetingTitleOnStart,
                recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : null,
                lastBackup: new Date().toISOString(),
                attendeeData: attendeeData
            }
        });
        
        // Don't save to session history here - let auto-save handle it to prevent duplicates
    }
    
    // Stop attendee tracking
    stopAttendeeTracking();
    
    chrome.runtime.sendMessage({ message: "update_badge_status", capturing: false });
}

// Save current transcript to session history
async function saveToSessionHistory() {
    if (transcriptArray.length === 0) return;
    
    try {
        // Use message passing to save session (content scripts can't import modules)
        const attendeeReport = await getAttendeeReport();
        
        // Clean transcript array (remove internal keys)
        const cleanTranscript = getCleanTranscript();
        
        // Send message to service worker
        const response = await chrome.runtime.sendMessage({
            message: "save_session_history",
            transcriptArray: cleanTranscript,
            meetingTitle: meetingTitleOnStart || 'Untitled Meeting',
            attendeeReport: attendeeReport
        });
        
        console.log('[Caption Saver] Session saved to history');
    } catch (error) {
        console.log('[Caption Saver] Could not save to session history:', error);
        
        // Try alternative: also trigger when auto-save happens
        if (platformConfig && platformConfig.name === 'Google Meet') {
            console.log('[Caption Saver] Will save session with auto-save');
        }
    }
}

// --- Automated Features ---
async function attemptAutoEnableCaptions() {
    // Prevent multiple simultaneous auto-enable attempts
    if (autoEnableInProgress) {
        console.log("Auto-enable already in progress, skipping...");
        return;
    }
    
    // Prevent too frequent attempts (min 10 seconds between attempts)
    const now = Date.now();
    if (now - autoEnableLastAttempt < 10000) {
        console.log("Auto-enable attempted too recently, skipping...");
        return;
    }
    
    autoEnableInProgress = true;
    autoEnableLastAttempt = now;
    
    try {
        console.log("Starting auto-enable captions attempt...");
        
        // Check if platform has its own enableCaptions method (Google Meet)
        if (platformConfig && platformConfig.enableCaptions) {
            const enabled = await platformConfig.enableCaptions();
            if (enabled) {
                console.log("Auto-enable SUCCESS: Captions enabled via platform method.");
                return;
            }
        }
        
        // Fallback to Teams method
        if (platformConfig && platformConfig.name === 'Microsoft Teams') {
            const moreButton = getCachedElement(SELECTORS.MORE_BUTTON);
            if (!moreButton) {
                console.error("Auto-enable FAILED: Could not find 'More' button.");
                return;
            }
            
            // Check if More menu is already expanded
            const expandedMoreButton = getCachedElement(SELECTORS.MORE_BUTTON_EXPANDED);
            if (!expandedMoreButton) {
                console.log("Clicking More button...");
                moreButton.click();
                await delay(TIMING.BUTTON_CLICK_DELAY);
            } else {
                console.log("More menu already expanded, proceeding...");
            }

            const langAndSpeechButton = getCachedElement(SELECTORS.LANGUAGE_SPEECH_BUTTON);
            if (!langAndSpeechButton) {
                console.error("Auto-enable FAILED: Could not find 'Language and speech' menu item.");
                // Close the More menu if we opened it
                const currentExpandedButton = getCachedElement(SELECTORS.MORE_BUTTON_EXPANDED);
                if (currentExpandedButton) {
                    currentExpandedButton.click();
                }
                return;
            }
            
            console.log("Clicking Language and speech...");
            langAndSpeechButton.click();
            await delay(TIMING.BUTTON_CLICK_DELAY);

            const turnOnCaptionsButton = getCachedElement(SELECTORS.TURN_ON_CAPTIONS_BUTTON);
            if (turnOnCaptionsButton) {
                console.log("Clicking Turn on live captions...");
                turnOnCaptionsButton.click();
                await delay(TIMING.BUTTON_CLICK_DELAY);
            } else {
                console.error("Auto-enable FAILED: Could not find 'Turn on live captions' button.");
            }

            // Attempt to close the 'More' menu
            const finalExpandedButton = getCachedElement(SELECTORS.MORE_BUTTON_EXPANDED);
            if (finalExpandedButton) {
                console.log("Closing More menu...");
                finalExpandedButton.click();
            }
        }
        
        console.log("Auto-enable captions attempt completed.");
    } catch (e) {
        console.error("Error during auto-enable captions attempt:", e);
    } finally {
        autoEnableInProgress = false;
    }
}

function debouncedAutoEnableCaptions() {
    if (autoEnableDebounceTimer) {
        clearTimeout(autoEnableDebounceTimer);
    }
    
    autoEnableDebounceTimer = setTimeout(() => {
        attemptAutoEnableCaptions();
    }, 2000); // 2 second debounce to prevent rapid firing
}

// --- Event-Driven Initialization ---
function initializeEventDrivenSystem() {
    if (hasInitializedListeners) return;
    
    console.log("Initializing event-driven caption system...");
    
    // Set up observers for meeting state changes
    setupMeetingObserver();
    setupCaptionsObserver();
    
    // Periodically check observer status (much less frequent than before)
    setInterval(ensureObserverIsActive, TIMING.OBSERVER_CHECK_INTERVAL);
    
    // Initial state check
    handleMeetingStateChange();
    
    hasInitializedListeners = true;
}

// --- Memory Leak Prevention ---
function cleanupObservers() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    if (meetingObserver) {
        meetingObserver.disconnect();
        meetingObserver = null;
    }
    if (captionsObserver) {
        captionsObserver.disconnect();
        captionsObserver = null;
    }
    
    // Remove leave button listener
    if (leaveButtonListener) {
        document.removeEventListener('click', leaveButtonListener, true);
        leaveButtonListener = null;
    }
    
    // Clear all debounce timers
    if (meetingStateDebounceTimer) {
        clearTimeout(meetingStateDebounceTimer);
        meetingStateDebounceTimer = null;
    }
    if (captionsStateDebounceTimer) {
        clearTimeout(captionsStateDebounceTimer);
        captionsStateDebounceTimer = null;
    }
    if (autoEnableDebounceTimer) {
        clearTimeout(autoEnableDebounceTimer);
        autoEnableDebounceTimer = null;
    }
    
    // Reset auto-enable state
    autoEnableInProgress = false;
    
    // Stop attendee tracking
    stopAttendeeTracking();
    
    clearElementCache();
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanupObservers);

// Initialize the system
if (initializePlatform()) {
    initializeEventDrivenSystem();
} else {
    console.error('[Caption Saver] Failed to initialize - unsupported platform');
}

// --- Message Handling ---
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    switch (request.message) {
        case 'viewer_ready':
            // Viewer is ready to receive live updates
            sendResponse({
                streaming: capturing,
                captionCount: transcriptArray.length
            });
            return true;
            
        case 'get_status':
            (async () => {
                const { trackCaptions } = await chrome.storage.sync.get('trackCaptions');
                const attendeeReport = await getAttendeeReport();
                sendResponse({
                    capturing: trackCaptions !== false ? capturing : false,
                    captionCount: transcriptArray.length,
                    isInMeeting: isUserInMeeting(),
                    attendeeCount: attendeeReport ? attendeeReport.totalUniqueAttendees : 0
                });
            })();
            return true; // Will respond asynchronously

        case 'return_transcript':
            if (transcriptArray.length > 0) {
                (async () => {
                    const attendeeReport = await getAttendeeReport();
                    console.log("[Teams Caption Saver] Sending transcript with attendee report:", {
                        transcriptCount: transcriptArray.length,
                        attendeeCount: attendeeReport ? attendeeReport.totalUniqueAttendees : 0,
                        attendees: attendeeReport ? attendeeReport.attendeeList : []
                    });
                    chrome.runtime.sendMessage({
                        message: "download_captions",
                        transcriptArray: getCleanTranscript(),
                        meetingTitle: meetingTitleOnStart,
                        format: request.format,
                        recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                        attendeeReport: attendeeReport
                    });
                })();
            } else {
                alert("No captions were captured. Please ensure captions are turned on in the meeting.");
            }
            break;

        case 'get_transcript_for_copying':
            sendResponse({ transcriptArray: getCleanTranscript() });
            break;
            
        case 'get_transcript_for_viewer':
            // Send current transcript to viewer for initial load
            sendResponse({ 
                transcriptArray: getCleanTranscript(),
                meetingTitle: meetingTitleOnStart,
                isCapturing: capturing
            });
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
            
        case 'get_attendee_report':
            (async () => {
                const attendeeReport = await getAttendeeReport();
                sendResponse({ attendeeReport: attendeeReport });
            })();
            return true; // Will respond asynchronously
        
        default:
            // Ignore live updates that might be relayed back
            if (request.message !== 'live_caption_update' && request.message !== 'live_attendee_update') {
                console.log("Unhandled message received in content script:", request.message);
            }
            break;
    }

    return true; // Indicates an asynchronous response may be sent.
});

console.log("Teams Captions Saver content script is running.");