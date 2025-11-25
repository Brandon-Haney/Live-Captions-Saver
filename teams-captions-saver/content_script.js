// --- Enhanced Debug Logging System (MeetGeek improvement #3) ---
const Logger = (function() {
    // Log levels
    const LogLevel = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3,
        NONE: 4
    };

    // Log categories for better organization
    const Category = {
        CAPTION: 'Caption',
        ATTENDEE: 'Attendee',
        CHAT: 'Chat',
        STORAGE: 'Storage',
        SESSION: 'Session',
        PLATFORM: 'Platform',
        SELECTOR: 'Selector',
        MEETING: 'Meeting',
        GENERAL: 'General'
    };

    // Default configuration - can be overridden via chrome.storage
    let config = {
        enabled: true,
        level: LogLevel.INFO, // Only show INFO and above by default
        showTimestamp: true,
        showCategory: true,
        categories: {} // Specific log level per category
    };

    // Load config from storage
    async function loadConfig() {
        try {
            const result = await chrome.storage.sync.get(['debugLogging']);
            if (result.debugLogging) {
                config = { ...config, ...result.debugLogging };
            }
        } catch (e) {
            // Silently fail - use defaults
        }
    }

    // Initialize config on load
    loadConfig();

    // Format timestamp
    function getTimestamp() {
        const now = new Date();
        return now.toLocaleTimeString('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });
    }

    // Get level name
    function getLevelName(level) {
        const names = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
        return names[level] || 'UNKNOWN';
    }

    // Core logging function
    function log(level, category, message, ...args) {
        // Check if logging is enabled
        if (!config.enabled) return;

        // Check if this log level should be displayed
        const categoryLevel = config.categories[category];
        const effectiveLevel = categoryLevel !== undefined ? categoryLevel : config.level;

        if (level < effectiveLevel) return;

        // Build log prefix
        let prefix = '[Caption Saver]';

        if (config.showTimestamp) {
            prefix += ` [${getTimestamp()}]`;
        }

        if (config.showCategory) {
            prefix += ` [${category}]`;
        }

        prefix += ` [${getLevelName(level)}]`;

        // Choose console method based on level
        const consoleMethods = [
            console.debug,  // DEBUG
            console.log,    // INFO
            console.warn,   // WARN
            console.error   // ERROR
        ];

        const consoleMethod = consoleMethods[level] || console.log;
        consoleMethod(`${prefix} ${message}`, ...args);
    }

    // Public API
    return {
        LogLevel,
        Category,

        // Configure logger
        setEnabled: (enabled) => { config.enabled = enabled; },
        setLevel: (level) => { config.level = level; },
        setCategoryLevel: (category, level) => { config.categories[category] = level; },

        // Log methods by level
        debug: (category, message, ...args) => log(LogLevel.DEBUG, category, message, ...args),
        info: (category, message, ...args) => log(LogLevel.INFO, category, message, ...args),
        warn: (category, message, ...args) => log(LogLevel.WARN, category, message, ...args),
        error: (category, message, ...args) => log(LogLevel.ERROR, category, message, ...args),

        // Shorthand for common operations
        logCaption: (message, ...args) => log(LogLevel.INFO, Category.CAPTION, message, ...args),
        logAttendee: (message, ...args) => log(LogLevel.INFO, Category.ATTENDEE, message, ...args),
        logChat: (message, ...args) => log(LogLevel.INFO, Category.CHAT, message, ...args),
        logStorage: (message, ...args) => log(LogLevel.DEBUG, Category.STORAGE, message, ...args),
        logSession: (message, ...args) => log(LogLevel.INFO, Category.SESSION, message, ...args),
        logPlatform: (message, ...args) => log(LogLevel.INFO, Category.PLATFORM, message, ...args),
        logSelector: (message, ...args) => log(LogLevel.DEBUG, Category.SELECTOR, message, ...args),
        logMeeting: (message, ...args) => log(LogLevel.INFO, Category.MEETING, message, ...args)
    };
})();

// --- Platform Detection and Configuration ---
let platformConfig = null;
let SELECTORS = {};
let sessionManager = null;
let currentSessionId = null;

// Storage quota check - prevents write failures
async function checkStorageQuota() {
    try {
        const usage = await chrome.storage.local.getBytesInUse();
        const limit = chrome.storage.local.QUOTA_BYTES;

        // Guard against division by zero if QUOTA_BYTES is undefined or 0
        if (!limit || limit === 0) {
            console.warn('[Storage] QUOTA_BYTES unavailable, assuming storage OK');
            return true;
        }

        const percentUsed = usage / limit;

        if (percentUsed >= 0.9) { // 90% threshold
            console.warn(`[Storage] Quota near limit: ${(percentUsed * 100).toFixed(1)}%`);
            return false;
        }
        return true;
    } catch (error) {
        console.error('[Storage] Failed to check quota:', error);
        return true; // Assume OK on error to not block operations
    }
}

// Helper function to acquire save lock (prevents race conditions in Zoom multi-frame scenarios)
// 5 seconds: long enough to complete typical save operations, short enough to recover from stale locks
const SAVE_LOCK_TIMEOUT_MS = 5000;

async function acquireSaveLock(sessionId) {
    const lockKey = `save_lock_${sessionId}`;
    const lockTimeout = SAVE_LOCK_TIMEOUT_MS;

    try {
        const result = await chrome.storage.local.get(lockKey);
        const existingLock = result[lockKey];

        // Check if lock exists and is still valid
        if (existingLock && (Date.now() - existingLock) < lockTimeout) {
            console.log(`[Save Lock] Lock already held for session ${sessionId}`);
            return false;
        }

        // Acquire lock
        await chrome.storage.local.set({ [lockKey]: Date.now() });
        console.log(`[Save Lock] Lock acquired for session ${sessionId}`);
        return true;
    } catch (error) {
        console.error('[Save Lock] Error acquiring lock:', error);
        return false;
    }
}

// Helper function to release save lock
async function releaseSaveLock(sessionId) {
    const lockKey = `save_lock_${sessionId}`;
    try {
        await chrome.storage.local.remove(lockKey);
        console.log(`[Save Lock] Lock released for session ${sessionId}`);
    } catch (error) {
        console.error('[Save Lock] Error releasing lock:', error);
    }
}

