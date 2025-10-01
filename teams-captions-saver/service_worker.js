// --- Import SessionManager ---
importScripts('sessionManager.js');
const sessionManager = new SessionManager();

// --- Track pending downloads to set their filenames ---
const pendingDownloads = new Map();

// --- Utility Functions ---
function getSanitizedMeetingName(fullTitle) {
    if (!fullTitle) return "Meeting";
    const parts = fullTitle.split('|');
    // Handles titles like "Meeting Name | Microsoft Teams" or "Location | Meeting | Teams"
    const meetingName = parts.length > 2 ? parts[1] : parts[0];
    const cleanedName = meetingName.replace('Microsoft Teams', '').trim();
    // Replace characters forbidden in filenames
    return cleanedName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || "Meeting";
}


function applyAliasesToTranscript(transcriptArray, aliases = {}) {
    if (Object.keys(aliases).length === 0) {
        return transcriptArray;
    }
    return transcriptArray.map(entry => {
        const newName = aliases[entry.Name]?.trim();
        return {
            ...entry,
            Name: newName || entry.Name
        };
    });
}

function applyAliasesToAttendeeReport(attendeeReport, aliases = {}) {
    if (!attendeeReport || Object.keys(aliases).length === 0) {
        return attendeeReport;
    }

    // Create a new report with aliased names
    const aliasedReport = {
        ...attendeeReport
    };

    // Apply aliases to attendeeList if it exists
    if (attendeeReport.attendeeList && Array.isArray(attendeeReport.attendeeList)) {
        aliasedReport.attendeeList = attendeeReport.attendeeList.map(name => {
            const aliasedName = aliases[name]?.trim();
            return aliasedName || name;
        });
    }

    // Apply aliases to currentAttendees if it exists
    if (attendeeReport.currentAttendees && Array.isArray(attendeeReport.currentAttendees)) {
        aliasedReport.currentAttendees = attendeeReport.currentAttendees.map(attendee => ({
            ...attendee,
            name: aliases[attendee.name]?.trim() || attendee.name
        }));
    }

    // Apply aliases to attendeeHistory if it exists
    if (attendeeReport.attendeeHistory && Array.isArray(attendeeReport.attendeeHistory)) {
        aliasedReport.attendeeHistory = attendeeReport.attendeeHistory.map(event => ({
            ...event,
            name: aliases[event.name]?.trim() || event.name
        }));
    }

    return aliasedReport;
}

