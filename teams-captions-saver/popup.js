// --- Constants for DOM Elements and Data ---
const UI_ELEMENTS = {
    statusMessage: document.getElementById('status-message'),
    manualStartInfo: document.getElementById('manual-start-info'),
    copyButton: document.getElementById('copyButton'),
    copyDropdownButton: document.getElementById('copyDropdownButton'),
    copyOptions: document.getElementById('copyOptions'),
    saveButton: document.getElementById('saveButton'),
    saveDropdownButton: document.getElementById('saveDropdownButton'),
    saveOptions: document.getElementById('saveOptions'),
    viewButton: document.getElementById('viewButton'),
    defaultSaveFormatSelect: document.getElementById('defaultSaveFormat'),
    autoEnableCaptionsToggle: document.getElementById('autoEnableCaptionsToggle'),
    autoSaveOnEndToggle: document.getElementById('autoSaveOnEndToggle'),
    trackCaptionsToggle: document.getElementById('trackCaptionsToggle'),
    trackAttendeesToggle: document.getElementById('trackAttendeesToggle'),
    chatCaptureToggle: document.getElementById('chatCaptureToggle'),
    autoOpenAttendeesToggle: document.getElementById('autoOpenAttendeesToggle'),
    timestampFormat: document.getElementById('timestampFormat'),
    filenamePattern: document.getElementById('filenamePattern'),
    meetingType: document.getElementById('meetingType'),
    templateName: document.getElementById('templateName'),
    saveTemplateBtn: document.getElementById('saveTemplateBtn'),
    editTemplateBtn: document.getElementById('editTemplateBtn'),
    deleteTemplateBtn: document.getElementById('deleteTemplateBtn'),
    customTemplatesGroup: document.getElementById('customTemplatesGroup'),
    aiInstructions: document.getElementById('aiInstructions'),
    promptButtons: document.querySelectorAll('.prompt-button'),
    // Session History Elements
    sessionHistory: document.getElementById('sessionHistory'),
    historyButton: document.getElementById('historyButton'),
    sessionList: document.getElementById('sessionList'),
    // Multi-Session Elements
    sessionManager: document.getElementById('session-manager'),
    sessionSelector: document.getElementById('session-selector'),
    refreshSessions: document.getElementById('refresh-sessions'),
    exportAllSessions: document.getElementById('export-all-sessions'),
    sessionInfo: document.getElementById('session-info'),
    sessionPlatform: document.getElementById('session-platform'),
    sessionDuration: document.getElementById('session-duration'),
    sessionCaptions: document.getElementById('session-captions'),
    sessionAttendees: document.getElementById('session-attendees'),
    cleanupSessions: document.getElementById('cleanup-sessions')
};

// --- Multi-Session State ---
let activeSessions = [];
let selectedSessionId = null;


const MEETING_TYPE_PROMPTS = {
    "executive": "You are an executive assistant preparing a comprehensive meeting brief. Analyze this transcript and create a structured summary with:\n\n## Executive Summary\nProvide a 2-3 sentence overview of the meeting's purpose and outcome.\n\n## Key Decisions Made\nList each decision with:\n- The decision itself\n- Who made it\n- Impact/rationale\n- Timeline if mentioned\n\n## Action Items & Owners\nFormat as a table:\n| Owner | Action | Due Date | Priority |\n\n## Critical Discussion Points\n- Highlight 3-5 most important topics discussed\n- Include any concerns or risks raised\n\n## Follow-up Required\nList items needing attention from leadership\n\n## Metrics & KPIs Mentioned\nExtract any numbers, targets, or measurements discussed\n\nBe concise but thorough. Focus on what executives need to know and act upon.",
    "standup": "You are a scrum master analyzing this daily standup. Create a comprehensive summary with:\n\n## Team Status Overview\nOne-line health check of the team's progress\n\n## Individual Updates\nFor each team member, capture:\n- ✅ Completed yesterday\n- 🎯 Working on today\n- 🚧 Blockers/impediments\n\n## Blocked Items Requiring Attention\nPrioritize by impact on sprint goals\n\n## Action Items\n- Include who will help resolve blockers\n- Note any meetings needed\n\n## Sprint Health Indicators\n- Are we on track for sprint goals?\n- Any risks to delivery?\n\nHighlight patterns across multiple team members (e.g., common blockers).",
    "retrospective": "You are an agile coach facilitating continuous improvement. Analyze this retrospective and produce:\n\n## Sprint Sentiment\nOverall team morale and satisfaction (based on tone and feedback)\n\n## What Went Well\n- Group by themes (e.g., Process, Communication, Technical)\n- Note frequency if mentioned multiple times\n- Identify practices to continue\n\n## What Could Be Improved\n- Categorize by impact (High/Medium/Low)\n- Include root causes if discussed\n- Link related issues\n\n## Action Items (SMART format)\nFor each action:\n- Specific action to take\n- Owner(s)\n- Success criteria\n- Target completion date\n- Expected impact\n\n## Trends from Previous Retros\nIdentify recurring themes or unresolved issues\n\n## Team Dynamics Observations\nNote participation levels and any team health indicators",
    "planning": "You are a product manager optimizing sprint planning. Extract and organize:\n\n## Sprint Goal\nClear, measurable objective for this sprint\n\n## Capacity Planning\n- Team availability (holidays, meetings)\n- Velocity comparison to previous sprints\n- Risk buffer included?\n\n## Committed User Stories\n| Story ID | Title | Story Points | Assignee | Acceptance Criteria Met? |\n\n## Technical Dependencies\n- Internal dependencies between stories\n- External team dependencies\n- Blocker mitigation plans\n\n## Risks & Mitigation\n- Identified risks to sprint success\n- Mitigation strategies discussed\n\n## Definition of Done Reminders\nAny special criteria for this sprint\n\n## Parking Lot\nItems discussed but deferred to next sprint\n\nCalculate total story points and flag if over/under capacity.",
    "review": "You are a senior architect conducting a thorough design review. Document:\n\n## Design Overview\nBrief description of what was reviewed\n\n## Architectural Decisions\nFor each major decision:\n- Decision made\n- Alternatives considered\n- Trade-offs accepted\n- Technical rationale\n\n## Concerns & Risks Identified\nCategorize by:\n- 🔴 Critical (blocks implementation)\n- 🟡 Important (needs resolution soon)\n- 🟢 Minor (can be addressed later)\n\n## Approved Changes\n- What was approved\n- Conditions/requirements\n- Impact on timeline\n\n## Technical Debt Acknowledged\n- What debt was accepted\n- Plan to address it\n\n## Follow-up Actions\n| Action | Owner | Due Date | Required For |\n\n## Compliance & Standards\nNote any deviations from standards and justifications\n\n## Performance Considerations\nAny performance impacts discussed",
    "interview": "You are a hiring manager evaluating candidates objectively. Structure your assessment as:\n\n## Candidate Overview\n- Role interviewed for\n- Interview round/type\n- Interviewers present\n\n## Technical Competencies Demonstrated\nRate each skill discussed:\n- Skill: [Strong/Adequate/Needs Development/Not Assessed]\n- Evidence from conversation\n\n## Behavioral Indicators\nUsing STAR format when possible:\n- Situation described\n- Actions taken\n- Results achieved\n- Competency demonstrated\n\n## Cultural Fit Observations\n- Alignment with company values\n- Team collaboration potential\n- Communication style\n\n## Red Flags or Concerns\n- Be specific and objective\n- Quote relevant statements\n\n## Strengths Highlighted\n- Unique value propositions\n- Standout moments\n\n## Questions from Candidate\n- What they asked about\n- Indicates interest/research level\n\n## Recommended Next Steps\n- Clear hire/no-hire recommendation\n- If proceeding, what to explore further\n- If not, specific gaps to document",
    "allhands": "You are a communications director ensuring company-wide alignment. Create a digest with:\n\n## Meeting Headline\nOne impactful sentence summarizing the main message\n\n## Leadership Messages\n- Key points from each executive\n- Strategic priorities emphasized\n- Cultural messages reinforced\n\n## Company Metrics Shared\n| Metric | Current | Target | Trend |\n\n## Major Announcements\nFor each announcement:\n- What's changing/new\n- Why it matters\n- Timeline\n- Impact on teams\n\n## Recognition & Celebrations\n- Teams/individuals recognized\n- Achievements celebrated\n\n## Q&A Highlights\n- Most important questions asked\n- Leadership responses\n- Concerns addressed\n\n## Action Items by Department\nWhat each team needs to do differently\n\n## Resources Mentioned\n- Links, documents, or tools referenced\n\n## Next All-Hands Preview\nTopics to be covered next time",
    "1on1": "You are a people manager focused on employee development. Document this 1:1 with:\n\n## Meeting Context\n- Manager and direct report names\n- Recurring or special 1:1?\n\n## Employee Well-being Check\n- Overall morale/satisfaction\n- Work-life balance indicators\n- Any personal concerns affecting work\n\n## Performance Discussion\n- Progress on current goals\n- Achievements to celebrate\n- Areas for improvement\n- Specific feedback exchanged\n\n## Career Development\n- Growth aspirations discussed\n- Skills to develop\n- Opportunities identified\n- Training/mentoring needs\n\n## Challenges & Support Needed\n- Current obstacles\n- Resources requested\n- Manager commitments to help\n\n## Action Items\n| Who | What | By When |\n\n## Topics for Next 1:1\n- Follow-ups needed\n- Topics parked for later\n\n## Manager Notes (Confidential)\n- Performance trends\n- Development opportunities\n- Team dynamics observations\n\nMaintain professional tone while capturing coaching moments.",
    "brainstorm": "You are an innovation strategist maximizing creative output. Organize this session into:\n\n## Session Objective\nWhat problem were we trying to solve?\n\n## Ideas Generated (Grouped by Theme)\nOrganize ideas into logical categories:\n\n### Category 1\n- Idea (contributor)\n- Build on this: [related ideas]\n\n### Category 2\n- Continue pattern...\n\n## Top Ideas by Engagement\nList 5-7 ideas that generated most discussion/excitement:\n1. Idea - Why it resonated\n2. Continue...\n\n## Feasibility Quick Assessment\n| Idea | Impact | Effort | Priority |\n| --- | --- | --- | --- |\n| Top ideas... | High/Med/Low | High/Med/Low | 1-5 |\n\n## Wild Cards\nUnconventional ideas worth noting (even if not practical)\n\n## Next Steps\n- Which ideas move to validation?\n- Who owns follow-up?\n- Timeline for decisions\n\n## Parking Lot\nGood ideas outside current scope\n\n## Session Effectiveness\n- Participation level\n- Diversity of ideas\n- Did we meet objective?\n\nCapture the energy and creativity while maintaining actionable output."
};

