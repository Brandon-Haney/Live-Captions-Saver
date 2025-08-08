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
        ...attendeeReport,
        attendeeList: attendeeReport.attendeeList.map(name => {
            const aliasedName = aliases[name]?.trim();
            return aliasedName || name;
        }),
        currentAttendees: attendeeReport.currentAttendees.map(attendee => ({
            ...attendee,
            name: aliases[attendee.name]?.trim() || attendee.name
        })),
        attendeeHistory: attendeeReport.attendeeHistory.map(event => ({
            ...event,
            name: aliases[event.name]?.trim() || event.name
        }))
    };
    
    return aliasedReport;
}

// --- Formatting Functions ---
function formatAsTxt(transcript, attendeeReport) {
    let content = '';
    
    console.log('[Teams Caption Saver] formatAsTxt called with:', {
        transcriptLength: transcript?.length,
        hasAttendeeReport: !!attendeeReport,
        attendeeCount: attendeeReport?.totalUniqueAttendees || 0,
        attendeeList: attendeeReport?.attendeeList || []
    });
    
    // Add attendee information if available
    if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
        content += '=== MEETING ATTENDEES ===\n';
        content += `Total Attendees: ${attendeeReport.totalUniqueAttendees}\n`;
        content += `Meeting Start: ${new Date(attendeeReport.meetingStartTime).toLocaleString()}\n`;
        content += '\nAttendee List:\n';
        attendeeReport.attendeeList.forEach(name => {
            content += `- ${name}\n`;
        });
        content += '\n=== TRANSCRIPT ===\n';
    }
    
    content += transcript.map(entry => `[${entry.Time}] ${entry.Name}: ${entry.Text}`).join('\n');
    return content;
}

function formatAsMarkdown(transcript, attendeeReport) {
    let content = '';
    
    // Add attendee information if available
    if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
        content += '# Meeting Attendees\n\n';
        content += `**Total Attendees:** ${attendeeReport.totalUniqueAttendees}\n\n`;
        content += `**Meeting Start:** ${new Date(attendeeReport.meetingStartTime).toLocaleString()}\n\n`;
        content += '## Attendee List\n\n';
        attendeeReport.attendeeList.forEach(name => {
            content += `- ${name}\n`;
        });
        content += '\n---\n\n# Transcript\n\n';
    }
    
    let lastSpeaker = null;
    content += transcript.map(entry => {
        if (entry.Name !== lastSpeaker) {
            lastSpeaker = entry.Name;
            return `\n**${entry.Name}** (${entry.Time}):\n> ${entry.Text}`;
        }
        return `> ${entry.Text}`;
    }).join('\n').trim();
    
    return content;
}