// --- Formatting Functions ---
function formatAsTxt(transcript, attendeeReport) {
    let content = '';
    
    console.log('[formatAsTxt] Received attendeeReport:', attendeeReport);

    // Handle both formats of attendee reports (Teams/Meet vs Zoom)
    let attendeeList = [];
    let totalAttendees = 0;
    let meetingStart = null;
    let attendeeHistory = [];

    if (attendeeReport) {
        // Format 1: Standard format with attendeeList and totalUniqueAttendees
        if (attendeeReport.attendeeList && attendeeReport.totalUniqueAttendees) {
            attendeeList = attendeeReport.attendeeList;
            totalAttendees = attendeeReport.totalUniqueAttendees;
            meetingStart = attendeeReport.meetingStartTime;
            attendeeHistory = attendeeReport.attendeeHistory || [];
            console.log('[formatAsTxt] Using standard format - attendees:', attendeeList);
        }
        // Format 2: Zoom format with allAttendees object/Set
        else if (attendeeReport.allAttendees) {
            // Handle if allAttendees is a Set or array
            if (attendeeReport.allAttendees instanceof Set) {
                attendeeList = Array.from(attendeeReport.allAttendees);
            } else if (Array.isArray(attendeeReport.allAttendees)) {
                attendeeList = attendeeReport.allAttendees;
            } else if (typeof attendeeReport.allAttendees === 'object') {
                // If it's an object, try to extract values
                attendeeList = Object.values(attendeeReport.allAttendees);
            }
            totalAttendees = attendeeList.length;
            meetingStart = attendeeReport.meetingStartTime;
            attendeeHistory = attendeeReport.attendeeHistory || [];
            console.log('[formatAsTxt] Using Zoom format - attendees:', attendeeList);
        } else {
            console.log('[formatAsTxt] Attendee report has unexpected format:', Object.keys(attendeeReport));
        }
    } else {
        console.log('[formatAsTxt] No attendee report provided');
    }

    // Add attendee information if available
    if (totalAttendees > 0) {
        content += '=== MEETING ATTENDEES ===\n';
        content += `Total Attendees: ${totalAttendees}\n`;
        if (meetingStart) {
            content += `Meeting Start: ${new Date(meetingStart).toLocaleString()}\n`;
        }
        content += '\nAttendee List:\n';
        attendeeList.forEach(name => {
            content += `- ${name}\n`;
        });
        content += '\n=== TRANSCRIPT ===\n';
    }

    // Merge transcript and attendee events chronologically
    const combinedEvents = [...transcript];

    // Add join/leave events to the combined array
    if (attendeeHistory && attendeeHistory.length > 0) {
        attendeeHistory.forEach(event => {
            combinedEvents.push({
                Time: event.time,
                Name: event.name,
                Text: event.action === 'joined' ? `joined the meeting${event.role ? ' (' + event.role + ')' : ''}` : 'left the meeting',
                Type: 'attendance',
                action: event.action,
                sortKey: new Date(event.time).getTime()
            });
        });
    }

    // Sort all events by time using timestamp field (ISO format)
    // All transcript entries have a 'timestamp' field with ISO format
    // Attendance events have 'sortKey' field with Unix timestamp
    combinedEvents.sort((a, b) => {
        // Use sortKey (attendance), timestamp (captions/chat), or 0 as fallback
        const timeA = a.sortKey || (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const timeB = b.sortKey || (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return timeA - timeB;
    });

    // Format all events
    content += combinedEvents.map(entry => {
        if (entry.Type === 'attendance') {
            // Format: [TIME] ● Name joined/left the meeting
            return `[${entry.Time}] ● ${entry.Name} ${entry.Text}`;
        } else if (entry.Type === 'chat') {
            return `[CHAT] [${entry.Time}] ${entry.Name}: ${entry.Text}`;
        } else {
            return `[${entry.Time}] ${entry.Name}: ${entry.Text}`;
        }
    }).join('\n');

    return content;
}

function formatAsMarkdown(transcript, attendeeReport) {
    let content = '';

    // Handle both formats of attendee reports (Teams/Meet vs Zoom)
    let attendeeList = [];
    let totalAttendees = 0;
    let meetingStart = null;
    let attendeeHistory = [];

    if (attendeeReport) {
        // Format 1: Standard format
        if (attendeeReport.attendeeList && attendeeReport.totalUniqueAttendees) {
            attendeeList = attendeeReport.attendeeList;
            totalAttendees = attendeeReport.totalUniqueAttendees;
            meetingStart = attendeeReport.meetingStartTime;
            attendeeHistory = attendeeReport.attendeeHistory || [];
        }
        // Format 2: Zoom format
        else if (attendeeReport.allAttendees) {
            if (attendeeReport.allAttendees instanceof Set) {
                attendeeList = Array.from(attendeeReport.allAttendees);
            } else if (Array.isArray(attendeeReport.allAttendees)) {
                attendeeList = attendeeReport.allAttendees;
            } else if (typeof attendeeReport.allAttendees === 'object') {
                attendeeList = Object.values(attendeeReport.allAttendees);
            }
            totalAttendees = attendeeList.length;
            meetingStart = attendeeReport.meetingStartTime;
            attendeeHistory = attendeeReport.attendeeHistory || [];
        }
    }

    // Add attendee information if available
    if (totalAttendees > 0) {
        content += '# Meeting Attendees\n\n';
        content += `**Total Attendees:** ${totalAttendees}\n\n`;
        if (meetingStart) {
            content += `**Meeting Start:** ${new Date(meetingStart).toLocaleString()}\n\n`;
        }
        content += '## Attendee List\n\n';
        attendeeList.forEach(name => {
            content += `- ${name}\n`;
        });
        content += '\n---\n\n# Transcript\n\n';
    }

    // Merge transcript and attendee events chronologically
    const combinedEvents = [...transcript];

    // Add join/leave events
    if (attendeeHistory && attendeeHistory.length > 0) {
        attendeeHistory.forEach(event => {
            combinedEvents.push({
                Time: event.time,
                Name: event.name,
                Text: event.action === 'joined' ? `joined the meeting${event.role ? ' (' + event.role + ')' : ''}` : 'left the meeting',
                Type: 'attendance',
                action: event.action,
                sortKey: new Date(event.time).getTime()
            });
        });
    }

    // Sort all events by time using timestamp field (ISO format)
    combinedEvents.sort((a, b) => {
        const timeA = a.sortKey || (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const timeB = b.sortKey || (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return timeA - timeB;
    });

    let lastSpeaker = null;
    content += combinedEvents.map(entry => {
        if (entry.Type === 'attendance') {
            // Format: ● Name joined/left the meeting (Time)
            lastSpeaker = null; // Reset speaker grouping
            return `\n*● ${entry.Name} ${entry.Text}* (${entry.Time})\n`;
        } else {
            // Add text indicator for chat messages
            const typeIndicator = entry.Type === 'chat' ? '[CHAT] ' : '';
            if (entry.Name !== lastSpeaker) {
                lastSpeaker = entry.Name;
                return `\n${typeIndicator}**${entry.Name}** (${entry.Time}):\n> ${entry.Text}`;
            }
            return `> ${entry.Text}`;
        }
    }).join('\n').trim();

    return content;
}

function formatAsDoc(transcript, attendeeReport) {
    let body = '';
    let attendeeHistory = [];

    // Add attendee information if available
    if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
        body += '<h2>Meeting Attendees</h2>';
        body += `<p><b>Total Attendees:</b> ${attendeeReport.totalUniqueAttendees}</p>`;
        body += `<p><b>Meeting Start:</b> ${escapeHtml(new Date(attendeeReport.meetingStartTime).toLocaleString())}</p>`;
        body += '<h3>Attendee List</h3><ul>';
        attendeeReport.attendeeList.forEach(name => {
            body += `<li>${escapeHtml(name)}</li>`;
        });
        body += '</ul><hr><h2>Transcript</h2>';
        attendeeHistory = attendeeReport.attendeeHistory || [];
    }

    // Merge transcript and attendee events chronologically
    const combinedEvents = [...transcript];

    // Add join/leave events
    if (attendeeHistory && attendeeHistory.length > 0) {
        attendeeHistory.forEach(event => {
            combinedEvents.push({
                Time: event.time,
                Name: event.name,
                Text: event.action === 'joined' ? `joined the meeting${event.role ? ' (' + event.role + ')' : ''}` : 'left the meeting',
                Type: 'attendance',
                action: event.action,
                sortKey: new Date(event.time).getTime()
            });
        });
    }

    // Sort all events by time using timestamp field (ISO format)
    combinedEvents.sort((a, b) => {
        const timeA = a.sortKey || (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const timeB = b.sortKey || (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return timeA - timeB;
    });

    body += combinedEvents.map(entry => {
        if (entry.Type === 'attendance') {
            // Attendance events in gray, italic, centered
            return `<p style="text-align:center; color:#666; font-style:italic;">● ${escapeHtml(entry.Name)} ${escapeHtml(entry.Text)} - <i>${escapeHtml(entry.Time)}</i></p>`;
        } else if (entry.Type === 'chat') {
            return `<p>[CHAT] <b>${escapeHtml(entry.Name)}</b> (<i>${escapeHtml(entry.Time)}</i>): ${escapeHtml(entry.Text)}</p>`;
        } else {
            return `<p><b>${escapeHtml(entry.Name)}</b> (<i>${escapeHtml(entry.Time)}</i>): ${escapeHtml(entry.Text)}</p>`;
        }
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Meeting Transcript</title></head><body>${body}</body></html>`;
}

async function formatForAi(transcript, meetingTitle, recordingStartTime, attendeeReport) {
    const { aiInstructions = '' } = await chrome.storage.sync.get('aiInstructions');
    const date = recordingStartTime ? new Date(recordingStartTime) : new Date();

    let metadataHeader = `Meeting Title: ${meetingTitle}\nDate: ${date.toLocaleString()}`;
    let attendeeHistory = [];

    // Add attendee information if available
    if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
        metadataHeader += `\nTotal Attendees: ${attendeeReport.totalUniqueAttendees}`;
        metadataHeader += '\n\nAttendee List:';
        attendeeReport.attendeeList.forEach(name => {
            metadataHeader += `\n- ${name}`;
        });
        attendeeHistory = attendeeReport.attendeeHistory || [];
    }

    // Merge transcript and attendee events chronologically
    const combinedEvents = [...transcript];

    // Add join/leave events
    if (attendeeHistory && attendeeHistory.length > 0) {
        attendeeHistory.forEach(event => {
            combinedEvents.push({
                Time: event.time,
                Name: event.name,
                Text: event.action === 'joined' ? `joined the meeting${event.role ? ' (' + event.role + ')' : ''}` : 'left the meeting',
                Type: 'attendance',
                action: event.action,
                sortKey: new Date(event.time).getTime()
            });
        });
    }

    // Sort all events by time using timestamp field (ISO format)
    combinedEvents.sort((a, b) => {
        const timeA = a.sortKey || (a.timestamp ? new Date(a.timestamp).getTime() : 0);
        const timeB = b.sortKey || (b.timestamp ? new Date(b.timestamp).getTime() : 0);
        return timeA - timeB;
    });

    const transcriptText = combinedEvents.map(entry => {
        if (entry.Type === 'attendance') {
            return `[${entry.Time}] ● ${entry.Name} ${entry.Text}`;
        } else if (entry.Type === 'chat') {
            return `[CHAT] [${entry.Time}] ${entry.Name}: ${entry.Text}`;
        } else {
            return `[${entry.Time}] ${entry.Name}: ${entry.Text}`;
        }
    }).join('\n\n');

    let finalContent = aiInstructions ? `${aiInstructions}\n\n---\n\n` : '';
    finalContent += `${metadataHeader}\n\n---\n\n${transcriptText}`;

    return finalContent;
}

// A simple HTML escaper for the .doc format
function escapeHtml(str) {
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
}

// --- Core Actions ---
async function downloadFile(filename, content, mimeType, saveAs) {
    // Ensure filename is not empty or undefined
    if (!filename || filename.trim() === '') {
        console.error('[downloadFile] ERROR: Filename is empty! Using fallback.');
        filename = `transcript_${new Date().toISOString().split('T')[0]}.txt`;
    }
    
    try {
        const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
        
        // Ensure filename is relative to Downloads directory (no leading slashes)
        let finalFilename = filename.replace(/^[\/\\]+/, '');
        
        const downloadOptions = {
            url: url,
            filename: finalFilename,
            saveAs: saveAs,
            conflictAction: 'uniquify'  // Automatically rename if file exists
        };
        
        // Store the desired filename for auto-downloads
        // Chrome ignores the filename parameter when saveAs is false,
        // so we need to use onDeterminingFilename to set it
        if (!saveAs && finalFilename) {
            pendingDownloads.set('next', finalFilename);
        }
        
        const downloadId = await chrome.downloads.download(downloadOptions);
        
        // Associate download ID with filename for onDeterminingFilename handler
        if (!saveAs && finalFilename) {
            pendingDownloads.set(downloadId, finalFilename);
            // Clean up after a delay
            setTimeout(() => {
                pendingDownloads.delete(downloadId);
                pendingDownloads.delete('next');
            }, 5000);
        }
        
        console.log(`[downloadFile] Download initiated: ${finalFilename}`);
        
    } catch (error) {
        console.error('[downloadFile] Download failed:', error.message);
    }
    
    // Notify viewer that transcript was saved
    try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (tab.url && tab.url.includes('viewer.html')) {
                chrome.tabs.sendMessage(tab.id, { message: 'transcript_saved' });
            }
        }
    } catch (error) {
        // Silent fail if viewer is not open
    }
}

async function generateFilename(pattern, meetingTitle, format, attendeeReport) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    const attendeeCount = attendeeReport ? attendeeReport.totalUniqueAttendees : 0;

    const sanitizedTitle = getSanitizedMeetingName(meetingTitle);

    console.log('[generateFilename] Input:', { pattern, meetingTitle, sanitizedTitle, format });

    const replacements = {
        '{date}': dateStr,
        '{time}': timeStr,
        '{title}': sanitizedTitle,
        '{format}': format,
        '{attendees}': attendeeCount > 0 ? `${attendeeCount}_attendees` : ''
    };

    // Use the provided pattern or default - FIX: don't include {format} in default pattern
    let filename = pattern || '{date}_{title}';

    for (const [key, value] of Object.entries(replacements)) {
        filename = filename.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    // Clean up any double underscores or trailing underscores
    filename = filename.replace(/__+/g, '_').replace(/_+$/, '');

    // If filename is empty or just underscores, use a fallback
    if (!filename || filename === '_' || filename === '') {
        console.warn('[generateFilename] Filename was empty, using fallback');
        filename = `Meeting_${dateStr}`;
    }

    console.log('[generateFilename] Final filename:', filename);
    return filename;
}

async function saveTranscript(meetingTitle, transcriptArray, aliases, format, recordingStartTime, saveAsPrompt, attendeeReport = null) {
    // Validate and fix meeting title
    if (!meetingTitle || meetingTitle.trim() === '') {
        console.log('[saveTranscript] Meeting title was empty, using "Untitled Meeting"');
        meetingTitle = 'Untitled Meeting';
    }

    console.log('[saveTranscript] Saving with:', {
        meetingTitle,
        format,
        saveAsPrompt,
        hasAttendeeReport: !!attendeeReport
    });

    const processedTranscript = applyAliasesToTranscript(transcriptArray, aliases);
    const processedAttendeeReport = applyAliasesToAttendeeReport(attendeeReport, aliases);

    // Get filename pattern from settings
    const { filenamePattern } = await chrome.storage.sync.get('filenamePattern');
    console.log('[saveTranscript] Using filename pattern:', filenamePattern || '{date}_{title}');

    const filename = await generateFilename(filenamePattern, meetingTitle, format, processedAttendeeReport);
    console.log('[saveTranscript] Generated filename (without extension):', filename);

    let content, extension, mimeType;

    switch (format) {
        case 'md':
            content = formatAsMarkdown(processedTranscript, processedAttendeeReport);
            extension = 'md';
            mimeType = 'text/markdown';
            break;
        case 'json':
            // For JSON, include both transcript and attendee data
            const jsonData = {
                meetingTitle: meetingTitle,
                recordingStartTime,
                transcript: processedTranscript,
                attendees: processedAttendeeReport
            };
            content = JSON.stringify(jsonData, null, 2);
            extension = 'json';
            mimeType = 'application/json';
            break;
        case 'doc':
            content = formatAsDoc(processedTranscript, processedAttendeeReport);
            extension = 'doc';
            mimeType = 'application/msword';
            break;
        case 'ai':
            content = await formatForAi(processedTranscript, meetingTitle, recordingStartTime, processedAttendeeReport);
            extension = 'txt';
            mimeType = 'text/plain';
            break;
        case 'txt':
        default:
            content = formatAsTxt(processedTranscript, processedAttendeeReport);
            extension = 'txt';
            mimeType = 'text/plain';
            break;
    }
    
    // Add extension to filename
    const fullFilename = `${filename}.${extension}`;
    console.log('[saveTranscript] Final filename with extension:', fullFilename);
    await downloadFile(fullFilename, content, mimeType, saveAsPrompt);
}

// --- State Management ---
let lastAutoSaveId = null;
let autoSaveInProgress = false;

async function createViewerTab(transcriptArray, meetingTitle, platform, sessionId) {
    await chrome.storage.local.set({
        captionsToView: transcriptArray,
        meetingTitle: meetingTitle,
        platform: platform,  // Store platform for display
        viewerSessionId: sessionId  // Store session ID for filtering live updates
    });
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
}

function updateBadge(isCapturing) {
    if (isCapturing) {
        // Red recording indicator (like a rec button)
        chrome.action.setBadgeText({ text: '●' }); // Unicode filled circle
        chrome.action.setBadgeBackgroundColor({ color: '#dc3545' }); // Red
    } else {
        // Clear badge when not recording
        chrome.action.setBadgeText({ text: '' });
    }
}

// --- Event Listeners ---
// Helper function to chunk arrays
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// Helper function to calculate duration
function calculateDuration(transcriptArray) {
    if (!transcriptArray || transcriptArray.length === 0) return '0 min';
    
    try {
        const firstTime = new Date(transcriptArray[0].Time);
        const lastTime = new Date(transcriptArray[transcriptArray.length - 1].Time);
        
        // Check if dates are valid
        if (isNaN(firstTime.getTime()) || isNaN(lastTime.getTime())) {
            // Fallback: estimate based on caption count (avg 3 seconds per caption)
            const estimatedMinutes = Math.round((transcriptArray.length * 3) / 60);
            return `~${estimatedMinutes} min`;
        }
        
        const durationMs = lastTime - firstTime;
        const minutes = Math.round(durationMs / 60000);
        
        if (minutes < 60) {
            return `${minutes} min`;
        } else {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${hours}h ${mins}m`;
        }
    } catch (error) {
        // If all else fails, show caption count
        return `${transcriptArray.length} captions`;
    }
}

// Helper function to save session to history
async function saveSessionToHistory(transcriptArray, meetingTitle, attendeeReport) {
    const sessionId = `session_${Date.now()}`;
    
    // Create session metadata
    const metadata = {
        id: sessionId,
        title: meetingTitle || 'Untitled Meeting',
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        captionCount: transcriptArray.length,
        duration: calculateDuration(transcriptArray),
        speakers: [...new Set(transcriptArray.map(c => c.Name))].slice(0, 10),
        attendees: attendeeReport?.attendeeList?.slice(0, 20),
        attendeeCount: attendeeReport?.totalUniqueAttendees || 0,
        preview: transcriptArray.slice(0, 3).map(c => `${c.Name}: ${c.Text.substring(0, 50)}`).join(' | ')
    };
    
    // Save transcript in chunks to avoid size limits
    const chunks = chunkArray(transcriptArray, 100);
    for (let i = 0; i < chunks.length; i++) {
        await chrome.storage.local.set({
            [`${sessionId}_chunk_${i}`]: chunks[i]
        });
    }
    metadata.chunkCount = chunks.length;
    
    // Save attendee report if exists
    if (attendeeReport) {
        await chrome.storage.local.set({
            [`${sessionId}_attendees`]: attendeeReport
        });
    }
    
    // Update session index
    const { session_index = [] } = await chrome.storage.local.get('session_index');
    session_index.push(metadata);
    
    // Keep only last 10 sessions
    if (session_index.length > 10) {
        const toDelete = session_index.shift();
        // Clean up old session data
        const keysToDelete = [];
        for (let i = 0; i < toDelete.chunkCount; i++) {
            keysToDelete.push(`${toDelete.id}_chunk_${i}`);
        }
        keysToDelete.push(`${toDelete.id}_attendees`);
        await chrome.storage.local.remove(keysToDelete);
    }
    
    // Sort by timestamp (newest first)
    session_index.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    await chrome.storage.local.set({ 'session_index': session_index });
    console.log('[Service Worker] Session saved to history:', sessionId);
}

chrome.runtime.onInstalled.addListener(() => {
    updateBadge(false);
});

chrome.runtime.onStartup.addListener(() => {
    updateBadge(false);
});

// Clear badge when meeting tabs are closed and end associated sessions
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    // Check if this tab had an active session
    const activeSessions = sessionManager.getActiveSessions();
    const sessionForTab = activeSessions.find(session => session.tabId === tabId);

    if (sessionForTab && sessionForTab.status === 'active') {
        console.log(`[Service Worker] Tab ${tabId} closed, ending session ${sessionForTab.sessionId}`);
        // End the session when tab is closed
        sessionManager.endSession(sessionForTab.sessionId);
    }

    // When a tab is closed, check if any other tabs are capturing
    chrome.tabs.query({}, (tabs) => {
        const meetingDomains = ['teams.microsoft.com', 'meet.google.com', 'zoom.us', 'app.zoom.us'];
        const hasMeetingTab = tabs.some(tab =>
            tab.url && meetingDomains.some(domain => tab.url.includes(domain))
        );

        if (!hasMeetingTab) {
            // No meeting tabs open, clear the badge
            updateBadge(false);
        }
    });
});

// Clear badge when navigating away from meeting pages and end associated sessions
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        const meetingDomains = ['teams.microsoft.com', 'meet.google.com', 'zoom.us', 'app.zoom.us'];
        const isLeavingMeetingPage = !meetingDomains.some(domain => changeInfo.url.includes(domain));

        if (isLeavingMeetingPage) {
            // Check if this tab had an active session
            const activeSessions = sessionManager.getActiveSessions();
            const sessionForTab = activeSessions.find(session => session.tabId === tabId);

            if (sessionForTab && sessionForTab.status === 'active') {
                console.log(`[Service Worker] Tab ${tabId} navigated away from meeting, ending session ${sessionForTab.sessionId}`);
                // End the session when navigating away from meeting page
                sessionManager.endSession(sessionForTab.sessionId);
            }

            // Check if any other tabs are still on meeting pages
            chrome.tabs.query({}, (tabs) => {
                const hasMeetingTab = tabs.some(t =>
                    t.id !== tabId && t.url && meetingDomains.some(domain => t.url.includes(domain))
                );

                if (!hasMeetingTab) {
                    updateBadge(false);
                }
            });
        }
    }
});