let currentDefaultFormat = 'txt';

// --- Error Handling ---
function safeExecute(fn, context = '', fallback = null) {
    try {
        return fn();
    } catch (error) {
        console.error(`[Live Caption Saver] ${context}:`, error);
        return fallback;
    }
}

// --- Utility Functions ---
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function getActiveMeetingTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    // Check for supported platforms
    const supportedPlatforms = [
        "https://teams.microsoft.com",
        "https://teams.live.com",
        "https://meet.google.com",
        "https://web.zoom.us",
        "https://app.zoom.us",
        "https://zoom.us"
    ];
    
    const meetingTab = tabs.find(tab => {
        return supportedPlatforms.some(platform => tab.url?.startsWith(platform));
    });
    
    // Update platform info if we found a tab
    if (meetingTab) {
        const platformInfo = document.getElementById('platform-info');
        if (platformInfo) {
            if (meetingTab.url.includes('teams.microsoft.com')) {
                platformInfo.textContent = 'Connected to Microsoft Teams';
            } else if (meetingTab.url.includes('teams.live.com')) {
                platformInfo.textContent = 'Connected to Microsoft Teams (Personal)';
            } else if (meetingTab.url.includes('meet.google.com')) {
                platformInfo.textContent = 'Connected to Google Meet';
            } else if (meetingTab.url.includes('zoom.us')) {
                platformInfo.textContent = 'Connected to Zoom';
            }
        }
    }
    
    return meetingTab || null;
}

// --- Multi-Session Management Functions ---
async function loadActiveSessions() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getActiveSessions' });

        // Check for extension context invalidated error
        if (chrome.runtime.lastError) {
            console.error('[loadActiveSessions] Extension context error:', chrome.runtime.lastError);
            // Show user notification for critical errors
            if (UI_ELEMENTS.statusMessage) {
                UI_ELEMENTS.statusMessage.textContent = 'Extension reloaded. Please refresh the page.';
                UI_ELEMENTS.statusMessage.style.color = '#dc3545';
            }
            return;
        }
        if (response && response.sessions) {
            // Check if tabs still exist for active sessions
            const validSessions = [];
            const staleSessions = [];

            for (const session of response.sessions) {
                // Check if the tab still exists and is on a meeting page
                let tabExists = false;
                try {
                    const tab = await chrome.tabs.get(session.tabId);
                    // Check if tab is still on a meeting page
                    const meetingDomains = ['teams.microsoft.com', 'teams.live.com', 'meet.google.com', 'zoom.us', 'app.zoom.us', 'web.zoom.us'];
                    tabExists = tab && tab.url && meetingDomains.some(domain => tab.url.includes(domain));
                } catch (e) {
                    // Tab doesn't exist
                    tabExists = false;
                }

                // Also check for stale sessions (active for more than 12 hours with no recent activity)
                const startTime = new Date(session.startTime);
                const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
                const lastActivity = session.lastUpdate ? new Date(session.lastUpdate) : startTime;
                const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

                // Keep session if:
                // - Tab exists and is on meeting page
                // - OR has recent activity (within 2 minutes)
                // - OR is a new session (started within last 5 minutes) even without content
                // Sessions with no tab should be marked as stale unless very recent
                const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

                if (tabExists) {
                    // Tab exists - keep the session
                    validSessions.push(session);
                } else if (lastActivity > twoMinutesAgo && session.captionCount > 0) {
                    // No tab, but very recent activity with content - keep temporarily
                    validSessions.push(session);
                } else if (startTime > fiveMinutesAgo && session.status === 'active') {
                    // New session that just started - keep it even without content yet
                    validSessions.push(session);
                } else {
                    // No tab and either old or no content - mark as stale
                    staleSessions.push(session);
                }
            }

            activeSessions = validSessions;

            // Clean up any stale sessions we identified
            for (const staleSession of staleSessions) {
                console.log(`Ending stale session: ${staleSession.meetingTitle} (${staleSession.platform})`);
                chrome.runtime.sendMessage({
                    action: 'endSession',
                    sessionId: staleSession.sessionId
                });
            }

            updateSessionSelector();

            // Only show session manager if we have multiple REAL active sessions from different tabs
            // Don't show for old/stale sessions
            if (activeSessions.length > 1) {
                // Check if sessions are from different tabs (real concurrent meetings)
                const uniqueTabs = new Set(activeSessions.map(s => s.tabId));
                if (uniqueTabs.size > 1 || activeSessions.some(s => s.captionCount > 0)) {
                    UI_ELEMENTS.sessionManager.style.display = 'block';
                } else {
                    UI_ELEMENTS.sessionManager.style.display = 'none';
                }
            } else if (activeSessions.length === 1) {
                // Auto-select single session
                selectedSessionId = activeSessions[0].sessionId;
                UI_ELEMENTS.sessionManager.style.display = 'none';
                // Enable View Transcript button for the auto-selected session
                UI_ELEMENTS.viewButton.disabled = false;
                // Enable other buttons if session has data
                if (activeSessions[0].captionCount > 0) {
                    UI_ELEMENTS.copyButton.disabled = false;
                    UI_ELEMENTS.copyDropdownButton.disabled = false;
                    UI_ELEMENTS.saveButton.disabled = false;
                    UI_ELEMENTS.saveDropdownButton.disabled = false;
                }
            } else {
                UI_ELEMENTS.sessionManager.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Failed to load active sessions:', error);
    }
}

function updateSessionSelector() {
    const selector = UI_ELEMENTS.sessionSelector;
    selector.innerHTML = '<option value="">Select a meeting session...</option>';
    
    activeSessions.forEach(session => {
        const option = document.createElement('option');
        option.value = session.sessionId;

        // Format session display with more context
        const platform = session.platform ? session.platform.charAt(0).toUpperCase() + session.platform.slice(1) : 'Unknown';
        const title = session.meetingTitle || 'Untitled Meeting';
        const captions = session.captionCount || 0;
        const duration = formatDuration(session.duration || 0);

        // Add status indicator for potentially stale sessions
        const lastUpdate = session.lastUpdate ? new Date(session.lastUpdate) : new Date(session.startTime);
        const minutesAgo = Math.floor((Date.now() - lastUpdate.getTime()) / 60000);
        const statusIndicator = minutesAgo > 5 ? ' ⚠️' : '';

        option.textContent = `${platform}: ${title} (${captions} captions, ${duration})${statusIndicator}`;

        // Set color based on platform
        if (session.platform === 'teams') {
            option.style.color = '#6264a7';
        } else if (session.platform === 'zoom') {
            option.style.color = '#2d8cff';
        } else if (session.platform === 'meet') {
            option.style.color = '#00897b';
        }

        // Add tooltip with more info
        option.title = `Platform: ${platform}\nMeeting: ${title}\nCaptions: ${captions}\nDuration: ${duration}\nLast Activity: ${minutesAgo} min ago${statusIndicator ? '\n⚠️ May be inactive' : ''}`;

        selector.appendChild(option);
    });
    
    // Restore selected session
    if (selectedSessionId && activeSessions.find(s => s.sessionId === selectedSessionId)) {
        selector.value = selectedSessionId;
        updateSessionInfo(selectedSessionId);
    }
}