// Initialize platform configuration
function initializePlatform() {
    platformConfig = getCurrentPlatformConfig();
    if (!platformConfig) {
        console.error('[Caption Saver] Unsupported platform');
        return false;
    }

    // Defensive null check for selectors
    if (!platformConfig.selectors) {
        console.error('[Caption Saver] Platform config missing selectors');
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

// Session creation lock to prevent race conditions
let sessionCreationInProgress = false;

// Create a new session for a new meeting
async function createNewMeetingSession() {
    try {
        // Prevent race condition: check if session creation is already in progress
        if (sessionCreationInProgress) {
            console.log('[Caption Saver] Session creation already in progress, waiting...');
            // Wait a bit and return success (the other call will handle it)
            return true;
        }

        // Don't create a new session if we already have one
        if (currentSessionId) {
            console.log(`[Caption Saver] Session already exists: ${currentSessionId}, not creating duplicate`);
            return true;
        }

        // Acquire lock
        sessionCreationInProgress = true;

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
        
        // Preserve meeting metadata across session creation
        // Don't reset title or start time - they should persist until meeting actually ends
        // The title will be extracted/updated when entering the meeting
        // Only reset when definitively leaving the meeting (in handleMeetingStateChange)
        
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
        
        // Validate sessionId format before accepting
        if (response && response.sessionId) {
            const sessionId = response.sessionId;
            const isValidFormat = /^session_(\d+_\d+|migrated_\d+)$/.test(sessionId);
            if (!isValidFormat) {
                console.warn(`[Caption Saver] Received invalid sessionId format: ${sessionId}`);
            }
            currentSessionId = sessionId;
            console.log(`[Caption Saver] New meeting session created: ${currentSessionId}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('[Caption Saver] Failed to create new meeting session:', error);
        return false;
    } finally {
        // Always release lock
        sessionCreationInProgress = false;
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
let isCleanedUp = false; // Track cleanup state to prevent timers being set after cleanup
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

// --- Duplicate Caption Detection (Time-Windowed) ---
// Map to track recent captions: key = hash(speaker+text), value = timestamp
const recentCaptionCache = new Map();
const CAPTION_CACHE_WINDOW = 30000; // 30 seconds
let captionCacheCleanupInterval = null; // Periodic cleanup interval

// Constants for Zoom caption overlap detection
// Zoom shows overlapping text fragments as captions scroll (sliding window effect)
const ZOOM_CAPTION_CONTINUATION_MS = 10000;    // Max time (ms) between captions to be considered continuation
const ZOOM_MIN_WORD_MATCH_LENGTH = 3;          // Min consecutive words to count as substantial overlap
const ZOOM_MIN_SUBSTRING_LENGTH = 10;          // Min chars for substring overlap detection

// Clean old entries from caption cache
function cleanCaptionCache() {
    const now = Date.now();
    for (const [key, timestamp] of recentCaptionCache.entries()) {
        if (now - timestamp > CAPTION_CACHE_WINDOW) {
            recentCaptionCache.delete(key);
        }
    }
}

// Start periodic cleanup to prevent memory leak in long meetings
function startCaptionCacheCleanup() {
    if (captionCacheCleanupInterval) return;
    captionCacheCleanupInterval = setInterval(() => {
        cleanCaptionCache();
        // Stop cleanup if cache is empty (no active meeting)
        if (recentCaptionCache.size === 0) {
            clearInterval(captionCacheCleanupInterval);
            captionCacheCleanupInterval = null;
        }
    }, 60000); // Clean every 60 seconds
}

// Stop periodic cleanup
function stopCaptionCacheCleanup() {
    if (captionCacheCleanupInterval) {
        clearInterval(captionCacheCleanupInterval);
        captionCacheCleanupInterval = null;
    }
    recentCaptionCache.clear(); // Clear cache when stopping
}

// Check if caption is duplicate using time-windowed cache
function isDuplicateCaption(speakerName, captionText) {
    const hash = `${speakerName}:${captionText}`;
    const now = Date.now();

    // Ensure periodic cleanup is running
    startCaptionCacheCleanup();

    // Also clean if cache gets large (immediate cleanup)
    if (recentCaptionCache.size > 100) {
        cleanCaptionCache();
    }

    if (recentCaptionCache.has(hash)) {
        const lastSeen = recentCaptionCache.get(hash);
        if (now - lastSeen < CAPTION_CACHE_WINDOW) {
            return true; // Duplicate within time window
        }
    }

    // Not a duplicate - add to cache
    recentCaptionCache.set(hash, now);
    return false;
}

// --- Attendee Tracking State ---
let attendeeUpdateInterval = null;
let attendeeObserver = null;
let backupInterval = null;
let observerCheckInterval = null;
let meetingStateCheckInterval = null;
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
    panelCheckInterval: null,  // Track the panel monitoring interval
    currentPanel: 'unknown',
    sessionStartTime: null,  // Track when this capture session started
    initialScanComplete: false,  // Track if we've done initial scan of existing messages
    initialMessagesSkipped: 0  // Count of pre-existing messages we skipped
};

// --- Safe Message Sending Helpers ---
let contextInvalidationNotified = false;

function showContextInvalidationNotification() {
    if (contextInvalidationNotified) return; // Show only once
    contextInvalidationNotified = true;

    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #ff9800;
        color: white;
        padding: 16px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 999999;
        font-family: Arial, sans-serif;
        font-size: 14px;
        max-width: 350px;
    `;
    notification.innerHTML = `
        <strong>Live Captions Saver</strong><br>
        Extension was updated. Please refresh this page to continue capturing captions.
        <button id="lcs-refresh-btn" style="
            margin-top: 8px;
            background: white;
            color: #ff9800;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        ">Refresh Page</button>
    `;
    document.body.appendChild(notification);

    // Add click handler after element is in DOM (CSP-compliant)
    const refreshBtn = document.getElementById('lcs-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => location.reload());
    }

    // Auto-remove after 30 seconds
    setTimeout(() => {
        notification.remove();
    }, 30000);
}

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
                // Check for context invalidation
                if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
                    showContextInvalidationNotification();
                }
                return;
            }
            if (callback) {
                callback(response);
            }
        });
    } catch (error) {
        // Extension context invalidated or runtime not available
        if (error.message?.includes('Extension context invalidated')) {
            showContextInvalidationNotification();
        }
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
                    // Check for context invalidation
                    if (chrome.runtime.lastError.message?.includes('Extension context invalidated')) {
                        showContextInvalidationNotification();
                    }
                    resolve(null);
                } else {
                    resolve(response);
                }
            });
        } catch (error) {
            if (error.message?.includes('Extension context invalidated')) {
                showContextInvalidationNotification();
            }
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
    /**
     * Log an error with context information
     * @param {Error|string} error - The error to log
     * @param {string} context - Description of where the error occurred
     * @param {boolean} silent - If true, only log to console without notifying service worker.
     *                          Console logging always happens for debugging; silent just prevents
     *                          message propagation to avoid cascading errors during cleanup.
     */
    static log(error, context = '', silent = false) {
        const timestamp = new Date().toISOString();
        const errorInfo = {
            timestamp,
            context,
            message: error?.message || String(error),
            stack: error?.stack,
            url: window.location.href
        };

        // Always log to console for debugging
        const errorMessage = errorInfo.message || 'Unknown error';
        if (errorInfo.stack) {
            console.error(`[Live Caption Saver] ${context}: ${errorMessage}\nStack:`, errorInfo.stack);
        } else {
            console.error(`[Live Caption Saver] ${context}: ${errorMessage}`);
        }

        if (!silent) {
            // Only notify service worker when not in silent mode
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

// Create shallow copy before mapping to prevent issues from concurrent mutation
const getCleanTranscript = () => [...transcriptArray].map(({ key, ...rest }) => rest);

// Sanitize attendee/speaker names from DOM to prevent XSS and normalize whitespace
function sanitizeNameFromDOM(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';

    return rawName
        .replace(/<[^>]*>/g, '')           // Strip HTML tags
        .replace(/[\x00-\x1F\x7F]/g, '')   // Remove control characters
        .replace(/\s+/g, ' ')              // Normalize whitespace
        .trim()
        .substring(0, 100);                // Limit length to prevent DoS
}

// --- Timestamp Formatting ---
let timestampFormat = '12hr'; // Default format

// Load timestamp format from storage
chrome.storage.sync.get('timestampFormat').then(result => {
    if (result.timestampFormat) {
        timestampFormat = result.timestampFormat;
    }
}).catch(error => {
    // Silently use default if storage read fails
    console.warn('[Caption Saver] Could not load timestamp format, using default:', error.message);
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

// Format a specific timestamp (for chat messages with actual timestamp)
function formatTimestamp(date) {
    switch(timestampFormat) {
        case '24hr':
            return date.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        case 'relative':
            if (recordingStartTime) {
                const elapsed = Math.floor((date - recordingStartTime) / 1000);
                const hours = Math.floor(elapsed / 3600);
                const minutes = Math.floor((elapsed % 3600) / 60);
                const seconds = elapsed % 60;
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            }
            // Fall back to 12hr if no recording start time
        case '12hr':
        default:
            return date.toLocaleTimeString('en-US', {
                hour12: true,
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit'
            });
    }
}

// --- DOM Element Caching with Selector Fallbacks (MeetGeek improvement #2) ---

/**
 * Helper function to query elements with fallback selectors
 * @param {string|Array<string>} selectorOrArray - Single selector or array of fallback selectors
 * @param {Document|Element} root - Root element to query from (defaults to document)
 * @returns {Element|null} First matching element or null
 */
function queryElementWithFallbacks(selectorOrArray, root = document) {
    // Handle null/undefined selectors
    if (!selectorOrArray) return null;

    // If it's a string (single selector), use it directly
    if (typeof selectorOrArray === 'string') {
        return root.querySelector(selectorOrArray);
    }

    // If it's an array, try each selector in order
    if (Array.isArray(selectorOrArray)) {
        for (const selector of selectorOrArray) {
            if (!selector) continue; // Skip null/undefined entries
            const element = root.querySelector(selector);
            if (element) {
                Logger.logSelector(`Selector fallback: found element with '${selector}'`);
                return element;
            }
        }
    }

    return null;
}

/**
 * Get cached element with fallback selector support
 * @param {string|Array<string>} selectorOrArray - Single selector or array of fallback selectors
 * @param {number} expiry - Cache expiry time in milliseconds
 * @returns {Element|null} Cached or newly found element
 */
function getCachedElement(selectorOrArray, expiry = 5000) {
    const now = Date.now();

    // Create cache key from selector(s)
    const cacheKey = Array.isArray(selectorOrArray)
        ? selectorOrArray.join('||')
        : selectorOrArray;

    const cached = cachedElements.get(cacheKey);

    // Enhanced staleness check:
    // - Check if cache entry exists and is not expired
    // - Check document.contains() for basic containment
    // - Check isConnected for proper DOM attachment (handles React re-renders)
    // - Check parentNode to ensure element hasn't been detached
    if (cached &&
        (now - cached.timestamp) < expiry &&
        cached.element &&
        cached.element.isConnected &&
        document.contains(cached.element) &&
        cached.element.parentNode) {
        return cached.element;
    }

    // Use the fallback-aware query function
    const element = queryElementWithFallbacks(selectorOrArray);

    if (element) {
        cachedElements.set(cacheKey, { element, timestamp: now });
    }

    return element;
}

/**
 * Helper function to query all elements with fallback selectors
 * @param {string|Array<string>} selectorOrArray - Single selector or array of fallback selectors
 * @param {Document|Element} root - Root element to query from (defaults to document)
 * @returns {NodeList|Array} NodeList of matching elements or empty array
 */
function queryAllElementsWithFallbacks(selectorOrArray, root = document) {
    // Handle null/undefined selectors
    if (!selectorOrArray) return [];

    // If it's a string (single selector), use it directly
    if (typeof selectorOrArray === 'string') {
        return root.querySelectorAll(selectorOrArray);
    }

    // If it's an array, try each selector in order
    if (Array.isArray(selectorOrArray)) {
        for (const selector of selectorOrArray) {
            if (!selector) continue; // Skip null/undefined entries
            const elements = root.querySelectorAll(selector);
            if (elements && elements.length > 0) {
                Logger.logSelector(`Selector fallback (querySelectorAll): found ${elements.length} elements with '${selector}'`);
                return elements;
            }
        }
    }

    return [];
}

function clearElementCache() {
    cachedElements.clear();
}

// --- Health Check System (MeetGeek improvement #4) ---
const HealthCheck = (function() {
    // Health check state
    const state = {
        lastCaptionTime: null,
        lastHealthCheck: null,
        captionStuckWarningShown: false,
        selectorFailureCount: 0,
        consecutiveFailures: 0,
        isHealthy: true,
        issues: []
    };

    // Health check thresholds
    const THRESHOLDS = {
        CAPTION_TIMEOUT: 5 * 60 * 1000,  // 5 minutes without captions
        MAX_SELECTOR_FAILURES: 10,        // Max consecutive selector failures
        HEALTH_CHECK_INTERVAL: 30 * 1000  // Check every 30 seconds
    };

    // Record that a caption was successfully captured
    function recordCaptionCapture() {
        state.lastCaptionTime = Date.now();
        state.consecutiveFailures = 0;
        state.captionStuckWarningShown = false;

        // If we were unhealthy, mark as recovered
        if (!state.isHealthy) {
            Logger.info(Logger.Category.GENERAL, 'Health check: Caption capture recovered');
            state.isHealthy = true;
            state.issues = [];
        }
    }

    // Record a selector failure
    function recordSelectorFailure(selector) {
        state.selectorFailureCount++;
        state.consecutiveFailures++;
        Logger.warn(Logger.Category.SELECTOR, `Selector failure: ${selector} (consecutive: ${state.consecutiveFailures})`);
    }

    // Reset selector failure count (call when selector succeeds)
    function resetSelectorFailures() {
        if (state.consecutiveFailures > 0) {
            Logger.debug(Logger.Category.SELECTOR, `Selector recovered after ${state.consecutiveFailures} failures`);
            state.consecutiveFailures = 0;
        }
    }

    // Check if caption capture is stuck
    function checkCaptionHealth() {
        if (!state.lastCaptionTime) {
            // No captions captured yet - this is normal at start
            return true;
        }

        const timeSinceLastCaption = Date.now() - state.lastCaptionTime;

        // Only check if we're in a meeting
        if (!isUserInMeeting()) {
            return true;
        }

        // If it's been too long since last caption
        if (timeSinceLastCaption > THRESHOLDS.CAPTION_TIMEOUT) {
            if (!state.captionStuckWarningShown) {
                Logger.warn(Logger.Category.CAPTION, `No captions captured in ${Math.floor(timeSinceLastCaption / 1000 / 60)} minutes`);
                state.captionStuckWarningShown = true;
                state.issues.push('No captions captured recently');
                return false;
            }
        }

        return true;
    }

    // Check if critical selectors are still working
    function checkSelectorHealth() {
        if (!platformConfig || !SELECTORS) {
            return true;
        }

        // Check if caption container can be found
        const captionsContainer = getCachedElement(SELECTORS.captionsContainer);
        if (!captionsContainer && isUserInMeeting()) {
            recordSelectorFailure('captionsContainer');

            if (state.consecutiveFailures >= THRESHOLDS.MAX_SELECTOR_FAILURES) {
                Logger.error(Logger.Category.SELECTOR, 'Critical: Caption container selector failing repeatedly');
                state.issues.push('Cannot find caption container');
                return false;
            }
        } else if (captionsContainer) {
            resetSelectorFailures();
        }

        return true;
    }

    // Run comprehensive health check
    function runHealthCheck() {
        state.lastHealthCheck = Date.now();
        state.issues = [];

        const captionHealthy = checkCaptionHealth();
        const selectorHealthy = checkSelectorHealth();

        const wasHealthy = state.isHealthy;
        state.isHealthy = captionHealthy && selectorHealthy;

        // Log health status change
        if (wasHealthy && !state.isHealthy) {
            Logger.error(Logger.Category.GENERAL, 'Health check FAILED', state.issues);
        } else if (!wasHealthy && state.isHealthy) {
            Logger.info(Logger.Category.GENERAL, 'Health check RECOVERED');
        }

        return state.isHealthy;
    }

    // Get current health status
    function getHealthStatus() {
        return {
            isHealthy: state.isHealthy,
            issues: [...state.issues],
            lastCaptionTime: state.lastCaptionTime,
            timeSinceLastCaption: state.lastCaptionTime ? Date.now() - state.lastCaptionTime : null,
            selectorFailureCount: state.selectorFailureCount,
            consecutiveFailures: state.consecutiveFailures
        };
    }

    // Start periodic health checks
    function startHealthMonitoring() {
        Logger.info(Logger.Category.GENERAL, 'Starting health monitoring system');

        setInterval(() => {
            if (isUserInMeeting()) {
                runHealthCheck();
            }
        }, THRESHOLDS.HEALTH_CHECK_INTERVAL);
    }

    // Public API
    return {
        recordCaptionCapture,
        recordSelectorFailure,
        resetSelectorFailures,
        runHealthCheck,
        getHealthStatus,
        startHealthMonitoring
    };
})();

const isUserInMeeting = () => {
    if (!platformConfig || !platformConfig.isMeetingActive) return false;

    try {
        const inMeeting = platformConfig.isMeetingActive();

        // Debug logging for Zoom
        if (platformConfig.name === 'Zoom' && wasInMeeting !== inMeeting) {
            // console.log(`[Caption Saver] Zoom meeting state changed: ${wasInMeeting} -> ${inMeeting}`);
        }

        return inMeeting;
    } catch (error) {
        console.error('[Caption Saver] Error checking meeting state:', error);
        return false;
    }
};

// Helper function to find common prefix length between two strings
function getCommonPrefixLength(str1, str2) {
    let i = 0;
    while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
        i++;
    }
    return i;
}

// Helper function to find common suffix length between two strings
function getCommonSuffixLength(str1, str2) {
    let i = 0;
    const len1 = str1.length;
    const len2 = str2.length;
    while (i < len1 && i < len2 && str1[len1 - 1 - i] === str2[len2 - 1 - i]) {
        i++;
    }
    return i;
}

// --- Core Logic ---
const processCaptionUpdates = ErrorHandler.wrap(function() {
    if (!platformConfig) return;

    const closedCaptionsContainer = getCachedElement(SELECTORS.captionsContainer);
    if (!closedCaptionsContainer) return;

    // For Zoom, check for the live transcription element directly
    let transcriptElements;
    if (platformConfig.name === 'Zoom') {
        // Look for the live transcription subtitle box directly, not cached
        const liveBox = document.querySelector('.live-transcription-subtitle__box');
        if (liveBox) {
            transcriptElements = [liveBox];
        } else {
            transcriptElements = [];
        }
    } else {
        // Use fallback-aware query function (MeetGeek improvement #2)
        transcriptElements = queryAllElementsWithFallbacks(SELECTORS.captionBlock, closedCaptionsContainer);
    }

    transcriptElements.forEach(element => {
        try {
            // Defensive null check for element
            if (!element) {
                return;
            }

            // Defensive null check for platformConfig and its methods
            if (!platformConfig || !platformConfig.getCaptionData) {
                console.error('[Caption Processing] Platform config or getCaptionData method missing');
                return;
            }

            const captionData = platformConfig.getCaptionData(element);
            if (!captionData) return;

            // Use the formatted timestamp if Time is not provided correctly
            const { Name: name, Text: text } = captionData;
            const time = getFormattedTimestamp(); // Always use our formatted timestamp
            if (text.length === 0) return;

            let captionId = element.getAttribute ? element.getAttribute('data-caption-id') : null;
            
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
                    (now - new Date(transcriptArray[lastCaptionIndex].timestamp)) < ZOOM_CAPTION_CONTINUATION_MS;

                // Check for exact duplicates using time-windowed cache
                // This handles rapid speakers better than checking last 10 captions
                if (isDuplicateCaption(name, text)) {
                    console.log(`[Zoom] Skipping duplicate caption: "${text.substring(0, 30)}..."`);
                    return;
                }

                if (isContinuation) {
                    const lastText = transcriptArray[lastCaptionIndex].Text;

                    // **SIMPLIFIED ZOOM LOGIC**: For Zoom, we need to be much more aggressive
                    // Zoom shows overlapping text fragments as captions scroll
                    // Examples of what we need to handle:
                    // "Testing, testing" -> "Testing, testing…" -> "Testing, testing… Test line number 2."
                    // "Test line number 2. Test line number 3." -> "Test line number 3. Test line number 4?"

                    // Check if the texts have any substantial overlap (more than just a word or two)
                    const wordsInCommon = [];
                    const lastWords = lastText.split(' ');
                    const newWords = text.split(' ');

                    // Find longest common substring of words
                    for (let i = 0; i < lastWords.length; i++) {
                        for (let j = 0; j < newWords.length; j++) {
                            if (lastWords[i] === newWords[j]) {
                                // Check how many consecutive words match
                                let matchLength = 0;
                                while (i + matchLength < lastWords.length &&
                                       j + matchLength < newWords.length &&
                                       lastWords[i + matchLength] === newWords[j + matchLength]) {
                                    matchLength++;
                                }
                                if (matchLength >= ZOOM_MIN_WORD_MATCH_LENGTH) {
                                    wordsInCommon.push(matchLength);
                                }
                            }
                        }
                    }

                    const hasSubstantialOverlap = wordsInCommon.length > 0 && Math.max(...wordsInCommon) >= ZOOM_MIN_WORD_MATCH_LENGTH;

                    // Check if new text contains substantial portion of old text
                    // This catches cases like: "Testing, testing" -> "Testing, testing… Test line"
                    const substringOverlap = lastText.length > ZOOM_MIN_SUBSTRING_LENGTH && text.includes(lastText.substring(0, lastText.length - 5));

                    // Check if old text is contained within new text (direct extension)
                    // This catches: "Test number 5." -> "Test number 5. Test number 6."
                    const isDirectExtension = text.includes(lastText.trim());

                    // For shifted windows, check if end of last appears in new
                    // This catches: "Test 2. Test 3." -> "Test 3. Test 4."
                    const lastSentences = lastText.split('.').filter(s => s.trim());
                    const newSentences = text.split('.').filter(s => s.trim());
                    let hasShiftedContent = false;
                    if (lastSentences.length > 0 && newSentences.length > 0) {
                        const lastEndSentence = lastSentences[lastSentences.length - 1].trim();
                        hasShiftedContent = newSentences.some(s => s.trim().includes(lastEndSentence) || lastEndSentence.includes(s.trim()));
                    }

                    // Debug logging for Zoom caption detection (uncomment to debug)
                    if (window.debugZoomCaptions) {
                        console.log('[Zoom Caption Debug]', {
                            lastText: lastText.substring(0, 50),
                            newText: text.substring(0, 50),
                            isDirectExtension,
                            hasSubstantialOverlap,
                            substringOverlap,
                            hasShiftedContent
                        });
                    }

                    // **KEY DECISION**: If there's ANY significant overlap, treat as update
                    // This is critical for Zoom which shows overlapping fragments
                    if (isDirectExtension || hasSubstantialOverlap || substringOverlap || hasShiftedContent) {
                        // This is an update/continuation of the same caption
                        // Reuse the existing caption's key to update it in place
                        captionId = transcriptArray[lastCaptionIndex].key;

                        // Log the update for debugging
                        if (window.debugZoomCaptions) {
                            console.log(`[Zoom] Updating caption ${captionId}: "${text.substring(0, 50)}..."`);
                        }
                    } else {
                        // This is truly a new sentence from the same speaker (no overlap)
                        captionId = `caption_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

                        if (window.debugZoomCaptions) {
                            console.log(`[Zoom] New caption ${captionId}: "${text.substring(0, 50)}..."`);
                        }
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

                        // Log if capturing while hidden (helps diagnose lock screen behavior)
                        if (document.hidden) {
                            console.log('[Caption Saver] ✓ Captured caption while page HIDDEN:', text.substring(0, 50));
                        }

                        // Record caption capture for health monitoring (MeetGeek improvement #4)
                        HealthCheck.recordCaptionCapture();

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

                // Log if capturing while hidden (helps diagnose lock screen behavior)
                if (document.hidden) {
                    console.log('[Caption Saver] ✓ Captured caption while page HIDDEN:', text.substring(0, 50));
                }

                // Record caption capture for health monitoring (MeetGeek improvement #4)
                HealthCheck.recordCaptionCapture();

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
    // Create shallow copy before mapping to prevent issues from concurrent mutation
    const speakers = [...new Set([...transcriptArray].map(item => item.Name))];
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
    // console.log(`Attendee update from transcript. Speakers found: ${speakers.length}`);
}
function updateAttendeeList() {
    try {
        // Platform-specific attendee list selector
        const attendeeListSelector = SELECTORS.attendeeList || SELECTORS.ATTENDEE_TREE;
        const attendeeTree = document.querySelector(attendeeListSelector);
        if (!attendeeTree) {
            if (platformConfig?.name === 'Zoom') {
                // console.log(`[Zoom] Attendee list not found with selector: ${attendeeListSelector}`);
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
        const currentTimestamp = Date.now(); // Use numeric timestamp for reliable comparison

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
                // Fallback to generic extraction with selector fallback support (MeetGeek improvement #2)
                const nameElement = queryElementWithFallbacks(
                    SELECTORS.attendeeName || SELECTORS.ATTENDEE_NAME || '.participant-name, .attendee-name',
                    item
                );
                const roleElement = queryElementWithFallbacks(
                    SELECTORS.attendeeRole || SELECTORS.ATTENDEE_ROLE || '.participant-role, .attendee-role',
                    item
                );
                
                if (nameElement) {
                    attendeeInfo = {
                        name: sanitizeNameFromDOM(nameElement.textContent),
                        role: roleElement ? sanitizeNameFromDOM(roleElement.textContent) : 'Attendee'
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
                
                // Check if this is a rejoin (was in previousAttendees but left)
                const wasPresent = previousAttendees.has(cleanName);
                const isRejoin = attendeeData.allAttendees.has(cleanName) && !wasPresent;

                // Add to current attendees
                attendeeData.currentAttendees.set(cleanName, role);

                // Track in all attendees (for first time join)
                const isFirstJoin = !attendeeData.allAttendees.has(cleanName);
                if (isFirstJoin) {
                    attendeeData.allAttendees.add(cleanName);
                }

                // Broadcast join event for both first joins AND rejoins
                if (isFirstJoin || isRejoin) {
                    // Check for duplicate join event in recent history (within last 5 seconds)
                    // Use numeric timestamp for reliable comparison
                    const recentJoin = attendeeData.attendeeHistory
                        .slice(-10) // Check last 10 events
                        .find(event =>
                            event.name === cleanName &&
                            event.action === 'joined' &&
                            event.timestamp && (currentTimestamp - event.timestamp) < 5000 // Within 5 seconds
                        );

                    if (recentJoin) {
                        // Skip duplicate join event
                        console.log(`Skipping duplicate join event for ${cleanName}`);
                    } else {
                        // Add to history
                        const joinEvent = {
                            name: cleanName,
                            role,
                            action: 'joined',
                            time: currentTime,
                            timestamp: currentTimestamp // Store numeric timestamp for comparison
                        };
                        attendeeData.attendeeHistory.push(joinEvent);

                        const logMessage = isRejoin ? `Attendee rejoined: ${cleanName} (${role})` : `New attendee detected: ${cleanName} (${role})`;
                        console.log(logMessage);

                        // Broadcast join event to viewer
                        broadcastCaptionUpdate({
                            type: 'new',
                            caption: {
                                Name: cleanName,
                                Text: `joined the meeting${role ? ' (' + role + ')' : ''}`,
                                Time: currentTime,
                                Type: 'attendance',
                                action: 'joined',
                                key: `attendance_${Date.now()}_${cleanName}`
                            }
                        });
                    }
                }
            }
        });
        
        // Check for attendees who left
        previousAttendees.forEach(name => {
            if (!attendeeData.currentAttendees.has(name)) {
                // Check for duplicate leave event in recent history (within last 5 seconds)
                // Use numeric timestamp for reliable comparison
                const recentLeave = attendeeData.attendeeHistory
                    .slice(-10) // Check last 10 events
                    .find(event =>
                        event.name === name &&
                        event.action === 'left' &&
                        event.timestamp && (currentTimestamp - event.timestamp) < 5000 // Within 5 seconds
                    );

                if (recentLeave) {
                    // Skip duplicate leave event
                    console.log(`Skipping duplicate leave event for ${name}`);
                } else {
                    const leaveEvent = {
                        name,
                        action: 'left',
                        time: currentTime,
                        timestamp: currentTimestamp // Store numeric timestamp for comparison
                    };
                    attendeeData.attendeeHistory.push(leaveEvent);
                    console.log(`Attendee left: ${name}`);

                    // Broadcast leave event to viewer
                    broadcastCaptionUpdate({
                        type: 'new',
                        caption: {
                            Name: name,
                            Text: 'left the meeting',
                            Time: currentTime,
                            Type: 'attendance',
                            action: 'left',
                            key: `attendance_${Date.now()}_${name}`
                        }
                    });
                }
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
    const { trackAttendees } = await chrome.storage.sync.get(['trackAttendees']);
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
            // For Zoom, always try to extract attendees from transcript
            // Since participant panel may not be reliably available
            console.log('[Attendee Tracking] Zoom - using transcript-based attendee tracking');

            // Try to open participant panel automatically
            const opened = await tryOpenParticipantPanel();
            if (opened) {
                console.log('[Attendee Tracking] Zoom participant panel opened');
                await delay(2000); // Give panel more time to populate
                updateAttendeeList(); // Try to get from panel
            }

            // ALWAYS check transcript for speakers - this is more reliable for Zoom
            updateAttendeesFromTranscript();
        } else {
            // Teams logic - check if chat capture is enabled to avoid conflicts
            const { chatCapture } = await chrome.storage.sync.get(['chatCapture']);

            // Auto-open participant panel if chat capture is disabled
            // Default to chat capture enabled (chatCapture !== false) to match popup behavior
            if (chatCapture === false) {
                await tryOpenParticipantPanel();
            } else {
                console.log("Chat capture is enabled - skipping auto-open attendees to avoid panel conflicts");
            }

            updateAttendeeList();
        }

        // Setup continuous observer for real-time updates
        // Try to setup observer, retry if not ready
        setTimeout(() => {
            if (!setupAttendeeObserver()) {
                // Retry after 2 seconds if attendee list not found
                setTimeout(() => {
                    setupAttendeeObserver();
                }, 2000);
            }
        }, 1000);

        // Keep interval as backup for cases where observer might miss changes
        // But increase interval since observer handles most updates
        attendeeUpdateInterval = setInterval(updateAttendeeList, TIMING.ATTENDEE_UPDATE_INTERVAL * 5); // Every 5 minutes instead of 1
    }, TIMING.INITIAL_ATTENDEE_DELAY);
}

function setupAttendeeObserver() {
    // Disconnect existing observer if any
    if (attendeeObserver) {
        attendeeObserver.disconnect();
        attendeeObserver = null;
    }

    // Get the attendee list container
    const attendeeListSelector = SELECTORS.attendeeList || SELECTORS.ATTENDEE_TREE;
    const attendeeListContainer = document.querySelector(attendeeListSelector);

    if (!attendeeListContainer) {
        console.log('[Attendee Observer] Attendee list container not found, will retry...');
        return false;
    }

    // Create observer to watch for changes
    attendeeObserver = new MutationObserver((mutations) => {
        // Debounce updates - only update if we see actual changes to attendee items
        const hasRelevantChanges = mutations.some(mutation => {
            // Check if added/removed nodes are attendee items
            const attendeeItemSelector = SELECTORS.attendeeItem || SELECTORS.ATTENDEE_ITEM;

            if (mutation.addedNodes.length > 0) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node.matches?.(attendeeItemSelector) || node.querySelector?.(attendeeItemSelector))) {
                        return true;
                    }
                }
            }

            if (mutation.removedNodes.length > 0) {
                for (let node of mutation.removedNodes) {
                    if (node.nodeType === 1 && (node.matches?.(attendeeItemSelector) || node.querySelector?.(attendeeItemSelector))) {
                        return true;
                    }
                }
            }

            return false;
        });

        if (hasRelevantChanges) {
            console.log('[Attendee Observer] Detected attendee list change, updating...');
            updateAttendeeList();
        }
    });

    // Start observing with appropriate options
    attendeeObserver.observe(attendeeListContainer, {
        childList: true,      // Watch for added/removed children
        subtree: true,        // Watch all descendants
        attributes: false     // Don't watch attribute changes (performance)
    });

    console.log('[Attendee Observer] Successfully setup observer on attendee list');
    return true;
}

function stopAttendeeTracking() {
    if (attendeeUpdateInterval) {
        clearInterval(attendeeUpdateInterval);
        attendeeUpdateInterval = null;
        console.log("Stopped attendee tracking interval");
    }

    if (attendeeObserver) {
        attendeeObserver.disconnect();
        attendeeObserver = null;
        console.log("Stopped attendee observer");
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
        // Always prioritize transcript-based attendees for Zoom
        updateAttendeesFromTranscript(); // Primary source: transcript speakers
        updateAttendeeList(); // Secondary source: participant panel (if available)
        await delay(100); // Small delay to ensure updates complete

        // If still no attendees, extract from current transcript
        if (attendeeData.allAttendees.size === 0 && transcriptArray.length > 0) {
            console.log('[Attendee Tracking] Zoom - No attendees found, extracting from transcript');
            const speakers = new Set();
            transcriptArray.forEach(item => {
                if (item.Name && item.Name !== 'Unknown Speaker') {
                    speakers.add(item.Name);
                }
            });
            speakers.forEach(name => {
                attendeeData.allAttendees.add(name);
            });
            console.log(`[Attendee Tracking] Extracted ${attendeeData.allAttendees.size} attendees from transcript`);
        }
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
        // console.log(`[Zoom] Attendee report generated: ${report.totalUniqueAttendees} attendees`, report.attendeeList);
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

    // Defensive null check for chat capture methods
    if (!platformConfig.chatCapture.getChatMessages || !platformConfig.chatCapture.getChatMessageData) {
        console.error('[Chat Capture] Required chat capture methods missing');
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

        // Filter out messages that are older than session start time
        // This prevents capturing old messages from recurring meetings
        if (messageData.timestamp && chatCaptureState.sessionStartTime) {
            const sessionStartMs = chatCaptureState.sessionStartTime.getTime();
            // Allow 30 second buffer before session start (for timing variations)
            const bufferMs = 30000;
            if (messageData.timestamp < (sessionStartMs - bufferMs)) {
                // This is an old message from before we joined - skip it
                chatCaptureState.capturedMessageIds.add(messageData.id);
                skippedCount++;
                console.log(`[Chat Capture] Skipping old message from ${new Date(messageData.timestamp).toLocaleString()} (before session start ${chatCaptureState.sessionStartTime.toLocaleString()})`);
                return;
            }
        }

        // During initial scan, mark all messages as "seen" but don't add to transcript
        if (skipInitialMessages) {
            chatCaptureState.capturedMessageIds.add(messageData.id);
            skippedCount++;
            return;
        }
        
        // Create chat message with consistent format
        // Use the actual message timestamp from messageData for chronological sorting
        let messageTime = messageData.timestamp ? new Date(messageData.timestamp) : new Date();

        // Validate that the Date object is valid, fallback to current time if not
        if (isNaN(messageTime.getTime())) {
            console.warn(`[Chat Capture] Invalid timestamp for message ${messageData.id}, using current time`);
            messageTime = new Date();
        }

        const chatMessage = {
            Name: messageData.author,
            Text: messageData.text,
            Time: formatTimestamp(messageTime), // Format the message's actual timestamp
            timestamp: messageTime.toISOString(), // ISO format for sorting in service worker
            Type: 'chat',  // Mark as chat message
            key: `chat_${messageData.id}`
        };

        // Add attachments if present
        if (messageData.attachments && messageData.attachments.length > 0) {
            chatMessage.attachments = messageData.attachments;
            console.log(`[Chat Capture] Message has ${messageData.attachments.length} attachments:`, messageData.attachments);

            // Append attachment indicators to text for exports
            const attachmentText = messageData.attachments.map(att =>
                `[Image: ${att.filename || 'attachment'}]`
            ).join(' ');

            // Only append if not already in text
            if (!chatMessage.Text.includes('[Image:')) {
                chatMessage.Text = chatMessage.Text ?
                    `${chatMessage.Text} ${attachmentText}` : attachmentText;
            }
        }

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

// Track typing postponement to prevent infinite recursion
let typingPostponeCount = 0;
const MAX_TYPING_POSTPONE = 30; // Max ~30 seconds of postponement at 1s intervals

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
        typingPostponeCount++;
        // Prevent infinite postponement - after max attempts, proceed anyway
        if (typingPostponeCount < MAX_TYPING_POSTPONE) {
            // Silently postpone without logging (reduces console spam when tab is inactive)
            setTimeout(performHybridRotation, TIMING.TYPING_RECHECK_DELAY);
            return;
        }
        // Reset counter and proceed with rotation
        console.log('[Chat Capture] Max typing postponement reached, proceeding with rotation');
    }
    typingPostponeCount = 0; // Reset counter when proceeding

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

            // Set up continuous chat monitoring (store interval for cleanup)
            if (chatCaptureState.panelCheckInterval) {
                clearInterval(chatCaptureState.panelCheckInterval);
            }
            chatCaptureState.panelCheckInterval = setInterval(() => {
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
    if (chatCaptureState.panelCheckInterval) {
        clearInterval(chatCaptureState.panelCheckInterval);
        chatCaptureState.panelCheckInterval = null;
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
            if (document.hidden) {
                console.log('[Caption Saver] Tab became HIDDEN - captions may stop updating if Teams stops rendering');
                console.log('[Caption Saver] Current transcript count:', transcriptArray.length);
            } else {
                console.log('[Caption Saver] Tab became VISIBLE, rechecking meeting state');
                console.log('[Caption Saver] Transcript count after being hidden:', transcriptArray.length);
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

    // Performance: Watch a more specific container instead of entire document.body
    // Try to find the calling controls container first, fall back to body
    let targetElement = document.body;
    if (platformConfig && platformConfig.name === 'Microsoft Teams') {
        targetElement = document.querySelector('[data-tid="calling-toolbar"], [data-tid="calling-controls-container"]') || document.body;
    } else if (platformConfig && platformConfig.name === 'Google Meet') {
        targetElement = document.querySelector('[data-meeting-controls], .Vw0THd') || document.body;
    } else if (platformConfig && platformConfig.name === 'Zoom') {
        targetElement = document.querySelector('.meeting-client-inner, .meeting-app') || document.body;
    }

    captionsObserver.observe(targetElement, {
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
    
    // Check for meeting start (important for Zoom which may load directly into a meeting)
    if (!wasInMeeting && nowInMeeting) {
        const isMainFrame = window === window.top;

        // For Zoom, only let the frame that will capture captions create the session
        // Main frame should not create sessions since it won't have captions
        if (platformConfig && platformConfig.name === 'Zoom' && isMainFrame) {
            console.log("[Zoom Main Frame] Meeting started but not creating session - iframe will handle it");
            wasInMeeting = nowInMeeting;
            return;
        }

        // Reset auto-save state when joining a new meeting
        console.log(`Meeting transition detected: Out -> In. ${isMainFrame ? '(Main Frame)' : '(Iframe)'}`);
        autoSaveTriggered = false;
        lastMeetingId = null;
        captionRetryInProgress = false; // Reset retry flag

        // Only create a new session if we don't already have one
        if (!currentSessionId) {
            console.log(`Creating new session for meeting ${isMainFrame ? '(Main Frame)' : '(Iframe)'}`);
            await createNewMeetingSession();
        } else {
            console.log(`Session already exists: ${currentSessionId}, not creating a new one.`);
        }

        // Start attendee tracking when entering meeting
        startAttendeeTracking();

        // Auto-enable captions for all platforms if enabled
        setTimeout(async () => {
            const { autoEnableCaptions } = await chrome.storage.sync.get('autoEnableCaptions');
            if (autoEnableCaptions) {
                console.log('[Caption Saver] Checking if captions need to be auto-enabled...');
                const captionsEnabled = (platformConfig && platformConfig.areCaptionsEnabled) ? platformConfig.areCaptionsEnabled() : false;

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
    } else if (wasInMeeting && !nowInMeeting) {
        const isMainFrame = window === window.top;

        // For Zoom, coordinate between frames - only the frame with captions should save
        if (platformConfig && platformConfig.name === 'Zoom') {
            // If we're the main frame and have no captions, check for saved data from iframe
            if (isMainFrame && transcriptArray.length === 0) {
                console.log(`[Zoom Main Frame] Meeting ended but no captions in main frame - checking for iframe data`);

                // Wait a moment for iframe to save data
                await new Promise(resolve => setTimeout(resolve, 500));

                // Check for saved transcript from iframe or backup
                const { transcriptBackup, zoomMeetingEnded } = await chrome.storage.local.get(['transcriptBackup', 'zoomMeetingEnded']);
                console.log(`[Zoom Main Frame] Storage check - zoomMeetingEnded: ${!!zoomMeetingEnded}, transcriptBackup: ${!!transcriptBackup}`);
                if (transcriptBackup) {
                    console.log(`[Zoom Main Frame] transcriptBackup has ${transcriptBackup.transcript?.length || 0} captions from ${transcriptBackup.frameType || 'unknown'} frame`);
                }

                if (zoomMeetingEnded && zoomMeetingEnded.transcript && zoomMeetingEnded.transcript.length > 0) {
                    console.log(`[Zoom Main Frame] Found iframe saved data with ${zoomMeetingEnded.transcript.length} captions`);
                    // Iframe saved data, trigger auto-save from main frame
                    const { autoSaveOnEnd } = await chrome.storage.sync.get('autoSaveOnEnd');
                    if (autoSaveOnEnd) {
                        console.log('[Zoom Main Frame] Triggering auto-save with iframe data');
                        await safeSendMessageAsync({ message: "zoom_meeting_ended" });
                    }
                } else if (transcriptBackup && transcriptBackup.transcript && transcriptBackup.transcript.length > 0) {
                    console.log(`[Zoom Main Frame] Found backup data with ${transcriptBackup.transcript.length} captions`);
                    // Convert backup to zoomMeetingEnded format and trigger auto-save
                    const { autoSaveOnEnd } = await chrome.storage.sync.get('autoSaveOnEnd');
                    if (autoSaveOnEnd) {
                        console.log('[Zoom Main Frame] Converting backup to meeting ended format for auto-save');
                        const hasSpace = await checkStorageQuota();
                        if (hasSpace) {
                            await chrome.storage.local.set({
                                zoomMeetingEnded: {
                                    transcript: transcriptBackup.transcript,
                                    meetingTitle: transcriptBackup.meetingTitle || currentMeetingTitle || 'Untitled Meeting',
                                    recordingStartTime: transcriptBackup.recordingStartTime || new Date().toISOString(),
                                    attendeeReport: transcriptBackup.attendeeData || { allAttendees: [], totalUniqueAttendees: 0 },
                                    timestamp: new Date().toISOString(),
                                    shouldAutoSave: true,
                                    sessionId: transcriptBackup.sessionId || currentSessionId  // Include session ID
                                }
                            });
                            console.log('[Zoom Main Frame] Triggering auto-save with backup data');
                            await safeSendMessageAsync({ message: "zoom_meeting_ended" });
                        } else {
                            console.warn('[Zoom] Skipping backup conversion - storage quota exceeded');
                        }
                    } else {
                        console.log('[Zoom Main Frame] Auto-save disabled, backup data not triggered');
                    }
                } else {
                    console.log('[Zoom Main Frame] No caption data found - zoomMeetingEnded:', !!zoomMeetingEnded, 'transcriptBackup:', !!transcriptBackup);
                }

                wasInMeeting = nowInMeeting;
                // Clean up session
                if (currentSessionId) {
                    chrome.runtime.sendMessage({
                        action: 'deleteSession',
                        sessionId: currentSessionId
                    });
                    currentSessionId = null;
                }

                // If we found and processed data, return
                if ((zoomMeetingEnded && zoomMeetingEnded.transcript) || (transcriptBackup && transcriptBackup.transcript)) {
                    return;
                }
            }
            console.log(`[Zoom ${isMainFrame ? 'Main Frame' : 'Iframe'}] Processing meeting end with ${transcriptArray.length} captions`);
        }

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

        // For Zoom, save immediately as iframe might be destroyed
        if (platformConfig && platformConfig.name === 'Zoom' && transcriptArray.length > 0) {
            const frameType = isMainFrame ? 'Main Frame' : 'Iframe';
            console.log(`[Zoom ${frameType}] Processing meeting end save with ${transcriptArray.length} items`);

            // Save to local storage immediately with lock coordination
            (async () => {
                // Try to acquire save lock to prevent race condition between frames
                const lockSessionId = currentSessionId || 'zoom_meeting';
                const lockAcquired = await acquireSaveLock(lockSessionId);

                if (!lockAcquired) {
                    console.log(`[Zoom ${frameType}] Another frame is handling save, skipping...`);
                    return;
                }

                try {
                    const attendeeReport = await getAttendeeReport();
                    const { autoSaveOnEnd } = await chrome.storage.sync.get('autoSaveOnEnd');
                    console.log(`[Zoom ${frameType}] Saving meeting data - Transcript: ${transcriptArray.length} items, Attendees: ${attendeeReport?.totalUniqueAttendees || 0}, AutoSave: ${autoSaveOnEnd}`);

                    // Always save the data for Zoom - check quota first
                    const hasSpace = await checkStorageQuota();
                    if (hasSpace) {
                        await chrome.storage.local.set({
                            zoomMeetingEnded: {
                                transcript: getCleanTranscript(),
                                meetingTitle: currentMeetingTitle || 'Untitled Meeting',
                                recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                                attendeeReport: attendeeReport,
                                timestamp: new Date().toISOString(),
                                shouldAutoSave: autoSaveOnEnd !== false,  // Default to true if not explicitly false
                                sessionId: currentSessionId  // Include session ID for alias lookup
                            }
                        });
                    } else {
                        console.warn('[Zoom] Skipping meeting end save - storage quota exceeded');
                    }

                    // If we're the iframe, also try to trigger auto-save immediately
                    if (!isMainFrame && autoSaveOnEnd !== false) {
                        console.log(`[Zoom ${frameType}] Iframe triggering auto-save directly`);
                        const response = await safeSendMessageAsync({
                            message: "zoom_meeting_ended"
                        });
                        console.log(`[Zoom ${frameType}] Service worker response:`, response);
                    }
                } catch (error) {
                    console.error(`[Zoom ${frameType}] Error saving meeting data:`, error);
                } finally {
                    // Always release lock
                    await releaseSaveLock(lockSessionId);
                }
            })();
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
            
            // **FIX FOR ZOOM**: Check for backup data if main frame has no captions
            let transcriptToSave = transcriptArray;
            let shouldTriggerSave = false;

            if (autoSaveOnEnd) {
                if (transcriptArray.length > 0) {
                    shouldTriggerSave = true;
                    console.log("Auto-save is ON and transcript has data. Triggering save.");
                } else if (platformConfig && platformConfig.name === 'Zoom') {
                    // For Zoom, check if we have backup data from the iframe
                    const backupData = await chrome.storage.local.get('transcriptBackup');
                    if (backupData.transcriptBackup?.transcript?.length > 0) {
                        transcriptToSave = backupData.transcriptBackup.transcript;
                        shouldTriggerSave = true;
                        console.log(`[Zoom Auto-save] Found ${transcriptToSave.length} captions in backup. Triggering save.`);
                    }
                }
            }

            if (shouldTriggerSave) {
                console.log(`Auto-save: Processing ${transcriptToSave.length} transcript items`);
                
                // Mark auto-save as triggered before sending message
                autoSaveTriggered = true;
                lastMeetingId = currentMeetingId;
                
                // Send save message without retry (let service worker handle retries if needed)
                // Use attendee data from backup if available (for Zoom)
                let attendeeReport = await getAttendeeReport();
                if (platformConfig?.name === 'Zoom' && (!attendeeReport || attendeeReport.totalUniqueAttendees === 0)) {
                    const backupData = await chrome.storage.local.get('transcriptBackup');
                    if (backupData.transcriptBackup?.attendeeData) {
                        attendeeReport = {
                            allAttendees: Array.from(backupData.transcriptBackup.attendeeData.allAttendees || []),
                            totalUniqueAttendees: backupData.transcriptBackup.attendeeData.allAttendees?.size || 0,
                            attendeeHistory: backupData.transcriptBackup.attendeeData.attendeeHistory || [],
                            meetingStartTime: backupData.transcriptBackup.attendeeData.meetingStartTime
                        };
                    }
                }

                // Clean the transcript (remove duplicates, sort, etc.)
                const cleanTranscript = transcriptToSave.filter(item => item && item.Name && item.Text);

                // For Zoom, also get recording start time from backup if needed
                let recordingStartTimeToUse = recordingStartTime;
                if (platformConfig?.name === 'Zoom' && !recordingStartTimeToUse) {
                    const backupData = await chrome.storage.local.get('transcriptBackup');
                    if (backupData.transcriptBackup?.recordingStartTime) {
                        recordingStartTimeToUse = new Date(backupData.transcriptBackup.recordingStartTime);
                    }
                }
                
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
                        recordingStartTime: recordingStartTimeToUse ? recordingStartTimeToUse.toISOString() : new Date().toISOString(),
                        attendeeReport: attendeeReport,
                        sessionId: currentSessionId
                    });
                    
                    console.log("Auto-save message sent successfully. Response:", response);
                } catch (sendError) {
                    console.error("Failed to send auto-save message:", sendError);
                    
                    // Try alternative: save directly if we have permission
                    if (cleanTranscript.length > 0) {
                        console.log("Attempting direct save fallback...");
                        // Store for manual save with error handling
                        try {
                            const hasSpace = await checkStorageQuota();
                            if (hasSpace) {
                                await chrome.storage.local.set({
                                    pendingAutoSave: {
                                        transcript: cleanTranscript,
                                        meetingTitle: currentMeetingTitle || 'Untitled Meeting',
                                        recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                                        attendeeReport: attendeeReport,
                                        timestamp: new Date().toISOString()
                                    }
                                });
                            } else {
                                console.warn('[Auto-save] Storage quota exceeded, cannot save pending data');
                            }
                        } catch (storageError) {
                            console.error('[Auto-save] Failed to save pending data:', storageError);
                        }
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
    
    // Only log and clear when transitioning from meeting to not-in-meeting
    if (!nowInMeeting && wasInMeeting) {
        console.log('[Caption Saver] Meeting ended - clearing metadata');
        stopCaptureSession();
        stopAttendeeTracking();

        // Reset meeting metadata now that meeting has definitely ended
        // This ensures next meeting starts fresh
        currentMeetingTitle = '';
        recordingStartTime = null;
    } else if (!nowInMeeting) {
        // Still not in meeting, but already cleaned up - no need to log
        stopCaptureSession();
        stopAttendeeTracking();
    }

    wasInMeeting = nowInMeeting;

    if (!nowInMeeting) {
        return;
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
        // Use fallback-aware query function (MeetGeek improvement #2)
        const captionBlocks = queryAllElementsWithFallbacks(SELECTORS.captionBlock, captionsContainer);
        hasCaptions = captionBlocks.length > 0;
    } else if (captionsContainer) {
        hasCaptions = true; // For Teams, container presence is enough
    }
    
    // For Zoom, also check for the live transcription element directly
    if (platformConfig && platformConfig.name === 'Zoom') {
        const liveTranscriptionBox = document.querySelector('.live-transcription-subtitle__box');
        if (liveTranscriptionBox) {
            startCaptureSession();
        } else if (capturing) {
            // Zoom captions disappeared
            console.log('[Zoom] Captions container disappeared, but keeping session active');
        }
    } else if (captionsContainer && hasCaptions) {
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

    let captionContainer;
    if (platformConfig && platformConfig.name === 'Zoom') {
        // For Zoom, observe the body since captions are added/removed frequently
        captionContainer = document.body;
    } else {
        captionContainer = getCachedElement(SELECTORS.captionsContainer);
    }
    
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
        try {
            const result = await chrome.storage.sync.get(['chatCapture']);
            // Default to true if not explicitly set to false (matches popup default behavior)
            if (result.chatCapture !== false) {
                // console.log('[Caption Saver] Starting chat capture for', platformConfig.name);
                startChatCapture();
            }
        } catch (error) {
            console.warn('[Caption Saver] Could not check chat capture setting, defaulting to enabled:', error.message);
            startChatCapture(); // Default to enabled on error
        }
    }
    
    updateBadgeStatus(true);

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
                        // Fallback to old storage method - check quota first
                        const hasSpace = await checkStorageQuota();
                        if (hasSpace) {
                            await chrome.storage.local.set({
                                transcriptBackup: {
                                    transcript: transcriptArray,
                                    meetingTitle: currentMeetingTitle,
                                    recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : null,
                                    lastBackup: new Date().toISOString(),
                                    attendeeData: attendeeData
                                }
                            });
                        } else {
                            console.warn('[Backup] Skipping backup - storage quota exceeded');
                        }
                    }

                    // **IMPORTANT FIX**: For Zoom, ALWAYS save a backup even when we have a session
                    // This ensures data persists when iframe is destroyed on meeting end
                    if (platformConfig && platformConfig.name === 'Zoom') {
                        const hasSpace = await checkStorageQuota();
                        const isMainFrame = window === window.top;
                        if (hasSpace) {
                            await chrome.storage.local.set({
                                transcriptBackup: {
                                    transcript: transcriptArray,
                                    meetingTitle: currentMeetingTitle,
                                    recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : null,
                                    lastBackup: new Date().toISOString(),
                                    attendeeData: attendeeData,
                                    sessionId: currentSessionId, // Include session ID for better tracking
                                    frameType: isMainFrame ? 'main' : 'iframe'
                                }
                            });
                            console.log(`[Zoom ${isMainFrame ? 'Main' : 'Iframe'}] Backup saved: ${transcriptArray.length} captions`);
                        } else {
                            console.warn('[Zoom Backup] Skipping backup - storage quota exceeded');
                        }
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

async function stopCaptureSession() {
    // Always update badge to off when stopping, even if not currently capturing
    updateBadgeStatus(false);

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
            // Fallback to old storage method - check quota first
            const hasSpace = await checkStorageQuota();
            if (hasSpace) {
                chrome.storage.local.set({
                    transcriptBackup: {
                        transcript: transcriptArray,
                        meetingTitle: currentMeetingTitle || 'Untitled Meeting',
                        recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : null,
                        lastBackup: new Date().toISOString(),
                        attendeeData: attendeeData
                    }
                });
            } else {
                console.warn('[Backup] Skipping backup - storage quota exceeded');
            }
        }
        
        // Don't save to session history here - let auto-save handle it to prevent duplicates
    }
    
    // Stop attendee tracking
    stopAttendeeTracking();

    updateBadgeStatus(false);
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
    // Don't set new timers after cleanup
    if (isCleanedUp) return;

    if (autoEnableDebounceTimer) {
        clearTimeout(autoEnableDebounceTimer);
    }

    autoEnableDebounceTimer = setTimeout(() => {
        attemptAutoEnableCaptions();
    }, 2000); // 2 second debounce to prevent rapid firing
}

// Debounced badge update to prevent excessive messages
let lastBadgeState = null;
let badgeUpdateTimer = null;
function updateBadgeStatus(capturing) {
    // Only send if state actually changed
    if (lastBadgeState === capturing) {
        return;
    }

    // Clear any pending update
    if (badgeUpdateTimer) {
        clearTimeout(badgeUpdateTimer);
    }

    // Debounce rapid changes
    badgeUpdateTimer = setTimeout(() => {
        if (lastBadgeState !== capturing) {
            lastBadgeState = capturing;
            safeSendMessage({ message: "update_badge_status", capturing: capturing });
        }
    }, 100); // Small debounce to batch rapid changes
}

// --- Event-Driven Initialization ---
function initializeEventDrivenSystem() {
    if (hasInitializedListeners) return;
    
    // console.log("Initializing event-driven caption system...");

    // Clear badge on initialization (page load/refresh)
    updateBadgeStatus(false);

    // Set up observers for meeting state changes
    setupMeetingObserver();
    setupCaptionsObserver();
    
    // Periodically check observer status (much less frequent than before)
    if (observerCheckInterval) {
        clearInterval(observerCheckInterval);
    }
    observerCheckInterval = setInterval(ensureObserverIsActive, TIMING.OBSERVER_CHECK_INTERVAL);

    // Periodically check meeting state for platforms like Zoom that may not trigger mutations
    if (meetingStateCheckInterval) {
        clearInterval(meetingStateCheckInterval);
    }
    meetingStateCheckInterval = setInterval(() => {
        handleMeetingStateChange();
    }, TIMING.MAIN_LOOP_INTERVAL);

    // Initial state check with a small delay for DOM to load
    setTimeout(() => {
        handleMeetingStateChange();
    }, 1000);
    
    hasInitializedListeners = true;
}

// --- Memory Leak Prevention ---
function cleanupObservers() {
    // Mark as cleaned up to prevent new timers
    isCleanedUp = true;

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

    // Remove visibility change handler
    if (visibilityChangeHandler) {
        document.removeEventListener('visibilitychange', visibilityChangeHandler);
        visibilityChangeHandler = null;
    }

    // Clear all intervals (memory leak prevention)
    if (observerCheckInterval) {
        clearInterval(observerCheckInterval);
        observerCheckInterval = null;
    }
    if (meetingStateCheckInterval) {
        clearInterval(meetingStateCheckInterval);
        meetingStateCheckInterval = null;
    }
    if (backupInterval) {
        clearInterval(backupInterval);
        backupInterval = null;
    }
    if (attendeeUpdateInterval) {
        clearInterval(attendeeUpdateInterval);
        attendeeUpdateInterval = null;
    }
    if (chatCaptureState.chatCheckInterval) {
        clearInterval(chatCaptureState.chatCheckInterval);
        chatCaptureState.chatCheckInterval = null;
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
    if (badgeUpdateTimer) {
        clearTimeout(badgeUpdateTimer);
        badgeUpdateTimer = null;
    }

    // Reset auto-enable state
    autoEnableInProgress = false;

    // Stop caption cache cleanup and clear cache
    stopCaptionCacheCleanup();

    // Stop attendee tracking
    stopAttendeeTracking();

    clearElementCache();

    // Clean up global user name
    window.currentUserName = null;
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    // For Zoom iframe, save data before unload
    if (platformConfig && platformConfig.name === 'Zoom' && transcriptArray.length > 0) {
        const isMainFrame = window === window.top;
        if (!isMainFrame) {
            console.log('[Zoom Iframe] Page unloading, saving transcript data');
            // Synchronously save data - extract attendees directly
            const attendeeReport = {
                allAttendees: Array.from(attendeeData.allAttendees),
                totalUniqueAttendees: attendeeData.allAttendees.size,
                attendeeHistory: attendeeData.attendeeHistory
            };
            chrome.storage.local.set({
                zoomMeetingEnded: {
                    transcript: getCleanTranscript(),
                    meetingTitle: currentMeetingTitle || 'Untitled Meeting',
                    recordingStartTime: recordingStartTime ? recordingStartTime.toISOString() : new Date().toISOString(),
                    attendeeReport: {
                        allAttendees: attendeeReport.allAttendees,
                        totalUniqueAttendees: attendeeReport.totalUniqueAttendees,
                        attendeeHistory: attendeeReport.attendeeHistory
                    },
                    timestamp: new Date().toISOString(),
                    shouldAutoSave: true,
                    sessionId: currentSessionId  // Include session ID
                }
            });
        }
    }

    // Clear badge when page is unloading
    updateBadgeStatus(false);
    cleanupObservers();
});

// Clear badge when page visibility changes (tab switching, minimizing)
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !capturing) {
        // If the page is hidden and we're not actively capturing, clear the badge
        updateBadgeStatus(false);
    }
});

// Initialize the system
if (initializePlatform()) {
    initializeEventDrivenSystem();

    // Start health monitoring system (MeetGeek improvement #4)
    HealthCheck.startHealthMonitoring();
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
            break;

        case 'toggle_chat_capture':
            // Toggle chat capture on/off
            if (request.enabled) {
                startChatCapture();
            } else {
                stopChatCapture();
            }
            sendResponse({ success: true });
            break;
            
        case 'get_status':
            (async () => {
                try {
                    // For Zoom, prioritize responses from frames with actual meeting content
                    if (platformConfig && platformConfig.name === 'Zoom') {
                        const isMainFrame = window === window.top;
                        const pathname = window.location.pathname;
                        const hasMeetingControls = !!document.querySelector('.footer-button-base__button');
                        const isInMeeting = isUserInMeeting();

                        console.log(`[Zoom Status] Frame: ${isMainFrame ? 'main' : 'iframe'}, Path: ${pathname}, InMeeting: ${isInMeeting}, Capturing: ${capturing}, Controls: ${hasMeetingControls}`);

                        // Don't respond from whiteboard or other non-meeting iframes
                        if (!isMainFrame && (pathname.includes('/wb/') || pathname.includes('/recent'))) {
                            // console.log(`[Zoom Status] Ignoring response from non-meeting iframe: ${pathname}`);
                            // Send minimal response to avoid popup error
                            sendResponse({
                                capturing: false,
                                captionCount: 0,
                                isInMeeting: false,
                                attendeeCount: 0,
                                frameType: 'non-meeting-iframe'
                            });
                            return;
                        }

                        // Main frame should delay response to let iframe respond first
                        // UNLESS the main frame is actually capturing
                        if (isMainFrame && !capturing && !hasMeetingControls) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                            // Still don't respond if we're not the right frame
                            if (!isInMeeting && !capturing) {
                                // console.log(`[Zoom Status] Main frame not responding - no meeting activity`);
                                // Send minimal response to prevent message channel error
                                sendResponse({
                                    capturing: false,
                                    captionCount: 0,
                                    isInMeeting: false,
                                    attendeeCount: 0,
                                    frameType: 'non-active-main-frame'
                                });
                                return;
                            }
                        }

                        // Iframe with actual meeting content should respond immediately
                        if (!isMainFrame && (capturing || isInMeeting)) {
                            console.log(`[Zoom Status] Iframe responding with capturing=${capturing}, inMeeting=${isInMeeting}`);
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
                } catch (error) {
                    console.error('[Caption Saver] Error in get_status handler:', error);
                    // Always send response even on error to prevent channel closure error
                    sendResponse({
                        capturing: false,
                        captionCount: 0,
                        isInMeeting: false,
                        attendeeCount: 0,
                        error: error.message
                    });
                }
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
                platform: platformConfig?.name || 'Unknown',  // Include platform name
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
                platform: platformConfig?.name || 'Unknown',  // Pass platform name
                sessionId: currentSessionId  // Pass session ID to viewer
            });
            break;

        case 'get_unique_speakers':
            // Create shallow copy before mapping to prevent issues from concurrent mutation
            const speakers = [...new Set([...transcriptArray].map(item => item.Name))];
            sendResponse({ speakers });
            break;
            
        case 'get_attendee_report':
            (async () => {
                const attendeeReport = await getAttendeeReport();
                sendResponse({ attendeeReport: attendeeReport });
            })();
            return true; // Will respond asynchronously
        
        case 'recording_transcript_saved':
            // Show toast notification when recording transcript is detected
            showToastNotification(request.meetingTitle || 'Recording');
            break;

        default:
            // Ignore live updates that might be relayed back
            if (request.message !== 'live_caption_update' && request.message !== 'live_attendee_update') {
                console.log("Unhandled message received in content script:", request.message);
            }
            break;
    }

    // Don't return true here - only specific cases that use async sendResponse should return true
});

// --- Toast Notification for Recording Transcripts ---
function showToastNotification(meetingTitle) {
    // Create toast element
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #0078d4;
        color: white;
        padding: 16px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 14px;
        max-width: 400px;
        cursor: pointer;
        transition: all 0.3s ease;
    `;

    toast.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 4px;">📥 Recording Transcript Detected</div>
        <div style="font-size: 12px; opacity: 0.9;">${meetingTitle}</div>
        <div style="font-size: 11px; opacity: 0.8; margin-top: 6px;">Click extension icon to download</div>
    `;

    // Add hover effect
    toast.addEventListener('mouseenter', () => {
        toast.style.transform = 'scale(1.02)';
    });
    toast.addEventListener('mouseleave', () => {
        toast.style.transform = 'scale(1)';
    });

    // Click to open extension action (popup)
    toast.addEventListener('click', () => {
        // Open the extension popup using chrome.action API
        chrome.runtime.sendMessage({ message: 'open_extension_popup' });
        toast.remove();
    });

    document.body.appendChild(toast);

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// --- Recording Transcript Interceptor ---
// Inject external script to intercept Teams recording transcript requests
// Using external file to avoid CSP inline script violations
(function injectTranscriptInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('transcript_interceptor.js');
    script.onload = function() {
        console.log('[Recording Transcript] Interceptor script loaded');
        this.remove();
    };
    script.onerror = function() {
        console.error('[Recording Transcript] Failed to load interceptor script');
        this.remove();
    };

    (document.head || document.documentElement).appendChild(script);
})();

// Listen for transcript data from injected script
window.addEventListener('message', (event) => {
    // Only accept messages from same origin
    if (event.source !== window) return;

    if (event.data && event.data.type === 'TEAMS_RECORDING_TRANSCRIPT') {
        console.log('[Recording Transcript] Received transcript data from page');

        // Extract meeting title from page - try to get from the span title attribute first
        let meetingTitle = '';

        // Look for the meeting title span with title attribute
        const titleSpan = document.querySelector('span.fui-StyledText[title]');
        if (titleSpan && titleSpan.getAttribute('title')) {
            meetingTitle = titleSpan.getAttribute('title');
            console.log('[Recording Transcript] Found meeting title from span:', meetingTitle);
        }

        // Fallback to document title
        if (!meetingTitle) {
            meetingTitle = document.title.replace(/ \| Microsoft Teams.*$/, '').trim();
            console.log('[Recording Transcript] Using document title:', meetingTitle);
        }

        // Send to service worker for storage
        chrome.runtime.sendMessage({
            message: 'save_recording_transcript',
            transcript: event.data.data,
            url: event.data.url,
            timestamp: event.data.timestamp,
            meetingTitle: meetingTitle || 'Teams Recording'
        }).catch(err => {
            console.error('[Recording Transcript] Failed to send to service worker:', err);
        });
    }
});

// Live Caption Saver content script is running