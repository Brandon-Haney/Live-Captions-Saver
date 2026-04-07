/**
 * M365 Keep-Alive Script
 * Prevents Microsoft 365 web apps from timing out due to inactivity
 *
 * Uses random intervals (3-60 minutes) and non-intrusive activity simulation
 * to avoid detection patterns while keeping the session alive.
 */

(function() {
    'use strict';

    const CONFIG = {
        MIN_INTERVAL_MS: 3 * 60 * 1000,    // 3 minutes
        MAX_INTERVAL_MS: 30 * 60 * 1000,   // 30 minutes
        DIALOG_CHECK_INTERVAL_MS: 5000,    // Check for timeout dialog every 5 seconds
        MIN_CLICK_DELAY_MS: 3000,          // Min delay before clicking button (3 sec)
        MAX_CLICK_DELAY_MS: 45000,         // Max delay before clicking button (45 sec)
        STORAGE_KEY: 'm365KeepAlive',
        DEBUG: true  // Set to false after testing
    };

    // Selectors for the "Stay signed in" dialog.
    // IMPORTANT: keep these narrow. Broad matches like `button.ms-Button--primary`
    // previously matched unrelated primary buttons (e.g. the "Join" button on the
    // Teams calendar iframe embedded from outlook.office.com) and caused the
    // extension to auto-join the first meeting of the day. All matches are also
    // gated by `isInSignInContext()` below as a second line of defense.
    const DIALOG_SELECTORS = [
        'button[data-automationid="keep-signed-in"]',
        '[aria-label="Stay signed in"]',
        '#idSIButton9', // Common Microsoft "Yes" button ID on login.microsoftonline.com
        'input#idSIButton9'
    ];

    // Hosts where a "Stay signed in" style dialog can legitimately appear.
    // On other hosts we rely entirely on dialog/modal context + text matching.
    const SIGN_IN_HOSTS = [
        'login.microsoftonline.com',
        'login.live.com',
        'login.microsoft.com'
    ];

    /**
     * Returns true if the given element is inside a sign-in / keep-signed-in
     * context. Used to avoid clicking unrelated primary buttons on pages like
     * the Teams calendar (embedded via outlook.office.com) where a generic
     * "primary" button might be the meeting "Join" action.
     */
    function isInSignInContext(el) {
        if (!el) return false;

        // On the dedicated login hosts, the whole page is the sign-in context.
        if (SIGN_IN_HOSTS.includes(window.location.hostname)) {
            return true;
        }

        // Otherwise the button must live inside an actual modal/dialog.
        const dialog = el.closest('[role="dialog"], [role="alertdialog"], .ms-Dialog, .ms-Modal');
        if (!dialog) return false;

        // And the dialog text should mention the specific sign-in prompt.
        const dialogText = (dialog.textContent || '').toLowerCase();
        return dialogText.includes('stay signed in') ||
               dialogText.includes('keep me signed in') ||
               dialogText.includes('keep you signed in');
    }

    let keepAliveTimer = null;
    let dialogCheckTimer = null;
    let pendingClickTimer = null;
    let isEnabled = false;
    let activityCount = 0;

    function log(...args) {
        if (CONFIG.DEBUG) {
            console.log('[M365 Keep-Alive]', ...args);
        }
    }

    /**
     * Generate a random interval between MIN and MAX
     */
    function getRandomInterval() {
        const range = CONFIG.MAX_INTERVAL_MS - CONFIG.MIN_INTERVAL_MS;
        const randomMs = Math.floor(Math.random() * range) + CONFIG.MIN_INTERVAL_MS;
        return randomMs;
    }

    /**
     * Generate a random delay for clicking the dialog button (3-45 seconds)
     */
    function getRandomClickDelay() {
        const range = CONFIG.MAX_CLICK_DELAY_MS - CONFIG.MIN_CLICK_DELAY_MS;
        const randomMs = Math.floor(Math.random() * range) + CONFIG.MIN_CLICK_DELAY_MS;
        return randomMs;
    }

    /**
     * Simulate user activity using DOM events
     * These are the events M365 typically monitors for activity detection
     */
    function simulateActivity() {
        activityCount++;
        log(`Simulating activity (#${activityCount})`);

        try {
            // Method 1: Dispatch keyboard event (Shift key - doesn't type anything)
            const keyEvent = new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Shift',
                code: 'ShiftLeft',
                keyCode: 16,
                which: 16
            });
            document.dispatchEvent(keyEvent);

            // Also dispatch keyup
            const keyUpEvent = new KeyboardEvent('keyup', {
                bubbles: true,
                cancelable: true,
                key: 'Shift',
                code: 'ShiftLeft',
                keyCode: 16,
                which: 16
            });
            document.dispatchEvent(keyUpEvent);
            log('Dispatched keyboard events');

            // Method 2: Trigger a scroll event (scroll by 0 - no visible effect)
            window.dispatchEvent(new Event('scroll', { bubbles: true }));
            log('Dispatched scroll event');

            // Method 3: Dispatch a focus event
            document.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
            log('Dispatched focus event');

            // Method 4: Dispatch mouse movement at current position (doesn't move cursor)
            const mouseEvent = new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                clientX: 0,
                clientY: 0,
                view: window
            });
            document.dispatchEvent(mouseEvent);
            log('Dispatched mousemove event');

            // Method 5: Touch the localStorage to trigger storage events
            const storageKey = '__m365_activity__';
            localStorage.setItem(storageKey, Date.now().toString());
            localStorage.removeItem(storageKey);

            // Method 6: Trigger visibility change simulation
            // (Some apps reset timers when page becomes visible)
            if (document.hidden) {
                document.dispatchEvent(new Event('visibilitychange'));
            }

        } catch (error) {
            log('Error simulating activity:', error);
        }

        scheduleNextActivity();
    }

    /**
     * Click a button with random delay to appear more human-like
     */
    function clickButtonWithDelay(button, source) {
        // Don't schedule another click if one is already pending
        if (pendingClickTimer) {
            log('Click already pending, skipping');
            return;
        }

        const delay = getRandomClickDelay();
        const delaySeconds = Math.round(delay / 1000);
        log(`Found timeout dialog (${source}), will click in ${delaySeconds} seconds`);

        pendingClickTimer = setTimeout(() => {
            pendingClickTimer = null;

            // Verify button is still visible before clicking
            if (button && button.offsetParent !== null) {
                log(`Clicking button after ${delaySeconds}s delay`);
                button.click();

                // Also try to submit if it's a form
                const form = button.closest('form');
                if (form) {
                    form.submit();
                }
            } else {
                log('Button no longer visible, click cancelled');
            }
        }, delay);
    }

    /**
     * Check for and handle the "Stay signed in" dialog
     */
    function checkForTimeoutDialog() {
        if (!isEnabled) return;

        // Skip if we already have a pending click
        if (pendingClickTimer) return;

        // Look for common timeout dialog elements
        for (const selector of DIALOG_SELECTORS) {
            try {
                const button = document.querySelector(selector);
                if (button &&
                    button.offsetParent !== null && // visible
                    isInSignInContext(button)) {
                    clickButtonWithDelay(button, selector);
                    return true;
                }
            } catch (e) {
                // Selector might be invalid, continue to next
            }
        }

        // Also look for dialogs by text content. All three branches now
        // require the button to be inside an actual sign-in dialog — the
        // previous `||`/`&&` precedence bug let "stay signed in" match
        // anywhere on the page.
        const allButtons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
        for (const btn of allButtons) {
            const text = (btn.textContent || btn.value || '').toLowerCase().trim();
            const textMatches =
                text === 'yes' ||
                text.includes('stay signed in') ||
                text.includes('keep me signed in');

            if (textMatches && btn.offsetParent !== null && isInSignInContext(btn)) {
                clickButtonWithDelay(btn, `text: "${text}"`);
                return true;
            }
        }

        return false;
    }

    /**
     * Schedule the next activity simulation
     */
    function scheduleNextActivity() {
        if (!isEnabled) {
            log('Keep-alive disabled, not scheduling next activity');
            return;
        }

        // Clear any existing timer
        if (keepAliveTimer) {
            clearTimeout(keepAliveTimer);
        }

        const interval = getRandomInterval();
        const minutes = Math.round(interval / 60000);
        log(`Next activity scheduled in ${minutes} minutes`);

        keepAliveTimer = setTimeout(simulateActivity, interval);
    }

    /**
     * Start the keep-alive system
     */
    function startKeepAlive() {
        if (isEnabled) {
            log('Already running');
            return;
        }

        isEnabled = true;
        activityCount = 0;
        log('Starting keep-alive on', window.location.hostname);

        // Schedule first activity (use a shorter initial delay)
        const initialDelay = Math.min(getRandomInterval(), 5 * 60 * 1000); // Max 5 min for first one
        log(`Initial activity in ${Math.round(initialDelay / 60000)} minutes`);
        keepAliveTimer = setTimeout(simulateActivity, initialDelay);

        // Start checking for timeout dialogs
        dialogCheckTimer = setInterval(checkForTimeoutDialog, CONFIG.DIALOG_CHECK_INTERVAL_MS);
    }

    /**
     * Stop the keep-alive system
     */
    function stopKeepAlive() {
        isEnabled = false;

        if (keepAliveTimer) {
            clearTimeout(keepAliveTimer);
            keepAliveTimer = null;
        }

        if (dialogCheckTimer) {
            clearInterval(dialogCheckTimer);
            dialogCheckTimer = null;
        }

        log('Stopped keep-alive');
    }

    /**
     * Load settings and initialize
     */
    async function initialize() {
        try {
            const settings = await chrome.storage.sync.get(CONFIG.STORAGE_KEY);
            const keepAliveEnabled = settings[CONFIG.STORAGE_KEY] === true;

            log('Settings loaded, enabled:', keepAliveEnabled);

            if (keepAliveEnabled) {
                startKeepAlive();
            }
        } catch (error) {
            log('Failed to load settings:', error);
        }
    }

    /**
     * Listen for settings changes
     */
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes[CONFIG.STORAGE_KEY]) {
            const newValue = changes[CONFIG.STORAGE_KEY].newValue;
            log('Setting changed to:', newValue);

            if (newValue === true) {
                startKeepAlive();
            } else {
                stopKeepAlive();
            }
        }
    });

    /**
     * Listen for messages from popup
     */
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.message === 'get_keepalive_status') {
            sendResponse({
                enabled: isEnabled,
                activityCount: activityCount,
                hostname: window.location.hostname
            });
            return true;
        }

        if (message.message === 'toggle_keepalive') {
            if (message.enabled) {
                startKeepAlive();
            } else {
                stopKeepAlive();
            }
            sendResponse({ success: true, enabled: isEnabled });
            return true;
        }

        return false;
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        stopKeepAlive();
    });

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    log('Script loaded on', window.location.hostname);
})();