// --- Download Filename Handler ---
// Chrome ignores the filename parameter when saveAs is false (auto-download)
// This handler ensures our filenames are used for auto-downloads
chrome.downloads.onDeterminingFilename?.addListener((downloadItem, suggest) => {
    // Check if we have a pending filename for this download
    const pendingFilename = pendingDownloads.get(downloadItem.id) || pendingDownloads.get('next');
    
    if (pendingFilename) {
        suggest({
            filename: pendingFilename,
            conflictAction: 'uniquify'
        });
        // Clean up
        pendingDownloads.delete(downloadItem.id);
        pendingDownloads.delete('next');
        return true;
    }
    
    return false;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle live updates synchronously for immediate relay
    if (message.message === 'live_caption_update' || message.message === 'live_attendee_update') {
        console.log('[Service Worker] Relaying live update:', message.message, 'sessionId:', message.sessionId, 'caption:', message.caption);
        // Don't relay back to the sender (content script)
        if (sender.tab && sender.tab.id) {
            // Relay to viewer tabs
            // Only use runtime.sendMessage - this reaches extension pages like viewer.html
            try {
                const messageToRelay = {
                    ...message,
                    sessionId: message.sessionId,
                    fromServiceWorker: true  // Mark that this is from service worker
                };

                // Broadcast to all extension pages (viewer.html will receive this)
                // This is sufficient - we don't need tabs.sendMessage too
                chrome.runtime.sendMessage(messageToRelay).then(() => {
                    // Successfully sent
                }).catch((error) => {
                    // Nobody listening - this is OK
                    console.log('[Service Worker] No listeners for live update (viewer might be closed)');
                });
            } catch (error) {
                console.error('[Service Worker] Error broadcasting:', error);
            }
        }
        // Send response immediately to unblock content script
        sendResponse({received: true});
        return; // Exit early for live updates
    }

    (async () => {
        try {
        // Speaker aliases are now managed per-session in the viewer
        // For downloads, we'll use the session-specific aliases if available
        let speakerAliases = {};

        // Handle session management actions first
        if (message.action) {
            switch (message.action) {
                case 'createSession':
                    // Get the actual tab ID from the sender
                    const tabId = sender.tab ? sender.tab.id : message.tabId;
                    const sessionId = sessionManager.createSession(tabId, message.platform, message.url);
                    sendResponse({ sessionId });
                    return;
                    
                case 'updateSession':
                    const updated = await sessionManager.updateSession(message.sessionId, message.data);
                    
                    // If we have transcript data, save it
                    if (message.data.transcript) {
                        await sessionManager.saveSessionTranscript(
                            message.sessionId,
                            message.data.transcript,
                            message.data.attendeeReport,
                            message.data.chatMessages
                        );
                    }
                    
                    sendResponse({ success: updated });
                    return;
                    
                case 'getActiveSessions':
                    const sessions = sessionManager.getActiveSessions();
                    sendResponse({ sessions });
                    return;
                    
                case 'getSessionData':
                    const sessionData = await sessionManager.loadSessionData(message.sessionId);
                    sendResponse({ sessionData });
                    return;
                    
                case 'endSession':
                    const ended = await sessionManager.endSession(message.sessionId);
                    sendResponse({ success: ended });
                    return;
                    
                case 'deleteSession':
                    const deleted = await sessionManager.deleteSession(message.sessionId);
                    sendResponse({ success: deleted });
                    return;
            }
        }

        switch (message.message) {
            case 'save_from_session':
                // Handle save from session data (multi-meeting support)
                console.log('Saving transcript from session');
                const { transcriptArray, meetingTitle, format, recordingStartTime, attendeeReport } = message;
                
                if (transcriptArray && transcriptArray.length > 0) {
                    // Get session-specific aliases if they exist
                    const sessionAliasKey = `aliases_${message.sessionId || 'default'}`;
                    const aliasData = await chrome.storage.local.get(sessionAliasKey);
                    const speakerAliases = aliasData[sessionAliasKey] || {};
                    
                    await saveTranscript(
                        meetingTitle || 'Meeting', 
                        transcriptArray, 
                        speakerAliases, 
                        format || 'txt', 
                        recordingStartTime || new Date().toISOString(), 
                        false, 
                        attendeeReport
                    );
                    
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false, error: 'No transcript data' });
                }
                return;
                
            case 'zoom_meeting_ended':
                // Handle Zoom meeting end - retrieve data from storage
                console.log('[Service Worker] Zoom meeting ended signal received');
                try {
                    const { zoomMeetingEnded } = await chrome.storage.local.get('zoomMeetingEnded');
                    console.log('[Service Worker] Retrieved zoomMeetingEnded data:', {
                        hasData: !!zoomMeetingEnded,
                        shouldAutoSave: zoomMeetingEnded?.shouldAutoSave,
                        transcriptLength: zoomMeetingEnded?.transcript?.length,
                        attendeeCount: zoomMeetingEnded?.attendeeReport?.totalUniqueAttendees
                    });

                    if (zoomMeetingEnded && zoomMeetingEnded.shouldAutoSave) {
                        const { autoSaveOnEnd, defaultSaveFormat } = await chrome.storage.sync.get(['autoSaveOnEnd', 'defaultSaveFormat']);
                        console.log('[Service Worker] Auto-save settings:', { autoSaveOnEnd, defaultSaveFormat });

                        if (autoSaveOnEnd && zoomMeetingEnded.transcript.length > 0) {
                            console.log('[Service Worker] Processing Zoom auto-save from stored data');
                            console.log(`[Service Worker] Auto-save data - Transcript: ${zoomMeetingEnded.transcript.length} items, Attendees: ${zoomMeetingEnded.attendeeReport?.totalUniqueAttendees || 0}`);
                            const formatToSave = defaultSaveFormat || 'txt';
                            
                            // Get session-specific aliases if they exist
                            // Session ID might be in the stored data or we use 'default'
                            const sessionId = zoomMeetingEnded.sessionId || 'default';
                            const sessionAliasKey = `aliases_${sessionId}`;
                            const aliasData = await chrome.storage.local.get(sessionAliasKey);
                            const speakerAliases = aliasData[sessionAliasKey] || {};
                            
                            await saveTranscript(
                                zoomMeetingEnded.meetingTitle, 
                                zoomMeetingEnded.transcript, 
                                speakerAliases, 
                                formatToSave, 
                                zoomMeetingEnded.recordingStartTime, 
                                false, 
                                zoomMeetingEnded.attendeeReport
                            );
                            
                            console.log('Zoom auto-save completed');
                            
                            // Save to session history
                            await saveSessionToHistory(
                                zoomMeetingEnded.transcript, 
                                zoomMeetingEnded.meetingTitle, 
                                zoomMeetingEnded.attendeeReport
                            );
                            
                            // Clean up storage
                            await chrome.storage.local.remove(['zoomMeetingEnded', 'transcriptBackup']);
                            console.log('[Service Worker] Cleaned up saved Zoom data');

                            // Send success response
                            sendResponse({ success: true, message: 'Zoom auto-save completed' });
                        } else {
                            sendResponse({ success: false, message: 'Auto-save not enabled or no transcript' });
                        }
                    } else {
                        sendResponse({ success: false, message: 'No Zoom meeting data found' });
                    }
                } catch (error) {
                    console.error('Error processing Zoom meeting end:', error);
                    sendResponse({ success: false, error: error.message });
                }
                return true; // Will respond asynchronously
                
            case 'save_session_history':
                // Save meeting to session history using chrome.storage directly
                try {
                    // Since we can't import in service worker, implement inline
                    const sessionId = `session_${Date.now()}`;
                    const transcriptArray = message.transcriptArray;
                    const meetingTitle = message.meetingTitle;
                    const attendeeReport = message.attendeeReport;
                    
                    // Create session metadata
                    const metadata = {
                        id: sessionId,
                        title: meetingTitle || 'Untitled Meeting',
                        timestamp: new Date().toISOString(),
                        date: new Date().toLocaleDateString(),
                        time: new Date().toLocaleTimeString(),
                        captionCount: transcriptArray.length,
                        duration: calculateDuration(transcriptArray),
                        speakers: [...new Set(transcriptArray.map(c => c.Name))].slice(0, 10),
                        attendees: attendeeReport?.attendeeList?.slice(0, 20),
                        attendeeCount: attendeeReport?.totalUniqueAttendees || 0,
                        preview: transcriptArray.slice(0, 3).map(c => `${c.Name}: ${c.Text.substring(0, 50)}`).join(' | ')
                    };
                    
                    // Save transcript in chunks to avoid size limits
                    const chunks = chunkArray(transcriptArray, 100); // 100 items per chunk
                    for (let i = 0; i < chunks.length; i++) {
                        await chrome.storage.local.set({
                            [`${sessionId}_chunk_${i}`]: chunks[i]
                        });
                    }
                    metadata.chunkCount = chunks.length;
                    
                    // Save attendee report if exists
                    if (attendeeReport) {
                        await chrome.storage.local.set({
                            [`${sessionId}_attendees`]: attendeeReport
                        });
                    }
                    
                    // Update session index
                    const { session_index = [] } = await chrome.storage.local.get('session_index');
                    session_index.push(metadata);
                    
                    // Keep only last 10 sessions
                    if (session_index.length > 10) {
                        const toDelete = session_index.shift();
                        // Clean up old session data
                        const keysToDelete = [];
                        for (let i = 0; i < toDelete.chunkCount; i++) {
                            keysToDelete.push(`${toDelete.id}_chunk_${i}`);
                        }
                        keysToDelete.push(`${toDelete.id}_attendees`);
                        await chrome.storage.local.remove(keysToDelete);
                    }
                    
                    // Sort by timestamp (newest first)
                    session_index.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    
                    await chrome.storage.local.set({ 'session_index': session_index });
                    console.log('[Service Worker] Session saved to history:', sessionId);
                    
                } catch (error) {
                    console.error('[Service Worker] Failed to save session:', error);
                }
                break;
                
            case 'download_captions': {
                console.log('[Service Worker] download_captions received with:', {
                    meetingTitle: message.meetingTitle,
                    transcriptCount: message.transcriptArray?.length,
                    format: message.format,
                    sessionId: message.sessionId,
                    hasAttendeeReport: !!message.attendeeReport
                });
                
                // Get session-specific aliases if they exist
                const downloadSessionKey = `aliases_${message.sessionId || 'default'}`;
                const downloadAliasData = await chrome.storage.local.get(downloadSessionKey);
                const downloadAliases = downloadAliasData[downloadSessionKey] || {};
                
                // Ensure meeting title is not undefined/empty
                const titleToSave = message.meetingTitle || 'Untitled Meeting';
                console.log('[Service Worker] Saving with title:', titleToSave);
                
                await saveTranscript(titleToSave, message.transcriptArray, downloadAliases, message.format, message.recordingStartTime, true, message.attendeeReport);
                break;
            }

            case 'save_on_leave':
                // Validate required data
                if (!message.transcriptArray || !Array.isArray(message.transcriptArray)) {
                    console.error('Auto-save failed: Invalid transcript data');
                    sendResponse({ success: false, error: 'Invalid transcript data' });
                    break;
                }

                // Generate unique ID for this save request
                const saveId = `${message.meetingTitle || 'unknown'}_${message.recordingStartTime || Date.now()}`;

                // Prevent duplicate saves
                if (autoSaveInProgress || lastAutoSaveId === saveId) {
                    console.log('Auto-save already in progress or completed for this meeting, skipping...');
                    sendResponse({ success: false, error: 'Duplicate save request' });
                    break;
                }

                autoSaveInProgress = true;
                lastAutoSaveId = saveId;

                try {
                    const settings = await chrome.storage.sync.get(['autoSaveOnEnd', 'defaultSaveFormat']);
                    if (settings.autoSaveOnEnd && message.transcriptArray.length > 0) {
                        const formatToSave = settings.defaultSaveFormat || 'txt';
                        const meetingTitleToSave = message.meetingTitle || 'Untitled Meeting';

                        // Get session-specific aliases if they exist
                        const autoSaveSessionKey = `aliases_${message.sessionId || 'default'}`;
                        const autoSaveAliasData = await chrome.storage.local.get(autoSaveSessionKey);
                        const autoSaveAliases = autoSaveAliasData[autoSaveSessionKey] || {};

                        await saveTranscript(meetingTitleToSave, message.transcriptArray, autoSaveAliases, formatToSave, message.recordingStartTime, false, message.attendeeReport);
                        console.log(`Auto-save completed: ${meetingTitleToSave}`);

                        // Also save to session history
                        try {
                            await saveSessionToHistory(message.transcriptArray, message.meetingTitle, message.attendeeReport);
                            console.log('Session also saved to history.');
                        } catch (sessionError) {
                            console.error('Failed to save to session history:', sessionError);
                        }

                        sendResponse({ success: true });
                    } else {
                        sendResponse({ success: false, error: 'Auto-save disabled or no transcript data' });
                    }
                } catch (error) {
                    console.error('Auto-save failed:', error);
                    // Reset state on error to allow retry
                    lastAutoSaveId = null;
                    sendResponse({ success: false, error: error.message });
                } finally {
                    autoSaveInProgress = false;
                }
                break;

            case 'display_captions':
                await createViewerTab(message.transcriptArray, message.meetingTitle, message.platform, message.sessionId);
                break;
            
            case 'update_badge_status':
                updateBadge(message.capturing);
                // Reset auto-save state when starting a new capture session
                if (message.capturing) {
                    lastAutoSaveId = null;
                    autoSaveInProgress = false;
                    console.log('New capture session started, auto-save state reset.');
                }
                break;
                
            case 'error_logged':
                // Central error logging - could send to analytics service
                console.warn('[Live Caption Saver] Error logged:', message.error);
                // Could implement error reporting here
                break;
        }
        } catch (error) {
            console.error('[Service Worker] Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();

    return true; // Indicates that the response will be sent asynchronously
});