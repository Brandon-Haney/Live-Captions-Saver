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
            attendeeList: ".fui-FlatTree[role='tree'][aria-label='Attendees'], [data-tid='calling-roster'], [role='tree'][aria-label='Attendees']",
            attendeeItem: "[data-cid='roster-participant'], [data-tid^='participantsInCall-']",
            // Teams-specific selectors for auto-enable
            MORE_BUTTON: "button[data-tid='more-button'], button[id='callingButtons-showMoreBtn']",
            MORE_BUTTON_EXPANDED: "button[data-tid='more-button'][aria-expanded='true'], button[id='callingButtons-showMoreBtn'][aria-expanded='true']",
            LANGUAGE_SPEECH_BUTTON: "div[id='LanguageSpeechMenuControl-id']",
            TURN_ON_CAPTIONS_BUTTON: "div[id='closed-captions-button']",
            PEOPLE_BUTTON: "button[data-tid='calling-toolbar-people-button'], button[id='roster-button']",
            ATTENDEE_NAME: "[title], .fui-TreeItemPersonaLayout__main .fui-StyledText, [id^='roster-avatar-img-']",
            ATTENDEE_ROLE: "[data-tid='ts-roster-organizer-status'], .fui-TreeItemPersonaLayout__description .fui-StyledText",
            ATTENDEE_COUNT: "#roster-title-section-2",
            ATTENDEE_TREE: ".fui-FlatTree[role='tree'][aria-label='Attendees'], [data-tid='calling-roster'], [role='tree'][aria-label='Attendees']",
            ATTENDEE_ITEM: "[data-cid='roster-participant'], [data-tid^='participantsInCall-']"
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
            // Multiple checks for Teams meeting state
            const hasHangupButton = !!document.querySelector("button[data-tid='hangup-main-btn'], button[data-tid='hangup-leave-button']");
            
            // Additional checks for meeting indicators
            const hasMeetingControls = !!document.querySelector('[data-tid="calling-toolbar"], [data-tid="calling-controls-container"]');
            const hasStageView = !!document.querySelector('[data-tid="stage-view"], [data-tid="video-gallery"]');
            const hasCallDuration = !!document.querySelector('[data-tid="call-duration"]');
            
            // Consider in meeting if we have hangup button OR other strong meeting indicators
            return hasHangupButton || (hasMeetingControls && (hasStageView || hasCallDuration));
        },
        
        extractMeetingTitle: () => {
            // For Teams, try to get from page title while in meeting
            // Teams format: "Meeting Title | Microsoft Teams" or "Calendar | Meeting Title | Microsoft Teams"
            const docTitle = document.title;
            
            // Don't return generic page names that appear after redirect
            if (docTitle === 'Calendar' || 
                docTitle === 'Microsoft Teams' || 
                docTitle === 'Teams' ||
                docTitle.startsWith('Calendar |') && !docTitle.includes('|', 10)) {
                return 'Untitled Meeting';
            }
            
            // If title contains "Calendar |", extract the meeting name part
            if (docTitle.includes('Calendar |')) {
                const parts = docTitle.split('|');
                if (parts.length >= 2) {
                    // Return the second part (meeting title) but validate it's not generic
                    const meetingPart = parts[1].trim();
                    if (meetingPart && meetingPart !== 'Microsoft Teams') {
                        return meetingPart;
                    }
                }
            }
            
            // Otherwise, remove the "| Microsoft Teams" suffix
            const cleanedTitle = docTitle.replace(/ \| Microsoft Teams.*$/, '').replace(/^\(\d+\) /, '').trim();
            
            // Final validation - don't return generic names
            if (cleanedTitle === 'Calendar' || cleanedTitle === 'Teams' || cleanedTitle === '') {
                return 'Untitled Meeting';
            }
            
            return cleanedTitle || 'Untitled Meeting';
        },
        
        // Chat capture methods for Teams
        chatCapture: {
            isSupported: () => true,
            
            detectCurrentPanel: () => {
                const chatPanel = document.querySelector('#chat-pane-list, [data-tid="message-pane-list-viewport"]');
                const peoplePanel = document.querySelector('[data-tid="calling-roster"], .fui-FlatTree[role="tree"][aria-label="Attendees"]');
                
                if (chatPanel && chatPanel.offsetParent !== null) {
                    return 'chat';
                } else if (peoplePanel && peoplePanel.offsetParent !== null) {
                    return 'people';
                }
                return 'none';
            },
            
            openChatPanel: async () => {
                const chatButton = document.querySelector('[data-inp="chat-button"]');
                if (chatButton) {
                    chatButton.click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return true;
                }
                return false;
            },
            
            openPeoplePanel: async () => {
                const peopleButton = document.querySelector('[data-tid="calling-roster-button"], button[aria-label*="People"]');
                if (peopleButton) {
                    peopleButton.click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return true;
                }
                return false;
            },
            
            isUserTyping: () => {
                const chatInput = document.querySelector(
                    'div[contenteditable="true"][data-tid="ckeditor"], ' +
                    'div[contenteditable="true"][role="textbox"], ' +
                    'div.ck-editor__editable, ' +
                    'div[data-tid="chat-pane-compose"]'
                );
                
                if (chatInput) {
                    const hasFocus = document.activeElement === chatInput || chatInput.contains(document.activeElement);
                    const hasContent = chatInput.textContent && chatInput.textContent.trim().length > 0;
                    return hasFocus && hasContent;
                }
                
                // Check for modal dialogs
                const hasModal = document.querySelector('[role="dialog"]:not([aria-hidden="true"])');
                return !!hasModal;
            },
            
            getChatMessages: () => {
                return document.querySelectorAll('[data-tid="chat-pane-message"]');
            },
            
            getChatMessageData: (msgElement) => {
                const messageId = msgElement.getAttribute('data-mid');
                const container = msgElement.closest('.fui-unstable-ChatItem');
                const authorEl = container?.querySelector('[data-tid="message-author-name"]');
                const contentEl = msgElement.querySelector('[id^="content-"]');

                if (!contentEl || !contentEl.textContent) return null;

                // Extract image attachments
                const attachments = [];

                // Look for images in Teams messages using the correct selectors
                // Teams uses fui-Image class and data-tid="lazy-image-2"
                const images = msgElement.querySelectorAll('.fui-Image, img[data-tid*="lazy-image"], img[itemtype="http://schema.skype.com/AMSImage"]');
                console.log(`[Teams Chat] Found ${images.length} images in message ${messageId}`);
                images.forEach(img => {
                    // Skip avatars, emojis, and icons
                    if (img.src &&
                        !img.src.includes('emoji') &&
                        !img.src.includes('avatar') &&
                        !img.closest('.fui-Icon-filled, .fui-Icon-regular')) {

                        // Get the original source URL if available (Teams often uses blob URLs)
                        const originalSrc = img.getAttribute('data-orig-src') || img.src;
                        const galleryUrl = img.getAttribute('data-gallery-src');

                        // Use the best quality URL available
                        const imageUrl = galleryUrl || originalSrc;

                        // Extract filename from alt text or use a default
                        const altText = img.alt || img.title || 'Image attachment';
                        let filename = altText;

                        // If the alt text is just "image", try to generate a better filename
                        if (filename.toLowerCase() === 'image' && imageUrl.includes('/')) {
                            const urlParts = imageUrl.split('/');
                            const lastPart = urlParts[urlParts.length - 1];
                            if (lastPart && !lastPart.startsWith('img')) {
                                filename = lastPart.split('?')[0];
                            } else {
                                filename = 'image.png';
                            }
                        }

                        attachments.push({
                            type: 'image',
                            url: imageUrl,
                            alt: altText,
                            filename: filename
                        });
                        console.log(`[Teams Chat] Added image attachment: ${filename}`, { url: imageUrl, alt: altText });
                    }
                });

                // Look for file attachments with preview images
                const fileAttachments = msgElement.querySelectorAll('.fui-AttachmentCard');
                fileAttachments.forEach(card => {
                    const nameEl = card.querySelector('.fui-AttachmentCard__name');
                    const imageEl = card.querySelector('img');
                    if (imageEl && imageEl.src && !attachments.some(a => a.url === imageEl.src)) {
                        const originalSrc = imageEl.getAttribute('data-orig-src') || imageEl.src;
                        attachments.push({
                            type: 'image',
                            url: originalSrc,
                            alt: nameEl?.textContent || 'File attachment',
                            filename: nameEl?.textContent || 'attachment'
                        });
                    }
                });

                // Look for GIFs
                const gifs = msgElement.querySelectorAll('.gif-item-container img');
                gifs.forEach(gif => {
                    if (gif.src && !attachments.some(a => a.url === gif.src)) {
                        attachments.push({
                            type: 'image',
                            url: gif.src,
                            alt: 'GIF',
                            filename: 'animated.gif'
                        });
                    }
                });

                // Extract timestamp from message ID (data-mid is Unix timestamp in milliseconds)
                let timestamp = null;
                if (messageId && !isNaN(messageId)) {
                    timestamp = parseInt(messageId);
                }

                return {
                    id: messageId,
                    author: authorEl?.textContent || 'Unknown',
                    text: contentEl.textContent || contentEl.getAttribute('aria-label'),
                    time: null, // Will be replaced with formatted timestamp in content_script
                    timestamp: timestamp, // Unix timestamp in milliseconds for filtering
                    attachments: attachments.length > 0 ? attachments : undefined
                };
            }
        }
    },
    
    // Teams Live uses the same interface as Teams Microsoft, so we'll reuse the configuration
    'teams.live.com': null, // Will be set below after teams.microsoft.com is defined
    
    'meet.google.com': {
        name: 'Google Meet',
        
        // Function to get current user's name
        getCurrentUserName: () => {
            // Try multiple methods to find the user's name
            
            // Method 1: Look for "(You)" indicator in participants list
            const youIndicators = document.querySelectorAll('.NnTWjc');
            for (const indicator of youIndicators) {
                if (indicator.textContent.includes('You')) {
                    // Find the name element in the same container
                    const container = indicator.closest('.jKwXVe, .cxdMu, .SKWIhd');
                    if (container) {
                        const nameEl = container.querySelector('.zWGUib');
                        if (nameEl) {
                            const name = nameEl.textContent.trim();
                            if (name && name !== 'You') {
                                window.currentUserName = name;
                                console.log('[Caption Saver] Detected user name from participants:', name);
                                return name;
                            }
                        }
                    }
                }
            }
            
            // Method 2: Check in contributors section
            const contributorsList = document.querySelector('.RJRKn, .m3Uzve.RJRKn');
            if (contributorsList) {
                const yourItem = contributorsList.querySelector('.cxdMu[role="listitem"]');
                if (yourItem) {
                    const nameEl = yourItem.querySelector('.zWGUib');
                    const youEl = yourItem.querySelector('.NnTWjc');
                    if (nameEl && youEl && youEl.textContent.includes('You')) {
                        const name = nameEl.textContent.trim();
                        if (name && name !== 'You') {
                            window.currentUserName = name;
                            console.log('[Caption Saver] Detected user name from contributors:', name);
                            return name;
                        }
                    }
                }
            }

            // Method 3: Check profile button in header (fallback for different layouts)
            const profileButtons = document.querySelectorAll('[data-tooltip*="Account"], [aria-label*="Account"], [aria-label*="Google Account"]');
            for (const profileButton of profileButtons) {
                const ariaLabel = profileButton.getAttribute('aria-label');
                if (ariaLabel) {
                    // Extract name from "Google Account: Name (email@domain.com)" pattern
                    const nameMatch = ariaLabel.match(/Google Account:\s*([^(]+)/i) || ariaLabel.match(/^([^(,]+)/);
                    if (nameMatch && nameMatch[1]) {
                        const name = nameMatch[1].trim();
                        if (name && name !== 'You' && !name.includes('@')) {
                            window.currentUserName = name;
                            console.log('[Caption Saver] Detected user name from profile button:', name);
                            return name;
                        }
                    }
                }
            }

            // Method 4: Try to find name in top bar user info
            const userButtons = document.querySelectorAll('[data-ved] img[alt], .gb_d img[alt]');
            for (const img of userButtons) {
                const alt = img.getAttribute('alt');
                if (alt && alt !== 'You' && !alt.includes('@') && alt.length > 0 && alt.length < 50) {
                    window.currentUserName = alt;
                    console.log('[Caption Saver] Detected user name from user button:', alt);
                    return alt;
                }
            }

            return window.currentUserName || 'You';
        },
        
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
                // First try to get current user name from participants
                const config = PLATFORM_CONFIGS['meet.google.com'];
                if (config.getCurrentUserName) {
                    const actualName = config.getCurrentUserName();
                    if (actualName && actualName !== 'You') {
                        speakerName = actualName;
                    }
                } else if (window.currentUserName) {
                    // Fall back to stored name
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
            
            let attendeeName = nameElement.textContent.trim();
            
            // Store the actual name if this is the current user
            if (isYou && attendeeName && attendeeName !== 'You') {
                window.currentUserName = attendeeName;
                console.log('[Caption Saver] Detected current user name from attendee list:', attendeeName);
            }
            
            return {
                name: attendeeName,
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
            
            // Meeting ended detection handled elsewhere
            
            window.lastMeetingActiveState = inMeeting;
            return inMeeting;
        },
        
        extractMeetingTitle: () => {
            // For Google Meet, extract from page title
            // Format: "Meeting Title - Google Meet" or just "Meet - Meeting Code"
            const docTitle = document.title;
            
            // Remove the "- Google Meet" suffix
            let title = docTitle.replace(/ - Google Meet.*$/, '').trim();
            
            // If it's just "Meet - xyz-abc-def", try to get a better title from the page
            if (title.startsWith('Meet - ')) {
                // Try to find meeting name in the UI if available
                const meetingNameElement = document.querySelector('[data-meeting-title], .meeting-title, .rua5Nb');
                if (meetingNameElement && meetingNameElement.textContent.trim()) {
                    title = meetingNameElement.textContent.trim();
                } else {
                    // Use the meeting code as fallback
                    title = title.replace('Meet - ', 'Meeting ');
                }
            }
            
            return title || 'Untitled Meeting';
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
        },
        
        // Chat capture methods for Google Meet
        chatCapture: {
            isSupported: () => true,
            
            detectCurrentPanel: () => {
                // Google Meet uses a side panel that can show different views
                // Check which panel button is active (aria-expanded="true")
                const chatButton = document.querySelector('button[aria-label*="Chat"][data-panel-id="2"]');
                const peopleButton = document.querySelector('button[aria-label*="People"][data-panel-id="1"]');
                
                // Also check for visible chat messages as confirmation
                const hasVisibleChat = document.querySelector('.RLrADb[data-message-id], .Ss4fHf');
                
                if (chatButton?.getAttribute('aria-expanded') === 'true' || hasVisibleChat) {
                    return 'chat';
                } else if (peopleButton?.getAttribute('aria-expanded') === 'true') {
                    return 'people';
                }
                return 'none';
            },
            
            openChatPanel: async () => {
                const chatButton = document.querySelector('button[aria-label*="Chat"][data-panel-id="2"]');
                if (chatButton && chatButton.getAttribute('aria-expanded') !== 'true') {
                    chatButton.click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return true;
                }
                return false;
            },
            
            openPeoplePanel: async () => {
                const peopleButton = document.querySelector('button[aria-label*="People"][data-panel-id="1"]');
                if (peopleButton && peopleButton.getAttribute('aria-expanded') !== 'true') {
                    peopleButton.click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return true;
                }
                return false;
            },
            
            isUserTyping: () => {
                // Check for active chat input in Google Meet
                const chatInput = document.querySelector('textarea[aria-label*="Send a message"], input[aria-label*="Send a message"]');
                
                if (chatInput) {
                    const hasFocus = document.activeElement === chatInput;
                    const hasContent = chatInput.value && chatInput.value.trim().length > 0;
                    return hasFocus && hasContent;
                }
                
                // Check for modal dialogs
                const hasModal = document.querySelector('[role="dialog"]:not([aria-hidden="true"])');
                return !!hasModal;
            },
            
            getChatMessages: () => {
                // Google Meet chat messages - look for the message containers
                return document.querySelectorAll('.RLrADb[data-message-id], .Ss4fHf');
            },
            
            getChatMessageData: (msgElement) => {
                // Find the actual message container
                let messageContainer = msgElement.querySelector('.RLrADb[data-message-id]');
                if (!messageContainer && msgElement.classList.contains('RLrADb')) {
                    messageContainer = msgElement;
                }
                if (!messageContainer) return null;

                // Get message ID
                const messageId = messageContainer.getAttribute('data-message-id') || Date.now().toString();

                // Get parent container for author and time
                const parentContainer = messageContainer.closest('.Ss4fHf');

                // Author name
                const authorEl = parentContainer?.querySelector('.poVWob');
                let authorName = authorEl?.textContent || 'Unknown';

                // If author is "You", get the actual name
                if (authorName === 'You') {
                    const config = PLATFORM_CONFIGS['meet.google.com'];
                    if (config.getCurrentUserName) {
                        const actualName = config.getCurrentUserName();
                        if (actualName && actualName !== 'You') {
                            authorName = actualName;
                        }
                    }
                }

                // Message content - look inside the message container
                const contentEl = messageContainer.querySelector('[jsname="dTKtvb"] > div, .ptNLrf > div');

                // Time
                const timeEl = parentContainer?.querySelector('.MuzmKe');

                if (!contentEl || !contentEl.textContent) return null;

                // Extract image attachments
                const attachments = [];

                // Look for images in the message
                const images = messageContainer.querySelectorAll('img[src]');
                images.forEach(img => {
                    // Skip avatars and emojis
                    if (img.src && !img.src.includes('googleusercontent.com/a/') &&
                        !img.classList.contains('emoji') && !img.closest('.poVWob')) {

                        // Try to get filename from alt text or URL
                        let filename = img.alt || 'image.png';
                        if (!img.alt && img.src.includes('/')) {
                            const urlParts = img.src.split('/');
                            const lastPart = urlParts[urlParts.length - 1];
                            if (lastPart && lastPart.includes('.')) {
                                filename = lastPart.split('?')[0]; // Remove query params
                            }
                        }

                        attachments.push({
                            type: 'image',
                            url: img.src,
                            alt: img.alt || 'Image attachment',
                            filename: filename
                        });
                    }
                });

                // Look for file attachment containers (Google Meet may show previews)
                const attachmentContainers = messageContainer.querySelectorAll('.attachment-container, [role="img"]');
                attachmentContainers.forEach(container => {
                    const img = container.querySelector('img');
                    if (img && img.src && !attachments.some(a => a.url === img.src)) {
                        attachments.push({
                            type: 'image',
                            url: img.src,
                            alt: container.getAttribute('aria-label') || 'File attachment',
                            filename: container.getAttribute('aria-label') || 'attachment'
                        });
                    }
                });

                // Try to extract timestamp from time element or message ID
                let timestamp = null;
                if (timeEl && timeEl.textContent) {
                    // Google Meet shows relative times like "10:30 AM" - we'll use current time as fallback
                    // Since we can't reliably parse relative times, use message creation time
                    timestamp = Date.now();
                } else if (messageId && !isNaN(messageId)) {
                    // If message ID is numeric, it might be a timestamp
                    timestamp = parseInt(messageId);
                } else {
                    // Fallback to current time
                    timestamp = Date.now();
                }

                return {
                    id: messageId,
                    author: authorName,
                    text: contentEl.textContent.trim(),
                    time: null, // Will be replaced with formatted timestamp in content_script
                    timestamp: timestamp, // Unix timestamp in milliseconds for filtering
                    attachments: attachments.length > 0 ? attachments : undefined
                };
            }
        }
    },
    
    'zoom.us': {  // This will match both web.zoom.us and app.zoom.us
        name: 'Zoom',
        // Store mapping of initials to full names
        speakerNameCache: new Map(),
        
        // Build initial mapping from attendee list
        buildSpeakerNameMapping: function() {
            const participants = document.querySelectorAll('.participants-item-position .participants-li');
            let mappingCount = 0;
            
            for (const participant of participants) {
                const nameEl = participant.querySelector('.participants-item__display-name');
                if (nameEl) {
                    const fullName = nameEl.textContent.trim();
                    if (fullName && fullName !== 'Unknown Speaker') {
                        // Generate initials from the name
                        const initials = fullName.split(' ')
                            .filter(word => word.length > 0)
                            .map(word => word.charAt(0).toUpperCase())
                            .join('');
                        
                        if (initials && !this.speakerNameCache.has(initials)) {
                            this.speakerNameCache.set(initials, fullName);
                            mappingCount++;
                        }
                    }
                }
            }
            
            if (mappingCount > 0) {
                console.log(`[Caption Saver] Built speaker name mapping for ${mappingCount} participants`);
            }
            
            return mappingCount;
        },
        selectors: {
            // Caption selectors
            captionsContainer: '.live-transcription-subtitle__box, .transcript-list, .closed-caption-container, .closed-caption-box',
            captionBlock: '.live-transcription-subtitle__box, #live-transcription-subtitle, .live-transcription-subtitle__box div[id="live-transcription-subtitle"], .transcript-message, .closed-caption-line, .closed-caption-box__message',
            speakerName: '.transcript-message-speaker, .closed-caption-speaker, .closed-caption-box__name',
            captionText: '.live-transcription-subtitle__item, .transcript-message-text, .closed-caption-text, .closed-caption-box__text',
            speakerAvatar: '.zmu-data-selector-item__icon',
            
            // Meeting controls
            hangupButton: 'button[aria-label="End"], button[aria-label="Leave"], .footer-button-base__button[aria-label*="End"], .footer-button-base__button[aria-label*="Leave"], button:has(.footer-button-base__button-label:text("End")), button:has(.footer-button-base__button-label:text("Leave"))',
            moreButton: '.footer-button-base__button',
            turnOnCaptionsButton: 'a[aria-label="Captions"], .more-button__item-box a[aria-label="Captions"], button[aria-label*="Closed Caption"], button[aria-label*="Show captions"], button[aria-label*="Show subtitle"]',
            turnOffCaptionsButton: 'button[aria-label*="Hide subtitle"], button[aria-label*="Hide captions"]',
            
            // Attendee tracking selectors
            peopleButton: '#participant button[aria-label*="manage participants"], #participant button[aria-label*="close the manage participants"]',
            attendeeList: '#participants-ul, .participants-list-container',
            attendeeItem: '.participants-item-position .participants-li',
            attendeeName: '.participants-item__display-name',
            attendeeRole: '.participants-item__name-label',
            attendeeCount: '.participants-header__title span[aria-label*="Participants"]',
            
            // Chat selectors
            chatButton: '#chat button[aria-label*="open the chat"], #chat button[aria-label*="close the chat"]',
            chatContainer: '.chat-container, .chat-virtualized-list',
            chatMessage: '.chat-item-container',
            chatSender: '.chat-item__sender',
            chatText: '.new-chat-message__text-content ._rtfEditor_1n3rs_1',
            chatTime: '.new-chat-item__chat-info-time-stamp',
            
            // Unused/Reserved selectors
            sidePanel: '.window-content-container',
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
            // Check if this is the live transcription format
            // The element might be the box itself or contain the subtitle div
            const isLiveTranscription = element.classList.contains('live-transcription-subtitle__box') ||
                                       element.id === 'live-transcription-subtitle' ||
                                       element.querySelector('#live-transcription-subtitle');
            
            if (isLiveTranscription) {
                // Find the actual subtitle container if we have the outer box
                const subtitleContainer = element.id === 'live-transcription-subtitle' ? element :
                                        (element.querySelector('#live-transcription-subtitle') || element);

                // Find the text element - it should always have the caption text even if hidden
                const textElement = subtitleContainer.querySelector('.live-transcription-subtitle__item') ||
                                  subtitleContainer.querySelector('span[dir="auto"]');
                
                if (!textElement || !textElement.textContent.trim()) return null;
                
                // Get speaker name from the avatar element (the colored circle with initials)
                let speakerName = 'Unknown Speaker';
                const avatarElement = subtitleContainer.querySelector('.zmu-data-selector-item__icon') ||
                                    element.querySelector('.zmu-data-selector-item__icon');
                
                if (avatarElement) {
                    // The avatar element contains initials as text content (e.g., "TS" for the user)
                    const initials = avatarElement.textContent.trim().toUpperCase();

                    if (initials) {
                        // First check our cache
                        const config = PLATFORM_CONFIGS['zoom.us'];
                        if (config.speakerNameCache.has(initials)) {
                            speakerName = config.speakerNameCache.get(initials);
                        } else {
                            // Performance: If cache is empty, rebuild it once
                            if (config.speakerNameCache.size === 0) {
                                config.buildSpeakerNameMapping();
                                // Try cache again after rebuild
                                if (config.speakerNameCache.has(initials)) {
                                    speakerName = config.speakerNameCache.get(initials);
                                }
                            }

                            // If still no match after cache check/rebuild, try active speaker video tile
                            if (speakerName === 'Unknown Speaker') {
                                const activeVideoFooter = document.querySelector('.video-avatar__avatar-footer span[role="none"]');
                                if (activeVideoFooter) {
                                    const fullName = activeVideoFooter.textContent.trim();
                                    // Check if this name's initials match
                                    const nameInitials = fullName.split(' ')
                                        .filter(word => word.length > 0)
                                        .map(word => word.charAt(0).toUpperCase())
                                        .join('');
                                    if (nameInitials === initials) {
                                        speakerName = fullName;
                                        // Cache this mapping for future use
                                        config.speakerNameCache.set(initials, fullName);
                                        console.log(`[Caption Saver] Mapped initials '${initials}' to '${fullName}'`);
                                    }
                                }
                            }

                            // Performance: Only scan participants panel as last resort fallback
                            // This is expensive, but needed for new participants who join mid-meeting
                            if (speakerName === 'Unknown Speaker') {
                                const participants = document.querySelectorAll('.participants-item-position .participants-li');
                                for (const participant of participants) {
                                    const nameEl = participant.querySelector('.participants-item__display-name');
                                    if (nameEl) {
                                        const fullName = nameEl.textContent.trim();
                                        // Check if initials match
                                        const nameInitials = fullName.split(' ')
                                            .filter(word => word.length > 0)
                                            .map(word => word.charAt(0).toUpperCase())
                                            .join('');
                                        if (nameInitials === initials) {
                                            speakerName = fullName;
                                            // Cache this mapping
                                            config.speakerNameCache.set(initials, fullName);
                                            console.log(`[Caption Saver] Mapped initials '${initials}' to '${fullName}' from participants`);
                                            break;
                                        }
                                    }
                                }
                            }

                            // If still no match, use initials as fallback
                            if (speakerName === 'Unknown Speaker') {
                                speakerName = `Speaker (${initials})`;
                            }
                        }
                    }
                }
                
                // If still no name, try to get from current user info
                if (speakerName === 'Unknown Speaker') {
                    // Check if participants panel is open
                    const currentUserElement = document.querySelector('.participants-item-position [aria-label*="me"] .participants-item__display-name');
                    if (currentUserElement) {
                        speakerName = currentUserElement.textContent.trim();
                    }
                }
                
                return {
                    Name: speakerName,
                    Text: textElement.textContent.trim(),
                    Time: new Date().toLocaleTimeString()
                };
            }
            
            // Fallback to other caption formats
            const speakerElement = element.querySelector('.transcript-message-speaker, .closed-caption-speaker, .closed-caption-box__name');
            const textElement = element.querySelector('.live-transcription-subtitle__item, .transcript-message-text, .closed-caption-text, .closed-caption-box__text');
            if (!textElement) return null;
            
            return {
                Name: speakerElement ? speakerElement.textContent.trim() : 'Unknown Speaker',
                Text: textElement.textContent.trim(),
                Time: new Date().toLocaleTimeString()
            };
        },
        getAttendeeData: (element) => {
            const nameElement = element.querySelector('.participants-item__display-name');
            const roleElement = element.querySelector('.participants-item__name-label');
            const ariaLabel = element.querySelector('[role="application"]')?.getAttribute('aria-label') || '';
            
            if (!nameElement) return null;
            
            let attendeeName = nameElement.textContent.trim();
            let role = 'Participant';
            
            // Also add this name to our speaker cache while we're scanning attendees
            if (attendeeName && attendeeName !== 'Unknown Speaker') {
                const config = PLATFORM_CONFIGS['zoom.us'];
                const initials = attendeeName.split(' ')
                    .filter(word => word.length > 0)
                    .map(word => word.charAt(0).toUpperCase())
                    .join('');
                
                if (initials && !config.speakerNameCache.has(initials)) {
                    config.speakerNameCache.set(initials, attendeeName);
                }
            }
            
            // Extract role from label text or aria-label
            if (roleElement) {
                const roleText = roleElement.textContent.trim();
                if (roleText.includes('Host')) role = 'Host';
                else if (roleText.includes('Co-host')) role = 'Co-host';
            } else if (ariaLabel.includes('Host')) {
                role = 'Host';
            }
            
            // Check if this is the current user
            const isCurrentUser = roleElement?.textContent.includes('me') || ariaLabel.includes('me');
            
            return {
                name: attendeeName,
                role: role,
                isCurrentUser: isCurrentUser
            };
        },
        isMeetingActive: () => {
            // Check if we're on the Zoom home page - NOT a meeting
            if (window.location.pathname === '/wc/home' || window.location.pathname.includes('/wc/home')) {
                return false;
            }

            // Check if we're on a Zoom meeting page
            // Meeting URLs have patterns like /wc/{meetingId}/start or /wc/{meetingId}/join
            const pathParts = window.location.pathname.split('/');
            const isOnMeetingPage = (
                // Check for /wc/{number}/start or /wc/{number}/join pattern (works in iframe too)
                (pathParts[1] === 'wc' && pathParts[2] && !isNaN(pathParts[2]) && (pathParts[3] === 'start' || pathParts[3] === 'join')) ||
                // Check for other meeting patterns
                window.location.pathname.includes('/j/') ||
                window.location.pathname.includes('/meeting')
            );

            // Check for leave/end button and ensure we're not on the post-meeting page
            // Also check for button containing the End text in a span
            const hasLeaveButton = !!document.querySelector('button[aria-label="End"], button[aria-label="Leave"], .footer-button-base__button[aria-label*="End"], .footer-button-base__button[aria-label*="Leave"]') ||
                                 !!Array.from(document.querySelectorAll('.footer-button-base__button-label')).find(el => el.textContent === 'End' || el.textContent === 'Leave');
            const onPostMeetingPage = window.location.pathname.includes('/postattendee') ||
                                      document.querySelector('.post-meeting-container') ||
                                      document.querySelector('.meeting-ended-container');

            // Also check for meeting controls presence (more reliable in iframe)
            const hasMeetingControls = !!document.querySelector('.footer-button-base__button, .meeting-footer, .footer__btns-container');

            // Additional check: Look for video container or participant video
            const hasVideoContainer = !!document.querySelector('.video-container, .speaker-active-container, .gallery-video-container__wrapper');

            // Check for the live transcription element as an indicator of being in a meeting
            const hasTranscriptionElement = !!document.querySelector('.live-transcription-subtitle__box, #live-transcription-subtitle');

            // Special check for iframe contexts - if we're in an iframe with meeting path, we're in a meeting
            const isInIframe = window !== window.top;
            const iframeHasMeetingPath = isInIframe && isOnMeetingPage;

            // For Zoom, we consider it active if we have any strong indicators of being in a meeting
            const inMeeting = ((isOnMeetingPage || hasLeaveButton || hasMeetingControls || hasVideoContainer || hasTranscriptionElement || iframeHasMeetingPath) && !onPostMeetingPage);

            // Log for debugging when enabled
            if (window.debugZoomMeeting) {
                console.log('[Zoom Meeting Detection]', window.location.pathname, {
                    pathname: window.location.pathname,
                    isOnMeetingPage,
                    hasLeaveButton,
                    hasMeetingControls,
                    hasVideoContainer,
                    hasTranscriptionElement,
                    onPostMeetingPage,
                    result: inMeeting
                });
            }
            
            return inMeeting;
        },
        
        extractMeetingTitle: () => {
            // For Zoom, extract from page title or meeting info
            // Format: "Zoom Meeting" or "Meeting Title - Zoom"
            const docTitle = document.title;
            
            // Try to find meeting topic in the UI first
            const topicElement = document.querySelector('.meeting-topic, .meeting-info-container__title, [aria-label*="Topic:"]');
            if (topicElement && topicElement.textContent.trim()) {
                return topicElement.textContent.trim();
            }
            
            // Clean up the document title
            let title = docTitle;
            
            // Remove common Zoom suffixes
            title = title.replace(/ - Zoom.*$/, '').trim();
            title = title.replace(/^Zoom Meeting$/, '').trim();
            title = title.replace(/^Zoom$/, '').trim();
            
            // If we just have "Zoom Meeting" or empty, return a generic title
            if (!title || title === 'Zoom Meeting' || title === 'Zoom') {
                // Try to get meeting ID as last resort
                const meetingId = window.location.pathname.match(/\/wc\/(\d+)/)?.[1];
                if (meetingId) {
                    return `Zoom Meeting ${meetingId}`;
                }
                return 'Zoom Meeting';
            }
            
            return title;
        },
        
        areCaptionsEnabled: () => {
            // Check UI state to determine if captions are enabled
            // Priority 1: Check for Hide button (strongest indicator that captions are on)
            const hideButton = document.querySelector('button[aria-label*="Hide subtitle"], button[aria-label*="Hide captions"]');
            if (hideButton) return true;

            // Priority 2: Check for caption containers (even if empty - no speech yet)
            const liveTranscriptionBox = document.querySelector('.live-transcription-subtitle__box');
            const transcriptElement = document.querySelector('#live-transcription-subtitle');
            const captionsVisible = document.querySelector('.closed-caption-container, .closed-caption-box');
            const captionContainer = document.querySelector('.live-transcription-subtitle, .live-transcription-container, [class*="transcription"]');

            // Priority 3: Check for the closed-captions-renderer element
            const closedCaptionsRenderer = document.querySelector('[data-tid="closed-captions-renderer"]');

            // Check if there's actual caption text present
            const hasCaptionText = !!(liveTranscriptionBox?.textContent || transcriptElement?.textContent);

            // For Zoom, the presence of the live transcription box is a strong indicator
            const result = !!(liveTranscriptionBox || transcriptElement || captionsVisible || captionContainer || closedCaptionsRenderer);

            // Log for debugging if needed
            if (window.debugZoomCaptions) {
                console.log('[Zoom Captions Detection]', {
                    liveTranscriptionBox: !!liveTranscriptionBox,
                    transcriptElement: !!transcriptElement,
                    captionsVisible: !!captionsVisible,
                    hideButton: !!hideButton,
                    hasCaptionText: !!hasCaptionText,
                    captionContainer: !!captionContainer,
                    result
                });
            }
            
            return result;
        },
        async enableCaptions(retryCount = 0) {
            try {
                console.log(`[Caption Saver] Starting Zoom caption enable process (attempt ${retryCount + 1})`);

                // First check if captions are already enabled
                if (this.areCaptionsEnabled()) {
                    console.log('[Caption Saver] Captions are already enabled');
                    return true;
                }
                
                // Step 1: Find the More button in the meeting controls
                let moreButton = null;
                
                // For Zoom in iframe - look for footer button
                const footerButtons = document.querySelectorAll('.footer-button-base__button');
                for (const btn of footerButtons) {
                    const text = btn.textContent?.trim();
                    const ariaLabel = btn.getAttribute('aria-label') || '';
                    
                    // Find the More button (not audio/video controls)
                    if ((text === 'More' || ariaLabel.includes('More')) && 
                        !ariaLabel.includes('audio') && 
                        !ariaLabel.includes('video')) {
                        moreButton = btn;
                        console.log('[Caption Saver] Found More button in footer:', text || ariaLabel);
                        break;
                    }
                }
                
                // Fallback: Look for button with "More" text
                if (!moreButton) {
                    const allButtons = document.querySelectorAll('button');
                    for (const btn of allButtons) {
                        if (btn.textContent?.trim() === 'More' && 
                            !btn.closest('.home-header') &&  // Not in header
                            btn.offsetParent !== null) {     // Visible
                            moreButton = btn;
                            console.log('[Caption Saver] Found More button by text');
                            break;
                        }
                    }
                }
                
                // Check if we need to click the More button or if menu is already open
                const menuAlreadyOpen = document.querySelector('.WCL-footer-more-btn-container .dropdown-menu.show, .more-button__pop-menu.show, .more-button__pop-menu[style*="display: block"], [aria-label="More"] + div[style*="display: block"]');
                
                if (moreButton && !menuAlreadyOpen) {
                    console.log('[Caption Saver] Step 1: Attempting to click More button');

                    // Try multiple click methods to ensure it works
                    try {
                        // Method 1: Focus then click
                        moreButton.focus();
                        await new Promise(resolve => setTimeout(resolve, 100));
                        moreButton.click();

                        // Wait and check
                        await new Promise(resolve => setTimeout(resolve, 500));

                        // Method 2: Dispatch events if menu still not open
                        if (!document.querySelector('.dropdown-menu.show, .more-button__pop-menu.show, .more-button__pop-menu, [role="menu"]:not([aria-hidden="true"])')) {
                            console.log('[Caption Saver] First click didn\'t work, trying mouse events');
                            const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
                            const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
                            const click = new MouseEvent('click', { bubbles: true, cancelable: true });

                            moreButton.dispatchEvent(mouseDown);
                            moreButton.dispatchEvent(mouseUp);
                            moreButton.dispatchEvent(click);
                        }
                    } catch (e) {
                        console.log('[Caption Saver] Error clicking More button:', e);
                    }

                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for menu to open
                    
                    // Verify menu opened - check multiple selectors
                    const menuNowOpen = document.querySelector('.dropdown-menu.show, .more-button__pop-menu.show, .more-button__pop-menu, [role="menu"]:not([aria-hidden="true"]), .footer__more-button-pop-menu');
                    if (!menuNowOpen) {
                        console.log('[Caption Saver] Menu did not open after clicking More button, will retry if attempts remain');
                        // Don't return false here - let it fall through to retry logic
                    } else {
                        console.log('[Caption Saver] Menu opened successfully');
                    }
                    
                } else if (menuAlreadyOpen) {
                    console.log('[Caption Saver] More menu is already open, proceeding to find Captions');
                } else if (!moreButton) {
                    console.log('[Caption Saver] More button not found in meeting controls, will retry if attempts remain');
                    // Don't return false here - let it fall through to retry logic
                }
                
                // Only proceed to Step 2 if menu is actually open
                const menuIsOpen = document.querySelector('.dropdown-menu.show, .more-button__pop-menu.show, .more-button__pop-menu, [role="menu"]:not([aria-hidden="true"]), .footer__more-button-pop-menu');

                if (menuIsOpen) {
                    // Step 2: Find and click Captions option
                    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for menu to fully render

                    // Look for Captions link - the menu structure shows it's in .more-button__item-box
                    let captionsOption = null;

                    // Primary method: Look for the Captions link directly
                    captionsOption = document.querySelector('.more-button__item-box a[aria-label="Captions"]');
                
                if (!captionsOption) {
                    // Try finding via the SvgCaptions icon
                    const svgCaptions = document.querySelector('.SvgCaptions');
                    if (svgCaptions) {
                        // Navigate from icon to the link
                        const itemBox = svgCaptions.closest('.more-button__item-box');
                        if (itemBox) {
                            captionsOption = itemBox.querySelector('a[aria-label="Captions"]') || itemBox.querySelector('a');
                            console.log('[Caption Saver] Found captions via SvgCaptions icon');
                        }
                    }
                }
                
                if (!captionsOption) {
                    // Fallback: Look through all dropdown items
                    const dropdownItems = document.querySelectorAll('.dropdown-menu.show .dropdown-item');
                    for (const item of dropdownItems) {
                        if (item.getAttribute('aria-label') === 'Captions' || item.textContent.trim() === 'Captions') {
                            captionsOption = item;
                            console.log('[Caption Saver] Found captions in dropdown items');
                            break;
                        }
                    }
                }
                
                if (captionsOption) {
                    // console.log('[Caption Saver] Step 2: Clicking Captions option');
                    captionsOption.click();
                    await new Promise(resolve => setTimeout(resolve, 700));
                    
                    // Step 3: Click on Show Captions in the submenu
                    const showCaptionsButton = document.querySelector('a[aria-label*="Show Captions"], .dropdown-menu.show a[aria-label*="Show Captions"]');
                    if (showCaptionsButton) {
                        // console.log('[Caption Saver] Step 3: Clicking Show Captions');
                        showCaptionsButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Step 4: Handle the language selection dialog if it appears
                        const languageDialog = document.querySelector('.zm-modal.lt-select-language, .new-LT__selector-language-dialog');
                        if (languageDialog) {
                            // console.log('[Caption Saver] Step 4: Language dialog detected, clicking Save');
                            
                            // Look for the Save button in the modal
                            const saveButton = document.querySelector('.zm-modal-footer button.zm-btn--primary, .zm-modal-footer button:last-child');
                            if (saveButton && (saveButton.textContent.includes('Save') || saveButton.textContent.includes('OK'))) {
                                saveButton.click();
                                await new Promise(resolve => setTimeout(resolve, 1000));
                                // console.log('[Caption Saver] Language dialog saved');
                            }
                        }
                        
                        // Check if captions are now enabled
                        const enabled = this.areCaptionsEnabled();
                        // console.log('[Caption Saver] Captions enabled:', enabled);
                        return enabled;
                    } else {
                        console.log('[Caption Saver] Could not find Show Captions button');
                        
                        // Try to close any open menus
                        const closeButton = document.querySelector('.dropdown-menu.show .close, [aria-expanded="true"]');
                        if (closeButton) closeButton.click();
                    }
                } else {
                    console.log('[Caption Saver] Could not find Captions option in More menu');
                    
                    // Fallback to other caption button selectors for different Zoom layouts
                    const directCaptionButton = document.querySelector('button[aria-label*="Closed Caption"], button[aria-label*="Show captions"], button[aria-label*="Show subtitle"]');
                    if (directCaptionButton) {
                        console.log('[Caption Saver] Using direct caption button (fallback)');
                        directCaptionButton.click();
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        // Check for language dialog in fallback case too
                        const languageDialog = document.querySelector('.zm-modal.lt-select-language');
                        if (languageDialog) {
                            const saveButton = document.querySelector('.zm-modal-footer button.zm-btn--primary');
                            if (saveButton) {
                                saveButton.click();
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        }
                        
                        return this.areCaptionsEnabled();
                    }
                }
                } // End of if (menuIsOpen)
            } catch (error) {
                console.error('[Caption Saver] Error enabling captions:', error);
            }

            // Wait a moment for UI to update after our actions
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Check if captions were successfully enabled by looking at UI state
            const captionsEnabled = this.areCaptionsEnabled();

            const MAX_RETRIES = 5;

            // If captions not enabled and we haven't exceeded max retries, try again
            if (!captionsEnabled && retryCount < MAX_RETRIES) {
                console.log(`[Caption Saver] Captions not enabled, retrying (attempt ${retryCount + 2}/${MAX_RETRIES + 1})...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                return this.enableCaptions(retryCount + 1);
            }

            if (!captionsEnabled) {
                console.error(`[Caption Saver] Failed to enable captions on Zoom after ${MAX_RETRIES + 1} attempts`);
                console.error('[Caption Saver] Please enable captions manually using the More button -> Captions');

                // Try to show user notification if chrome.runtime is available
                try {
                    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                        chrome.runtime.sendMessage({
                            action: 'showNotification',
                            title: 'Live Captions Saver',
                            message: 'Unable to auto-enable captions. Please enable manually via More → Captions.'
                        }).catch(() => {
                            // Silent fail - notification not critical
                        });
                    }
                } catch (e) {
                    // Silent fail - notification not critical
                }
            } else {
                console.log('[Caption Saver] Zoom captions successfully enabled (UI indicates captions are on)');
            }

            return captionsEnabled;
        },
        async openAttendeePanel() {
            // Check if panel is already open
            if (document.querySelector('.participants-section-container')) {
                console.log('[Caption Saver] Zoom participant panel is already open');
                return true;
            }
            
            // Try to find and click the participants button
            const peopleButton = document.querySelector('#participant button[aria-label*="participants" i], #participant button[aria-label*="manage" i]');
            if (peopleButton) {
                console.log('[Caption Saver] Opening attendee panel on Zoom');
                peopleButton.click();
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Verify panel opened
                if (document.querySelector('.participants-section-container')) {
                    return true;
                }
            }
            
            console.log('[Caption Saver] Could not open Zoom participant panel');
            return false;
        },
        
        // Chat capture methods for Zoom
        chatCapture: {
            isSupported: () => true,
            
            detectCurrentPanel: () => {
                // Check if chat panel is open
                const chatPanel = document.querySelector('.chat-container, .chat-virtualized-list');
                const participantsPanel = document.querySelector('.participants-section-container');
                
                // Zoom can have both open at the same time
                if (chatPanel) {
                    return 'chat';
                } else if (participantsPanel) {
                    return 'people';
                }
                return 'none';
            },
            
            openChatPanel: async () => {
                const chatButton = document.querySelector('#chat button[aria-label*="open the chat"]');
                if (chatButton) {
                    chatButton.click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return true;
                }
                return false;
            },
            
            openPeoplePanel: async () => {
                const peopleButton = document.querySelector('#participant button[aria-label*="manage participants"]');
                if (peopleButton && !document.querySelector('.participants-section-container')) {
                    peopleButton.click();
                    await new Promise(resolve => setTimeout(resolve, 500));
                    return true;
                }
                return false;
            },
            
            isUserTyping: () => {
                // Check for active chat input in Zoom
                const chatInput = document.querySelector('.chat-box__chat-textarea, [contenteditable="true"][aria-label*="chat"]');
                
                if (chatInput) {
                    const hasFocus = document.activeElement === chatInput || chatInput.contains(document.activeElement);
                    const hasContent = chatInput.textContent && chatInput.textContent.trim().length > 0;
                    return hasFocus && hasContent;
                }
                
                return false;
            },
            
            getChatMessages: () => {
                // Zoom chat messages
                return document.querySelectorAll('.chat-item-container[data-id]');
            },
            
            getChatMessageData: (msgElement) => {
                // Get message ID
                const messageId = msgElement.getAttribute('data-id') || Date.now().toString();

                // Get sender name - try multiple selectors
                let senderEl = msgElement.querySelector('.chat-item__sender');
                if (!senderEl) {
                    senderEl = msgElement.querySelector('.chat-message-header__sender');
                }
                if (!senderEl) {
                    senderEl = msgElement.querySelector('[class*="sender"]');
                }

                let senderName = senderEl?.textContent?.trim();

                // If no sender found or sender is "You", try to get actual name
                if (!senderName || senderName === 'You') {
                    // Try to find current user's name from participants list
                    const myParticipant = document.querySelector('.participants-li[aria-label*="me"]');
                    if (myParticipant) {
                        const myNameEl = myParticipant.querySelector('.participants-item__display-name');
                        if (myNameEl) {
                            senderName = myNameEl.textContent.trim();
                        }
                    }

                    // If still no name, check if we stored it
                    if (!senderName && window.currentUserName) {
                        senderName = window.currentUserName;
                    }

                    // Final fallback
                    if (!senderName) {
                        senderName = 'You';
                    }
                }

                // Get message content - try multiple selectors
                let contentEl = msgElement.querySelector('.new-chat-message__text-content ._rtfEditor_1n3rs_1');
                if (!contentEl) {
                    contentEl = msgElement.querySelector('[class*="chat-message__text"]');
                }
                if (!contentEl) {
                    contentEl = msgElement.querySelector('[class*="message-content"]');
                }

                // Get time
                const timeEl = msgElement.querySelector('.new-chat-item__chat-info-time-stamp');

                if (!contentEl || !contentEl.textContent) return null;

                // Get the text content but exclude reaction buttons
                // Clone the content element to manipulate it without affecting the DOM
                const contentClone = contentEl.cloneNode(true);

                // Remove reaction button row if it exists
                const reactionRow = contentClone.querySelector('.chat-vote-row');
                if (reactionRow) {
                    reactionRow.remove();
                }

                // Get cleaned text
                const messageText = contentClone.textContent.trim();
                if (!messageText) return null;

                // Zoom doesn't support inline image sharing in chat
                // Only file transfers are supported, which appear as download links
                // Don't extract any attachments to avoid capturing UI elements
                const attachments = [];

                // Try to extract timestamp from message ID or time element
                let timestamp = null;
                if (messageId && !isNaN(messageId)) {
                    // If message ID is numeric, it might be a timestamp
                    timestamp = parseInt(messageId);
                } else if (timeEl && timeEl.textContent) {
                    // Zoom shows times like "10:30 AM" - use current time as fallback
                    timestamp = Date.now();
                } else {
                    // Fallback to current time
                    timestamp = Date.now();
                }

                return {
                    id: messageId,
                    author: senderName,
                    text: messageText,  // Use the cleaned text without reaction buttons
                    time: null, // Will be replaced with formatted timestamp in content_script
                    timestamp: timestamp, // Unix timestamp in milliseconds for filtering
                    attachments: attachments.length > 0 ? attachments : undefined
                };
            }
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
        },
        
        // Chat capture not yet supported for Webex
        chatCapture: {
            isSupported: () => false  // Mark as not supported for now
        }
    }
};

// Copy the Teams configuration for teams.live.com (personal accounts use the same interface)
PLATFORM_CONFIGS['teams.live.com'] = {
    ...PLATFORM_CONFIGS['teams.microsoft.com'],
    name: 'Microsoft Teams (Personal)' // Slightly different name to distinguish
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