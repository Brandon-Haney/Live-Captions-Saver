// --- Import SessionManager ---
importScripts('sessionManager.js', 'imageStore.js', 'transcriptRenderer.js');
const sessionManager = new SessionManager();

// Constants for documented magic numbers
const PENDING_DOWNLOAD_CLEANUP_INTERVAL_MS = 30000;  // 30s - how often to check for stale downloads
const PENDING_DOWNLOAD_STALE_THRESHOLD_MS = 60000;   // 60s - downloads older than this are stale
const AVG_CAPTION_DURATION_SEC = 3;                  // Avg seconds per caption (for duration estimation)
const MAX_SESSION_HISTORY = 10;                      // Max sessions to keep in history
const SESSION_CHUNK_SIZE = 100;                      // Captions per storage chunk (Chrome has 8KB item limit)

// --- Track pending downloads to set their filenames ---
const pendingDownloads = new Map();
// Queue of filenames waiting to be assigned to downloads (FIFO order)
const pendingFilenameQueue = [];
// Periodic cleanup interval for stale entries
let pendingDownloadsCleanupInterval = null;

// Start periodic cleanup of stale pending downloads
function startPendingDownloadsCleanup() {
    if (pendingDownloadsCleanupInterval) return;
    pendingDownloadsCleanupInterval = setInterval(() => {
        const now = Date.now();
        // Clean up stale entries from the Map
        for (const [key, value] of pendingDownloads) {
            if (typeof value === 'object' && value.timestamp && now - value.timestamp > PENDING_DOWNLOAD_STALE_THRESHOLD_MS) {
                pendingDownloads.delete(key);
            }
        }
        // Clean up stale entries from the queue
        while (pendingFilenameQueue.length > 0 && now - pendingFilenameQueue[0].timestamp > PENDING_DOWNLOAD_STALE_THRESHOLD_MS) {
            pendingFilenameQueue.shift();
        }
        // Stop cleanup if nothing to clean
        if (pendingDownloads.size === 0 && pendingFilenameQueue.length === 0) {
            clearInterval(pendingDownloadsCleanupInterval);
            pendingDownloadsCleanupInterval = null;
        }
    }, PENDING_DOWNLOAD_CLEANUP_INTERVAL_MS);
}
startPendingDownloadsCleanup();

// --- Utility Functions ---
// Safe timestamp parsing to prevent NaN in sorting
function parseSafeTimestamp(timestampValue) {
    if (!timestampValue) return 0;

    try {
        const parsed = new Date(timestampValue).getTime();
        return isNaN(parsed) ? 0 : parsed;
    } catch (error) {
        console.error('[parseSafeTimestamp] Invalid timestamp:', timestampValue, error);
        return 0;
    }
}

// Storage quota management
const QUOTA_THRESHOLD = 0.9; // 90% of quota limit

async function checkStorageQuota() {
    try {
        const usage = await chrome.storage.local.getBytesInUse();
        const limit = chrome.storage.local.QUOTA_BYTES;
        const percentUsed = usage / limit;

        console.log(`[Storage] Usage: ${usage} bytes / ${limit} bytes (${(percentUsed * 100).toFixed(1)}%)`);

        if (percentUsed > QUOTA_THRESHOLD) {
            console.warn(`[Storage] Quota threshold exceeded: ${(percentUsed * 100).toFixed(1)}%`);
            return { exceeded: true, usage, limit, percentUsed };
        }

        return { exceeded: false, usage, limit, percentUsed };
    } catch (error) {
        console.error('[checkStorageQuota] Failed to check quota:', error);
        return { exceeded: false, error: error.message };
    }
}

async function cleanupOldSessions(minSessionsToKeep = 3) {
    try {
        const { session_index = [] } = await chrome.storage.local.get('session_index');

        if (session_index.length <= minSessionsToKeep) {
            console.log(`[Storage] Only ${session_index.length} sessions, no cleanup needed`);
            return { cleaned: 0 };
        }

        // Sort by timestamp (oldest first) and remove oldest sessions
        session_index.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        const sessionsToDelete = session_index.slice(0, session_index.length - minSessionsToKeep);
        console.log(`[Storage] Cleaning up ${sessionsToDelete.length} old sessions`);

        for (const session of sessionsToDelete) {
            const keysToDelete = [];
            for (let i = 0; i < session.chunkCount; i++) {
                keysToDelete.push(`${session.id}_chunk_${i}`);
            }
            keysToDelete.push(`${session.id}_attendees`);
            await chrome.storage.local.remove(keysToDelete);
        }

        // Update index with remaining sessions
        const remainingSessions = session_index.slice(session_index.length - minSessionsToKeep);
        // Re-sort newest first for display
        remainingSessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        await chrome.storage.local.set({ session_index: remainingSessions });

        console.log(`[Storage] Cleanup complete. Removed ${sessionsToDelete.length} sessions`);
        return { cleaned: sessionsToDelete.length };
    } catch (error) {
        console.error('[cleanupOldSessions] Failed to cleanup:', error);
        return { cleaned: 0, error: error.message };
    }
}