function updateSessionInfo(sessionId) {
    const session = activeSessions.find(s => s.sessionId === sessionId);
    if (!session) {
        UI_ELEMENTS.sessionInfo.style.display = 'none';
        return;
    }
    
    UI_ELEMENTS.sessionInfo.style.display = 'block';
    
    // Update platform with color coding
    const platform = session.platform ? session.platform.charAt(0).toUpperCase() + session.platform.slice(1) : 'Unknown';
    UI_ELEMENTS.sessionPlatform.textContent = platform;
    
    // Set platform color
    if (session.platform === 'teams') {
        UI_ELEMENTS.sessionPlatform.style.color = '#6264a7';
    } else if (session.platform === 'zoom') {
        UI_ELEMENTS.sessionPlatform.style.color = '#2d8cff';
    } else if (session.platform === 'meet') {
        UI_ELEMENTS.sessionPlatform.style.color = '#00897b';
    }
    
    // Update duration
    const duration = formatDuration(session.duration || 0);
    UI_ELEMENTS.sessionDuration.textContent = duration;
    
    // Update caption count
    UI_ELEMENTS.sessionCaptions.textContent = `${session.captionCount || 0} captions`;

    // Update attendee count
    UI_ELEMENTS.sessionAttendees.textContent = `${session.attendeeCount || 0} attendees`;

    // Add activity indicator
    const lastUpdate = session.lastUpdate ? new Date(session.lastUpdate) : new Date(session.startTime);
    const minutesAgo = Math.floor((Date.now() - lastUpdate.getTime()) / 60000);
    if (minutesAgo > 5) {
        const activityWarning = document.createElement('div');
        activityWarning.style.cssText = 'margin-top: 4px; padding: 4px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 3px; font-size: 11px; color: #856404;';
        activityWarning.textContent = `⚠️ No activity for ${minutesAgo} minutes - session may be inactive`;
        UI_ELEMENTS.sessionInfo.appendChild(activityWarning);
    }
}

function formatDuration(seconds) {
    if (!seconds || seconds === 0) return '0 min';
    
    const minutes = Math.floor(seconds / 60);
    
    if (minutes < 60) {
        return `${minutes} min`;
    } else {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    }
}

// Session selector change handler
if (UI_ELEMENTS.sessionSelector) {
    UI_ELEMENTS.sessionSelector.addEventListener('change', (e) => {
        selectedSessionId = e.target.value;
        if (selectedSessionId) {
            updateSessionInfo(selectedSessionId);
            // Enable View Transcript button for active sessions
            UI_ELEMENTS.viewButton.disabled = false;
            // Enable copy and save buttons if session has data
            const session = activeSessions.find(s => s.sessionId === selectedSessionId);
            if (session && session.captionCount > 0) {
                UI_ELEMENTS.copyButton.disabled = false;
                UI_ELEMENTS.copyDropdownButton.disabled = false;
                UI_ELEMENTS.saveButton.disabled = false;
                UI_ELEMENTS.saveDropdownButton.disabled = false;
            }
            // Update the status based on selected session
            initializePopup();
        } else {
            UI_ELEMENTS.sessionInfo.style.display = 'none';
            // Disable buttons when no session selected
            UI_ELEMENTS.viewButton.disabled = true;
            UI_ELEMENTS.copyButton.disabled = true;
            UI_ELEMENTS.copyDropdownButton.disabled = true;
            UI_ELEMENTS.saveButton.disabled = true;
            UI_ELEMENTS.saveDropdownButton.disabled = true;
        }
    });
}

// Refresh sessions button handler
if (UI_ELEMENTS.refreshSessions) {
    UI_ELEMENTS.refreshSessions.addEventListener('click', async () => {
        await loadActiveSessions();
        await initializePopup();
    });
}

