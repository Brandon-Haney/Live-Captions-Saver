// Platform-specific configurations for caption capture
const PLATFORM_CONFIGS = {
    'teams.microsoft.com': {
        name: 'Microsoft Teams',
        selectors: {
            captionsContainer: "[data-tid='closed-caption-v2-window-wrapper'], [data-tid='closed-captions-renderer'], [data-tid*='closed-caption']",
            captionBlock: '.fui-ChatMessageCompact',
            speakerName: '[data-tid="author"]',
            captionText: '[data-tid="closed-caption-text"]',
            hangupButton: "button[data-tid='hangup-main-btn'], button[data-tid='hangup-leave-button'], button[data-tid='hangup-end-meeting-button']",
            attendeeList: "[role='tree'][aria-label='Attendees']",
            attendeeItem: "[data-tid^='participantsInCall-']",
            // Teams-specific selectors for auto-enable
            MORE_BUTTON: "button[data-tid='more-button'], button[id='callingButtons-showMoreBtn']",
            MORE_BUTTON_EXPANDED: "button[data-tid='more-button'][aria-expanded='true'], button[id='callingButtons-showMoreBtn'][aria-expanded='true']",
            LANGUAGE_SPEECH_BUTTON: "div[id='LanguageSpeechMenuControl-id']",
            TURN_ON_CAPTIONS_BUTTON: "div[id='closed-captions-button']",
            PEOPLE_BUTTON: "button[data-tid='calling-toolbar-people-button'], button[id='roster-button']",
            ATTENDEE_NAME: "[id^='roster-avatar-img-']",
            ATTENDEE_ROLE: "[data-tid='ts-roster-organizer-status']",
            ATTENDEE_COUNT: "#roster-title-section-2",
            ATTENDEE_TREE: "[role='tree'][aria-label='Attendees']",
            ATTENDEE_ITEM: "[data-tid^='participantsInCall-']"
        },
        getCaptionData: (element) => {
            const author = element.querySelector('[data-tid="author"]');
            const text = element.querySelector('[data-tid="closed-caption-text"]');
            if (!author || !text) return null;
            
            return {
                Name: author.textContent.trim(),
                Text: text.textContent.trim(),
                Time: new Date().toLocaleTimeString()
            };
        },
        isMeetingActive: () => {
            return !!document.querySelector("button[data-tid='hangup-main-btn'], button[data-tid='hangup-leave-button']");
        }
    },
    
    'meet.google.com': {
        name: 'Google Meet',
        selectors: {
            // Caption selectors
            captionsContainer: '.ZPyPXe[aria-label="Captions"]',
            captionBlock: '.nMcdL.bj4p3b',
            speakerName: '.KcIKyf .NWpY1d',
            captionText: '.ygicle.VbkSUe',
            
            // Meeting controls
            hangupButton: 'button[aria-label="Leave call"], button[aria-label*="End call"]',
            turnOnCaptionsButton: 'button[aria-label="Turn on captions"][jsname="r8qRAd"]',
            turnOffCaptionsButton: 'button[aria-label="Turn off captions"]',
            
            // Attendee tracking selectors
            peopleButton: 'button[aria-label*="People"][data-panel-id="1"], button[aria-label*="People - "]',
            attendeeList: '.m3Uzve.RJRKn, .m3Uzve.LkEdie',  // In the meeting section
            attendeeItem: '.cxdMu[role="listitem"]',
            attendeeName: '.zWGUib',
            
            // Unused/Reserved selectors (kept for modularity)
            sidePanel: null,  // Not currently used
            attendeeRole: null,  // Not currently used
            attendeeCount: null,  // Not currently used
            searchBox: null,  // Not currently used
            moreButton: null,  // Not needed for Google Meet (caption button is directly accessible)
            
            // Teams-specific selectors not applicable to Google Meet
            MORE_BUTTON: null,
            MORE_BUTTON_EXPANDED: null,
            LANGUAGE_SPEECH_BUTTON: null,
            TURN_ON_CAPTIONS_BUTTON: null,
            PEOPLE_BUTTON: null,
            ATTENDEE_NAME: null,
            ATTENDEE_ROLE: null,
            ATTENDEE_COUNT: null,
            ATTENDEE_TREE: null,
            ATTENDEE_ITEM: null
        },
        getCaptionData: (element) => {
            const speakerElement = element.querySelector('.KcIKyf .NWpY1d');
            const textElement = element.querySelector('.ygicle.VbkSUe');
            if (!speakerElement || !textElement) return null;
            
            let speakerName = speakerElement.textContent.trim();
            
            // If speaker is "You", try to get the actual name
            if (speakerName === 'You') {
                // First try stored name
                if (window.currentUserName) {
                    speakerName = window.currentUserName;
                } else {
                    // Try to get name from the avatar area in the caption
                    const avatarImg = element.querySelector('img.Z6byG');
                    if (avatarImg && avatarImg.alt) {
                        speakerName = avatarImg.alt;
                        window.currentUserName = speakerName;
                        console.log(`[Caption Saver] Detected user name from caption avatar: ${speakerName}`);
                    }
                }
            }
            
            return {
                Name: speakerName,
                Text: textElement.textContent.trim(),
                Time: new Date().toLocaleTimeString()
            };
        },
        getAttendeeData: (element) => {
            const nameElement = element.querySelector('.zWGUib');
            const roleElement = element.querySelector('.d93U2d');
            const isYou = element.querySelector('.NnTWjc')?.textContent.includes('You');
            
            if (!nameElement) return null;
            
            return {
                name: nameElement.textContent.trim(),
                role: roleElement ? roleElement.textContent.trim() : 'Participant',
                isCurrentUser: isYou || false
            };
        },
        isMeetingActive: () => {
            // Google Meet shows leave button when in meeting
            // Also check we're NOT on the "You left the meeting" or "host ended" page
            const hasLeaveButton = !!document.querySelector('button[aria-label="Leave call"], button[aria-label*="End call"]');
            const meetingEndedH1 = document.querySelector('h1.roSPhc');
            const leftMeetingPage = meetingEndedH1?.textContent?.includes('You left the meeting');
            const hostEndedMeeting = meetingEndedH1?.textContent?.includes('Your host ended the meeting');
            const onLandingPage = window.location.pathname === '/landing';
            
            // Not in meeting if: meeting ended (by user or host), on landing page, or no leave button
            const inMeeting = hasLeaveButton && !leftMeetingPage && !hostEndedMeeting && !onLandingPage;
            
            if (!inMeeting && window.lastMeetingActiveState === true) {
                console.log('[Caption Saver] Meeting ended detected:', {
                    hasLeaveButton,
                    leftMeetingPage,
                    hostEndedMeeting,
                    onLandingPage,
                    pathname: window.location.pathname
                });
            }
            
            window.lastMeetingActiveState = inMeeting;
            return inMeeting;
        },
        isPanelOpen: () => {
            const panel = document.querySelector('aside[aria-label="Side panel"]');
            return panel && panel.style.display !== 'none';
        },
        areCaptionsEnabled: () => {
            // Check multiple ways to detect if captions are enabled
            // Look for visible captions with actual caption blocks
            const captionsWithContent = document.querySelector('.ZPyPXe[aria-label="Captions"]:has(.nMcdL.bj4p3b)');
            const turnOffButton = document.querySelector('button[aria-label="Turn off captions"]');
            // Also check for the captions button pressed state
            const captionsButton = document.querySelector('button[aria-label*="captions"][aria-pressed="true"]');
            
            // Check if captions container is visible (not just exists)
            let containerVisible = false;
            const captionsContainer = document.querySelector('.ZPyPXe[aria-label="Captions"]');
            if (captionsContainer) {
                const rect = captionsContainer.getBoundingClientRect();
                containerVisible = rect.width > 0 && rect.height > 0;
            }
            
            const result = !!(captionsWithContent || turnOffButton || captionsButton || containerVisible);
            console.log('[Caption Saver] Checking captions enabled:', {
                captionsWithContent: !!captionsWithContent,
                turnOffButton: !!turnOffButton,
                captionsButton: !!captionsButton,
                containerVisible,
                result
            });
            return result;
        },
        async enableCaptions() {
            // Try multiple selectors for the caption button
            let turnOnButton = document.querySelector('button[aria-label="Turn on captions"][jsname="r8qRAd"]') ||
                              document.querySelector('button[aria-label="Turn on captions (c)"]') ||
                              document.querySelector('button[jsname="r8qRAd"][aria-pressed="false"]') ||
                              document.querySelector('button[jsname="r8qRAd"]');
            
            // If not found, try looking for any button with captions in the label
            if (!turnOnButton) {
                const allButtons = document.querySelectorAll('button[aria-label*="caption" i]');
                for (const btn of allButtons) {
                    const label = btn.getAttribute('aria-label');
                    console.log('[Caption Saver] Found caption-related button:', label);
                    if (label && (label.toLowerCase().includes('turn on') || 
                                 btn.getAttribute('aria-pressed') === 'false')) {
                        turnOnButton = btn;
                        break;
                    }
                }
            }
            
            if (turnOnButton) {
                console.log('[Caption Saver] Found caption button, clicking to enable:', 
                           turnOnButton.getAttribute('aria-label'));
                turnOnButton.click();
                
                // Wait a bit for captions to activate
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                // Verify captions are now on
                const nowEnabled = this.areCaptionsEnabled();
                console.log('[Caption Saver] Captions enabled result:', nowEnabled);
                return nowEnabled;
            }
            
            console.log('[Caption Saver] Could not find caption button. Available buttons:');
            document.querySelectorAll('button[jsname]').forEach(btn => {
                if (btn.getAttribute('aria-label')) {
                    console.log('  -', btn.getAttribute('aria-label'));
                }
            });
            return false;
        },
        async openAttendeePanel() {
            const peopleButton = document.querySelector('button[aria-label*="People"][data-panel-id="1"], button[aria-label*="People - "]');
            if (peopleButton && peopleButton.getAttribute('aria-expanded') !== 'true') {
                console.log('[Caption Saver] Opening attendee panel on Google Meet');
                peopleButton.click();
                return true;
            }
            return false;
        }
    },
    
    'web.zoom.us': {
        name: 'Zoom',
        selectors: {
            // Caption selectors
            captionsContainer: '.transcript-list, .closed-caption-container',
            captionBlock: '.transcript-message, .closed-caption-line',
            speakerName: '.transcript-message-speaker, .closed-caption-speaker',
            captionText: '.transcript-message-text, .closed-caption-text',
            
            // Meeting controls
            hangupButton: 'button[aria-label*="Leave"], button[aria-label*="End"]',
            turnOnCaptionsButton: 'button[aria-label*="Closed Caption"], button[aria-label*="Show captions"]',
            turnOffCaptionsButton: null,  // Reserved for future use
            
            // Attendee tracking selectors
            peopleButton: null,  // Reserved for future use
            attendeeList: 'div[aria-label="Participants panel"]',
            attendeeItem: '.participants-item',
            attendeeName: null,  // Reserved for future use
            
            // Unused/Reserved selectors
            sidePanel: null,
            attendeeRole: null,
            attendeeCount: null,
            searchBox: null,
            moreButton: 'button[aria-label="More"]',
            
            // Teams-specific selectors not applicable
            MORE_BUTTON: null,
            MORE_BUTTON_EXPANDED: null,
            LANGUAGE_SPEECH_BUTTON: null,
            TURN_ON_CAPTIONS_BUTTON: null,
            PEOPLE_BUTTON: null,
            ATTENDEE_NAME: null,
            ATTENDEE_ROLE: null,
            ATTENDEE_COUNT: null,
            ATTENDEE_TREE: null,
            ATTENDEE_ITEM: null
        },
        getCaptionData: (element) => {
            const speakerElement = element.querySelector('.transcript-message-speaker, .closed-caption-speaker');
            const textElement = element.querySelector('.transcript-message-text, .closed-caption-text');
            if (!textElement) return null;
            
            return {
                Name: speakerElement ? speakerElement.textContent.trim() : 'Unknown Speaker',
                Text: textElement.textContent.trim(),
                Time: new Date().toLocaleTimeString()
            };
        },
        isMeetingActive: () => {
            return !!document.querySelector('button[aria-label*="Leave"], button[aria-label*="End"]');
        }
    },
    
    'web.webex.com': {
        name: 'Webex',
        selectors: {
            // Caption selectors
            captionsContainer: '.captions-container, [aria-label="Closed captions"]',
            captionBlock: '.caption-line',
            speakerName: '.caption-speaker',
            captionText: '.caption-text',
            
            // Meeting controls
            hangupButton: 'button[aria-label*="Leave"], button[aria-label*="End meeting"]',
            turnOnCaptionsButton: 'button[aria-label*="Closed captions"]',
            turnOffCaptionsButton: null,  // Reserved for future use
            
            // Attendee tracking selectors
            peopleButton: null,  // Reserved for future use
            attendeeList: '[aria-label="Participants panel"]',
            attendeeItem: '.participant-list-item',
            attendeeName: null,  // Reserved for future use
            
            // Unused/Reserved selectors
            sidePanel: null,
            attendeeRole: null,
            attendeeCount: null,
            searchBox: null,
            moreButton: 'button[aria-label="More options"]',
            
            // Teams-specific selectors not applicable
            MORE_BUTTON: null,
            MORE_BUTTON_EXPANDED: null,
            LANGUAGE_SPEECH_BUTTON: null,
            TURN_ON_CAPTIONS_BUTTON: null,
            PEOPLE_BUTTON: null,
            ATTENDEE_NAME: null,
            ATTENDEE_ROLE: null,
            ATTENDEE_COUNT: null,
            ATTENDEE_TREE: null,
            ATTENDEE_ITEM: null
        },
        getCaptionData: (element) => {
            const speakerElement = element.querySelector('.caption-speaker');
            const textElement = element.querySelector('.caption-text');
            if (!textElement) return null;
            
            return {
                Name: speakerElement ? speakerElement.textContent.trim() : 'Unknown Speaker',
                Text: textElement.textContent.trim(),
                Time: new Date().toLocaleTimeString()
            };
        },
        isMeetingActive: () => {
            return !!document.querySelector('button[aria-label*="Leave"], button[aria-label*="End meeting"]');
        }
    }
};

// Helper function to get current platform config
function getCurrentPlatformConfig() {
    const hostname = window.location.hostname;
    for (const [domain, config] of Object.entries(PLATFORM_CONFIGS)) {
        if (hostname.includes(domain)) {
            return { domain, ...config };
        }
    }
    return null;
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PLATFORM_CONFIGS, getCurrentPlatformConfig };
}