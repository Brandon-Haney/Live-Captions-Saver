// --- Platform Detection and Configuration ---
let platformConfig = null;
let SELECTORS = {};
let sessionManager = null;
let currentSessionId = null;

// Initialize platform configuration
function initializePlatform() {
    platformConfig = getCurrentPlatformConfig();
    if (!platformConfig) {
        console.error('[Caption Saver] Unsupported platform');
        return false;
    }
    
    SELECTORS = platformConfig.selectors;
    // console.log(`[Caption Saver] Initialized for ${platformConfig.name}`);
    
    // Don't create session on page load - wait until actually in a meeting
    // Session will be created when entering a meeting
    return true;
}

// Initialize SessionManager for this tab - DEPRECATED, use createNewMeetingSession instead
async function initializeSessionManager() {
    // This function is no longer used - sessions are created when entering meetings
    console.log('[Caption Saver] Legacy initializeSessionManager called - ignoring');
}

// Extract meeting title from page using platform-specific logic
function extractMeetingTitle() {
    // Use platform-specific title extraction if available
    if (platformConfig?.extractMeetingTitle) {
        return platformConfig.extractMeetingTitle();
    }
    
    // Fallback to basic document title extraction
    let title = document.title;
    
    // Remove common suffixes based on platform
    if (platformConfig?.name === 'Microsoft Teams') {
        title = title.replace(/ \| Microsoft Teams.*$/, '').trim();
    } else if (platformConfig?.name === 'Zoom') {
        title = title.replace(/ - Zoom.*$/, '').trim();
    } else if (platformConfig?.name === 'Google Meet') {
        title = title.replace(/ - Google Meet.*$/, '').trim();
    }
    
    return title || 'Untitled Meeting';
}