// Export All Sessions button handler
if (UI_ELEMENTS.exportAllSessions) {
    UI_ELEMENTS.exportAllSessions.addEventListener('click', async () => {
        UI_ELEMENTS.statusMessage.textContent = 'Exporting all sessions...';
        
        try {
            // Get all session data
            const allSessionData = [];
            for (const session of activeSessions) {
                const response = await chrome.runtime.sendMessage({ 
                    action: 'getSessionData', 
                    sessionId: session.sessionId 
                });
                
                if (response?.sessionData) {
                    allSessionData.push({
                        ...session,
                        ...response.sessionData
                    });
                }
            }
            
            if (allSessionData.length === 0) {
                UI_ELEMENTS.statusMessage.textContent = 'No sessions to export';
                return;
            }
            
            // Create combined export
            const combinedTranscript = [];
            let combinedContent = `=== MULTI-SESSION EXPORT ===\n`;
            combinedContent += `Total Sessions: ${allSessionData.length}\n`;
            combinedContent += `Export Time: ${new Date().toLocaleString()}\n\n`;
            
            for (const sessionData of allSessionData) {
                const platform = sessionData.platform ? sessionData.platform.charAt(0).toUpperCase() + sessionData.platform.slice(1) : 'Unknown';
                const title = sessionData.meetingTitle || 'Untitled Meeting';
                
                combinedContent += `\n${'='.repeat(50)}\n`;
                combinedContent += `SESSION: ${title}\n`;
                combinedContent += `Platform: ${platform}\n`;
                combinedContent += `Start Time: ${new Date(sessionData.startTime).toLocaleString()}\n`;
                combinedContent += `Duration: ${formatDuration(sessionData.duration)}\n`;
                combinedContent += `Captions: ${sessionData.captionCount || 0}\n`;
                combinedContent += `Attendees: ${sessionData.attendeeCount || 0}\n`;
                combinedContent += `${'='.repeat(50)}\n\n`;
                
                // Add attendee section if available
                if (sessionData.attendeeReport && sessionData.attendeeReport.totalUniqueAttendees > 0) {
                    combinedContent += '--- ATTENDEES ---\n';
                    sessionData.attendeeReport.attendeeList.forEach(name => {
                        combinedContent += `- ${name}\n`;
                    });
                    combinedContent += '\n';
                }
                
                // Add transcript
                if (sessionData.transcript && sessionData.transcript.length > 0) {
                    combinedContent += '--- TRANSCRIPT ---\n';
                    sessionData.transcript.forEach(entry => {
                        const prefix = entry.Type === 'chat' ? '[CHAT] ' : '';
                        combinedContent += `${prefix}[${entry.Time}] ${entry.Name}: ${entry.Text}\n`;
                    });
                }
                
                combinedContent += '\n';
            }
            
            // Download the combined file
            const blob = new Blob([combinedContent], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const filename = `MultiSession_Export_${timestamp}.txt`;

            try {
                await chrome.downloads.download({
                    url: url,
                    filename: filename,
                    saveAs: true
                });

                UI_ELEMENTS.statusMessage.textContent = `Exported ${allSessionData.length} sessions!`;
            } catch (error) {
                console.error('[exportAllSessions] Download failed:', error);
                UI_ELEMENTS.statusMessage.textContent = 'Export failed. Please try again.';
                UI_ELEMENTS.statusMessage.style.color = 'red';
            } finally {
                // Always revoke the blob URL to prevent memory leak
                URL.revokeObjectURL(url);
            }
            UI_ELEMENTS.statusMessage.style.color = '#28a745';
            
        } catch (error) {
            console.error('Failed to export all sessions:', error);
            UI_ELEMENTS.statusMessage.textContent = 'Export failed';
            UI_ELEMENTS.statusMessage.style.color = '#dc3545';
        }
    });
}

async function formatTranscript(transcript, aliases, type = 'standard') {
    const processed = transcript.map(entry => ({
        ...entry,
        Name: aliases[entry.Name] || entry.Name
    }));

    if (type === 'ai') {
        const { aiInstructions: instructions } = await chrome.storage.sync.get('aiInstructions');
        const transcriptText = processed.map(entry => `[${entry.Time}] ${entry.Name}: ${entry.Text}`).join('\n\n');
        return instructions ? `${instructions}\n\n---\n\n${transcriptText}` : transcriptText;
    }

    return processed.map(entry => `[${entry.Time}] ${entry.Name}: ${entry.Text}`).join('\n');
}

// --- UI Update Functions ---
async function updateStatusUI({ capturing, captionCount, isInMeeting, attendeeCount }) {
    const { statusMessage } = UI_ELEMENTS;
    const { trackCaptions, trackAttendees } = await chrome.storage.sync.get(['trackCaptions', 'trackAttendees']);
    
    if (isInMeeting) {
        // In meeting - show appropriate status based on what's being tracked
        if (trackCaptions !== false && capturing) {
            let status = captionCount > 0 ? `Capturing! (${captionCount} lines recorded` : 'Capturing... (Waiting for speech';
            if (attendeeCount > 0) {
                status += `, ${attendeeCount} attendees`;
            }
            status += ')';
            statusMessage.textContent = status;
            statusMessage.style.color = captionCount > 0 ? '#28a745' : '#ffc107';
        } else if (trackCaptions === false && trackAttendees !== false && attendeeCount > 0) {
            // Only tracking attendees
            statusMessage.textContent = `Tracking attendees (${attendeeCount} participants)`;
            statusMessage.style.color = '#17a2b8';
        } else if (trackCaptions === false) {
            statusMessage.textContent = 'In a meeting (caption tracking disabled)';
            statusMessage.style.color = '#6c757d';
        } else {
            statusMessage.textContent = 'In a meeting, but captions are off.';
            statusMessage.style.color = '#dc3545';
        }
    } else {
        // Not in meeting - show saved data status
        let hasData = captionCount > 0 || attendeeCount > 0;
        if (hasData) {
            let status = 'Meeting ended. ';
            let parts = [];
            if (captionCount > 0) parts.push(`${captionCount} lines`);
            if (attendeeCount > 0) parts.push(`${attendeeCount} attendees`);
            status += parts.join(', ') + ' available.';
            statusMessage.textContent = status;
            statusMessage.style.color = '#17a2b8';
        } else {
            statusMessage.textContent = 'Not in a meeting.';
            statusMessage.style.color = '#6c757d';
        }
    }
}

function updateButtonStates(hasData, isInMeeting) {
    // Copy and Save buttons require actual data
    const dataButtons = [
        UI_ELEMENTS.copyButton, UI_ELEMENTS.copyDropdownButton,
        UI_ELEMENTS.saveButton, UI_ELEMENTS.saveDropdownButton
    ];
    dataButtons.forEach(btn => btn.disabled = !hasData);
    
    // View button should be enabled as soon as we're in a meeting
    UI_ELEMENTS.viewButton.disabled = !isInMeeting && !hasData;
}

function updateSaveButtonText(format) {
    UI_ELEMENTS.saveButton.textContent = format === 'ai' ? 'Save for AI' : `Save as ${format.toUpperCase()}`;
}


// --- Template Management ---
async function loadCustomTemplates() {
    const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');
    
    // Clear existing custom templates
    UI_ELEMENTS.customTemplatesGroup.innerHTML = '';
    
    // Add custom templates to dropdown
    Object.entries(customTemplates).forEach(([id, template]) => {
        const option = document.createElement('option');
        option.value = `custom_${id}`;
        option.textContent = template.name;
        UI_ELEMENTS.customTemplatesGroup.appendChild(option);
    });
    
    // Show/hide custom templates optgroup
    UI_ELEMENTS.customTemplatesGroup.style.display = 
        Object.keys(customTemplates).length > 0 ? 'block' : 'none';
}

// Sanitize input to prevent special characters in filenames and names
function sanitizeInput(str) {
    return str.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

// Validate template name - only alphanumeric, spaces, hyphens, underscores
function validateTemplateName(name) {
    const trimmedName = name.trim();

    if (!trimmedName) {
        throw new Error('Template name cannot be empty');
    }

    if (trimmedName.length > 50) {
        throw new Error('Template name must be 50 characters or less');
    }

    const validPattern = /^[a-zA-Z0-9_\-\s]+$/;
    if (!validPattern.test(trimmedName)) {
        throw new Error('Template name can only contain letters, numbers, spaces, hyphens, and underscores');
    }

    return trimmedName;
}

// Validate filename pattern - only safe characters and pattern variables
function validateFilenamePattern(pattern) {
    const trimmedPattern = pattern.trim();

    if (!trimmedPattern) {
        throw new Error('Filename pattern cannot be empty');
    }

    if (trimmedPattern.length > 100) {
        throw new Error('Filename pattern must be 100 characters or less');
    }

    // Allow alphanumeric, spaces, hyphens, underscores, dots, and pattern variables {date}, {time}, {title}, {format}, {attendees}
    const validPattern = /^[a-zA-Z0-9_\-\{\}\s\.]+$/;
    if (!validPattern.test(trimmedPattern)) {
        throw new Error('Filename pattern contains invalid characters. Use only letters, numbers, spaces, dots, hyphens, underscores, and pattern variables like {date}');
    }

    return trimmedPattern;
}

async function saveCustomTemplate(name, instructions) {
    if (!name || !name.trim() || !instructions || !instructions.trim()) {
        alert('Please enter both a template name and instructions.');
        return;
    }

    let sanitizedName;
    try {
        // Validate and sanitize the template name
        const validatedName = validateTemplateName(name);
        sanitizedName = sanitizeInput(validatedName);

        if (!sanitizedName) {
            alert('Template name contains only invalid characters. Please use alphanumeric characters.');
            return;
        }
    } catch (error) {
        alert(error.message);
        return;
    }

    const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');

    // Check if we're updating an existing template (by matching the name)
    let existingId = null;
    for (const [id, template] of Object.entries(customTemplates)) {
        if (template.name === sanitizedName) {
            existingId = id;
            break;
        }
    }

    // Use existing ID if updating, or generate new ID if creating
    const id = existingId || Date.now().toString();

    // Add or update template
    customTemplates[id] = {
        name: sanitizedName,
        instructions: instructions.trim(),
        createdAt: customTemplates[id]?.createdAt || new Date().toISOString(),
        updatedAt: existingId ? new Date().toISOString() : undefined
    };

    // Save to storage with quota error handling
    try {
        await chrome.storage.sync.set({ customTemplates });
    } catch (error) {
        // Check for quota exceeded error
        if (error.message && (error.message.includes('quota') || error.message.includes('QUOTA_BYTES'))) {
            alert('Template too large. Chrome storage quota exceeded. Please:\n\n' +
                  '1. Reduce template size, or\n' +
                  '2. Delete unused templates, or\n' +
                  '3. Use shorter instructions\n\n' +
                  'Max storage per item: 8KB');
            console.error('[Template Save] Storage quota exceeded:', error);
            return;
        }
        // Re-throw other errors
        throw error;
    }

    // Reload templates
    await loadCustomTemplates();

    // Clear template name input
    UI_ELEMENTS.templateName.value = '';

    // Reset save button to default state
    UI_ELEMENTS.saveTemplateBtn.textContent = 'Save Template';
    UI_ELEMENTS.saveTemplateBtn.style.background = '#28a745';

    // Select the newly created/updated template
    UI_ELEMENTS.meetingType.value = `custom_${id}`;

    alert(existingId ? 'Template updated successfully!' : 'Template saved successfully!');
}

async function editCustomTemplate(templateId) {
    const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');

    // Remove the custom_ prefix to get the actual ID
    const id = templateId.replace('custom_', '');

    if (!customTemplates[id]) {
        alert('Template not found');
        return;
    }

    // Load template data into the form
    UI_ELEMENTS.templateName.value = customTemplates[id].name || id;
    UI_ELEMENTS.aiInstructions.value = customTemplates[id].instructions || '';

    // Focus on the instructions field for editing
    UI_ELEMENTS.aiInstructions.focus();

    // Update save button text to indicate editing mode
    UI_ELEMENTS.saveTemplateBtn.textContent = 'Update Template';
    UI_ELEMENTS.saveTemplateBtn.style.background = '#0078d4';
}

async function deleteCustomTemplate(templateId) {
    if (!confirm('Are you sure you want to delete this custom template?')) {
        return;
    }

    const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');

    // Remove the custom_ prefix to get the actual ID
    const id = templateId.replace('custom_', '');

    delete customTemplates[id];

    // Save to storage
    await chrome.storage.sync.set({ customTemplates });

    // Reload templates
    await loadCustomTemplates();

    // Reset selection and form
    UI_ELEMENTS.meetingType.value = '';
    UI_ELEMENTS.editTemplateBtn.style.display = 'none';
    UI_ELEMENTS.deleteTemplateBtn.style.display = 'none';
    UI_ELEMENTS.templateName.value = '';
    UI_ELEMENTS.saveTemplateBtn.textContent = 'Save Template';
    UI_ELEMENTS.saveTemplateBtn.style.background = '#28a745';

    alert('Template deleted successfully!');
}

// --- Settings Management ---
async function loadSettings() {
    const settings = await chrome.storage.sync.get([
        'autoEnableCaptions',
        'autoSaveOnEnd',
        'aiInstructions',
        'defaultSaveFormat',
        'trackCaptions',
        'trackAttendees',
        'autoOpenAttendees',
        'timestampFormat',
        'filenamePattern'
    ]);

    UI_ELEMENTS.autoEnableCaptionsToggle.checked = !!settings.autoEnableCaptions;
    UI_ELEMENTS.autoSaveOnEndToggle.checked = !!settings.autoSaveOnEnd;
    UI_ELEMENTS.trackCaptionsToggle.checked = settings.trackCaptions !== false; // Default to true
    UI_ELEMENTS.trackAttendeesToggle.checked = settings.trackAttendees !== false; // Default to true
    UI_ELEMENTS.chatCaptureToggle.checked = settings.chatCapture !== false; // Default to true
    if (UI_ELEMENTS.autoOpenAttendeesToggle) {
        UI_ELEMENTS.autoOpenAttendeesToggle.checked = !!settings.autoOpenAttendees;
        UI_ELEMENTS.autoOpenAttendeesToggle.disabled = !UI_ELEMENTS.trackAttendeesToggle.checked;
    }
    UI_ELEMENTS.timestampFormat.value = settings.timestampFormat || '12hr';
    UI_ELEMENTS.filenamePattern.value = settings.filenamePattern || '{date}_{title}_{format}';
    UI_ELEMENTS.aiInstructions.value = settings.aiInstructions || '';
    UI_ELEMENTS.manualStartInfo.style.display = settings.autoEnableCaptions ? 'none' : 'block';

    currentDefaultFormat = settings.defaultSaveFormat || 'txt';
    UI_ELEMENTS.defaultSaveFormatSelect.value = currentDefaultFormat;
    updateSaveButtonText(currentDefaultFormat);
}

// --- Event Handling ---
function setupEventListeners() {
    // Settings Listeners
    UI_ELEMENTS.defaultSaveFormatSelect.addEventListener('change', (e) => {
        currentDefaultFormat = e.target.value;
        chrome.storage.sync.set({ defaultSaveFormat: currentDefaultFormat });
        updateSaveButtonText(currentDefaultFormat);
    });

    UI_ELEMENTS.trackCaptionsToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ trackCaptions: e.target.checked });
        // Disable auto-enable captions if caption tracking is disabled
        if (!e.target.checked) {
            UI_ELEMENTS.autoEnableCaptionsToggle.checked = false;
            UI_ELEMENTS.autoEnableCaptionsToggle.disabled = true;
            chrome.storage.sync.set({ autoEnableCaptions: false });
        } else {
            UI_ELEMENTS.autoEnableCaptionsToggle.disabled = false;
        }
    });
    
    UI_ELEMENTS.autoEnableCaptionsToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ autoEnableCaptions: e.target.checked });
        UI_ELEMENTS.manualStartInfo.style.display = e.target.checked ? 'none' : 'block';
    });

    UI_ELEMENTS.autoSaveOnEndToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ autoSaveOnEnd: e.target.checked });
    });

    UI_ELEMENTS.trackAttendeesToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ trackAttendees: e.target.checked });
        // Disable auto-open if tracking is disabled
        if (UI_ELEMENTS.autoOpenAttendeesToggle) {
            if (!e.target.checked) {
                UI_ELEMENTS.autoOpenAttendeesToggle.checked = false;
                UI_ELEMENTS.autoOpenAttendeesToggle.disabled = true;
                chrome.storage.sync.set({ autoOpenAttendees: false });
            } else {
                UI_ELEMENTS.autoOpenAttendeesToggle.disabled = false;
            }
        }
    });

    UI_ELEMENTS.chatCaptureToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ chatCapture: e.target.checked });
        // Send message to content script to enable/disable chat capture
        getActiveMeetingTab().then(tab => {
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { 
                    message: "toggle_chat_capture", 
                    enabled: e.target.checked 
                });
            }
        });
    });
    
    if (UI_ELEMENTS.autoOpenAttendeesToggle) {
        UI_ELEMENTS.autoOpenAttendeesToggle.addEventListener('change', (e) => {
            chrome.storage.sync.set({ autoOpenAttendees: e.target.checked });
        });
    }
    
    // Initialize auto-enable captions toggle state based on track captions
    if (UI_ELEMENTS.trackCaptionsToggle) {
        UI_ELEMENTS.autoEnableCaptionsToggle.disabled = !UI_ELEMENTS.trackCaptionsToggle.checked;
    }

    UI_ELEMENTS.timestampFormat.addEventListener('change', (e) => {
        chrome.storage.sync.set({ timestampFormat: e.target.value });
    });

    UI_ELEMENTS.filenamePattern.addEventListener('input', (e) => {
        try {
            const validatedPattern = validateFilenamePattern(e.target.value);
            chrome.storage.sync.set({ filenamePattern: validatedPattern });
            // Clear any previous error styling
            e.target.style.borderColor = '';
        } catch (error) {
            // Show error styling
            e.target.style.borderColor = 'red';
            console.error('[Filename Pattern] Validation error:', error.message);
            // Still save the value but log the error for user awareness
            chrome.storage.sync.set({ filenamePattern: e.target.value });
        }
    });

    UI_ELEMENTS.meetingType.addEventListener('change', async (e) => {
        const value = e.target.value;

        // Show/hide edit and delete buttons for custom templates
        const isCustomTemplate = value.startsWith('custom_');
        UI_ELEMENTS.editTemplateBtn.style.display = isCustomTemplate ? 'inline-block' : 'none';
        UI_ELEMENTS.deleteTemplateBtn.style.display = isCustomTemplate ? 'inline-block' : 'none';

        // Reset save button to default state when changing templates
        UI_ELEMENTS.saveTemplateBtn.textContent = 'Save Template';
        UI_ELEMENTS.saveTemplateBtn.style.background = '#28a745';

        if (value) {
            if (isCustomTemplate) {
                // Load custom template
                const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');
                const id = value.replace('custom_', '');
                if (customTemplates[id]) {
                    UI_ELEMENTS.aiInstructions.value = customTemplates[id].instructions;
                    UI_ELEMENTS.aiInstructions.dispatchEvent(new Event('change'));
                }
            } else if (MEETING_TYPE_PROMPTS[value]) {
                // Load built-in template
                UI_ELEMENTS.aiInstructions.value = MEETING_TYPE_PROMPTS[value];
                UI_ELEMENTS.aiInstructions.dispatchEvent(new Event('change'));
            }
        }
    });
    
    UI_ELEMENTS.saveTemplateBtn.addEventListener('click', () => {
        const name = UI_ELEMENTS.templateName.value;
        const instructions = UI_ELEMENTS.aiInstructions.value;
        saveCustomTemplate(name, instructions);
    });
    
    UI_ELEMENTS.templateName.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const name = UI_ELEMENTS.templateName.value;
            const instructions = UI_ELEMENTS.aiInstructions.value;
            saveCustomTemplate(name, instructions);
        }
    });
    
    UI_ELEMENTS.editTemplateBtn.addEventListener('click', () => {
        const selectedValue = UI_ELEMENTS.meetingType.value;
        if (selectedValue.startsWith('custom_')) {
            editCustomTemplate(selectedValue);
        }
    });

    UI_ELEMENTS.deleteTemplateBtn.addEventListener('click', () => {
        const selectedValue = UI_ELEMENTS.meetingType.value;
        if (selectedValue.startsWith('custom_')) {
            deleteCustomTemplate(selectedValue);
        }
    });

    UI_ELEMENTS.aiInstructions.addEventListener('change', async (e) => {
        try {
            await chrome.storage.sync.set({ aiInstructions: e.target.value });
        } catch (error) {
            if (error.message && (error.message.includes('quota') || error.message.includes('QUOTA_BYTES'))) {
                alert('AI instructions too large. Please reduce the length of your instructions.\n\nMax storage per item: 8KB');
                console.error('[AI Instructions] Storage quota exceeded:', error);
            } else {
                console.error('[AI Instructions] Save error:', error);
            }
        }
    });


    // Action Button Listeners
    UI_ELEMENTS.saveButton.addEventListener('click', async () => {
        const tab = await getActiveMeetingTab();
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { message: "return_transcript", format: currentDefaultFormat });
        }
    });

    UI_ELEMENTS.viewButton.addEventListener('click', async () => {
        // Check if we have a selected session (multi-meeting mode)
        if (selectedSessionId) {
            // Open viewer for the selected session
            const session = activeSessions.find(s => s.sessionId === selectedSessionId);
            if (session) {
                // Send message to the session's tab to open viewer
                chrome.tabs.sendMessage(session.tabId, { message: "get_captions_for_viewing" });
            }
        } else {
            // Fallback to current tab
            const tab = await getActiveMeetingTab();
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { message: "get_captions_for_viewing" });
            }
        }
    });

    setupDropdown(UI_ELEMENTS.copyButton, UI_ELEMENTS.copyDropdownButton, UI_ELEMENTS.copyOptions, handleCopy);
    setupDropdown(null, UI_ELEMENTS.saveDropdownButton, UI_ELEMENTS.saveOptions, handleSave);

    // AI Prompt Buttons - Now act as smart template selectors
    UI_ELEMENTS.promptButtons.forEach(button => {
        button.addEventListener('click', function() {
            const buttonText = this.textContent;
            let templateToSelect = '';
            
            // Map buttons to the most appropriate templates
            switch(buttonText) {
                case 'Summarize':
                    templateToSelect = 'executive'; // Executive Summary template
                    break;
                case 'List Action Items':
                    templateToSelect = 'retrospective'; // Has comprehensive action items
                    break;
                case 'Find Decisions':
                    templateToSelect = 'review'; // Design Review has decision tracking
                    break;
            }
            
            // Select the template in dropdown
            if (templateToSelect) {
                UI_ELEMENTS.meetingType.value = templateToSelect;
                // Trigger change event to load the template
                UI_ELEMENTS.meetingType.dispatchEvent(new Event('change'));
                
                // Provide visual feedback
                this.style.backgroundColor = '#28a745';
                this.style.color = 'white';
                setTimeout(() => {
                    this.style.backgroundColor = '';
                    this.style.color = '';
                }, 500);
            }
        });
    });

    document.addEventListener('click', () => {
        UI_ELEMENTS.copyOptions.style.display = 'none';
        UI_ELEMENTS.saveOptions.style.display = 'none';
    });
}