async function ensureStorageSpace() {
    const quota = await checkStorageQuota();

    if (quota.exceeded) {
        console.log('[Storage] Quota exceeded, attempting cleanup...');
        const cleanup = await cleanupOldSessions(3);

        // Check quota again after cleanup
        const newQuota = await checkStorageQuota();

        if (newQuota.exceeded) {
            // Still exceeded after cleanup, notify user
            try {
                chrome.runtime.sendMessage({
                    action: 'showNotification',
                    title: 'Live Captions Saver - Storage Full',
                    message: 'Storage quota exceeded. Please delete old sessions from the popup to free up space.'
                }).catch(() => {});
            } catch (e) {
                console.error('[ensureStorageSpace] Failed to notify user:', e);
            }
            return { success: false, reason: 'quota_exceeded' };
        }

        console.log(`[Storage] Cleanup successful. Freed space for new data.`);
        return { success: true, cleaned: cleanup.cleaned };
    }

    return { success: true };
}

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
// Input validation for transcript array
function validateTranscriptInput(transcript) {
    if (!transcript) return [];
    if (!Array.isArray(transcript)) {
        console.warn('[validateTranscriptInput] Expected array, got:', typeof transcript);
        return [];
    }
    // Filter out invalid entries
    return transcript.filter(entry =>
        entry && typeof entry === 'object' && (entry.Name || entry.Text)
    );
}

function formatAsTxt(transcript, attendeeReport) {
    const validTranscript = validateTranscriptInput(transcript);
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

    // Fallback: If still no attendees, generate from speakers in transcript
    if (totalAttendees === 0) {
        console.log('[formatAsTxt] No attendee data found, generating from speakers');
        // Filter out attendance events before extracting speaker names
        const speakers = [...new Set(
            validTranscript
                .filter(entry => entry.Type !== 'attendance')
                .map(entry => entry.Name)
                .filter(name => name && name.trim())
        )];
        if (speakers.length > 0) {
            attendeeList = speakers.sort();
            totalAttendees = speakers.length;
            // Try to get meeting start from first transcript entry
            if (validTranscript.length > 0 && validTranscript[0].timestamp) {
                meetingStart = validTranscript[0].timestamp;
            }
        }
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

    // Handle empty transcript - still allow export with just attendees
    if (validTranscript.length === 0 && totalAttendees === 0) {
        return content + '\n(No transcript data available)\n';
    }

    // Merge transcript and attendee events chronologically
    const combinedEvents = [...validTranscript];

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
        const timeA = a.sortKey || parseSafeTimestamp(a.timestamp);
        const timeB = b.sortKey || parseSafeTimestamp(b.timestamp);
        return timeA - timeB;
    });

    // Format all events
    content += combinedEvents.map(entry => {
        if (entry.Type === 'attendance') {
            // Format: [TIME] ● Name joined/left the meeting
            return `[${entry.Time}] ● ${entry.Name} ${entry.Text}`;
        } else if (entry.Type === 'chat') {
            return `[CHAT] [${entry.Time}] ${entry.Name}: ${entry.Text}`;
        } else if (entry.Type === 'slide') {
            return `[SLIDE] [${entry.Time}] ${entry.Name}: ${entry.Text}`;
        } else {
            return `[${entry.Time}] ${entry.Name}: ${entry.Text}`;
        }
    }).join('\n');

    return content;
}

function formatAsMarkdown(transcript, attendeeReport, meetingTitle = 'Untitled Meeting', recordingStartTime = null) {
    const validTranscript = validateTranscriptInput(transcript);
    let content = '';

    // Add meeting title as H1
    content += `# ${meetingTitle}\n\n`;

    // Add meeting metadata section
    content += '## Meeting Information\n\n';

    // Handle both formats of attendee reports (Teams/Meet vs Zoom)
    let attendeeList = [];
    let totalAttendees = 0;
    let meetingStart = recordingStartTime;
    let attendeeHistory = [];

    if (attendeeReport) {
        // Format 1: Standard format
        if (attendeeReport.attendeeList && attendeeReport.totalUniqueAttendees) {
            attendeeList = attendeeReport.attendeeList;
            totalAttendees = attendeeReport.totalUniqueAttendees;
            meetingStart = attendeeReport.meetingStartTime || recordingStartTime;
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
            meetingStart = attendeeReport.meetingStartTime || recordingStartTime;
            attendeeHistory = attendeeReport.attendeeHistory || [];
        }
    }

    // Fallback: If still no attendees, generate from speakers in transcript
    if (totalAttendees === 0) {
        console.log('[formatAsMarkdown] No attendee data found, generating from speakers');
        // Filter out attendance events before extracting speaker names
        const speakers = [...new Set(
            validTranscript
                .filter(entry => entry.Type !== 'attendance')
                .map(entry => entry.Name)
                .filter(name => name && name.trim())
        )];
        if (speakers.length > 0) {
            attendeeList = speakers.sort();
            totalAttendees = speakers.length;
            // Try to get meeting start from first transcript entry
            if (validTranscript.length > 0 && validTranscript[0].timestamp) {
                meetingStart = validTranscript[0].timestamp;
            }
        }
    }

    // Add metadata
    content += `**Total Captions:** ${transcript.length}\n\n`;

    if (totalAttendees > 0) {
        content += `**Total Attendees:** ${totalAttendees}\n\n`;
    }

    if (meetingStart) {
        content += `**Meeting Start:** ${new Date(meetingStart).toLocaleString()}\n\n`;
    }

    // Add first and last caption times if available
    if (transcript.length > 0 && transcript[0].Time && transcript[transcript.length - 1].Time) {
        content += `**First Caption:** ${transcript[0].Time}\n\n`;
        content += `**Last Caption:** ${transcript[transcript.length - 1].Time}\n\n`;
    }

    content += `**Exported:** ${new Date().toLocaleString()}\n\n`;

    // Add attendee list if available
    if (totalAttendees > 0) {
        content += '---\n\n';
        content += '## Attendees\n\n';
        attendeeList.forEach(name => {
            content += `- ${name}\n`;
        });
    }

    content += '\n---\n\n';
    content += '## Transcript\n\n';

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
        const timeA = a.sortKey || parseSafeTimestamp(a.timestamp);
        const timeB = b.sortKey || parseSafeTimestamp(b.timestamp);
        return timeA - timeB;
    });

    // Format transcript with speaker headings and blockquotes
    let lastSpeaker = null;
    combinedEvents.forEach(entry => {
        if (entry.Type === 'attendance') {
            // Join/leave events - reset speaker grouping
            lastSpeaker = null;
            content += `\n*● ${entry.Name} ${entry.Text}* (${entry.Time})\n\n`;
        } else {
            // Regular captions or chat messages
            const typeIndicator = entry.Type === 'chat' ? '[CHAT] ' : (entry.Type === 'slide' ? '[SLIDE] ' : '');

            // Add speaker heading if speaker changed
            if (entry.Name !== lastSpeaker) {
                lastSpeaker = entry.Name;
                content += `\n### ${typeIndicator}${entry.Name}\n\n`;
            }

            // Add caption as blockquote with timestamp
            content += `> **[${entry.Time}]** ${entry.Text}\n\n`;
        }
    });

    return content.trim();
}