function formatAsDoc(transcript, attendeeReport) {
    let body = '';
    
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
    }
    
    body += transcript.map(entry =>
        `<p><b>${escapeHtml(entry.Name)}</b> (<i>${escapeHtml(entry.Time)}</i>): ${escapeHtml(entry.Text)}</p>`
    ).join('');
    
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Meeting Transcript</title></head><body>${body}</body></html>`;
}

async function formatForAi(transcript, meetingName, recordingStartTime, attendeeReport) {
    const { aiInstructions = '' } = await chrome.storage.sync.get('aiInstructions');
    const date = recordingStartTime ? new Date(recordingStartTime) : new Date();
    
    let metadataHeader = `Meeting Title: ${meetingName}\nDate: ${date.toLocaleString()}`;
    
    // Add attendee information if available
    if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
        metadataHeader += `\nTotal Attendees: ${attendeeReport.totalUniqueAttendees}`;
        metadataHeader += '\n\nAttendee List:';
        attendeeReport.attendeeList.forEach(name => {
            metadataHeader += `\n- ${name}`;
        });
    }
    
    const transcriptText = transcript.map(entry => `[${entry.Time}] ${entry.Name}: ${entry.Text}`).join('\n\n');

    let finalContent = aiInstructions ? `${aiInstructions}\n\n---\n\n` : '';
    finalContent += `${metadataHeader}\n\n---\n\n${transcriptText}`;
    
    return finalContent;
}

// A simple HTML escaper for the .doc format
function escapeHtml(str) {
    return str.replace(/&/g, "&")
              .replace(/</g, "<")
              .replace(/>/g, ">")
              .replace(/"/g, "&quot;")
            //   .replace(/'/g, "'");
              .replace(/'/g, "&#039;");
}

// --- Core Actions ---
function downloadFile(filename, content, mimeType, saveAs) {
    const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
    chrome.downloads.download({
        url: url,
        filename: filename,
        saveAs: saveAs
    });
}

async function generateFilename(pattern, meetingTitle, format, attendeeReport) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
    const attendeeCount = attendeeReport ? attendeeReport.totalUniqueAttendees : 0;
    
    const replacements = {
        '{date}': dateStr,
        '{time}': timeStr,
        '{title}': getSanitizedMeetingName(meetingTitle),
        '{format}': format,
        '{attendees}': attendeeCount > 0 ? `${attendeeCount}_attendees` : ''
    };
    
    let filename = pattern || '{date}_{title}_{format}';
    for (const [key, value] of Object.entries(replacements)) {
        filename = filename.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }
    
    // Clean up any double underscores or trailing underscores
    filename = filename.replace(/__+/g, '_').replace(/_+$/, '');
    
    return filename;
}

async function saveTranscript(meetingTitle, transcriptArray, aliases, format, recordingStartTime, saveAsPrompt, attendeeReport = null) {
    const processedTranscript = applyAliasesToTranscript(transcriptArray, aliases);
    const processedAttendeeReport = applyAliasesToAttendeeReport(attendeeReport, aliases);
    
    // Get filename pattern from settings
    const { filenamePattern } = await chrome.storage.sync.get('filenamePattern');
    const filename = await generateFilename(filenamePattern, meetingTitle, format, processedAttendeeReport);

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
                meetingTitle: meetingName,
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
            content = await formatForAi(processedTranscript, meetingName, recordingStartTime, processedAttendeeReport);
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
    downloadFile(fullFilename, content, mimeType, saveAsPrompt);
}

// --- State Management ---
let lastAutoSaveId = null;
let autoSaveInProgress = false;

async function createViewerTab(transcriptArray) {
    await chrome.storage.local.set({ captionsToView: transcriptArray });
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
}

function updateBadge(isCapturing) {
    if (isCapturing) {
        chrome.action.setBadgeText({ text: 'ON' });
        chrome.action.setBadgeBackgroundColor({ color: '#28a745' }); // Green
    } else {
        chrome.action.setBadgeText({ text: 'OFF' });
        chrome.action.setBadgeBackgroundColor({ color: '#6c757d' }); // Grey
    }
}

// --- Event Listeners ---
chrome.runtime.onInstalled.addListener(() => {
    updateBadge(false);
});

chrome.runtime.onStartup.addListener(() => {
    updateBadge(false);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        const { speakerAliases } = await chrome.storage.session.get('speakerAliases');

        switch (message.message) {
            case 'download_captions':
                console.log('[Teams Caption Saver] Download request received:', {
                    format: message.format,
                    transcriptCount: message.transcriptArray?.length,
                    hasAttendeeReport: !!message.attendeeReport,
                    attendeeCount: message.attendeeReport?.totalUniqueAttendees || 0
                });
                await saveTranscript(message.meetingTitle, message.transcriptArray, speakerAliases, message.format, message.recordingStartTime, true, message.attendeeReport);
                break;

            case 'save_on_leave':
                // Generate unique ID for this save request
                const saveId = `${message.meetingTitle}_${message.recordingStartTime}`;
                
                // Prevent duplicate saves
                if (autoSaveInProgress || lastAutoSaveId === saveId) {
                    console.log('Auto-save already in progress or completed for this meeting, skipping...');
                    break;
                }
                
                autoSaveInProgress = true;
                lastAutoSaveId = saveId;
                
                try {
                    const settings = await chrome.storage.sync.get(['autoSaveOnEnd', 'defaultSaveFormat']);
                    if (settings.autoSaveOnEnd && message.transcriptArray.length > 0) {
                        const formatToSave = settings.defaultSaveFormat || 'txt';
                        console.log(`Auto-saving transcript in ${formatToSave.toUpperCase()} format.`);
                        await saveTranscript(message.meetingTitle, message.transcriptArray, speakerAliases, formatToSave, message.recordingStartTime, false, message.attendeeReport);
                        console.log('Auto-save completed successfully.');
                    }
                } catch (error) {
                    console.error('Auto-save failed:', error);
                    // Reset state on error to allow retry
                    lastAutoSaveId = null;
                } finally {
                    autoSaveInProgress = false;
                }
                break;

            case 'display_captions':
                await createViewerTab(message.transcriptArray);
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
                console.warn('[Teams Caption Saver] Error logged:', message.error);
                // Could implement error reporting here
                break;
        }
    })();
    
    return true; // Indicates that the response will be sent asynchronously
});