function setupDropdown(mainButton, dropdownButton, optionsContainer, actionHandler) {
    if (mainButton) {
        mainButton.addEventListener('click', () => optionsContainer.firstElementChild.click());
    }
    dropdownButton.addEventListener('click', (e) => {
        e.stopPropagation();
        optionsContainer.style.display = 'block';
    });
    optionsContainer.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        actionHandler(e.target);
        optionsContainer.style.display = 'none';
    });
}

async function handleCopy(target) {
    const copyType = target?.dataset?.copyType;
    if (!copyType) return;

    if (!UI_ELEMENTS.statusMessage) {
        console.error('[handleCopy] Status message element not found');
        return;
    }

    UI_ELEMENTS.statusMessage.textContent = "Preparing text to copy...";
    try {
        let transcriptArray = null;

        // Check if we have a selected session (multi-meeting mode)
        if (selectedSessionId) {
            const response = await chrome.runtime.sendMessage({
                action: 'getSessionData',
                sessionId: selectedSessionId
            });
            if (response?.sessionData?.transcript) {
                transcriptArray = response.sessionData.transcript;
            }
        } else {
            // Fallback to current tab
            const tab = await getActiveMeetingTab();
            if (!tab) {
                UI_ELEMENTS.statusMessage.textContent = "No active meeting found.";
                UI_ELEMENTS.statusMessage.style.color = '#dc3545';
                return;
            }
            const response = await chrome.tabs.sendMessage(tab.id, { message: "get_transcript_for_copying" });
            transcriptArray = response?.transcriptArray;
        }

        if (transcriptArray && transcriptArray.length > 0) {
            const formattedText = await formatTranscript(transcriptArray, {}, copyType);
            await navigator.clipboard.writeText(formattedText);
            UI_ELEMENTS.statusMessage.textContent = "Copied to clipboard!";
            UI_ELEMENTS.statusMessage.style.color = '#28a745';
        } else {
            UI_ELEMENTS.statusMessage.textContent = "No transcript data to copy.";
            UI_ELEMENTS.statusMessage.style.color = '#ffc107';
        }
    } catch (error) {
        console.error('[handleCopy] Copy operation failed:', error);
        UI_ELEMENTS.statusMessage.textContent = `Copy failed: ${error.message}`;
        UI_ELEMENTS.statusMessage.style.color = '#dc3545';
    }
}