function formatAsDoc(transcript, attendeeReport) {
    let body = '';
    let attendeeHistory = [];
    let attendeeList = [];
    let totalAttendees = 0;
    let meetingStart = null;

    // Fallback: If no attendee report, generate from speakers in transcript
    if (!attendeeReport || attendeeReport.totalUniqueAttendees === 0) {
        console.log('[formatAsDoc] No attendee report, generating from speakers');
        // Filter out attendance events before extracting speaker names
        const speakers = [...new Set(
            transcript
                .filter(entry => entry.Type !== 'attendance')
                .map(entry => entry.Name)
                .filter(name => name && name.trim())
        )];
        if (speakers.length > 0) {
            attendeeList = speakers.sort();
            totalAttendees = speakers.length;
            // Try to get meeting start from first transcript entry
            if (transcript.length > 0 && transcript[0].timestamp) {
                meetingStart = transcript[0].timestamp;
            }
        }
    } else if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
        attendeeList = attendeeReport.attendeeList;
        totalAttendees = attendeeReport.totalUniqueAttendees;
        meetingStart = attendeeReport.meetingStartTime;
        attendeeHistory = attendeeReport.attendeeHistory || [];
    }

    // Add attendee information if available
    if (totalAttendees > 0) {
        body += '<h2>Meeting Attendees</h2>';
        body += `<p><b>Total Attendees:</b> ${totalAttendees}</p>`;
        if (meetingStart) {
            body += `<p><b>Meeting Start:</b> ${escapeHtml(new Date(meetingStart).toLocaleString())}</p>`;
        }
        body += '<h3>Attendee List</h3><ul>';
        attendeeList.forEach(name => {
            body += `<li>${escapeHtml(name)}</li>`;
        });
        body += '</ul><hr><h2>Transcript</h2>';
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
        const timeA = a.sortKey || parseSafeTimestamp(a.timestamp);
        const timeB = b.sortKey || parseSafeTimestamp(b.timestamp);
        return timeA - timeB;
    });

    body += combinedEvents.map(entry => {
        if (entry.Type === 'attendance') {
            // Attendance events in gray, italic, centered
            return `<p style="text-align:center; color:#666; font-style:italic;">● ${escapeHtml(entry.Name)} ${escapeHtml(entry.Text)} - <i>${escapeHtml(entry.Time)}</i></p>`;
        } else if (entry.Type === 'chat') {
            return `<p>[CHAT] <b>${escapeHtml(entry.Name)}</b> (<i>${escapeHtml(entry.Time)}</i>): ${escapeHtml(entry.Text)}</p>`;
        } else if (entry.Type === 'slide') {
            return `<p>[SLIDE] <b>${escapeHtml(entry.Name)}</b> (<i>${escapeHtml(entry.Time)}</i>): ${escapeHtml(entry.Text)}</p>`;
        } else {
            return `<p><b>${escapeHtml(entry.Name)}</b> (<i>${escapeHtml(entry.Time)}</i>): ${escapeHtml(entry.Text)}</p>`;
        }
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Meeting Transcript</title></head><body>${body}</body></html>`;
}

// SRT subtitle format for video synchronization
// Requires user to input their external recording start time
function formatAsSrt(transcript, userRecordingStartTime) {
    const validTranscript = validateTranscriptInput(transcript)
        .filter(entry => entry.Type !== 'attendance' && entry.Type !== 'chat');

    if (validTranscript.length === 0) {
        return '1\n00:00:00,000 --> 00:00:03,000\n(No captions available)\n';
    }

    // Parse the user's recording start time
    const recordingStart = new Date(userRecordingStartTime).getTime();
    if (isNaN(recordingStart)) {
        console.error('[formatAsSrt] Invalid recording start time:', userRecordingStartTime);
        return '1\n00:00:00,000 --> 00:00:03,000\n(Invalid recording start time)\n';
    }

    // Sort transcript by timestamp
    const sortedTranscript = [...validTranscript].sort((a, b) => {
        const timeA = parseSafeTimestamp(a.timestamp);
        const timeB = parseSafeTimestamp(b.timestamp);
        return timeA - timeB;
    });

    const srtEntries = [];

    for (let i = 0; i < sortedTranscript.length; i++) {
        const entry = sortedTranscript[i];
        const captionTime = parseSafeTimestamp(entry.timestamp);

        if (captionTime === 0) continue;

        // Calculate relative start time from recording start
        let startMs = captionTime - recordingStart;

        // Skip captions that appear before the recording started
        if (startMs < 0) {
            console.log(`[formatAsSrt] Skipping caption before recording start: ${startMs}ms`);
            continue;
        }

        // Calculate end time
        let endMs;
        if (i < sortedTranscript.length - 1) {
            // End when next caption starts (minus small gap for readability)
            const nextCaptionTime = parseSafeTimestamp(sortedTranscript[i + 1].timestamp);
            endMs = nextCaptionTime - recordingStart - 100; // 100ms gap

            // Cap duration at 7 seconds max (subtitles shouldn't linger)
            const duration = endMs - startMs;
            if (duration > 7000) {
                endMs = startMs + 7000;
            }
        } else {
            // Last caption: estimate based on text length
            const wordCount = (entry.Text || '').split(/\s+/).length;
            const estimatedDuration = Math.min(7000, Math.max(2000, wordCount * 300));
            endMs = startMs + estimatedDuration;
        }

        // Ensure end is after start
        if (endMs <= startMs) {
            endMs = startMs + 2000;
        }

        srtEntries.push({
            index: srtEntries.length + 1,
            startMs,
            endMs,
            speaker: entry.Name || 'Unknown',
            text: entry.Text || ''
        });
    }

    if (srtEntries.length === 0) {
        return '1\n00:00:00,000 --> 00:00:03,000\n(No captions within recording timeframe)\n';
    }

    // Format as SRT
    return srtEntries.map(entry => {
        const startTime = formatSrtTimestamp(entry.startMs);
        const endTime = formatSrtTimestamp(entry.endMs);
        return `${entry.index}\n${startTime} --> ${endTime}\n[${entry.speaker}] ${entry.text}\n`;
    }).join('\n');
}

// Format milliseconds as SRT timestamp: HH:MM:SS,mmm
function formatSrtTimestamp(ms) {
    if (ms < 0) ms = 0;

    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const milliseconds = ms % 1000;

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
}

async function formatForAi(transcript, meetingTitle, recordingStartTime, attendeeReport) {
    let aiInstructions = '';
    try {
        const result = await chrome.storage.sync.get('aiInstructions');
        aiInstructions = result.aiInstructions || '';
    } catch (error) {
        console.error('[formatForAi] Failed to get AI instructions from storage:', error);
        // Continue with empty instructions
    }
    const date = recordingStartTime ? new Date(recordingStartTime) : new Date();

    let metadataHeader = `Meeting Title: ${meetingTitle}\nDate: ${date.toLocaleString()}`;
    let attendeeHistory = [];
    let attendeeList = [];
    let totalAttendees = 0;

    if (attendeeReport && attendeeReport.totalUniqueAttendees > 0) {
        attendeeList = attendeeReport.attendeeList;
        totalAttendees = attendeeReport.totalUniqueAttendees;
        attendeeHistory = attendeeReport.attendeeHistory || [];
    }

    // Fallback: If still no attendees, generate from speakers in transcript
    if (totalAttendees === 0) {
        console.log('[formatForAi] No attendee data found, generating from speakers');
        // Filter out attendance events before extracting speaker names
        const speakers = [...new Set(
            transcript
                .filter(entry => entry.Type !== 'attendance')
                .map(entry => entry.Name)
                .filter(name => name && name.trim())
        )];
        if (speakers.length > 0) {
            attendeeList = speakers.sort();
            totalAttendees = speakers.length;
        }
    }

    // Add attendee info to metadata header
    if (totalAttendees > 0) {
        metadataHeader += `\nTotal Attendees: ${totalAttendees}`;
        metadataHeader += '\n\nAttendee List:';
        attendeeList.forEach(name => {
            metadataHeader += `\n- ${name}`;
        });
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
        const timeA = a.sortKey || parseSafeTimestamp(a.timestamp);
        const timeB = b.sortKey || parseSafeTimestamp(b.timestamp);
        return timeA - timeB;
    });

    const transcriptText = combinedEvents.map(entry => {
        if (entry.Type === 'attendance') {
            return `[${entry.Time}] ● ${entry.Name} ${entry.Text}`;
        } else if (entry.Type === 'chat') {
            return `[CHAT] [${entry.Time}] ${entry.Name}: ${entry.Text}`;
        } else if (entry.Type === 'slide') {
            return `[SLIDE] [${entry.Time}] ${entry.Name}: ${entry.Text}`;
        } else {
            return `[${entry.Time}] ${entry.Name}: ${entry.Text}`;
        }
    }).join('\n');

    let finalContent = aiInstructions ? `${aiInstructions}\n\n---\n\n` : '';
    finalContent += `${metadataHeader}\n\n---\n\n${transcriptText}`;

    return finalContent;
}

// HTML escaper for the .doc format
function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;")
              .replace(/`/g, "&#96;");
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

        // Safety-net sanitization: strip any characters Windows forbids in filenames.
        // getSanitizedMeetingName already handles this for meeting titles, but this
        // catches anything that slips through (custom patterns, edge cases, etc.)
        let finalFilename = filename.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_');

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
            // Add to queue BEFORE starting download - onDeterminingFilename will pick from queue
            pendingFilenameQueue.push({
                filename: finalFilename,
                timestamp: Date.now()
            });
            startPendingDownloadsCleanup(); // Ensure cleanup is running
        }

        const downloadId = await chrome.downloads.download(downloadOptions);

        // Associate download ID with filename for onDeterminingFilename handler
        // This provides a direct lookup if the event fires after we have the ID
        if (!saveAs && finalFilename) {
            pendingDownloads.set(downloadId, {
                filename: finalFilename,
                timestamp: Date.now()
            });
        }

        console.log(`[downloadFile] Download initiated: ${finalFilename}`);

    } catch (error) {
        console.error('[downloadFile] Download failed:', error);
        // Return error state for caller to handle
        return { success: false, error: error.message };
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
        console.error('[downloadFile] Failed to notify viewer:', error);
        // Non-critical error, continue
    }

    return { success: true };
}