// Create a new session for a new meeting
async function createNewMeetingSession() {
    try {
        // Only end previous session if it has actual content
        if (currentSessionId) {
            // Check if the current session has any captions
            if (transcriptArray.length > 0) {
                console.log(`[Caption Saver] Ending previous session with ${transcriptArray.length} captions: ${currentSessionId}`);
                chrome.runtime.sendMessage({
                    action: 'endSession',
                    sessionId: currentSessionId
                });
            } else {
                console.log(`[Caption Saver] Deleting empty session: ${currentSessionId}`);
                // Delete the empty session instead of ending it
                chrome.runtime.sendMessage({
                    action: 'deleteSession',
                    sessionId: currentSessionId
                });
            }
        }
        
        // Clear transcript and attendee data for the new meeting
        transcriptArray.length = 0;
        attendeeData = {
            allAttendees: new Set(),
            currentAttendees: new Map(),
            attendeeHistory: [],
            lastUpdated: null,
            meetingStartTime: new Date().toISOString()
        };
        chatCaptureState.capturedMessageIds.clear();
        chatCaptureState.initialScanComplete = false;
        chatCaptureState.initialMessagesSkipped = 0;
        
        // Reset meeting metadata only if not already set
        // This preserves the title if we're creating a new session after ending one
        if (!currentMeetingTitle || currentMeetingTitle === '') {
            currentMeetingTitle = '';
            recordingStartTime = null;
        }
        
        // Create a new session
        const tabId = window.location.href;
        // Convert platform name to short form: "Microsoft Teams" -> "teams"
        let platform = 'unknown';
        if (platformConfig?.name === 'Microsoft Teams') {
            platform = 'teams';
        } else if (platformConfig?.name === 'Zoom') {
            platform = 'zoom';
        } else if (platformConfig?.name === 'Google Meet') {
            platform = 'meet';
        }
        const url = window.location.href;
        
        const response = await safeSendMessageAsync({
            action: 'createSession',
            tabId: tabId,
            platform: platform,
            url: url
        });
        
        if (response && response.sessionId) {
            currentSessionId = response.sessionId;
            console.log(`[Caption Saver] New meeting session created: ${currentSessionId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('[Caption Saver] Failed to create new meeting session:', error);
        return false;
    }
}

// --- Constants ---
const TIMING = {
    BUTTON_CLICK_DELAY: 400,
    RETRY_DELAY: 2000,
    MAIN_LOOP_INTERVAL: 5000,
    OBSERVER_CHECK_INTERVAL: 10000,
    TOOLTIP_DISPLAY_DURATION: 1500,
    ATTENDEE_UPDATE_INTERVAL: 60000,
    INITIAL_ATTENDEE_DELAY: 3000, // Increased delay for Zoom to ensure panel is open
    CHAT_CHECK_INTERVAL: 60000, // Check chat every 60 seconds
    PANEL_SWITCH_DELAY: 1500,    // Wait after panel switch
    TYPING_RECHECK_DELAY: 10000, // Recheck if user was typing
};

// --- State ---
const transcriptArray = [];
let capturing = false;
let currentMeetingTitle = ''; // Current meeting title
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

// --- Chat Capture State ---
let chatCaptureState = {
    enabled: false,
    capturedMessageIds: new Set(),
    lastChatCheck: null,
    isRotating: false,
    chatCheckInterval: null,
    currentPanel: 'unknown',
    sessionStartTime: null,  // Track when this capture session started
    initialScanComplete: false,  // Track if we've done initial scan of existing messages
    initialMessagesSkipped: 0  // Count of pre-existing messages we skipped
};

// --- Safe Message Sending Helpers ---
function safeSendMessage(message, callback) {
    try {
        // Check if chrome.runtime is available
        if (!chrome?.runtime?.sendMessage) {
            return;
        }
        
        // Send message with error handling
        chrome.runtime.sendMessage(message, (response) => {
            // Check for errors
            if (chrome.runtime.lastError) {
                // Extension context invalidated or other errors - ignore silently
                return;
            }
            if (callback) {
                callback(response);
            }
        });
    } catch (error) {
        // Extension context invalidated or runtime not available
        // This can happen during page unload or extension updates
    }
}

async function safeSendMessageAsync(message) {
    return new Promise((resolve) => {
        try {
            // Check if chrome.runtime is available
            if (!chrome?.runtime?.sendMessage) {
                resolve(null);
                return;
            }
            
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    resolve(null);
                } else {
                    resolve(response);
                }
            });
        } catch (error) {
            resolve(null);
        }
    });
}

// --- Real-time Broadcasting ---
function broadcastCaptionUpdate(data) {
    if (!currentSessionId) {
        console.warn('[Caption Saver] No session ID when broadcasting caption update');
    }
    safeSendMessage({
        message: "live_caption_update",
        sessionId: currentSessionId,  // Include session ID for filtering
        ...data
    });
}

async function broadcastAttendeeUpdate(data) {
    await safeSendMessageAsync({
        message: "live_attendee_update",
        sessionId: currentSessionId,  // Include session ID for filtering
        ...data
    });
}

// --- Error Handling & Logging ---
class ErrorHandler {
    static log(error, context = '', silent = false) {
        const timestamp = new Date().toISOString();
        const errorInfo = {
            timestamp,
            context,
            message: error?.message || String(error),
            stack: error?.stack,
            url: window.location.href
        };
        
        // Format error message properly
        const errorMessage = errorInfo.message || 'Unknown error';
        if (errorInfo.stack) {
            console.error(`[Live Caption Saver] ${context}: ${errorMessage}\nStack:`, errorInfo.stack);
        } else {
            console.error(`[Live Caption Saver] ${context}: ${errorMessage}`);
        }
        
        if (!silent) {
            // Could send to analytics or show user notification
            safeSendMessage({
                message: "error_logged",
                error: errorInfo
            });
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
                console.log(`[Live Caption Saver] ${context} - Attempt ${attempt} failed, retrying in ${delayTime}ms:`, error.message || error);
                await delay(delayTime);
            }
        }
        
        throw lastError;
    }
}

// --- Utility Functions ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getCleanTranscript = () => transcriptArray.map(({ key, ...rest }) => rest);

// --- Timestamp Formatting ---
let timestampFormat = '12hr'; // Default format

// Load timestamp format from storage
chrome.storage.sync.get('timestampFormat').then(result => {
    if (result.timestampFormat) {
        timestampFormat = result.timestampFormat;
    }
});

// Listen for changes to timestamp format
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.timestampFormat) {
        timestampFormat = changes.timestampFormat.newValue;
    }
});

function getFormattedTimestamp() {
    const now = new Date();
    
    switch(timestampFormat) {
        case '24hr':
            return now.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit', 
                second: '2-digit' 
            });
        case 'relative':
            if (recordingStartTime) {
                const elapsed = Math.floor((now - recordingStartTime) / 1000);
                const hours = Math.floor(elapsed / 3600);
                const minutes = Math.floor((elapsed % 3600) / 60);
                const seconds = elapsed % 60;
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
            // Fall back to 12hr if no recording start time
        case '12hr':
        default:
            return now.toLocaleTimeString('en-US', { 
                hour12: true, 
                hour: 'numeric', 
                minute: '2-digit', 
                second: '2-digit' 
            });
    }
}

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
    const inMeeting = platformConfig.isMeetingActive();
    
    // Debug logging for Zoom
    if (platformConfig.name === 'Zoom' && wasInMeeting !== inMeeting) {
        // console.log(`[Caption Saver] Zoom meeting state changed: ${wasInMeeting} -> ${inMeeting}`);
    }
    
    return inMeeting;
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

            // Use the formatted timestamp if Time is not provided correctly
            const { Name: name, Text: text } = captionData;
            const time = getFormattedTimestamp(); // Always use our formatted timestamp
            if (text.length === 0) return;

            let captionId = element.getAttribute('data-caption-id');
            
            // For Zoom, don't rely on element IDs since elements are destroyed/recreated
            if (platformConfig.name === 'Zoom') {
                // Use content-based tracking for Zoom
                // Look for the last caption with the same speaker
                let lastCaptionIndex = -1;
                if (transcriptArray.length > 0) {
                    // Get the last caption entry
                    const lastEntry = transcriptArray[transcriptArray.length - 1];
                    if (lastEntry.Name === name && lastEntry.Type === 'caption') {
                        lastCaptionIndex = transcriptArray.length - 1;
                    }
                }
                
                // Check if this is a continuation of the last caption
                const now = new Date();
                const isContinuation = lastCaptionIndex !== -1 && 
                    transcriptArray[lastCaptionIndex].timestamp && 
                    (now - new Date(transcriptArray[lastCaptionIndex].timestamp)) < 10000; // Within 10 seconds
                
                if (isContinuation) {
                    const lastText = transcriptArray[lastCaptionIndex].Text;
                    
                    // Check if this is an update (text starts with previous text)
                    // OR if the text is completely different (new sentence)
                    if (text.startsWith(lastText) || lastText.startsWith(text)) {
                        // This is an update/continuation of the same caption
                        captionId = transcriptArray[lastCaptionIndex].key;
                    } else {
                        // This is a new sentence from the same speaker
                        captionId = `caption_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                    }
                } else {
                    // This is a new caption (different speaker or too much time passed)
                    captionId = `caption_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                }
            } else {
                // For other platforms, use element-based tracking
                if (!captionId) {
                    captionId = `caption_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                    element.setAttribute('data-caption-id', captionId);
                }
            }

            const existingIndex = transcriptArray.findIndex(entry => entry.key === captionId);

            if (existingIndex !== -1) {
                const existingEntry = transcriptArray[existingIndex];
                
                // For Google Meet and Zoom: Just update the existing caption with the new text
                // Both platforms continuously update the same caption element
                if (platformConfig.name === 'Google Meet' || platformConfig.name === 'Zoom') {
                    const speakerChanged = existingEntry.Name !== name;
                    
                    if (speakerChanged) {
                        // New speaker - create a new caption entry
                        const newCaptionId = `${captionId}_${Date.now()}`;
                        const newCaption = { 
                            Name: name, 
                            Text: text, 
                            Time: time,
                            Type: 'caption',  // Mark as caption
                            key: newCaptionId,
                            timestamp: new Date().toISOString() // Add timestamp
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
                // Add new entry with timestamp for Zoom tracking
                const newCaption = { 
                    Name: name, 
                    Text: text, 
                    Time: time, 
                    Type: 'caption', 
                    key: captionId,
                    timestamp: new Date().toISOString() // Add timestamp for Zoom tracking
                };
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
        // Skip "You" as it's not a real name
        if (name === 'You') {
            // For Google Meet, try to replace with actual name
            if (window.currentUserName && window.currentUserName !== 'You') {
                name = window.currentUserName;
            } else {
                return; // Skip this entry
            }
        }
        
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
            if (platformConfig?.name === 'Zoom') {
                console.log(`[Zoom] Attendee list not found with selector: ${attendeeListSelector}`);
            }
            // Fallback: Add speakers from transcript as attendees
            updateAttendeesFromTranscript();
            return;
        }
        
        // For Zoom, build speaker name mapping when we scan attendees
        if (platformConfig?.name === 'Zoom' && platformConfig.buildSpeakerNameMapping) {
            platformConfig.buildSpeakerNameMapping();
        }
        
        // Platform-specific attendee item selector
        const attendeeItemSelector = SELECTORS.attendeeItem || SELECTORS.ATTENDEE_ITEM;
        const attendeeItems = document.querySelectorAll(attendeeItemSelector);
        // console.log(`[Attendee Tracking] Found ${attendeeItems.length} attendees with selector: ${attendeeItemSelector}`);
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
        
        console.log(`[${platformConfig?.name}] Attendee update complete. Current: ${attendeeData.currentAttendees.size}, Total: ${attendeeData.allAttendees.size}`);
        
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
        // console.log("[Attendee Tracking] Disabled in settings");
        return;
    }
    
    // console.log(`[Attendee Tracking] Starting for ${platformConfig?.name || 'unknown platform'}`);
    
    if (attendeeUpdateInterval) {
        clearInterval(attendeeUpdateInterval);
    }
    
    // Reset attendee data for new meeting
    const startTime = new Date().toISOString();
    attendeeData = {
        allAttendees: new Set(),
        currentAttendees: new Map(),
        attendeeHistory: [],
        lastUpdated: null,
        meetingStartTime: startTime,
    };
    
    // Ensure meeting start time is also set in main recording start time
    if (!recordingStartTime) {
        recordingStartTime = new Date();
    }
    
    // console.log(`Starting attendee tracking for ${platformConfig?.name}...`);
    
    // Initial update after delay
    setTimeout(async () => {
        // For Google Meet, always try to open People panel initially to get attendees
        if (platformConfig?.name === 'Google Meet') {
            // console.log('[Attendee Tracking] Google Meet - opening People panel for initial attendee scan');
            const opened = await tryOpenParticipantPanel();
            if (opened) {
                await delay(1000); // Give panel time to populate
            }
            updateAttendeeList();
            
            // For Google Meet, also check attendees from transcript speakers
            updateAttendeesFromTranscript();
        } else if (platformConfig?.name === 'Zoom') {
            // For Zoom, try to open participant panel if enabled
            if (autoOpenAttendees) {
                const opened = await tryOpenParticipantPanel();
                if (opened) {
                    await delay(2000); // Give panel more time to populate
                }
            }
            
            // Update attendee list after delay
            updateAttendeeList();
            
            // Also check transcript for speakers in case panel isn't available
            updateAttendeesFromTranscript();
        } else {
            // Teams logic - check if chat capture is enabled to avoid conflicts
            const { chatCapture } = await chrome.storage.sync.get(['chatCapture']);
            
            // Only auto-open participant panel if setting is enabled AND chat capture is not active
            if (autoOpenAttendees && !chatCapture) {
                await tryOpenParticipantPanel();
            } else if (autoOpenAttendees && chatCapture) {
                console.log("Chat capture is enabled - skipping auto-open attendees to avoid panel conflicts");
            }
            
            updateAttendeeList();
        }
        
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
    
    // For Zoom, do a final attendee update before generating report
    if (platformConfig?.name === 'Zoom') {
        updateAttendeeList(); // Update from participant panel
        updateAttendeesFromTranscript(); // Also check transcript
        await delay(100); // Small delay to ensure updates complete
    }
    
    // For Google Meet, ensure we have at least the speakers from the transcript
    if (platformConfig?.name === 'Google Meet' && attendeeData.allAttendees.size === 0) {
        // console.log('[Attendee Tracking] Google Meet - no attendees found, checking transcript for speakers');
        updateAttendeesFromTranscript();
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
    
    if (platformConfig?.name === 'Zoom') {
        console.log(`[Zoom] Attendee report generated: ${report.totalUniqueAttendees} attendees`, report.attendeeList);
    }
    
    return report;
}

// --- Chat Capture Functions ---
function detectCurrentPanel() {
    if (!platformConfig?.chatCapture?.isSupported()) return 'none';
    
    const panel = platformConfig.chatCapture.detectCurrentPanel();
    chatCaptureState.currentPanel = panel;
    return panel;
}

function isUserTyping() {
    if (!platformConfig?.chatCapture?.isSupported()) return false;
    
    const isTyping = platformConfig.chatCapture.isUserTyping();
    if (isTyping) {
        // console.log('[Chat Capture] User is actively typing - postponing panel switch');
    }
    return isTyping;
}

function captureChatMessages(skipInitialMessages = false) {
    if (!chatCaptureState.enabled) return 0;
    if (!platformConfig?.chatCapture?.isSupported()) {
        // console.log('[Chat Capture] Not supported on this platform');
        return 0;
    }
    
    const messages = platformConfig.chatCapture.getChatMessages();
    let newCount = 0;
    let skippedCount = 0;
    
    messages.forEach(msgElement => {
        const messageData = platformConfig.chatCapture.getChatMessageData(msgElement);
        if (!messageData || !messageData.id) return;
        
        // Skip if already captured or marked as pre-existing
        if (chatCaptureState.capturedMessageIds.has(messageData.id)) {
            return;
        }
        
        // During initial scan, mark all messages as "seen" but don't add to transcript
        if (skipInitialMessages) {
            chatCaptureState.capturedMessageIds.add(messageData.id);
            skippedCount++;
            return;
        }
        
        // Create chat message with consistent format
        // Use our formatted timestamp instead of the one from the element
        const chatMessage = {
            Name: messageData.author,
            Text: messageData.text,
            Time: getFormattedTimestamp(), // Use our consistent timestamp format
            Type: 'chat',  // Mark as chat message
            key: `chat_${messageData.id}`
        };
        
        // Add to transcript array in chronological position
        transcriptArray.push(chatMessage);
        chatCaptureState.capturedMessageIds.add(messageData.id);
        newCount++;
        
        // console.log(`[Chat Capture] New message from ${chatMessage.Name}: "${chatMessage.Text}"`);
        
        // Broadcast to viewer
        broadcastCaptionUpdate({
            type: 'new',
            caption: chatMessage
        });
    });
    
    if (skipInitialMessages && skippedCount > 0) {
        chatCaptureState.initialMessagesSkipped = skippedCount;
        console.log(`[Chat Capture] Skipped ${skippedCount} pre-existing messages from recurring meeting`);
    }
    
    if (newCount > 0) {
        // console.log(`[Chat Capture] Captured ${newCount} new messages. Total transcript: ${transcriptArray.length}`);
    }
    
    return newCount;
}

async function openChatPanel() {
    if (!platformConfig?.chatCapture?.isSupported()) return false;
    if (platformConfig.chatCapture.detectCurrentPanel() === 'chat') return true;
    
    return await platformConfig.chatCapture.openChatPanel();
}

async function openPeoplePanel() {
    if (!platformConfig?.chatCapture?.isSupported()) return false;
    if (platformConfig.chatCapture.detectCurrentPanel() === 'people') return true;
    
    return await platformConfig.chatCapture.openPeoplePanel();
}

async function performHybridRotation() {
    if (chatCaptureState.isRotating || !chatCaptureState.enabled) return;
    
    // For Google Meet, we don't need panel rotation since both can be visible
    if (platformConfig?.name === 'Google Meet') {
        // Just capture chat messages if the panel is open
        captureChatMessages(false);  // Normal capture, not initial scan
        return;
    }
    
    // Check if user is typing (Teams/other platforms)
    if (isUserTyping()) {
        // Silently postpone without logging (reduces console spam when tab is inactive)
        setTimeout(performHybridRotation, TIMING.TYPING_RECHECK_DELAY);
        return;
    }
    
    chatCaptureState.isRotating = true;
    // console.log('[Chat Capture] Starting hybrid rotation');
    
    try {
        const currentPanel = detectCurrentPanel();
        
        // Quick attendee check
        if (await openPeoplePanel()) {
            updateAttendeeList();
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Return to chat (our primary panel)
        if (await openChatPanel()) {
            captureChatMessages(false);  // Normal capture, not initial scan
        }
        
        chatCaptureState.lastChatCheck = new Date();
    } catch (error) {
        console.error('[Chat Capture] Rotation error:', error);
    } finally {
        chatCaptureState.isRotating = false;
    }
}

async function startChatCapture() {
    // Check if platform supports chat capture
    if (!platformConfig?.chatCapture?.isSupported()) {
        // console.log('[Chat Capture] Not supported on this platform');
        return;
    }
    
    const { chatCapture } = await chrome.storage.sync.get(['chatCapture']);
    if (chatCapture === false) {
        // console.log('[Chat Capture] Disabled in settings');
        return;
    }
    
    chatCaptureState.enabled = true;
    chatCaptureState.sessionStartTime = new Date();  // Record when we started capturing
    chatCaptureState.initialScanComplete = false;  // Reset initial scan flag
    chatCaptureState.initialMessagesSkipped = 0;  // Reset counter
    // console.log('[Chat Capture] Starting capture system for', platformConfig.name);
    
    // Platform-specific initialization
    if (platformConfig.name === 'Google Meet') {
        // Google Meet: Simpler approach since panels can coexist
        // console.log('[Chat Capture] Google Meet mode - monitoring chat continuously');
        
        // Open chat panel initially if not already open
        const chatOpened = await openChatPanel();
        if (chatOpened) {
            // console.log('[Chat Capture] Opened chat panel for monitoring');
            await delay(1000);
            // Mark all existing messages as "already seen" on first capture
            captureChatMessages(true);  // Skip initial messages
            chatCaptureState.initialScanComplete = true;
        }
        
        // Set up continuous chat monitoring (every 2 seconds)
        // Don't rely on panel detection for Google Meet - just try to capture
        chatCaptureState.chatCheckInterval = setInterval(() => {
            captureChatMessages(false);  // Capture new messages normally
        }, 2000);
        
    } else {
        // Teams and other platforms: Use hybrid rotation
        // console.log('[Chat Capture] Step 1: Checking People panel for initial attendees');
        await openPeoplePanel();
        await delay(1500); // Give time for panel to fully load
        
        // Capture initial attendees
        const peoplePanel = document.querySelector('.fui-FlatTree[role="tree"][aria-label="Attendees"], .ts-calling-participants-grid-container');
        if (peoplePanel) {
            // console.log('[Chat Capture] Capturing initial attendee list');
            updateAttendeeList(); // Use existing attendee capture function
        }
        
        // Then switch to chat panel for ongoing capture
        // console.log('[Chat Capture] Step 2: Switching to Chat panel for message capture');
        await delay(500);
        
        // Start on chat panel
        openChatPanel().then(() => {
            // Initial scan - mark existing messages as seen but don't capture
            captureChatMessages(true);  // Skip initial messages
            chatCaptureState.initialScanComplete = true;
            
            // Set up continuous chat monitoring
            setInterval(() => {
                if (detectCurrentPanel() === 'chat' && !chatCaptureState.isRotating) {
                    captureChatMessages(false);  // Capture new messages normally
                }
            }, 2000);
            
            // Set up periodic rotation for attendee checks
            chatCaptureState.chatCheckInterval = setInterval(performHybridRotation, TIMING.CHAT_CHECK_INTERVAL);
        });
    }
}

function stopChatCapture() {
    chatCaptureState.enabled = false;
    chatCaptureState.initialScanComplete = false;
    chatCaptureState.capturedMessageIds.clear();  // Clear the set of captured IDs for next session
    if (chatCaptureState.chatCheckInterval) {
        clearInterval(chatCaptureState.chatCheckInterval);
        chatCaptureState.chatCheckInterval = null;
    }
    // console.log('[Chat Capture] Stopped');
}

// --- Event-Driven Meeting Detection ---
let meetingStateDebounceTimer = null;
let captionsStateDebounceTimer = null;
let leaveButtonListener = null;
let visibilityChangeHandler = null;

function setupMeetingObserver() {
    if (meetingObserver) return;
    
    // Setup visibility change handler to recheck meeting state when tab becomes visible
    if (!visibilityChangeHandler) {
        visibilityChangeHandler = () => {
            if (!document.hidden) {
                console.log('[Caption Saver] Tab became visible, rechecking meeting state');
                // Delay check to allow DOM to stabilize
                setTimeout(() => {
                    handleMeetingStateChange();
                }, 500);
            }
        };
        document.addEventListener('visibilitychange', visibilityChangeHandler);
    }
    
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
    
    // console.log(`[Caption Saver] Meeting state check - Was: ${wasInMeeting}, Now: ${nowInMeeting}`);
    
    // Check if tab is hidden - if so, don't trigger auto-save as user might be switching to another meeting
    if (document.hidden && wasInMeeting && !nowInMeeting) {
        console.log('[Caption Saver] Tab is hidden and meeting state changed - likely switching tabs, not triggering auto-save');
        // Don't update wasInMeeting state yet - wait for tab to become visible again
        return;
    }
    
    if (wasInMeeting && !nowInMeeting) {
        // Handle session end
        if (currentSessionId) {
            if (transcriptArray.length === 0) {
                // Delete empty session
                console.log(`[Caption Saver] Deleting empty session on meeting end: ${currentSessionId}`);
                chrome.runtime.sendMessage({
                    action: 'deleteSession',
                    sessionId: currentSessionId
                });
            } else {
                // End session with content (this adds it to history)
                console.log(`[Caption Saver] Ending session with ${transcriptArray.length} captions: ${currentSessionId}`);
                chrome.runtime.sendMessage({
                    action: 'endSession',
                    sessionId: currentSessionId
                });
            }
            currentSessionId = null;
        }
        const isMainFrame = window === window.top;
        // console.log(`Meeting transition detected: In -> Out. Checking for auto-save in ${isMainFrame ? 'main frame' : 'iframe'}.`);
        // console.log(`Platform: ${platformConfig?.name}, Transcript length: ${transcriptArray.length}, Capturing: ${capturing}`);
        
        // For Zoom, save immediately as iframe might be destroyed
        if (platformConfig && platformConfig.name === 'Zoom') {
            console.log(`[Zoom] Meeting end detected in ${isMainFrame ? 'main frame' : 'iframe'}, transcript: ${transcriptArray.length} items`);
            if (transcriptArray.length > 0) {
                // Save to local storage immediately
                (async () => {
                const attendeeReport = await getAttendeeReport();
                console.log(`[Zoom iframe] Saving meeting data - Transcript: ${transcriptArray.length} items, Attendees: ${attendeeReport?.totalUniqueAttendees || 0}`);
                await chrome.storage.local.set({
                    zoomMeetingEnded: {
                        transcript: getCleanTranscript(),
                        meetingTitle: currentMeetingTitle || 'Untitled Meeting',
                        recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                        attendeeReport: attendeeReport,
                        timestamp: new Date().toISOString(),
                        shouldAutoSave: true
                    }
                });
                
                // Send message to service worker
                safeSendMessage({
                    message: "zoom_meeting_ended"
                });
            })();
            }
        }
        
        // Send meeting ended signal to viewer
        try {
            safeSendMessage({
                message: "meeting_ended"
            });
        } catch (error) {
            // Silent fail if no listeners
        }
        
        // Generate a unique meeting session ID
        const currentMeetingId = `${currentMeetingTitle}_${recordingStartTime?.toISOString() || Date.now()}`;
        
        // Prevent duplicate auto-saves for the same meeting session
        if (autoSaveTriggered && lastMeetingId === currentMeetingId) {
            console.log("Auto-save already triggered for this meeting session, skipping...");
            clearElementCache();
            wasInMeeting = nowInMeeting;
            return;
        }
        
        try {
            const { autoSaveOnEnd } = await chrome.storage.sync.get('autoSaveOnEnd');
            console.log(`Auto-save check: enabled=${autoSaveOnEnd}, transcript=${transcriptArray.length} items`);
            
            if (autoSaveOnEnd && transcriptArray.length > 0) {
                console.log("Auto-save is ON and transcript has data. Triggering save.");
                
                // Mark auto-save as triggered before sending message
                autoSaveTriggered = true;
                lastMeetingId = currentMeetingId;
                
                // Send save message without retry (let service worker handle retries if needed)
                const attendeeReport = await getAttendeeReport();
                const cleanTranscript = getCleanTranscript();
                
                // DON'T extract new title after meeting ends - use the cached one from when meeting was active
                // extractMeetingTitle() will return "Calendar" after leaving the meeting!
                // Also check transcriptBackup for title if currentMeetingTitle was cleared
                let titleToUse = currentMeetingTitle;
                
                // If title was cleared, try to get it from backup storage
                if (!titleToUse || titleToUse === 'Untitled Meeting') {
                    const backupData = await chrome.storage.local.get('transcriptBackup');
                    if (backupData.transcriptBackup?.meetingTitle) {
                        titleToUse = backupData.transcriptBackup.meetingTitle;
                        console.log(`Auto-save: Retrieved title from backup: "${titleToUse}"`);
                    }
                }
                
                // Final fallback
                titleToUse = titleToUse || 'Untitled Meeting';
                
                console.log(`Auto-save: Sending ${cleanTranscript.length} transcript items from ${window === window.top ? 'main frame' : 'iframe'}`);
                console.log(`Auto-save: Using title "${titleToUse}" (cached from active meeting)`);
                
                try {
                    const response = await safeSendMessageAsync({
                        message: "save_on_leave",
                        transcriptArray: cleanTranscript,
                        meetingTitle: titleToUse,
                        recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                        attendeeReport: attendeeReport,
                        sessionId: currentSessionId
                    });
                    
                    console.log("Auto-save message sent successfully. Response:", response);
                } catch (sendError) {
                    console.error("Failed to send auto-save message:", sendError);
                    
                    // Try alternative: save directly if we have permission
                    if (cleanTranscript.length > 0) {
                        console.log("Attempting direct save fallback...");
                        // Store for manual save
                        chrome.storage.local.set({
                            pendingAutoSave: {
                                transcript: cleanTranscript,
                                meetingTitle: currentMeetingTitle || 'Untitled Meeting',
                                recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                                attendeeReport: attendeeReport,
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                }
            } else {
                // console.log(`Auto-save skipped: enabled=${autoSaveOnEnd}, transcript=${transcriptArray.length} items`);
                
                // If this is Zoom and we have no transcript in this frame, check if it's in storage
                if (platformConfig && platformConfig.name === 'Zoom' && autoSaveOnEnd && !transcriptArray.length) {
                    console.log('[Zoom main frame] Checking for saved meeting data...');
                    
                    // First check for zoomMeetingEnded (saved by iframe)
                    const { zoomMeetingEnded } = await chrome.storage.local.get('zoomMeetingEnded');
                    if (zoomMeetingEnded && zoomMeetingEnded.transcript && zoomMeetingEnded.transcript.length > 0) {
                        console.log(`[Zoom main frame] Found saved data - Transcript: ${zoomMeetingEnded.transcript.length} items, Attendees: ${zoomMeetingEnded.attendeeReport?.totalUniqueAttendees || 0}`);
                        // Trigger the zoom_meeting_ended handler in service worker
                        await safeSendMessageAsync({ message: "zoom_meeting_ended" });
                    } else {
                        // Fallback: check transcriptBackup
                        const { transcriptBackup } = await chrome.storage.local.get('transcriptBackup');
                        if (transcriptBackup && transcriptBackup.transcript && transcriptBackup.transcript.length > 0) {
                            console.log(`[Zoom main frame] Found backup data - Transcript: ${transcriptBackup.transcript.length} items`);
                            // Use the cached title from backup, don't extract from page
                            const titleToUse = transcriptBackup.meetingTitle || currentMeetingTitle || 'Untitled Meeting';
                            
                            // Send save message with backup data
                            await safeSendMessageAsync({
                                message: "save_on_leave",
                                transcriptArray: transcriptBackup.transcript,
                                meetingTitle: titleToUse,
                                recordingStartTime: transcriptBackup.recordingStartTime || new Date().toISOString(),
                                attendeeReport: transcriptBackup.attendeeData,
                                sessionId: currentSessionId
                            });
                        }
                    }
                }
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
        console.log("Meeting transition detected: Out -> In. Creating new session.");
        autoSaveTriggered = false;
        lastMeetingId = null;
        captionRetryInProgress = false; // Reset retry flag
        
        // Create a new session for the new meeting
        await createNewMeetingSession();
        
        // Start attendee tracking when entering meeting
        startAttendeeTracking();
        
        // Auto-enable captions for all platforms if enabled
        setTimeout(async () => {
            const { autoEnableCaptions } = await chrome.storage.sync.get('autoEnableCaptions');
            if (autoEnableCaptions) {
                console.log('[Caption Saver] Checking if captions need to be auto-enabled...');
                const captionsEnabled = platformConfig.areCaptionsEnabled ? platformConfig.areCaptionsEnabled() : false;
                
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
        
        // For Google Meet, also setup leave button listener
        if (platformConfig && platformConfig.name === 'Google Meet') {
            setupLeaveButtonListener();
        }
    }
    
    // Check caption state after all transitions
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
    
    // Note: Speaker aliases are now managed per-session in the viewer
    // No need to clear global aliases here

    capturing = true;
    wasInMeeting = true; // Ensure we know we're in a meeting when capturing starts
    currentMeetingTitle = extractMeetingTitle();
    recordingStartTime = new Date();
    
    console.log(`Capture started. Title: "${currentMeetingTitle}", Time: ${recordingStartTime.toLocaleString()}`);
    
    // Create a session if we don't have one yet
    if (!currentSessionId) {
        console.log('[Caption Saver] No session exists, creating one now...');
        await createNewMeetingSession();
    }
    
    // Update session with proper meeting title
    if (currentSessionId && currentMeetingTitle && currentMeetingTitle !== 'Untitled Meeting') {
        chrome.runtime.sendMessage({
            action: 'updateSession',
            sessionId: currentSessionId,
            data: {
                meetingTitle: currentMeetingTitle
            }
        });
    }
    
    // Start periodic backup
    startPeriodicBackup();
    
    // Start attendee tracking
    startAttendeeTracking();
    
    // For Google Meet, try to capture the user's name early
    if (platformConfig && platformConfig.name === 'Google Meet' && platformConfig.getCurrentUserName) {
        setTimeout(() => {
            const userName = platformConfig.getCurrentUserName();
            if (userName && userName !== 'You') {
                console.log('[Caption Saver] Captured user name at meeting start:', userName);
            }
        }, 2000); // Give time for UI to load
    }
    
    // Start chat capture if enabled (for platforms that support it)
    if (platformConfig && platformConfig.chatCapture?.isSupported()) {
        chrome.storage.sync.get(['chatCapture'], (result) => {
            if (result.chatCapture) {
                // console.log('[Caption Saver] Starting chat capture for', platformConfig.name);
                startChatCapture();
            }
        });
    }
    
    safeSendMessage({ message: "update_badge_status", capturing: true });
    
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
                    // Use session-based storage if we have a session ID
                    if (currentSessionId) {
                        // Update session with current data and potentially updated meeting title
                        const latestTitle = extractMeetingTitle();
                        // Update currentMeetingTitle ONLY if we found a better one AND we're still in the meeting
                        // Don't update if title is generic or if we've been redirected
                        if (latestTitle !== 'Untitled Meeting' && 
                            latestTitle !== 'Calendar' && 
                            latestTitle !== 'Microsoft Teams' &&
                            latestTitle !== 'Teams' &&
                            !latestTitle.includes('Calendar |') &&
                            latestTitle.trim() !== '' &&
                            platformConfig?.isMeetingActive?.()) {
                            currentMeetingTitle = latestTitle;
                        }
                        chrome.runtime.sendMessage({
                            action: 'updateSession',
                            sessionId: currentSessionId,
                            data: {
                                transcript: transcriptArray,
                                attendeeReport: attendeeData,
                                meetingTitle: currentMeetingTitle || 'Untitled Meeting',
                                captionCount: transcriptArray.length,
                                attendeeCount: attendeeData.allAttendees.size
                            }
                        });
                    } else {
                        // Fallback to old storage method
                        await chrome.storage.local.set({
                            transcriptBackup: {
                                transcript: transcriptArray,
                                meetingTitle: currentMeetingTitle,
                                recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : null,
                                lastBackup: new Date().toISOString(),
                                attendeeData: attendeeData
                            }
                        });
                    }
                    // console.log(`[Caption Saver] Backup saved: ${transcriptArray.length} entries`);
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
    // Always update badge to off when stopping, even if not currently capturing
    safeSendMessage({ message: "update_badge_status", capturing: false });
    
    if (!capturing) return;

    console.log("Captions turned off or meeting ended. Capture stopped. Data preserved.");
    capturing = false;
    if (observer) {
        observer.disconnect();
        observer = null;
    }
    observedElement = null;
    
    // Stop chat capture if it's running
    if (chatCaptureState.enabled) {
        stopChatCapture();
    }
    
    // Stop periodic backup
    if (backupInterval) {
        clearInterval(backupInterval);
        backupInterval = null;
    }
    
    // Final backup before stopping
    if (transcriptArray.length > 0) {
        if (currentSessionId) {
            // Update session with final data - use cached title (don't extract as page may have changed)
            const finalTitle = currentMeetingTitle || 'Untitled Meeting';
            console.log(`[Caption Saver] Saving final session data - Session: ${currentSessionId}, Title: "${finalTitle}", Captions: ${transcriptArray.length}`);
            chrome.runtime.sendMessage({
                action: 'updateSession',
                sessionId: currentSessionId,
                data: {
                    transcript: transcriptArray,
                    attendeeReport: attendeeData,
                    meetingTitle: finalTitle,
                    captionCount: transcriptArray.length,
                    attendeeCount: attendeeData.allAttendees.size,
                    status: 'ended'
                }
            });
        } else {
            // Fallback to old storage method
            chrome.storage.local.set({
                transcriptBackup: {
                    transcript: transcriptArray,
                    meetingTitle: currentMeetingTitle || 'Untitled Meeting',
                    recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : null,
                    lastBackup: new Date().toISOString(),
                    attendeeData: attendeeData
                }
            });
        }
        
        // Don't save to session history here - let auto-save handle it to prevent duplicates
    }
    
    // Stop attendee tracking
    stopAttendeeTracking();
    
    safeSendMessage({ message: "update_badge_status", capturing: false });
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
        const response = await safeSendMessageAsync({
            message: "save_session_history",
            transcriptArray: cleanTranscript,
            meetingTitle: currentMeetingTitle || extractMeetingTitle() || 'Untitled Meeting',
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
        // console.log("Auto-enable already in progress, skipping...");
        return;
    }
    
    // Prevent too frequent attempts (min 10 seconds between attempts)
    const now = Date.now();
    if (now - autoEnableLastAttempt < 10000) {
        // console.log("Auto-enable attempted too recently, skipping...");
        return;
    }
    
    autoEnableInProgress = true;
    autoEnableLastAttempt = now;
    
    try {
        // console.log("Starting auto-enable captions attempt...");
        
        // Check if platform has its own enableCaptions method (Google Meet)
        if (platformConfig && platformConfig.enableCaptions) {
            const enabled = await platformConfig.enableCaptions();
            if (enabled) {
                // console.log("Auto-enable SUCCESS: Captions enabled via platform method.");
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
        
        // console.log("Auto-enable captions attempt completed.");
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
    
    // console.log("Initializing event-driven caption system...");
    
    // Clear badge on initialization (page load/refresh)
    safeSendMessage({ message: "update_badge_status", capturing: false });
    
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
window.addEventListener('beforeunload', () => {
    // Clear badge when page is unloading
    safeSendMessage({ message: "update_badge_status", capturing: false });
    cleanupObservers();
});

// Clear badge when page visibility changes (tab switching, minimizing)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !capturing) {
        // If the page is hidden and we're not actively capturing, clear the badge
        safeSendMessage({ message: "update_badge_status", capturing: false });
    }
});

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
            
        case 'toggle_chat_capture':
            // Toggle chat capture on/off
            if (request.enabled) {
                startChatCapture();
            } else {
                stopChatCapture();
            }
            sendResponse({ success: true });
            return true;
            
        case 'get_status':
            (async () => {
                // For Zoom, prioritize responses from frames with actual meeting content
                if (platformConfig && platformConfig.name === 'Zoom') {
                    const isMainFrame = window === window.top;
                    const hasMeetingControls = !!document.querySelector('.footer-button-base__button');
                    const isInMeeting = isUserInMeeting();
                    
                    // If we're in main frame, not in meeting, and not capturing,
                    // wait a bit to let iframe respond first
                    if (isMainFrame && !isInMeeting && !capturing && !hasMeetingControls) {
                        await new Promise(resolve => setTimeout(resolve, 100));
                    }
                }
                
                const { trackCaptions } = await chrome.storage.sync.get('trackCaptions');
                const attendeeReport = await getAttendeeReport();
                const inMeeting = isUserInMeeting();
                
                // Add context info for debugging
                const isMainFrame = window === window.top;
                // console.log(`[Caption Saver] Sending status from ${isMainFrame ? 'main frame' : 'iframe'}: inMeeting=${inMeeting}, capturing=${capturing}`);
                
                sendResponse({
                    capturing: trackCaptions !== false ? capturing : false,
                    captionCount: transcriptArray.length,
                    isInMeeting: inMeeting,
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
                    // Use the cached meeting title, don't extract from page
                    const titleToUse = currentMeetingTitle || 'Untitled Meeting';
                    
                    safeSendMessage({
                        message: "download_captions",
                        transcriptArray: getCleanTranscript(),
                        meetingTitle: titleToUse,
                        format: request.format,
                        recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                        attendeeReport: attendeeReport,
                        sessionId: currentSessionId
                    });
                })();
            } else {
                alert("No data to save yet. Please wait for captions or attendees to be detected.");
            }
            break;

        case 'get_transcript_for_copying':
            sendResponse({ transcriptArray: getCleanTranscript() });
            break;
            
        case 'get_transcript_for_viewer':
            // Send current transcript to viewer for initial load
            sendResponse({ 
                transcriptArray: getCleanTranscript(),
                meetingTitle: currentMeetingTitle,
                isCapturing: capturing
            });
            break;

        case 'get_captions_for_viewing':
            // Only respond from the frame that's actually capturing
            // to avoid opening multiple tabs
            if (platformConfig && platformConfig.name === 'Zoom') {
                // For Zoom, only respond if we're capturing or have transcript data
                if (!capturing && transcriptArray.length === 0) {
                    console.log('[Caption Saver] Ignoring view request - no captions in this frame');
                    break;
                }
            }
            
            // Open the viewer with session ID for filtering live updates
            safeSendMessage({
                message: "display_captions",
                transcriptArray: getCleanTranscript(),
                meetingTitle: currentMeetingTitle,
                sessionId: currentSessionId  // Pass session ID to viewer
            });
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

// Live Caption Saver content script is running