async function handleSave(target) {
    const format = target.dataset.format;
    if (!format) return;

    UI_ELEMENTS.statusMessage.textContent = `Saving as ${format === 'ai' ? 'AI' : format.toUpperCase()}...`;

    try {
        // Check if we have a selected session (multi-meeting mode)
        if (selectedSessionId) {
            // Get session data and send to service worker for download
            const response = await chrome.runtime.sendMessage({
                action: 'getSessionData',
                sessionId: selectedSessionId
            });

            if (response?.sessionData) {
                const { transcript, attendeeReport, metadata } = response.sessionData;
                const meetingTitle = metadata?.meetingTitle || 'Meeting';
                const recordingStartTime = metadata?.startTime || new Date().toISOString();

                // Send to service worker to handle download
                const saveResponse = await chrome.runtime.sendMessage({
                    message: "save_from_session",
                    transcriptArray: transcript,
                    meetingTitle: meetingTitle,
                    format: format,
                    recordingStartTime: recordingStartTime,
                    attendeeReport: attendeeReport
                });

                if (saveResponse?.success) {
                    UI_ELEMENTS.statusMessage.textContent = 'Transcript saved!';
                    UI_ELEMENTS.statusMessage.style.color = '#28a745';
                } else {
                    throw new Error(saveResponse?.error || 'Save failed');
                }
            } else {
                throw new Error('No session data available');
            }
        } else {
            // Fallback to current tab
            const tab = await getActiveMeetingTab();
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, { message: "return_transcript", format });
                UI_ELEMENTS.statusMessage.textContent = 'Save initiated...';
                UI_ELEMENTS.statusMessage.style.color = '#17a2b8';
            } else {
                throw new Error('No active meeting tab found');
            }
        }
    } catch (error) {
        console.error('[handleSave] Save operation failed:', error);
        UI_ELEMENTS.statusMessage.textContent = `Save failed: ${error.message}`;
        UI_ELEMENTS.statusMessage.style.color = '#dc3545';
    }
}

// --- Session History Management ---
async function initializeSessionHistory() {
    try {
        // Load SessionManager script
        const script = document.createElement('script');
        script.src = 'sessionManager.js';
        document.head.appendChild(script);

        // Wait for script to load with error handling
        await new Promise((resolve, reject) => {
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load sessionManager.js'));
            setTimeout(resolve, 100); // Fallback timeout
        });
        
        // Always show session history button
        UI_ELEMENTS.sessionHistory.style.display = 'flex';
        
        // Setup history button click handler
        UI_ELEMENTS.historyButton.addEventListener('click', async () => {
            const isVisible = UI_ELEMENTS.sessionList.style.display !== 'none';
            UI_ELEMENTS.sessionList.style.display = isVisible ? 'none' : 'block';

            if (!isVisible) {
                await loadSessionList();
            }
        });

        // Setup cleanup button handler
        if (UI_ELEMENTS.cleanupSessions) {
            UI_ELEMENTS.cleanupSessions.addEventListener('click', async () => {
                const confirmCleanup = confirm('This will end all stale sessions and clean up stuck meeting data. Continue?');
                if (!confirmCleanup) return;

                try {
                    // End all active sessions that don't have valid tabs
                    const response = await chrome.runtime.sendMessage({ action: 'getActiveSessions' });
                    if (response && response.sessions) {
                        let cleanedCount = 0;

                        for (const session of response.sessions) {
                            // Check if the tab still exists
                            let tabExists = false;
                            try {
                                const tab = await chrome.tabs.get(session.tabId);
                                const meetingDomains = ['teams.microsoft.com', 'teams.live.com', 'meet.google.com', 'zoom.us', 'app.zoom.us'];
                                tabExists = tab && tab.url && meetingDomains.some(domain => tab.url.includes(domain));
                            } catch (e) {
                                tabExists = false;
                            }

                            // End session if tab doesn't exist or is very old
                            if (!tabExists) {
                                await chrome.runtime.sendMessage({
                                    action: 'endSession',
                                    sessionId: session.sessionId
                                });
                                cleanedCount++;
                            }
                        }

                        // Clear any Zoom-specific storage
                        await chrome.storage.local.remove(['zoomMeetingEnded', 'transcriptBackup']);

                        // Reload sessions and update UI
                        await loadActiveSessions();
                        await initializePopup();

                        if (cleanedCount > 0) {
                            UI_ELEMENTS.statusMessage.textContent = `Cleaned up ${cleanedCount} stale session(s)`;
                            UI_ELEMENTS.statusMessage.style.color = '#28a745';
                        } else {
                            UI_ELEMENTS.statusMessage.textContent = 'No stale sessions found';
                            UI_ELEMENTS.statusMessage.style.color = '#17a2b8';
                        }
                    }
                } catch (error) {
                    console.error('Failed to cleanup sessions:', error);
                    UI_ELEMENTS.statusMessage.textContent = 'Failed to cleanup sessions';
                    UI_ELEMENTS.statusMessage.style.color = '#dc3545';
                }
            });
        }
        
        // Check if we have saved sessions and update button text
        const sessionManager = new SessionManager();
        const sessions = await sessionManager.getAllSessions();

        if (sessions && sessions.length > 0) {
            UI_ELEMENTS.historyButton.innerHTML = `📁 View Previous Sessions (${sessions.length})`;
        } else {
            UI_ELEMENTS.historyButton.innerHTML = '📁 No Previous Sessions';
        }
    } catch (error) {
        console.log('[Session History] Initialization skipped:', error.message);
    }
}