async function generateFilename(pattern, meetingTitle, format, attendeeReport) {
    try {
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

        // Add -AI suffix for AI format exports
        if (format === 'ai') {
            filename += '-AI';
        }

        console.log('[generateFilename] Final filename:', filename);
        return filename;
    } catch (error) {
        console.error('[generateFilename] Failed to generate filename:', error);
        // Return safe fallback filename
        return `Meeting_${new Date().toISOString().split('T')[0]}`;
    }
}

async function saveTranscript(meetingTitle, transcriptArray, aliases, format, recordingStartTime, saveAsPrompt, attendeeReport = null, userRecordingStartTime = null, platform = null) {
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
    let filenamePattern = null;
    try {
        const result = await chrome.storage.sync.get('filenamePattern');
        filenamePattern = result.filenamePattern;
    } catch (error) {
        console.error('[saveTranscript] Failed to get filename pattern from storage:', error);
        // Will use default pattern in generateFilename
    }
    console.log('[saveTranscript] Using filename pattern:', filenamePattern || '{date}_{title}');

    const filename = await generateFilename(filenamePattern, meetingTitle, format, processedAttendeeReport);
    console.log('[saveTranscript] Generated filename (without extension):', filename);

    let content, extension, mimeType;

    console.log('[saveTranscript] Processing format:', format, 'userRecordingStartTime:', userRecordingStartTime);

    switch (format) {
        case 'md':
            content = formatAsMarkdown(processedTranscript, processedAttendeeReport, meetingTitle, recordingStartTime);
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
        case 'srt':
            if (!userRecordingStartTime) {
                console.error('[saveTranscript] SRT format requires userRecordingStartTime');
                throw new Error('SRT export requires a recording start time');
            }
            content = formatAsSrt(processedTranscript, userRecordingStartTime);
            extension = 'srt';
            mimeType = 'application/x-subrip';
            break;
        case 'html': {
            // Self-contained page: slides and embedded chat images are inlined from the image store
            let images = {};
            try {
                images = await ImageStore.getDataUrls(TranscriptRenderer.collectImageIds(processedTranscript));
            } catch (error) {
                console.warn('[saveTranscript] Could not load images for HTML export:', error);
            }
            const PLATFORM_NAMES = { teams: 'Microsoft Teams', meet: 'Google Meet', zoom: 'Zoom' };
            content = TranscriptRenderer.buildStandaloneDocument({
                meetingTitle,
                platform: PLATFORM_NAMES[platform] || platform || null,
                entries: processedTranscript,
                attendeeReport: processedAttendeeReport,
                images,
                recordingStartTime
            });
            extension = 'html';
            mimeType = 'text/html';
            break;
        }
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

async function createViewerTab(transcriptArray, meetingTitle, platform, sessionId, scrollToIndex) {
    const data = {
        captionsToView: transcriptArray,
        meetingTitle: meetingTitle,
        platform: platform,  // Store platform for display
        viewerSessionId: sessionId  // Store session ID for filtering live updates
    };
    if (scrollToIndex != null) {
        data.scrollToIndex = scrollToIndex;
    }
    await chrome.storage.local.set(data);
    chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
}

async function updateBadge(isCapturing) {
    if (isCapturing) {
        // Create a custom icon with a green dot overlay for better centering
        const canvas = new OffscreenCanvas(128, 128);
        const ctx = canvas.getContext('2d');

        // Load the base icon
        const baseIcon = await fetch(chrome.runtime.getURL('icon.png'));
        const blob = await baseIcon.blob();
        const bitmap = await createImageBitmap(blob);

        // Draw base icon
        ctx.drawImage(bitmap, 0, 0, 128, 128);

        // Draw green recording dot in bottom-right corner
        const dotSize = 40;
        const dotX = 128 - dotSize / 2 - 8;
        const dotY = 128 - dotSize / 2 - 8;

        // Draw white background circle for contrast
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotSize / 2 + 2, 0, 2 * Math.PI);
        ctx.fill();

        // Draw green dot
        ctx.fillStyle = '#28a745';
        ctx.beginPath();
        ctx.arc(dotX, dotY, dotSize / 2, 0, 2 * Math.PI);
        ctx.fill();

        // Convert to ImageData and set as icon
        const imageData = ctx.getImageData(0, 0, 128, 128);
        chrome.action.setIcon({ imageData: imageData });
    } else {
        // Reset to original icon
        chrome.action.setIcon({ path: 'icon.png' });
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
        // Use 'timestamp' field (ISO format) instead of 'Time' field (locale formatted string)
        // This fixes issues where Time field contains formatted strings like "3:45:12 PM"
        const firstEntry = transcriptArray[0];
        const lastEntry = transcriptArray[transcriptArray.length - 1];

        // Try timestamp field first (ISO format), fall back to Time field
        const firstTimeStr = firstEntry.timestamp || firstEntry.Time;
        const lastTimeStr = lastEntry.timestamp || lastEntry.Time;

        const firstTime = new Date(firstTimeStr);
        const lastTime = new Date(lastTimeStr);

        // Check if dates are valid
        if (isNaN(firstTime.getTime()) || isNaN(lastTime.getTime())) {
            // Fallback: estimate based on caption count
            const estimatedMinutes = Math.round((transcriptArray.length * AVG_CAPTION_DURATION_SEC) / 60);
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
    try {
        // Check storage quota before saving
        const spaceCheck = await ensureStorageSpace();
        if (!spaceCheck.success) {
            console.error('[Service Worker] Insufficient storage space, cannot save session');
            return { success: false, error: 'Storage quota exceeded' };
        }

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

        // Update session index with retry logic for concurrent writes
        const MAX_RETRIES = 3;
        let retryCount = 0;
        let saved = false;

        while (!saved && retryCount < MAX_RETRIES) {
            try {
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
                saved = true;
                console.log('[Service Worker] Session saved to history:', sessionId);
            } catch (error) {
                retryCount++;
                if (retryCount >= MAX_RETRIES) {
                    throw error;
                }
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 100 * retryCount));
                console.log(`[Service Worker] Retrying session save (attempt ${retryCount + 1}/${MAX_RETRIES})`);
            }
        }

        return { success: true, sessionId };
    } catch (error) {
        console.error('[Service Worker] Failed to save session to history:', error);
        return { success: false, error: error.message };
    }
}

chrome.runtime.onInstalled.addListener(() => {
    updateBadge(false);
});

chrome.runtime.onStartup.addListener(() => {
    updateBadge(false);
});

// Clear badge when meeting tabs are closed and end associated sessions
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    // Check if this tab had an active session
    const activeSessions = await sessionManager.getActiveSessions();
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
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        const meetingDomains = ['teams.microsoft.com', 'meet.google.com', 'zoom.us', 'app.zoom.us'];
        const isLeavingMeetingPage = !meetingDomains.some(domain => changeInfo.url.includes(domain));

        if (isLeavingMeetingPage) {
            // Check if this tab had an active session
            const activeSessions = await sessionManager.getActiveSessions();
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
// --- Recording Transcript Badge Management ---
async function updateRecordingBadge(count) {
    try {
        if (count > 0) {
            await chrome.action.setBadgeText({ text: String(count) });
            await chrome.action.setBadgeBackgroundColor({ color: '#0078d4' }); // Teams blue
            await chrome.action.setTitle({ title: `Live Captions Saver - ${count} recording transcript${count > 1 ? 's' : ''} available` });
        } else {
            await chrome.action.setBadgeText({ text: '' });
            await chrome.action.setTitle({ title: 'Live Captions Saver' });
        }
    } catch (error) {
        console.error('[Service Worker] Failed to update badge:', error);
    }
}

// Clean up expired recording transcripts on startup
(async function cleanupExpiredRecordings() {
    try {
        const { recording_transcripts = [] } = await chrome.storage.local.get('recording_transcripts');
        const now = new Date().toISOString();

        const validTranscripts = recording_transcripts.filter(rec => rec.expiresAt > now);

        if (validTranscripts.length !== recording_transcripts.length) {
            console.log(`[Service Worker] Cleaned up ${recording_transcripts.length - validTranscripts.length} expired recording transcripts`);
            await chrome.storage.local.set({ recording_transcripts: validTranscripts });
        }

        // Update badge with current count
        await updateRecordingBadge(validTranscripts.length);
    } catch (error) {
        console.error('[Service Worker] Failed to cleanup expired recordings:', error);
    }
})();

chrome.downloads.onDeterminingFilename?.addListener((downloadItem, suggest) => {
    let pendingFilename = null;

    // Method 1: Check if we have a pending filename for this download by ID (most reliable)
    const pendingEntry = pendingDownloads.get(downloadItem.id);
    if (pendingEntry && pendingEntry.filename) {
        pendingFilename = pendingEntry.filename;
        pendingDownloads.delete(downloadItem.id);
    }

    // Method 2: If not found by ID, check queue for URLs we created (blob: and data:)
    // This handles the race condition where onDeterminingFilename fires before we get the download ID
    // Only apply queue filenames to blob: or data: URLs to avoid interfering with other extensions
    if (!pendingFilename && pendingFilenameQueue.length > 0) {
        const isOurUrl = downloadItem.url && (downloadItem.url.startsWith('blob:') || downloadItem.url.startsWith('data:'));
        if (isOurUrl) {
            const queueEntry = pendingFilenameQueue.shift();
            pendingFilename = queueEntry.filename;
        }
    }

    if (pendingFilename && pendingFilename.trim()) {
        suggest({
            filename: pendingFilename,
            conflictAction: 'uniquify'
        });
        return true;
    }

    // Don't interfere with downloads from other extensions or sources
    // By not calling suggest() and not returning true, we let Chrome/other extensions handle it
});

// Monitor download progress and handle errors
chrome.downloads.onChanged?.addListener((delta) => {
    // Handle download state changes
    if (delta.state?.current === 'interrupted') {
        // Download was interrupted (network failure, disk full, etc.)
        const errorMsg = delta.error?.current || 'Unknown error';

        // Clean up from pending downloads
        pendingDownloads.delete(delta.id);

        // Silently handle user cancellations - this is expected behavior
        if (errorMsg === 'USER_CANCELED') {
            console.log('[Service Worker] Download cancelled by user:', delta.id);
            return;
        }

        // Log other errors (network failure, disk full, etc.)
        console.error('[Service Worker] Download interrupted:', delta.id, 'Error:', errorMsg);

        // Try to show notification to user for real errors (may not work if no active page)
        chrome.runtime.sendMessage({
            message: 'download_failed',
            downloadId: delta.id,
            error: errorMsg
        }).catch(() => {
            // No listeners - popup/content script might not be open
            console.log('[Service Worker] Could not notify user of download failure');
        });
    } else if (delta.state?.current === 'complete') {
        // Download completed successfully
        console.log('[Service Worker] Download completed:', delta.id);
        pendingDownloads.delete(delta.id);
    }

    // Handle download errors without state change (in case state doesn't transition to interrupted)
    if (delta.error?.current && delta.state?.current !== 'interrupted') {
        const errorMsg = delta.error.current;
        console.error('[Service Worker] Download error:', delta.id, errorMsg);
        pendingDownloads.delete(delta.id);

        // Notify user of the error
        chrome.runtime.sendMessage({
            message: 'download_failed',
            downloadId: delta.id,
            error: errorMsg
        }).catch(() => {
            console.log('[Service Worker] Could not notify user of download failure');
        });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Slide frames from the PowerPoint Live iframe (pptLiveCapture.js) go to the
    // Teams top frame of the same tab, which owns the session and the registry.
    if (message.message === 'shared_content_frame') {
        if (sender.tab && sender.tab.id != null && sender.frameId) {
            chrome.tabs.sendMessage(sender.tab.id, {
                message: 'shared_content_frame',
                source: message.source,
                frame: message.frame,
                fromFrameId: sender.frameId
            }, { frameId: 0 }).catch(() => {
                // No meeting content script in this tab (e.g. PowerPoint embedded elsewhere)
            });
        }
        sendResponse({ received: true });
        return;
    }

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
                    const sessionId = await sessionManager.createSession(tabId, message.platform, message.url);
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
                    const sessions = await sessionManager.getActiveSessions();
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
            case 'store_image': {
                // Content script hands us pixels (slides, embedded chat images); they live in IndexedDB
                try {
                    const image = message.image || {};
                    if (!image.id || !image.dataUrl) throw new Error('store_image requires id and dataUrl');
                    await ImageStore.put({
                        ...image,
                        sessionId: image.sessionId || message.sessionId || null
                    });
                    sendResponse({ success: true, id: image.id });
                } catch (error) {
                    console.error('[Service Worker] store_image failed:', error);
                    sendResponse({ success: false, error: error.message });
                }
                return;
            }
            case 'save_from_session':
                // Handle save from session data (multi-meeting support)
                console.log('Saving transcript from session');
                const { transcriptArray, meetingTitle, format, recordingStartTime, attendeeReport, userRecordingStartTime } = message;

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
                        attendeeReport,
                        userRecordingStartTime,
                        message.platform || null
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
                                zoomMeetingEnded.attendeeReport,
                                null,
                                'Zoom'
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
                break;

            case 'save_session_history':
                // Save meeting to session history using the saveSessionToHistory helper function
                // Use shared helper function
                try {
                    const result = await saveSessionToHistory(
                        message.transcriptArray,
                        message.meetingTitle,
                        message.attendeeReport
                    );
                    sendResponse(result);
                } catch (error) {
                    console.error('[Service Worker] Failed to save session:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'download_captions':
                try {
                    console.log('[Service Worker] download_captions received with:', {
                        meetingTitle: message.meetingTitle,
                        transcriptCount: message.transcriptArray?.length,
                        format: message.format,
                        sessionId: message.sessionId,
                        hasAttendeeReport: !!message.attendeeReport,
                        userRecordingStartTime: message.userRecordingStartTime
                    });

                    // Get session-specific aliases if they exist
                    const downloadSessionKey = `aliases_${message.sessionId || 'default'}`;
                    const downloadAliasData = await chrome.storage.local.get(downloadSessionKey);
                    const downloadAliases = downloadAliasData[downloadSessionKey] || {};

                    // Ensure meeting title is not undefined/empty
                    const titleToSave = message.meetingTitle || 'Untitled Meeting';
                    console.log('[Service Worker] Saving with title:', titleToSave);

                    // Use auto-download (saveAs: false) to provide filename automatically
                    await saveTranscript(titleToSave, message.transcriptArray, downloadAliases, message.format, message.recordingStartTime, false, message.attendeeReport, message.userRecordingStartTime, message.platform || null);

                    sendResponse({ success: true });
                } catch (error) {
                    console.error('[Service Worker] download_captions error:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

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

                        await saveTranscript(meetingTitleToSave, message.transcriptArray, autoSaveAliases, formatToSave, message.recordingStartTime, false, message.attendeeReport, null, message.platform || null);
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
                await createViewerTab(message.transcriptArray, message.meetingTitle, message.platform, message.sessionId, message.scrollToIndex);
                sendResponse({ success: true });
                break;
            
            case 'update_badge_status':
                updateBadge(message.capturing);
                // Reset auto-save state when starting a new capture session
                if (message.capturing) {
                    lastAutoSaveId = null;
                    autoSaveInProgress = false;
                    console.log('New capture session started, auto-save state reset.');
                }
                sendResponse({ success: true });
                break;


            case 'save_recording_transcript':
                // Store recording transcript from network interceptor
                try {
                    console.log('[Service Worker] Saving recording transcript:', message.meetingTitle);

                    const transcriptId = `recording_${Date.now()}`;
                    const recordingData = {
                        id: transcriptId,
                        transcript: message.transcript,
                        meetingTitle: message.meetingTitle,
                        url: message.url,
                        capturedAt: message.timestamp,
                        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
                    };

                    // Get existing recordings
                    const { recording_transcripts = [] } = await chrome.storage.local.get('recording_transcripts');

                    // Add new recording
                    recording_transcripts.push(recordingData);

                    // Store updated list
                    await chrome.storage.local.set({ recording_transcripts });

                    // Update badge to show count
                    await updateRecordingBadge(recording_transcripts.length);

                    // Show notification to content script (toast)
                    if (sender.tab && sender.tab.id) {
                        chrome.tabs.sendMessage(sender.tab.id, {
                            message: 'recording_transcript_saved',
                            meetingTitle: message.meetingTitle
                        }).catch(err => {
                            console.log('[Service Worker] Could not send toast notification:', err);
                        });
                    }

                    console.log('[Service Worker] Recording transcript saved:', transcriptId);
                    sendResponse({ success: true, id: transcriptId });
                } catch (error) {
                    console.error('[Service Worker] Failed to save recording transcript:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'update_recording_badge':
                // Update badge count for recording transcripts
                await updateRecordingBadge(message.count);
                sendResponse({ success: true });
                break;

            case 'open_extension_popup':
                // Open the extension popup when toast notification is clicked
                try {
                    // Get the sender tab and open popup for that window
                    if (sender.tab && sender.tab.windowId) {
                        await chrome.action.openPopup({ windowId: sender.tab.windowId });
                    } else {
                        // Fallback - just open the popup
                        await chrome.action.openPopup();
                    }
                    sendResponse({ success: true });
                } catch (error) {
                    console.log('[Service Worker] Could not programmatically open popup:', error);
                    // Note: chrome.action.openPopup() requires user interaction in some cases
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'download_blob':
                // Download a blob URL with a specific filename
                try {
                    // Add to queue BEFORE initiating download (handles race condition)
                    pendingFilenameQueue.push({
                        filename: message.filename,
                        timestamp: Date.now()
                    });
                    startPendingDownloadsCleanup();

                    // Trigger the download
                    const downloadId = await chrome.downloads.download({
                        url: message.url,
                        saveAs: false
                    });

                    // Also store with downloadId as backup (in case onDeterminingFilename fires after)
                    pendingDownloads.set(downloadId, {
                        filename: message.filename,
                        timestamp: Date.now()
                    });

                    console.log('[Service Worker] Recording download initiated:', downloadId, message.filename);
                    sendResponse({ success: true, downloadId: downloadId });
                } catch (error) {
                    console.error('[Service Worker] Download blob failed:', error);
                    sendResponse({ success: false, error: error.message });
                }
                break;

            case 'error_logged':
                // Central error logging - could send to analytics service
                console.warn('[Live Caption Saver] Error logged:', message.error);
                // Could implement error reporting here
                sendResponse({ success: true });
                break;

            default:
                // Unknown message type - still send response to prevent channel hanging
                sendResponse({ success: false, error: 'Unknown message type' });
                break;
        }
        } catch (error) {
            console.error('[Service Worker] Error handling message:', error);
            sendResponse({ success: false, error: error.message });
        }
    })();

    return true; // Indicates that the response will be sent asynchronously
});