async function loadSessionList() {
    try {
        const sessionManager = new SessionManager();
        const sessions = await sessionManager.getAllSessions();
        const stats = await sessionManager.getStorageStats();
        
        if (!sessions || sessions.length === 0) {
            UI_ELEMENTS.sessionList.innerHTML = '<div style="text-align: center; color: #999;">No saved sessions</div>';
            return;
        }
        
        let html = '';
        for (const session of sessions) {
            // Handle both old and new session formats
            const sessionId = session.sessionId || session.id;
            const title = session.meetingTitle || session.title || 'Untitled Meeting';
            const startTime = session.startTime || session.timestamp;
            const timeAgo = getTimeAgo(new Date(startTime));
            const date = new Date(startTime).toLocaleDateString();
            const duration = session.duration ? formatDuration(session.duration) : (session.duration || '0 min');
            const captionCount = session.captionCount || 0;
            const speakerCount = session.speakerCount || (session.speakers ? session.speakers.length : 0);
            const platform = session.platform || 'unknown';
            
            // Platform color and display name
            let platformColor = '#6c757d';
            let platformDisplay = 'UNKNOWN';
            if (platform === 'teams' || platform === 'microsoft teams') {
                platformColor = '#6264a7';
                platformDisplay = 'TEAMS';
            } else if (platform === 'zoom') {
                platformColor = '#2d8cff';
                platformDisplay = 'ZOOM';
            } else if (platform === 'meet' || platform === 'google meet') {
                platformColor = '#00897b';
                platformDisplay = 'MEET';
            }
            
            html += `
                <div class="session-item" data-id="${sessionId}">
                    <div class="session-title">
                        <span style="color: ${platformColor}; font-weight: bold;">[${platformDisplay}]</span>
                        ${escapeHtml(title)}
                    </div>
                    <div class="session-meta">
                        <span>${date} • ${duration} • ${captionCount} captions • ${speakerCount} speakers</span>
                    </div>
                    <div class="session-meta" style="margin-top: 4px;">
                        <span style="font-size: 11px; color: #888;">${timeAgo}</span>
                    </div>
                    <div class="session-actions">
                        <button class="session-btn view-btn" data-id="${sessionId}">View</button>
                        <button class="session-btn export-btn" data-id="${sessionId}">Export</button>
                        <button class="session-btn delete" data-id="${sessionId}">Delete</button>
                    </div>
                </div>
            `;
        }
        
        // Add storage info
        html += `
            <div class="storage-info">
                Storage: ${stats.usedMB}MB / ${stats.quotaMB}MB (${stats.percentUsed}%)
                <button id="clearAllSessions" style="margin-left: 10px; font-size: 11px; color: #dc3545; background: none; border: none; cursor: pointer; text-decoration: underline;">Clear All</button>
            </div>
        `;
        
        UI_ELEMENTS.sessionList.innerHTML = html;
        
        // Add event listeners for session actions
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', (e) => viewSession(e.target.dataset.id));
        });
        
        document.querySelectorAll('.export-btn').forEach(btn => {
            btn.addEventListener('click', (e) => exportSession(e.target.dataset.id));
        });
        
        document.querySelectorAll('.session-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => deleteSession(e.target.dataset.id));
        });
        
        document.getElementById('clearAllSessions')?.addEventListener('click', clearAllSessions);
        
    } catch (error) {
        console.error('[Session History] Failed to load sessions:', error);
        UI_ELEMENTS.sessionList.innerHTML = '<div style="text-align: center; color: #dc3545;">Error loading sessions</div>';
    }
}

async function viewSession(sessionId) {
    try {
        const sessionManager = new SessionManager();
        const sessionData = await sessionManager.loadSessionData(sessionId);

        if (!sessionData || !sessionData.transcript) {
            throw new Error('Session data is empty or corrupted');
        }

        // Store in chrome.storage.local for viewer to access - using the correct key
        await chrome.storage.local.set({
            captionsToView: sessionData.transcript,
            viewerData: {
                transcriptArray: sessionData.transcript,
                meetingTitle: sessionData.metadata?.meetingTitle || sessionData.metadata?.title || 'Untitled Meeting',
                platform: sessionData.metadata?.platform || '',
                attendeeReport: sessionData.attendeeReport,
                isHistorical: true
            }
        });

        // Open viewer
        window.open(chrome.runtime.getURL('viewer.html'), '_blank');

    } catch (error) {
        console.error('[Session History] Failed to view session:', error);
        alert(`Failed to load session: ${error.message}`);
    }
}

async function exportSession(sessionId) {
    try {
        const sessionManager = new SessionManager();
        const sessionData = await sessionManager.loadSessionData(sessionId);

        if (!sessionData || !sessionData.transcript || sessionData.transcript.length === 0) {
            throw new Error('No transcript data available to export');
        }

        // Use existing export logic - correct message type
        const format = currentDefaultFormat;
        const exportResponse = await chrome.runtime.sendMessage({
            message: "download_captions",
            transcriptArray: sessionData.transcript,
            format: format,
            meetingTitle: sessionData.metadata?.meetingTitle || sessionData.metadata?.title || 'Meeting',
            attendeeReport: sessionData.attendeeReport,
            recordingStartTime: sessionData.metadata?.startTime || sessionData.metadata?.timestamp || new Date().toISOString()
        });

        if (exportResponse && !exportResponse.success) {
            throw new Error(exportResponse.error || 'Export failed');
        }

        // Visual feedback
        const btn = document.querySelector(`.export-btn[data-id="${sessionId}"]`);
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = '✓ Exported';
            btn.style.background = '#28a745';
            btn.style.color = 'white';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = '';
                btn.style.color = '';
            }, 2000);
        }

    } catch (error) {
        console.error('[Session History] Failed to export session:', error);
        alert(`Failed to export session: ${error.message}`);
    }
}

async function deleteSession(sessionId) {
    if (!confirm('Delete this session? This cannot be undone.')) return;

    try {
        const sessionManager = new SessionManager();
        const result = await sessionManager.deleteSession(sessionId);

        if (!result || !result.success) {
            throw new Error(result?.error || 'Delete operation failed');
        }

        await loadSessionList(); // Refresh the list
    } catch (error) {
        console.error('[Session History] Failed to delete session:', error);
        alert(`Failed to delete session: ${error.message}`);
    }
}

async function clearAllSessions() {
    const sessionManager = new SessionManager();
    const stats = await sessionManager.getStorageStats();

    // Check if storage is over quota
    if (parseFloat(stats.percentUsed) > 90) {
        // Storage is critical, offer emergency cleanup
        const message = `Storage is at ${stats.percentUsed}% (${stats.usedMB}MB / ${stats.quotaMB}MB).\n\n` +
                       `Would you like to:\n` +
                       `• OK = Run emergency cleanup (deletes oldest 50% of sessions)\n` +
                       `• Cancel = Delete ALL sessions`;

        if (confirm(message)) {
            // Run emergency cleanup
            try {
                console.log('[Popup] Running emergency cleanup...');
                await sessionManager.emergencyCleanup();
                alert('Emergency cleanup complete. Storage has been optimized.');
                await loadSessionList(); // Reload the list
            } catch (error) {
                console.error('[Session History] Emergency cleanup failed:', error);
                alert('Emergency cleanup failed. You may need to delete all sessions.');
            }
        } else if (confirm('Delete ALL saved sessions? This cannot be undone.')) {
            // Delete everything
            try {
                await sessionManager.clearAllSessions();
                UI_ELEMENTS.sessionList.style.display = 'none';
                UI_ELEMENTS.sessionHistory.style.display = 'none';
                alert('All sessions have been deleted.');
            } catch (error) {
                console.error('[Session History] Failed to clear sessions:', error);
            }
        }
    } else {
        // Normal clear all
        if (!confirm('Delete ALL saved sessions? This cannot be undone.')) return;

        try {
            await sessionManager.clearAllSessions();
            UI_ELEMENTS.sessionList.style.display = 'none';
            UI_ELEMENTS.sessionHistory.style.display = 'none';
        } catch (error) {
            console.error('[Session History] Failed to clear sessions:', error);
        }
    }
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) {
            return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
        }
    }
    return 'just now';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Initialization ---
async function initializePopup() {
    await loadSettings();
    await loadCustomTemplates();
    setupEventListeners();
    await initializeSessionHistory(); // Initialize session history
    
    // Load active sessions for multi-meeting support
    await loadActiveSessions();

    const tab = await getActiveMeetingTab();
    if (!tab) {
        // Check if we have any active sessions from other tabs
        if (activeSessions.length > 0) {
            // Show the session manager UI
            UI_ELEMENTS.sessionManager.style.display = 'block';
            updateSessionSelector();

            // Show simple status message without session details
            UI_ELEMENTS.statusMessage.textContent = `${activeSessions.length} active session(s) found. Select one above to manage or view.`;
            UI_ELEMENTS.statusMessage.style.color = '#17a2b8';

            // If we have a selected session, enable the view button
            if (selectedSessionId) {
                UI_ELEMENTS.viewButton.disabled = false;
                // Enable other buttons if session has data
                const session = activeSessions.find(s => s.sessionId === selectedSessionId);
                if (session && session.captionCount > 0) {
                    UI_ELEMENTS.copyButton.disabled = false;
                    UI_ELEMENTS.copyDropdownButton.disabled = false;
                    UI_ELEMENTS.saveButton.disabled = false;
                    UI_ELEMENTS.saveDropdownButton.disabled = false;
                }
            }
        } else {
            UI_ELEMENTS.statusMessage.innerHTML = 'Please open a <a href="https://teams.microsoft.com" target="_blank">Teams</a>, <a href="https://teams.live.com" target="_blank">Teams Personal</a>, <a href="https://meet.google.com" target="_blank">Google Meet</a>, or <a href="https://web.zoom.us" target="_blank">Zoom</a> tab to use this extension.';
            UI_ELEMENTS.statusMessage.style.color = '#dc3545';
        }
        return;
    }

    try {
        // For Zoom, we might get multiple responses (main frame + iframe)
        // Use the one that shows "in meeting" or has captions
        console.log('[Popup] Requesting status from tab:', tab.url);
        let status;
        try {
            status = await chrome.tabs.sendMessage(tab.id, { message: "get_status" });
            console.log('[Popup] Received initial status:', status);
        } catch (e) {
            console.log('[Popup] No initial response from tab');
            status = null;
        }

        // For Zoom, handle multiple frame responses
        if (tab.url?.includes('zoom.us')) {
            // Skip non-meeting frames in the first response
            if (status && status.frameType === 'non-meeting-iframe') {
                status = null; // Reset to try again
            }

            // Wait for potential iframe responses
            await new Promise(resolve => setTimeout(resolve, 500));

            // Try to get a second response (from iframe)
            try {
                const secondStatus = await chrome.tabs.sendMessage(tab.id, { message: "get_status" });
                console.log('[Popup] Received second status:', secondStatus);

                // If we got a second response, use the better one
                if (secondStatus) {
                    // Skip non-meeting frames
                    if (secondStatus.frameType === 'non-meeting-iframe') {
                        // Keep original status if it's better
                        if (!status) {
                            status = secondStatus; // Use this if we have nothing else
                        }
                    } else {
                        // Use the status that shows in meeting or has more data
                        if (!status ||
                            (secondStatus.isInMeeting && !status.isInMeeting) ||
                            (secondStatus.capturing && !status.capturing) ||
                            (secondStatus.captionCount > (status.captionCount || 0))) {
                            status = secondStatus;
                        }
                    }
                }
            } catch (e) {
                // No second response - this is expected if main frame doesn't respond
                // console.log('[Popup] No second response (expected for Zoom main frame)');
            }

            // Check if we have an active session for this tab that might indicate we're in a meeting
            const activeSession = activeSessions.find(s => s.tabId === tab.id);
            if (activeSession && activeSession.status === 'active') {
                console.log('[Popup] Found active session for Zoom tab:', activeSession);
                // If we have an active session but status shows not in meeting,
                // it might be iframe detection issue - trust the session
                if (!status || !status.isInMeeting) {
                    status = {
                        capturing: activeSession.captionCount > 0,
                        captionCount: activeSession.captionCount || 0,
                        isInMeeting: true, // Trust that we're in a meeting if session is active
                        attendeeCount: activeSession.attendeeCount || 0
                    };
                }
            } else if (!status) {
                // No status and no active session
                status = {
                    capturing: false,
                    captionCount: 0,
                    isInMeeting: false,
                    attendeeCount: 0
                };
            }
        }

        console.log('[Popup] Final status to use:', status);

        if (status) {
            console.log('[Popup] Updating UI with status:', {
                isInMeeting: status.isInMeeting,
                capturing: status.capturing,
                captionCount: status.captionCount,
                attendeeCount: status.attendeeCount
            });
            await updateStatusUI(status);
            // Enable buttons if we have either captions or attendees
            const hasData = status.captionCount > 0 || (status.attendeeCount > 0 && status.isInMeeting === false);
            updateButtonStates(hasData, status.isInMeeting);

            // For Zoom, if we're in a meeting but session might not have data yet,
            // ensure View button is enabled based on active sessions
            if (tab.url?.includes('zoom.us') && status.isInMeeting && activeSessions.length > 0) {
                // Find the session for this tab
                const currentSession = activeSessions.find(s => s.tabId === tab.id);
                if (currentSession) {
                    // Update button states to ensure View is enabled for active session
                    UI_ELEMENTS.viewButton.disabled = false;
                }
            }
        }
    } catch (error) {
        // This error is expected when content script isn't loaded yet
        if (error.message.includes("Could not establish connection")) {
            console.log("Content script not ready. This is normal if the Teams page was just opened.");
            UI_ELEMENTS.statusMessage.innerHTML = 'Please refresh your meeting tab (F5) to activate the extension.';
            UI_ELEMENTS.statusMessage.style.color = '#ffc107';
            
            // Try to inject the content script if it's not loaded
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content_script.js']
                });
                console.log("Content script injected successfully. Retrying connection...");
                // Retry after injection
                setTimeout(() => initializePopup(), 500);
            } catch (injectError) {
                console.log("Could not inject content script:", injectError.message);
                UI_ELEMENTS.statusMessage.textContent = "Please refresh your meeting tab to activate the extension.";
                UI_ELEMENTS.statusMessage.style.color = '#dc3545';
            }
        } else {
            console.error("Unexpected error:", error.message);
            UI_ELEMENTS.statusMessage.textContent = "Connection error. Please refresh your meeting tab and try again.";
            UI_ELEMENTS.statusMessage.style.color = '#dc3545';
        }
    }
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + S for save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!UI_ELEMENTS.saveButton.disabled) {
            UI_ELEMENTS.saveButton.click();
        }
    }
    
    // Ctrl/Cmd + C for copy
    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        if (!UI_ELEMENTS.copyButton.disabled) {
            UI_ELEMENTS.copyButton.click();
        }
    }
    
    // Ctrl/Cmd + V for view
    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        if (!UI_ELEMENTS.viewButton.disabled) {
            UI_ELEMENTS.viewButton.click();
        }
    }
});

// Listen for download failure notifications from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.message === 'download_failed') {
        // Show error notification to user
        const errorText = message.error || 'Unknown error';
        alert(`Download failed: ${errorText}\n\nPlease try again or check your connection.`);
        console.error('[Popup] Download failed:', message.downloadId, errorText);
    }
    return false; // No async response
});

document.addEventListener('DOMContentLoaded', () => {
    initializePopup();

    // Periodically refresh sessions to detect stale ones
    setInterval(async () => {
        await loadActiveSessions();
    }, 30000); // Check every 30 seconds
});