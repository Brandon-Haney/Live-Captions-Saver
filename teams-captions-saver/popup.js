// --- Tab Switching Logic ---
const tabs = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-panel');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active class from all tabs and panels
        tabs.forEach(t => t.classList.remove('active'));
        tabPanels.forEach(p => p.classList.remove('active'));

        // Add active class to clicked tab and corresponding panel
        tab.classList.add('active');
        const targetPanel = document.getElementById(tab.dataset.tab);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }
    });
});

// --- Constants for DOM Elements and Data ---
const UI_ELEMENTS = {
    statusMessage: document.getElementById('status-message'),
    meetingTitle: document.getElementById('meeting-title'),
    platformBadge: document.getElementById('platform-badge'),
    sessionIndicator: document.getElementById('session-indicator'),
    switchSessionBtn: document.getElementById('switch-session-btn'),
    statusDot: document.getElementById('status-dot'),
    captionsStat: document.getElementById('caption-count'),
    attendeesStat: document.getElementById('attendee-count'),
    currentSessionTitle: document.getElementById('current-session-title'),
    currentSessionSubtitle: document.getElementById('current-session-subtitle'),
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
    backgroundCaptureToggle: document.getElementById('backgroundCaptureToggle'),
    captureSharedContentToggle: document.getElementById('captureSharedContentToggle'),
    timestampFormat: document.getElementById('timestampFormat'),
    filenamePattern: document.getElementById('filenamePattern'),
    meetingType: document.getElementById('meetingType'),
    templateName: document.getElementById('templateName'),
    saveTemplateBtn: document.getElementById('saveTemplateBtn'),
    editTemplateBtn: document.getElementById('editTemplateBtn'),
    deleteTemplateBtn: document.getElementById('deleteTemplateBtn'),
    customTemplatesGroup: document.getElementById('customTemplatesGroup'),
    aiInstructions: document.getElementById('aiInstructions'),
    promptButtons: document.querySelectorAll('.prompt-btn'),
    m365KeepAliveToggle: document.getElementById('m365KeepAliveToggle'),
    // Multi-Session Elements
    sessionSelector: document.getElementById('session-selector'),
    refreshSessions: document.getElementById('refresh-sessions'),
    sessionInfo: document.getElementById('session-info'),
    sessionPlatform: document.getElementById('session-platform'),
    sessionDuration: document.getElementById('session-duration'),
    sessionCaptions: document.getElementById('session-captions'),
    sessionAttendees: document.getElementById('session-attendees'),
    configureKeywordsBtn: document.getElementById('configureKeywordsBtn'),
    toastEnabledToggle: document.getElementById('toastEnabledToggle'),
    toastDismissSelect: document.getElementById('toastDismissSelect')
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

// --- Utility Functions ---
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Platform detection utility
function detectPlatformFromUrl(url) {
    if (!url) return null;
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com') || url.includes('teams.cloud.microsoft')) {
        return 'teams';
    } else if (url.includes('meet.google.com')) {
        return 'meet';
    } else if (url.includes('zoom.us')) {
        return 'zoom';
    }
    return null;
}

async function getActiveMeetingTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const supportedPlatforms = [
        "https://teams.microsoft.com",
        "https://teams.live.com",
        "https://meet.google.com",
        "https://web.zoom.us",
        "https://app.zoom.us",
        "https://zoom.us"
    ];

    return tabs.find(tab => {
        return supportedPlatforms.some(platform => tab.url?.startsWith(platform));
    }) || null;
}

// --- Multi-Session Management Functions ---
async function loadActiveSessions() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getActiveSessions' });

        if (chrome.runtime.lastError) {
            console.error('[loadActiveSessions] Extension context error:', chrome.runtime.lastError);
            if (UI_ELEMENTS.statusMessage) {
                UI_ELEMENTS.statusMessage.textContent = 'Extension reloaded. Please refresh the page.';
                UI_ELEMENTS.statusMessage.style.color = '#dc3545';
            }
            return;
        }

        if (response && response.sessions) {
            const validSessions = [];
            const staleSessions = [];

            for (const session of response.sessions) {
                let tabExists = false;
                try {
                    const tab = await chrome.tabs.get(session.tabId);
                    const meetingDomains = ['teams.microsoft.com', 'teams.live.com', 'meet.google.com', 'zoom.us', 'app.zoom.us', 'web.zoom.us'];
                    tabExists = tab && tab.url && meetingDomains.some(domain => tab.url.includes(domain));
                } catch (e) {
                    tabExists = false;
                }

                const startTime = new Date(session.startTime);
                const lastActivity = session.lastUpdate ? new Date(session.lastUpdate) : startTime;
                const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
                const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

                if (tabExists) {
                    validSessions.push(session);
                } else if (lastActivity > twoMinutesAgo && session.captionCount > 0) {
                    validSessions.push(session);
                } else if (startTime > fiveMinutesAgo && session.status === 'active') {
                    validSessions.push(session);
                } else {
                    staleSessions.push(session);
                }
            }

            activeSessions = validSessions;

            for (const staleSession of staleSessions) {
                console.log(`Ending stale session: ${staleSession.meetingTitle} (${staleSession.platform})`);
                chrome.runtime.sendMessage({
                    action: 'endSession',
                    sessionId: staleSession.sessionId
                }, (response) => {
                    // Silently ignore benign errors
                    if (chrome.runtime.lastError && !chrome.runtime.lastError.message?.includes('message port closed')) {
                        console.warn('[Popup] Error ending stale session:', chrome.runtime.lastError.message);
                    }
                });
            }

            updateMultiSessionUI();
        }
    } catch (error) {
        console.error('Failed to load active sessions:', error);
    }
}

function updateMultiSessionUI() {
    // Handle empty activeSessions by resetting selectedSessionId
    if (activeSessions.length === 0) {
        selectedSessionId = null;
        UI_ELEMENTS.sessionIndicator.style.display = 'none';
        UI_ELEMENTS.switchSessionBtn.style.display = 'none';
        return;
    }

    // If multiple sessions, show session indicator and switch button
    if (activeSessions.length > 1) {
        const currentSessionIndex = activeSessions.findIndex(s => s.sessionId === selectedSessionId) + 1;
        UI_ELEMENTS.sessionIndicator.textContent = `Session ${currentSessionIndex} of ${activeSessions.length}`;
        UI_ELEMENTS.sessionIndicator.style.display = 'inline';
        UI_ELEMENTS.switchSessionBtn.style.display = 'inline-block';
    } else {
        UI_ELEMENTS.sessionIndicator.style.display = 'none';
        UI_ELEMENTS.switchSessionBtn.style.display = 'none';
    }

    // Auto-select single session
    if (activeSessions.length === 1) {
        selectedSessionId = activeSessions[0].sessionId;
        updateHeaderFromSession(activeSessions[0]);
        UI_ELEMENTS.viewButton.disabled = false;
        if (activeSessions[0].captionCount > 0) {
            UI_ELEMENTS.copyButton.disabled = false;
            UI_ELEMENTS.copyDropdownButton.disabled = false;
            UI_ELEMENTS.saveButton.disabled = false;
            UI_ELEMENTS.saveDropdownButton.disabled = false;
        }
    }
}

function updateHeaderFromSession(session) {
    // Update meeting title
    const meetingTitle = session.meetingTitle || 'Untitled Meeting';
    UI_ELEMENTS.meetingTitle.textContent = meetingTitle;

    // Show status dot and platform badge when in a meeting
    UI_ELEMENTS.statusDot.style.display = 'block';
    UI_ELEMENTS.platformBadge.style.display = 'inline-block';

    // Update platform badge
    const platform = session.platform ? session.platform.charAt(0).toUpperCase() + session.platform.slice(1) : 'Unknown';
    UI_ELEMENTS.platformBadge.textContent = platform;

    // Set platform color
    let platformColor = '#6c757d';
    if (session.platform === 'teams') {
        platformColor = '#6264a7';
        UI_ELEMENTS.platformBadge.style.background = 'rgba(98, 100, 167, 0.3)';
    } else if (session.platform === 'zoom') {
        platformColor = '#2d8cff';
        UI_ELEMENTS.platformBadge.style.background = 'rgba(45, 140, 255, 0.3)';
    } else if (session.platform === 'meet') {
        platformColor = '#00897b';
        UI_ELEMENTS.platformBadge.style.background = 'rgba(0, 137, 123, 0.3)';
    }

    // Update stats
    const captionCount = session.captionCount || 0;
    const attendeeCount = session.attendeeCount || 0;
    UI_ELEMENTS.captionsStat.textContent = captionCount;
    UI_ELEMENTS.attendeesStat.textContent = attendeeCount;

    // Update Current Session section
    UI_ELEMENTS.currentSessionTitle.textContent = meetingTitle;
    UI_ELEMENTS.currentSessionSubtitle.textContent = `${platform} • ${captionCount} Captions • ${attendeeCount} Attendees`;
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

// Switch session button handler
if (UI_ELEMENTS.switchSessionBtn) {
    UI_ELEMENTS.switchSessionBtn.addEventListener('click', () => {
        if (activeSessions.length <= 1) return;

        // Find current session index
        const currentIndex = activeSessions.findIndex(s => s.sessionId === selectedSessionId);
        // If current session not found, start from beginning
        const safeCurrentIndex = currentIndex === -1 ? 0 : currentIndex;
        // Move to next session (wrap around)
        const nextIndex = (safeCurrentIndex + 1) % activeSessions.length;
        const nextSession = activeSessions[nextIndex];

        // Validate next session exists before accessing properties
        if (!nextSession || !nextSession.sessionId) {
            console.warn('[Popup] Next session is invalid, cannot switch');
            return;
        }

        selectedSessionId = nextSession.sessionId;

        // Update UI
        updateHeaderFromSession(nextSession);
        updateMultiSessionUI();

        // Enable buttons based on session data
        UI_ELEMENTS.viewButton.disabled = false;
        if (nextSession.captionCount > 0) {
            UI_ELEMENTS.copyButton.disabled = false;
            UI_ELEMENTS.copyDropdownButton.disabled = false;
            UI_ELEMENTS.saveButton.disabled = false;
            UI_ELEMENTS.saveDropdownButton.disabled = false;
        } else {
            UI_ELEMENTS.copyButton.disabled = true;
            UI_ELEMENTS.copyDropdownButton.disabled = true;
            UI_ELEMENTS.saveButton.disabled = true;
            UI_ELEMENTS.saveDropdownButton.disabled = true;
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
        if (trackCaptions !== false && capturing) {
            statusMessage.textContent = captionCount > 0 ? 'Live captions are being captured' : 'Waiting for someone to speak...';
            statusMessage.style.color = captionCount > 0 ? '#28a745' : '#ffc107';
        } else if (trackCaptions === false && trackAttendees !== false && attendeeCount > 0) {
            statusMessage.textContent = 'Tracking attendees only';
            statusMessage.style.color = '#17a2b8';
        } else if (trackCaptions === false) {
            statusMessage.textContent = 'In a meeting (caption tracking disabled)';
            statusMessage.style.color = '#6c757d';
        } else {
            statusMessage.textContent = 'Please enable live captions in the meeting';
            statusMessage.style.color = '#dc3545';
        }
    } else {
        let hasData = captionCount > 0 || attendeeCount > 0;
        if (hasData) {
            statusMessage.textContent = 'Meeting ended. Data available for export.';
            statusMessage.style.color = '#17a2b8';
        } else {
            statusMessage.textContent = 'Not in a meeting';
            statusMessage.style.color = '#6c757d';
        }
    }
}

async function updateButtonStates(hasData, isInMeeting) {
    const dataButtons = [
        UI_ELEMENTS.copyButton, UI_ELEMENTS.copyDropdownButton,
        UI_ELEMENTS.saveButton, UI_ELEMENTS.saveDropdownButton
    ];
    dataButtons.forEach(btn => btn.disabled = !hasData);

    // Enable View Transcript if in meeting with data OR if we have previous sessions
    let hasPreviousSessions = false;
    try {
        if (typeof SessionManager !== 'undefined') {
            const sessionManager = new SessionManager();
            const sessions = await sessionManager.getAllSessions();
            hasPreviousSessions = sessions && sessions.length > 0;
        }
    } catch (e) {
        // Ignore errors
    }

    UI_ELEMENTS.viewButton.disabled = !isInMeeting && !hasData && !hasPreviousSessions;
}

function updateSaveButtonText(format) {
    UI_ELEMENTS.saveButton.textContent = format === 'ai' ? 'Save for AI' : `Save as ${format.toUpperCase()}`;
}

// --- Template Management ---
async function loadCustomTemplates() {
    const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');
    UI_ELEMENTS.customTemplatesGroup.innerHTML = '';

    Object.entries(customTemplates).forEach(([id, template]) => {
        const option = document.createElement('option');
        option.value = `custom_${id}`;
        option.textContent = template.name;
        UI_ELEMENTS.customTemplatesGroup.appendChild(option);
    });

    UI_ELEMENTS.customTemplatesGroup.style.display =
        Object.keys(customTemplates).length > 0 ? 'block' : 'none';
}

function sanitizeInput(str) {
    return str.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

function validateTemplateName(name) {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error('Template name cannot be empty');
    if (trimmedName.length > 50) throw new Error('Template name must be 50 characters or less');
    const validPattern = /^[a-zA-Z0-9_\-\s]+$/;
    if (!validPattern.test(trimmedName)) {
        throw new Error('Template name can only contain letters, numbers, spaces, hyphens, and underscores');
    }
    return trimmedName;
}

function validateFilenamePattern(pattern) {
    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) throw new Error('Filename pattern cannot be empty');
    if (trimmedPattern.length > 100) throw new Error('Filename pattern must be 100 characters or less');
    const validPattern = /^[a-zA-Z0-9_\-\{\}\s\.]+$/;
    if (!validPattern.test(trimmedPattern)) {
        throw new Error('Filename pattern contains invalid characters');
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
        const validatedName = validateTemplateName(name);
        sanitizedName = sanitizeInput(validatedName);
        if (!sanitizedName) {
            alert('Template name contains only invalid characters.');
            return;
        }
    } catch (error) {
        alert(error.message);
        return;
    }

    const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');

    let existingId = null;
    for (const [id, template] of Object.entries(customTemplates)) {
        if (template.name === sanitizedName) {
            existingId = id;
            break;
        }
    }

    const id = existingId || Date.now().toString();
    customTemplates[id] = {
        name: sanitizedName,
        instructions: instructions.trim(),
        createdAt: customTemplates[id]?.createdAt || new Date().toISOString(),
        updatedAt: existingId ? new Date().toISOString() : undefined
    };

    try {
        await chrome.storage.sync.set({ customTemplates });
    } catch (error) {
        if (error.message && (error.message.includes('quota') || error.message.includes('QUOTA_BYTES'))) {
            alert('Template too large. Chrome storage quota exceeded.');
            return;
        }
        throw error;
    }

    await loadCustomTemplates();
    UI_ELEMENTS.templateName.value = '';
    UI_ELEMENTS.saveTemplateBtn.textContent = 'Save Template';
    UI_ELEMENTS.saveTemplateBtn.style.background = '#28a745';
    UI_ELEMENTS.meetingType.value = `custom_${id}`;
    alert(existingId ? 'Template updated successfully!' : 'Template saved successfully!');
}

async function editCustomTemplate(templateId) {
    const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');
    const id = templateId.replace('custom_', '');
    if (!customTemplates[id]) {
        alert('Template not found');
        return;
    }
    UI_ELEMENTS.templateName.value = customTemplates[id].name || id;
    UI_ELEMENTS.aiInstructions.value = customTemplates[id].instructions || '';
    UI_ELEMENTS.aiInstructions.focus();
    UI_ELEMENTS.saveTemplateBtn.textContent = 'Update Template';
    UI_ELEMENTS.saveTemplateBtn.style.background = '#0078d4';
}

async function deleteCustomTemplate(templateId) {
    if (!confirm('Are you sure you want to delete this custom template?')) return;

    const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');
    const id = templateId.replace('custom_', '');
    delete customTemplates[id];
    await chrome.storage.sync.set({ customTemplates });
    await loadCustomTemplates();

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
        'autoEnableCaptions', 'autoSaveOnEnd', 'aiInstructions', 'defaultSaveFormat',
        'trackCaptions', 'trackAttendees', 'timestampFormat',
        'filenamePattern', 'chatCapture', 'm365KeepAlive', 'backgroundCapture', 'captureSharedContent'
    ]);

    UI_ELEMENTS.autoEnableCaptionsToggle.checked = !!settings.autoEnableCaptions;
    UI_ELEMENTS.autoSaveOnEndToggle.checked = !!settings.autoSaveOnEnd;
    UI_ELEMENTS.trackCaptionsToggle.checked = settings.trackCaptions !== false;
    UI_ELEMENTS.trackAttendeesToggle.checked = settings.trackAttendees !== false;
    UI_ELEMENTS.chatCaptureToggle.checked = settings.chatCapture !== false;
    UI_ELEMENTS.backgroundCaptureToggle.checked = settings.backgroundCapture !== false;
    UI_ELEMENTS.captureSharedContentToggle.checked = !!settings.captureSharedContent;
    UI_ELEMENTS.timestampFormat.value = settings.timestampFormat || '12hr';
    UI_ELEMENTS.filenamePattern.value = settings.filenamePattern || '{date}_{title}_{format}';
    UI_ELEMENTS.aiInstructions.value = settings.aiInstructions || '';
    UI_ELEMENTS.m365KeepAliveToggle.checked = !!settings.m365KeepAlive;

    // Load toast settings from hotKeywordSettings
    const kwData = await chrome.storage.sync.get('hotKeywordSettings');
    const kwSettings = kwData.hotKeywordSettings || {};
    UI_ELEMENTS.toastEnabledToggle.checked = kwSettings.toastEnabled !== false;
    UI_ELEMENTS.toastDismissSelect.value = String(kwSettings.toastDismissSeconds || 45);

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
    });

    UI_ELEMENTS.autoSaveOnEndToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ autoSaveOnEnd: e.target.checked });
    });

    UI_ELEMENTS.trackAttendeesToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ trackAttendees: e.target.checked });
    });

    UI_ELEMENTS.backgroundCaptureToggle.addEventListener('change', (e) => {
        // Content script reacts via chrome.storage.onChanged, even mid-capture
        chrome.storage.sync.set({ backgroundCapture: e.target.checked });
    });

    UI_ELEMENTS.captureSharedContentToggle.addEventListener('change', (e) => {
        // Content script starts/stops the slide sampler via chrome.storage.onChanged
        chrome.storage.sync.set({ captureSharedContent: e.target.checked });
    });

    UI_ELEMENTS.chatCaptureToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ chatCapture: e.target.checked });
        getActiveMeetingTab().then(tab => {
            if (tab) {
                chrome.tabs.sendMessage(tab.id, {
                    message: "toggle_chat_capture",
                    enabled: e.target.checked
                }, (response) => {
                    // Silently ignore benign errors
                    if (chrome.runtime.lastError && !chrome.runtime.lastError.message?.includes('message port closed')) {
                        console.warn('[Popup] Error toggling chat capture:', chrome.runtime.lastError.message);
                    }
                });
            }
        });
    });

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
            e.target.style.borderColor = '';
        } catch (error) {
            // Don't save invalid patterns, just show visual feedback
            e.target.style.borderColor = 'red';
            console.warn('[Popup] Invalid filename pattern, not saving:', error.message);
        }
    });

    UI_ELEMENTS.m365KeepAliveToggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ m365KeepAlive: e.target.checked });
    });

    UI_ELEMENTS.toastEnabledToggle.addEventListener('change', async (e) => {
        const data = await chrome.storage.sync.get('hotKeywordSettings');
        const current = data.hotKeywordSettings || {};
        current.toastEnabled = e.target.checked;
        await chrome.storage.sync.set({ hotKeywordSettings: current });
    });

    UI_ELEMENTS.toastDismissSelect.addEventListener('change', async (e) => {
        const data = await chrome.storage.sync.get('hotKeywordSettings');
        const current = data.hotKeywordSettings || {};
        current.toastDismissSeconds = parseInt(e.target.value, 10);
        await chrome.storage.sync.set({ hotKeywordSettings: current });
    });

    UI_ELEMENTS.meetingType.addEventListener('change', async (e) => {
        const value = e.target.value;
        const isCustomTemplate = value.startsWith('custom_');
        UI_ELEMENTS.editTemplateBtn.style.display = isCustomTemplate ? 'inline-block' : 'none';
        UI_ELEMENTS.deleteTemplateBtn.style.display = isCustomTemplate ? 'inline-block' : 'none';
        UI_ELEMENTS.saveTemplateBtn.textContent = 'Save Template';
        UI_ELEMENTS.saveTemplateBtn.style.background = '#28a745';

        if (value) {
            if (isCustomTemplate) {
                const { customTemplates = {} } = await chrome.storage.sync.get('customTemplates');
                const id = value.replace('custom_', '');
                if (customTemplates[id]) {
                    UI_ELEMENTS.aiInstructions.value = customTemplates[id].instructions;
                    UI_ELEMENTS.aiInstructions.dispatchEvent(new Event('change'));
                } else {
                    // Template was deleted (possibly by another tab) - notify user and reset
                    console.warn(`[Templates] Custom template '${id}' not found, may have been deleted`);
                    UI_ELEMENTS.aiInstructions.value = '';
                    UI_ELEMENTS.meetingType.value = '';
                    UI_ELEMENTS.editTemplateBtn.style.display = 'none';
                    UI_ELEMENTS.deleteTemplateBtn.style.display = 'none';
                    // Refresh the template list to remove stale entry
                    await loadCustomTemplates();
                }
            } else if (MEETING_TYPE_PROMPTS[value]) {
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
                alert('AI instructions too large. Please reduce the length.');
            }
        }
    });

    // Action Button Listeners
    UI_ELEMENTS.saveButton.addEventListener('click', async () => {
        const tab = await getActiveMeetingTab();
        if (tab) {
            chrome.tabs.sendMessage(tab.id, { message: "return_transcript", format: currentDefaultFormat }, (response) => {
                // Silently ignore benign errors
                if (chrome.runtime.lastError && !chrome.runtime.lastError.message?.includes('message port closed')) {
                    console.warn('[Popup] Error saving transcript:', chrome.runtime.lastError.message);
                }
            });
        }
    });

    UI_ELEMENTS.viewButton.addEventListener('click', async () => {
        if (selectedSessionId) {
            const session = activeSessions.find(s => s.sessionId === selectedSessionId);
            if (session) {
                chrome.tabs.sendMessage(session.tabId, { message: "get_captions_for_viewing" }, (response) => {
                    // Silently ignore "message port closed" - expected when tab/content script is busy
                    if (chrome.runtime.lastError && !chrome.runtime.lastError.message?.includes('message port closed')) {
                        console.warn('[Popup] Error getting captions for viewing:', chrome.runtime.lastError.message);
                    }
                });
            }
        } else {
            const tab = await getActiveMeetingTab();
            if (tab) {
                chrome.tabs.sendMessage(tab.id, { message: "get_captions_for_viewing" }, (response) => {
                    // Silently ignore "message port closed" - expected when tab/content script is busy
                    if (chrome.runtime.lastError && !chrome.runtime.lastError.message?.includes('message port closed')) {
                        console.warn('[Popup] Error getting captions for viewing:', chrome.runtime.lastError.message);
                    }
                });
            } else {
                // No active meeting - open viewer directly (user can load history from there)
                chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html') });
            }
        }
    });

    setupDropdown(UI_ELEMENTS.copyButton, UI_ELEMENTS.copyDropdownButton, UI_ELEMENTS.copyOptions, handleCopy);
    setupDropdown(null, UI_ELEMENTS.saveDropdownButton, UI_ELEMENTS.saveOptions, handleSave);

    // Configure Keywords button - opens viewer with keyword modal
    UI_ELEMENTS.configureKeywordsBtn?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('viewer.html?openKeywords=true') });
    });

    // AI Prompt Buttons
    UI_ELEMENTS.promptButtons.forEach(button => {
        button.addEventListener('click', function() {
            const buttonText = this.textContent;
            let templateToSelect = '';

            switch(buttonText) {
                case 'Summarize': templateToSelect = 'executive'; break;
                case 'Action Items': templateToSelect = 'retrospective'; break;
                case 'Decisions': templateToSelect = 'review'; break;
            }

            if (templateToSelect) {
                UI_ELEMENTS.meetingType.value = templateToSelect;
                UI_ELEMENTS.meetingType.dispatchEvent(new Event('change'));
                this.style.backgroundColor = '#28a745';
                this.style.color = 'white';
                setTimeout(() => {
                    this.style.backgroundColor = '';
                    this.style.color = '';
                }, 500);
            }
        });
    });

    document.addEventListener('click', (e) => {
        // Close all dropdowns when clicking outside
        if (!e.target.closest('.split-button')) {
            document.querySelectorAll('.dropdown-menu').forEach(menu => {
                menu.classList.remove('show');
            });
            document.querySelectorAll('.btn-dropdown').forEach(btn => {
                btn.classList.remove('open');
            });
        }
    });
}

function setupDropdown(mainButton, dropdownButton, optionsContainer, actionHandler) {
    if (mainButton) {
        mainButton.addEventListener('click', () => {
            const firstOption = optionsContainer.querySelector('.dropdown-item');
            if (firstOption) actionHandler(firstOption);
        });
    }

    dropdownButton.addEventListener('click', (e) => {
        e.stopPropagation();

        // Close other dropdowns
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            if (menu !== optionsContainer) {
                menu.classList.remove('show');
            }
        });
        document.querySelectorAll('.btn-dropdown').forEach(btn => {
            if (btn !== dropdownButton) {
                btn.classList.remove('open');
            }
        });

        // Toggle this dropdown
        const isOpen = optionsContainer.classList.contains('show');
        if (isOpen) {
            optionsContainer.classList.remove('show');
            dropdownButton.classList.remove('open');
        } else {
            optionsContainer.classList.add('show');
            dropdownButton.classList.add('open');
        }
    });

    optionsContainer.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target.closest('.dropdown-item');
        if (target) {
            actionHandler(target);
            optionsContainer.classList.remove('show');
            dropdownButton.classList.remove('open');
        }
    });
}

async function handleCopy(target) {
    const copyType = target?.dataset?.copyType;
    if (!copyType) return;

    // Capture session ID at start to prevent race condition if user switches sessions
    const capturedSessionId = selectedSessionId;

    UI_ELEMENTS.statusMessage.textContent = "Preparing text to copy...";
    try {
        let transcriptArray = null;

        if (capturedSessionId) {
            const response = await chrome.runtime.sendMessage({
                action: 'getSessionData',
                sessionId: capturedSessionId
            });
            if (response?.sessionData?.transcript) {
                transcriptArray = response.sessionData.transcript;
            }
        } else {
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

    // Capture session ID at start to prevent race condition if user switches sessions
    const capturedSessionId = selectedSessionId;

    // For SRT, we need to get the meeting start time first to use as default
    let userRecordingStartTime = null;
    let meetingStartTime = null;

    if (format === 'srt') {
        // Try to get meeting start time for the default value
        if (capturedSessionId) {
            try {
                const response = await chrome.runtime.sendMessage({
                    action: 'getSessionData',
                    sessionId: capturedSessionId
                });
                meetingStartTime = response?.sessionData?.metadata?.startTime;
            } catch (e) {
                // Ignore - will use current time as fallback
            }
        }

        const srtResult = await showSrtExportDialog(meetingStartTime);
        if (!srtResult) return; // User cancelled
        userRecordingStartTime = srtResult.userRecordingStartTime;
    }

    UI_ELEMENTS.statusMessage.textContent = `Saving as ${format === 'ai' ? 'AI' : format.toUpperCase()}...`;

    try {
        if (capturedSessionId) {
            const response = await chrome.runtime.sendMessage({
                action: 'getSessionData',
                sessionId: capturedSessionId
            });

            if (response?.sessionData) {
                const { transcript, attendeeReport, metadata } = response.sessionData;
                const meetingTitle = metadata?.meetingTitle || 'Meeting';
                const recordingStartTime = metadata?.startTime || new Date().toISOString();

                const saveResponse = await chrome.runtime.sendMessage({
                    message: "save_from_session",
                    transcriptArray: transcript,
                    meetingTitle: meetingTitle,
                    platform: metadata?.platform || null,
                    format: format,
                    recordingStartTime: recordingStartTime,
                    attendeeReport: attendeeReport,
                    userRecordingStartTime: userRecordingStartTime
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
            const tab = await getActiveMeetingTab();
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, { message: "return_transcript", format, userRecordingStartTime });
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

// --- Previous Sessions Management ---
async function loadPreviousSessions() {
    try {
        // Check if SessionManager is available
        if (typeof SessionManager === 'undefined') {
            // SessionManager not loaded yet, try to load it
            const script = document.createElement('script');
            script.src = 'sessionManager.js';
            document.head.appendChild(script);

            await new Promise((resolve, reject) => {
                let resolved = false;
                script.onload = () => {
                    if (!resolved) {
                        resolved = true;
                        resolve();
                    }
                };
                script.onerror = (error) => {
                    if (!resolved) {
                        resolved = true;
                        console.warn('[Previous Sessions] Failed to load sessionManager.js:', error);
                        resolve(); // Don't reject - allow graceful degradation
                    }
                };
                // Timeout as fallback
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        resolve();
                    }
                }, 1000); // Increased timeout
            });
        }

        if (typeof SessionManager === 'undefined') {
            console.log('[Previous Sessions] SessionManager not available');
            return;
        }

        const sessionManager = new SessionManager();
        const sessions = await sessionManager.getAllSessions();

        const section = document.getElementById('previous-sessions-section');
        const countEl = document.getElementById('session-count');
        const pluralEl = document.getElementById('session-plural');
        const listEl = document.getElementById('sessions-list');
        const headerEl = document.getElementById('previous-sessions-header');
        const folderIcon = document.getElementById('folder-icon');

        if (!sessions || sessions.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        countEl.textContent = sessions.length;
        pluralEl.textContent = sessions.length === 1 ? '' : 's';

        // Add click handler to toggle folder (check if listener already added)
        if (!headerEl.dataset.listenerAdded) {
            headerEl.dataset.listenerAdded = 'true';
            headerEl.addEventListener('click', () => {
                const isOpen = listEl.style.display !== 'none';
                if (isOpen) {
                    listEl.style.display = 'none';
                    folderIcon.classList.remove('open');
                } else {
                    listEl.style.display = 'block';
                    folderIcon.classList.add('open');
                }
            });
        }

        // Sort by most recent first
        sessions.sort((a, b) => new Date(b.startTime || b.timestamp) - new Date(a.startTime || a.timestamp));

        // Show all sessions (scrollable)
        listEl.innerHTML = sessions.map(session => {
            // Validate session ID exists
            const sessionId = session.sessionId || session.id;
            if (!sessionId) {
                console.warn('[Previous Sessions] Session missing sessionId:', session);
                return ''; // Skip sessions without valid ID
            }
            const title = session.meetingTitle || session.title || 'Untitled Meeting';
            const startTime = session.startTime || session.timestamp;
            const date = new Date(startTime);
            const timeAgo = getTimeAgo(date);
            const captionCount = session.captionCount || 0;
            const platform = session.platform || 'unknown';

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

            return `
                <div class="session-item" data-session-id="${sessionId}">
                    <div class="session-item-title">
                        <span style="color: ${platformColor}; font-weight: bold; font-size: 10px;">${platformDisplay}</span>
                        <span>${escapeHtml(title)}</span>
                    </div>
                    <div class="session-item-meta">
                        <span>${timeAgo}</span>
                        <span>•</span>
                        <span>${captionCount} captions</span>
                    </div>
                    <div class="session-item-actions">
                        <button class="session-item-btn view-session" data-id="${sessionId}">View</button>
                        <button class="session-item-btn export-session" data-id="${sessionId}">Export</button>
                        <button class="session-item-btn delete delete-session" data-id="${sessionId}">Delete</button>
                    </div>
                </div>
            `;
        }).join('');

        // Add event listeners
        document.querySelectorAll('.view-session').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                viewPreviousSession(e.target.dataset.id);
            });
        });

        document.querySelectorAll('.export-session').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                exportPreviousSession(e.target.dataset.id);
            });
        });

        document.querySelectorAll('.delete-session').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deletePreviousSession(e.target.dataset.id);
            });
        });

    } catch (error) {
        console.error('[Previous Sessions] Failed to load:', error);
    }
}

async function viewPreviousSession(sessionId) {
    try {
        console.log('[viewPreviousSession] Clicked session ID:', sessionId);

        const sessionManager = new SessionManager();
        const sessionData = await sessionManager.loadSessionData(sessionId);

        console.log('[viewPreviousSession] Loaded session data:', sessionData);

        if (!sessionData || !sessionData.transcript) {
            throw new Error('Session data not found');
        }

        // Debug: Log all possible title sources
        console.log('[viewPreviousSession] Title sources:', {
            'sessionData.metadata?.meetingTitle': sessionData.metadata?.meetingTitle,
            'sessionData.metadata?.title': sessionData.metadata?.title,
            'sessionData.meetingTitle': sessionData.meetingTitle,
            'sessionData.title': sessionData.title
        });

        // Get meeting title with multiple fallbacks
        const meetingTitle = sessionData.metadata?.meetingTitle ||
                           sessionData.metadata?.title ||
                           sessionData.meetingTitle ||
                           sessionData.title ||
                           'Untitled Meeting';

        // Get platform with fallbacks
        const platform = sessionData.metadata?.platform ||
                        sessionData.platform ||
                        '';

        console.log('[viewPreviousSession] Selected meetingTitle:', meetingTitle);

        console.log('[viewPreviousSession] Extracted data:', {
            sessionId,
            meetingTitle,
            platform,
            expectedTitle: 'Should match the clicked session',
            metadataTitle: sessionData.metadata?.meetingTitle,
            topLevelTitle: sessionData.meetingTitle,
            topLevelPlatform: sessionData.platform,
            hasTranscript: !!sessionData.transcript
        });

        // Debug: Check if we have the data
        if (!meetingTitle || meetingTitle === 'Untitled Meeting') {
            console.warn('[viewPreviousSession] Missing meeting title! Session data:', sessionData);
        }

        // Store with a unique timestamp key to avoid conflicts with live meeting data
        const viewerKey = `historicalSession_${Date.now()}`;

        await chrome.storage.local.set({
            [viewerKey]: {
                transcriptArray: sessionData.transcript,
                meetingTitle: meetingTitle,
                platform: platform,
                attendeeReport: sessionData.attendeeReport,
                isHistorical: true,
                timestamp: Date.now(),
                _debug: {
                    clickedSessionId: sessionId,
                    loadedSessionData: {
                        hasMetadata: !!sessionData.metadata,
                        metadataTitle: sessionData.metadata?.meetingTitle,
                        metadataPlatform: sessionData.metadata?.platform,
                        topLevelTitle: sessionData.meetingTitle,
                        topLevelPlatform: sessionData.platform
                    }
                }
            },
            // Also set the old keys for backwards compatibility, but these might get overwritten
            captionsToView: sessionData.transcript,
            viewerData: {
                transcriptArray: sessionData.transcript,
                meetingTitle: meetingTitle,
                platform: platform,
                attendeeReport: sessionData.attendeeReport,
                isHistorical: true
            }
        });

        // Open viewer with the unique key as a URL parameter
        window.open(chrome.runtime.getURL(`viewer.html?session=${viewerKey}`), '_blank');
    } catch (error) {
        console.error('[Previous Sessions] Failed to view session:', error);
        alert(`Failed to load session: ${error.message}`);
    }
}

async function exportPreviousSession(sessionId) {
    try {
        const sessionManager = new SessionManager();
        const sessionData = await sessionManager.loadSessionData(sessionId);

        if (!sessionData || !sessionData.transcript) {
            throw new Error('No transcript data available');
        }

        // Get meeting start time for SRT default
        const meetingStartTime = sessionData.metadata?.startTime;

        // Show format selection dialog with meeting start time for SRT
        const result = await showExportFormatDialog(meetingStartTime);
        if (!result) return; // User cancelled

        await chrome.runtime.sendMessage({
            message: "download_captions",
            transcriptArray: sessionData.transcript,
            format: result.format,
            meetingTitle: sessionData.metadata?.meetingTitle || 'Meeting',
            platform: sessionData.metadata?.platform || null,
            attendeeReport: sessionData.attendeeReport,
            recordingStartTime: sessionData.metadata?.startTime || new Date().toISOString(),
            userRecordingStartTime: result.userRecordingStartTime
        });

        UI_ELEMENTS.statusMessage.textContent = 'Session exported!';
        UI_ELEMENTS.statusMessage.style.color = '#28a745';
    } catch (error) {
        console.error('[Previous Sessions] Failed to export session:', error);
        alert(`Failed to export session: ${error.message}`);
    }
}

async function deletePreviousSession(sessionId) {
    if (!confirm('Delete this session? This cannot be undone.')) return;

    try {
        const sessionManager = new SessionManager();
        await sessionManager.deleteSession(sessionId);
        await loadPreviousSessions(); // Reload the list
        UI_ELEMENTS.statusMessage.textContent = 'Session deleted';
        UI_ELEMENTS.statusMessage.style.color = '#28a745';
    } catch (error) {
        console.error('[Previous Sessions] Failed to delete session:', error);
        alert(`Failed to delete session: ${error.message}`);
    }
}

// Show format selection dialog for exports
// Returns { format, userRecordingStartTime } or null if cancelled
// meetingStartTime: optional ISO string to use as SRT default
function showExportFormatDialog(meetingStartTime = null) {
    return new Promise((resolve) => {
        // Create modal
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            max-width: 400px;
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; font-size: 18px;">Select Export Format</h3>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button data-format="txt" style="padding: 12px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    TXT (Plain Text)
                </button>
                <button data-format="json" style="padding: 12px; background: #0078d4; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    JSON (Structured Data)
                </button>
                <button data-format="md" style="padding: 12px; background: #6f42c1; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    Markdown (Formatted)
                </button>
                <button data-format="html" style="padding: 12px; background: #e34c26; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    HTML (Viewer page with images)
                </button>
                <button data-format="ai" style="padding: 12px; background: #ff6b6b; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    AI Analysis (with Instructions)
                </button>
                <button data-format="srt" style="padding: 12px; background: #fd7e14; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    SRT (Subtitles for Video)
                </button>
                <button data-format="cancel" style="padding: 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    Cancel
                </button>
            </div>
        `;

        modal.appendChild(dialog);
        document.body.appendChild(modal);

        // Handle clicks
        dialog.addEventListener('click', async (e) => {
            if (e.target.tagName === 'BUTTON') {
                const format = e.target.dataset.format;
                document.body.removeChild(modal);

                if (format === 'cancel') {
                    resolve(null);
                } else if (format === 'srt') {
                    // Show SRT-specific dialog for recording start time
                    const srtResult = await showSrtExportDialog(meetingStartTime);
                    resolve(srtResult);
                } else {
                    resolve({ format, userRecordingStartTime: null });
                }
            }
        });

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(null);
            }
        });
    });
}

// Show SRT export dialog with recording start time input
// meetingStartTime: optional ISO string to use as default instead of current time
function showSrtExportDialog(meetingStartTime = null) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        // Use meeting start time if provided, otherwise fall back to current time
        const defaultTime = meetingStartTime ? new Date(meetingStartTime) : new Date();
        const dateStr = defaultTime.toISOString().split('T')[0];
        const timeStr = defaultTime.toTimeString().slice(0, 5);

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            max-width: 420px;
            width: 90%;
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 8px 0; font-size: 18px;">Export as SRT Subtitles</h3>
            <p style="margin: 0 0 16px 0; font-size: 13px; color: #666;">
                Enter when you started your external recording (OBS, etc.) to sync subtitles with your video.
            </p>

            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 14px;">Recording Start Date</label>
                <input type="date" id="srt-date" value="${dateStr}" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
            </div>

            <div style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 4px; font-weight: 500; font-size: 14px;">Recording Start Time</label>
                <input type="time" id="srt-time" value="${timeStr}" step="1" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
            </div>

            <p style="margin: 0 0 16px 0; font-size: 12px; color: #888;">
                Tip: You may need to adjust by a few seconds in your video editor for perfect sync.
            </p>

            <div style="display: flex; gap: 8px;">
                <button id="srt-export-btn" style="flex: 1; padding: 12px; background: #fd7e14; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 500;">
                    Export SRT
                </button>
                <button id="srt-cancel-btn" style="flex: 1; padding: 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    Cancel
                </button>
            </div>
        `;

        modal.appendChild(dialog);
        document.body.appendChild(modal);

        const dateInput = dialog.querySelector('#srt-date');
        const timeInput = dialog.querySelector('#srt-time');
        const exportBtn = dialog.querySelector('#srt-export-btn');
        const cancelBtn = dialog.querySelector('#srt-cancel-btn');

        exportBtn.addEventListener('click', () => {
            const date = dateInput.value;
            const time = timeInput.value;

            if (!date || !time) {
                alert('Please enter both date and time');
                return;
            }

            // Combine date and time into ISO string
            const userRecordingStartTime = new Date(`${date}T${time}`).toISOString();
            document.body.removeChild(modal);
            resolve({ format: 'srt', userRecordingStartTime });
        });

        cancelBtn.addEventListener('click', () => {
            document.body.removeChild(modal);
            resolve(null);
        });

        // Close on background click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                document.body.removeChild(modal);
                resolve(null);
            }
        });
    });
}

function getTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    const days = Math.floor(seconds / 86400);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

// --- Initialization ---
async function initializePopup() {
    await loadSettings();
    await loadCustomTemplates();
    setupEventListeners();
    await loadActiveSessions();
    await loadPreviousSessions();

    const tab = await getActiveMeetingTab();
    if (!tab) {
        if (activeSessions.length > 0) {
            UI_ELEMENTS.statusMessage.textContent = `${activeSessions.length} active session(s) found. Click Switch to change sessions.`;
            UI_ELEMENTS.statusMessage.style.color = '#17a2b8';
            if (selectedSessionId) {
                UI_ELEMENTS.viewButton.disabled = false;
                const session = activeSessions.find(s => s.sessionId === selectedSessionId);
                if (session && session.captionCount > 0) {
                    UI_ELEMENTS.copyButton.disabled = false;
                    UI_ELEMENTS.copyDropdownButton.disabled = false;
                    UI_ELEMENTS.saveButton.disabled = false;
                    UI_ELEMENTS.saveDropdownButton.disabled = false;
                }
            }
        } else {
            UI_ELEMENTS.statusMessage.innerHTML = 'Please open a Teams, Google Meet, or Zoom meeting to use this extension.';
            UI_ELEMENTS.statusMessage.style.color = '#dc3545';
            UI_ELEMENTS.meetingTitle.textContent = 'No Active Meeting';
            UI_ELEMENTS.platformBadge.style.display = 'none';
        }
        return;
    }

    try {
        let status;
        try {
            status = await chrome.tabs.sendMessage(tab.id, { message: "get_status" });
        } catch (e) {
            status = null;
        }

        // Zoom uses iframes, need delay to allow meeting iframe to respond
        const ZOOM_IFRAME_RESPONSE_DELAY_MS = 500;
        if (tab.url?.includes('zoom.us')) {
            if (status && status.frameType === 'non-meeting-iframe') {
                status = null;
            }
            await new Promise(resolve => setTimeout(resolve, ZOOM_IFRAME_RESPONSE_DELAY_MS));
            try {
                const secondStatus = await chrome.tabs.sendMessage(tab.id, { message: "get_status" });
                if (secondStatus && secondStatus.frameType !== 'non-meeting-iframe') {
                    if (!status || (secondStatus.isInMeeting && !status.isInMeeting) ||
                        (secondStatus.capturing && !status.capturing) ||
                        (secondStatus.captionCount > (status.captionCount || 0))) {
                        status = secondStatus;
                    }
                }
            } catch (e) {}

            const activeSession = activeSessions.find(s => s.tabId === tab.id);
            if (activeSession && activeSession.status === 'active') {
                if (!status || !status.isInMeeting) {
                    status = {
                        capturing: activeSession.captionCount > 0,
                        captionCount: activeSession.captionCount || 0,
                        isInMeeting: true,
                        attendeeCount: activeSession.attendeeCount || 0
                    };
                }
            } else if (!status) {
                status = {
                    capturing: false,
                    captionCount: 0,
                    isInMeeting: false,
                    attendeeCount: 0
                };
            }
        }

        if (status) {
            await updateStatusUI(status);
            const hasData = status.captionCount > 0 || (status.attendeeCount > 0 && status.isInMeeting === false);
            updateButtonStates(hasData, status.isInMeeting);

            // Update header stats
            const captionCount = status.captionCount || 0;
            const attendeeCount = status.attendeeCount || 0;
            UI_ELEMENTS.captionsStat.textContent = captionCount;
            UI_ELEMENTS.attendeesStat.textContent = attendeeCount;

            // Only show meeting info when actually in a meeting
            if (status.isInMeeting) {
                // Determine platform from tab URL using utility function
                const platformKey = detectPlatformFromUrl(tab.url);
                const platform = platformKey === 'teams' ? 'Teams' :
                                platformKey === 'meet' ? 'Meet' :
                                platformKey === 'zoom' ? 'Zoom' : 'Unknown';

                // Get meeting title from status (if available) or tab title as fallback
                const meetingTitle = status.meetingTitle ||
                                    tab.title?.replace(/ - Microsoft Teams| - Google Meet| - Zoom Meeting/g, '') ||
                                    'Meeting';

                UI_ELEMENTS.meetingTitle.textContent = meetingTitle;
                UI_ELEMENTS.platformBadge.textContent = platform;
                UI_ELEMENTS.statusDot.style.display = 'block';
                UI_ELEMENTS.platformBadge.style.display = 'inline-block';

                // Update Current Session section
                UI_ELEMENTS.currentSessionTitle.textContent = meetingTitle;
                UI_ELEMENTS.currentSessionSubtitle.textContent = `${platform} • ${captionCount} Captions • ${attendeeCount} Attendees`;
            } else {
                // Not in a meeting - reset to defaults
                UI_ELEMENTS.meetingTitle.textContent = 'No Active Meeting';
                UI_ELEMENTS.statusDot.style.display = 'none';
                UI_ELEMENTS.platformBadge.style.display = 'none';

                // Keep Current Session updated for ended meetings with data
                if (captionCount > 0 || attendeeCount > 0) {
                    // Preserve the meeting title if we have one from before
                    UI_ELEMENTS.currentSessionSubtitle.textContent = `Meeting Ended • ${captionCount} Captions • ${attendeeCount} Attendees`;
                } else {
                    UI_ELEMENTS.currentSessionTitle.textContent = 'No Active Meeting';
                    UI_ELEMENTS.currentSessionSubtitle.textContent = 'Join a meeting to start capturing';
                }
            }

            if (tab.url?.includes('zoom.us') && status.isInMeeting && activeSessions.length > 0) {
                const currentSession = activeSessions.find(s => s.tabId === tab.id);
                if (currentSession) {
                    UI_ELEMENTS.viewButton.disabled = false;
                }
            }
        }
    } catch (error) {
        if (error.message.includes("Could not establish connection")) {
            UI_ELEMENTS.statusMessage.innerHTML = 'Please refresh your meeting tab (F5) to activate the extension.';
            UI_ELEMENTS.statusMessage.style.color = '#ffc107';

            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content_script.js']
                });
                setTimeout(() => initializePopup(), 500);
            } catch (injectError) {
                UI_ELEMENTS.statusMessage.textContent = "Please refresh your meeting tab to activate the extension.";
                UI_ELEMENTS.statusMessage.style.color = '#dc3545';
            }
        } else {
            UI_ELEMENTS.statusMessage.textContent = "Connection error. Please refresh your meeting tab.";
            UI_ELEMENTS.statusMessage.style.color = '#dc3545';
        }
    }
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!UI_ELEMENTS.saveButton.disabled) {
            UI_ELEMENTS.saveButton.click();
        }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        if (!UI_ELEMENTS.copyButton.disabled) {
            UI_ELEMENTS.copyButton.click();
        }
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'v' && !e.target.matches('input, textarea')) {
        e.preventDefault();
        if (!UI_ELEMENTS.viewButton.disabled) {
            UI_ELEMENTS.viewButton.click();
        }
    }
});

// Listen for download failure notifications
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.message === 'download_failed') {
        alert(`Download failed: ${message.error || 'Unknown error'}\n\nPlease try again.`);
    }
    return false;
});

// --- Real-time Updates ---
let updateInterval = null;

async function updateLiveStats() {
    try {
        const tab = await getActiveMeetingTab();
        if (!tab) return;

        const status = await chrome.tabs.sendMessage(tab.id, { message: "get_status" });
        if (!status) return;

        // Update stats in real-time
        const captionCount = status.captionCount || 0;
        const attendeeCount = status.attendeeCount || 0;

        UI_ELEMENTS.captionsStat.textContent = captionCount;
        UI_ELEMENTS.attendeesStat.textContent = attendeeCount;

        // Only update meeting title/platform if in a meeting
        if (status.isInMeeting) {
            // Determine platform from tab URL using utility function
            const platformKey = detectPlatformFromUrl(tab.url);
            const platform = platformKey === 'teams' ? 'Teams' :
                            platformKey === 'meet' ? 'Meet' :
                            platformKey === 'zoom' ? 'Zoom' : 'Unknown';

            // Only update if we don't already have a title or if status provides one
            if (status.meetingTitle || UI_ELEMENTS.meetingTitle.textContent === 'No Active Meeting') {
                const meetingTitle = status.meetingTitle ||
                                    tab.title?.replace(/ - Microsoft Teams| - Google Meet| - Zoom Meeting/g, '') ||
                                    'Meeting';
                UI_ELEMENTS.meetingTitle.textContent = meetingTitle;
                UI_ELEMENTS.currentSessionTitle.textContent = meetingTitle;
            }

            UI_ELEMENTS.platformBadge.textContent = platform;
            UI_ELEMENTS.statusDot.style.display = 'block';
            UI_ELEMENTS.platformBadge.style.display = 'inline-block';

            const currentPlatform = UI_ELEMENTS.platformBadge.textContent || platform;
            UI_ELEMENTS.currentSessionSubtitle.textContent = `${currentPlatform} • ${captionCount} Captions • ${attendeeCount} Attendees`;
        } else {
            // Not in meeting
            UI_ELEMENTS.meetingTitle.textContent = 'No Active Meeting';
            UI_ELEMENTS.statusDot.style.display = 'none';
            UI_ELEMENTS.platformBadge.style.display = 'none';

            if (captionCount > 0 || attendeeCount > 0) {
                UI_ELEMENTS.currentSessionSubtitle.textContent = `Meeting Ended • ${captionCount} Captions • ${attendeeCount} Attendees`;
            } else {
                UI_ELEMENTS.currentSessionTitle.textContent = 'No Active Meeting';
                UI_ELEMENTS.currentSessionSubtitle.textContent = 'Join a meeting to start capturing';
            }
        }

        // Update button states
        const hasData = captionCount > 0 || (attendeeCount > 0 && status.isInMeeting === false);
        updateButtonStates(hasData, status.isInMeeting);

        // Update status message if needed
        await updateStatusUI(status);

    } catch (error) {
        // Silently fail - tab might have closed or navigation occurred
        console.debug('[Live Updates] Update failed:', error.message);
    }
}

function startLiveUpdates() {
    // Update every 2 seconds while popup is open
    if (!updateInterval) {
        updateInterval = setInterval(updateLiveStats, 2000);
    }
}

function stopLiveUpdates() {
    if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
    }
}

// --- Recording Transcript Management ---
async function loadRecordingTranscripts() {
    try {
        const { recording_transcripts = [] } = await chrome.storage.local.get('recording_transcripts');
        const now = new Date().toISOString();

        // Filter out expired transcripts
        const validTranscripts = recording_transcripts.filter(rec => rec.expiresAt > now);

        const section = document.getElementById('recording-section');
        const countEl = document.getElementById('recording-count');
        const listEl = document.getElementById('recordings-list');

        if (validTranscripts.length > 0) {
            section.style.display = 'block';
            countEl.textContent = validTranscripts.length;

            // Build recordings list
            listEl.innerHTML = validTranscripts.map(rec => {
                const capturedDate = new Date(rec.capturedAt);
                const timeAgo = getTimeAgo(capturedDate);

                return `
                    <div style="background: #f8f9fa; border-radius: 6px; padding: 10px; margin-bottom: 8px; border: 1px solid #e9ecef;">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-weight: 600; font-size: 12px; color: #333; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(rec.meetingTitle)}">
                                    ${escapeHtml(rec.meetingTitle)}
                                </div>
                                <div style="font-size: 10px; color: #6c757d;">
                                    Captured ${timeAgo}
                                </div>
                            </div>
                            <button class="delete-recording" data-id="${rec.id}" style="background: #dc3545; color: white; border: none; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 10px; flex-shrink: 0; margin-left: 8px;">
                                Delete
                            </button>
                        </div>
                        <div style="display: flex; gap: 4px;">
                            <button class="download-recording" data-id="${rec.id}" data-format="json" style="flex: 1; background: #0078d4; color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;">
                                JSON
                            </button>
                            <button class="download-recording" data-id="${rec.id}" data-format="txt" style="flex: 1; background: #28a745; color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;">
                                TXT
                            </button>
                            <button class="download-recording" data-id="${rec.id}" data-format="md" style="flex: 1; background: #6f42c1; color: white; border: none; padding: 5px; border-radius: 4px; cursor: pointer; font-size: 10px; font-weight: 500;">
                                MD
                            </button>
                        </div>
                    </div>
                `;
            }).join('');

            // Add event listeners
            document.querySelectorAll('.download-recording').forEach(btn => {
                btn.addEventListener('click', handleRecordingDownload);
            });

            document.querySelectorAll('.delete-recording').forEach(btn => {
                btn.addEventListener('click', handleRecordingDelete);
            });
        } else {
            section.style.display = 'none';
        }
    } catch (error) {
        console.error('[Popup] Failed to load recording transcripts:', error);
    }
}

// Note: getTimeAgo is defined earlier in the file (line ~1183)

async function handleRecordingDownload(e) {
    const id = e.target.dataset.id;
    const format = e.target.dataset.format;

    try {
        const { recording_transcripts = [] } = await chrome.storage.local.get('recording_transcripts');
        const recording = recording_transcripts.find(r => r.id === id);

        if (!recording) {
            alert('Recording not found');
            return;
        }

        // Download based on format
        await downloadRecordingTranscript(recording, format);
    } catch (error) {
        console.error('[Popup] Download failed:', error);
        alert('Failed to download recording transcript');
    }
}

async function handleRecordingDelete(e) {
    const id = e.target.dataset.id;

    if (!confirm('Delete this recording transcript?')) return;

    try {
        const { recording_transcripts = [] } = await chrome.storage.local.get('recording_transcripts');
        const filtered = recording_transcripts.filter(r => r.id !== id);

        await chrome.storage.local.set({ recording_transcripts: filtered });

        // Update badge
        chrome.runtime.sendMessage({
            message: 'update_recording_badge',
            count: filtered.length
        }, (response) => {
            // Silently ignore benign errors
            if (chrome.runtime.lastError && !chrome.runtime.lastError.message?.includes('message port closed')) {
                console.warn('[Popup] Error updating badge:', chrome.runtime.lastError.message);
            }
        });

        // Reload UI
        await loadRecordingTranscripts();
    } catch (error) {
        console.error('[Popup] Delete failed:', error);
        alert('Failed to delete recording transcript');
    }
}

async function downloadRecordingTranscript(recording, format) {
    try {
        console.log('[Download] Format requested:', format);
        let content, mimeType, extension;

        if (format === 'json') {
            // JSON format - full transcript data (raw Teams API response)
            content = JSON.stringify(recording.transcript, null, 2);
            mimeType = 'application/json';
            extension = 'json';
        } else if (format === 'txt' || format === 'md') {
            // Text/Markdown format - formatted transcript
            // Handle different possible transcript structures
            let entries = [];

            const transcript = recording.transcript;

            // Log the structure to help debug
            console.log('[Download] Transcript structure:', transcript);

            // Check if transcript has an entries array (Teams recording transcript format)
            if (transcript && transcript.entries && Array.isArray(transcript.entries)) {
                console.log('[Download] Using entries format, count:', transcript.entries.length);
                entries = transcript.entries.map(entry => {
                    // Parse timestamp from startOffset (format: "00:00:03.9178033")
                    let timestamp = 'Unknown Time';
                    if (entry.startOffset) {
                        // Extract HH:MM:SS from the offset
                        const timeParts = entry.startOffset.split(':');
                        if (timeParts.length >= 3) {
                            const hours = parseInt(timeParts[0]);
                            const minutes = timeParts[1];
                            const seconds = Math.floor(parseFloat(timeParts[2]));
                            timestamp = `${hours}:${minutes}:${seconds.toString().padStart(2, '0')}`;
                        }
                    }

                    // Get text directly from entry (no speaker info in recording transcripts)
                    const text = entry.text || '';

                    return { timestamp, text };
                });
            }
            // Check if transcript has a recognizedPhrases array (alternative Teams VTT format)
            else if (transcript && transcript.recognizedPhrases && Array.isArray(transcript.recognizedPhrases)) {
                console.log('[Download] Using recognizedPhrases format');
                entries = transcript.recognizedPhrases.map(entry => {
                    const timestamp = entry.offsetMilliseconds
                        ? new Date(entry.offsetMilliseconds).toLocaleTimeString()
                        : 'Unknown Time';
                    const speaker = entry.speaker || 'Unknown Speaker';
                    const text = entry.nBest?.[0]?.display || entry.text || '';
                    return { timestamp, text, speaker };
                });
            }
            // Fallback: try if it's an array of caption entries
            else if (Array.isArray(transcript)) {
                console.log('[Download] Using array format, entries:', transcript.length);
                entries = transcript.map(entry => {
                    const timestamp = entry.startTime
                        ? new Date(entry.startTime).toLocaleTimeString()
                        : (entry.offsetMilliseconds ? new Date(entry.offsetMilliseconds).toLocaleTimeString() : 'Unknown Time');
                    const speaker = entry.speaker || 'Unknown Speaker';
                    const text = entry.text || entry.display || '';
                    return { timestamp, text, speaker };
                });
            }
            // Last resort: just stringify it
            else {
                console.log('[Download] Using fallback - unrecognized format');
                entries = [{ timestamp: '', text: 'Raw transcript data (unrecognized format):\n\n' + JSON.stringify(transcript, null, 2) }];
            }

            // Format based on output type
            if (format === 'md') {
                // Markdown format with metadata
                content = `# ${recording.meetingTitle}\n\n`;
                content += `## Recording Information\n\n`;
                content += `**Platform:** Microsoft Teams (Recording)\n\n`;
                content += `**Total Entries:** ${entries.length}\n\n`;
                content += `**Captured:** ${new Date(recording.capturedAt).toLocaleString()}\n\n`;

                if (entries.length > 0 && entries[0].timestamp) {
                    content += `**First Entry:** ${entries[0].timestamp}\n\n`;
                    content += `**Last Entry:** ${entries[entries.length - 1].timestamp}\n\n`;
                }

                content += `**Exported:** ${new Date().toLocaleString()}\n\n`;
                content += `---\n\n`;
                content += `## Transcript\n\n`;

                entries.forEach(entry => {
                    if (entry.speaker) {
                        content += `> **[${entry.timestamp}] ${entry.speaker}:** ${entry.text}\n\n`;
                    } else {
                        content += `> **[${entry.timestamp}]** ${entry.text}\n\n`;
                    }
                });

                mimeType = 'text/markdown';
            } else {
                // Plain text format
                content = `Meeting: ${recording.meetingTitle}\n`;
                content += `Captured: ${new Date(recording.capturedAt).toLocaleString()}\n`;
                content += `\n${'='.repeat(60)}\n\n`;

                entries.forEach(entry => {
                    if (entry.speaker) {
                        content += `[${entry.timestamp}] ${entry.speaker}: ${entry.text}\n`;
                    } else {
                        content += `[${entry.timestamp}] ${entry.text}\n`;
                    }
                });

                mimeType = 'text/plain';
            }

            extension = format;
        }

        console.log('[Download] Extension set to:', extension);

        // Create blob and download
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        // Generate filename (consistent with service_worker.js sanitization)
        let cleanTitle = recording.meetingTitle || 'Recording';
        const parts = cleanTitle.split('|');
        const meetingName = parts.length > 2 ? parts[1] : parts[0];
        cleanTitle = meetingName.replace('Microsoft Teams', '').trim();
        cleanTitle = cleanTitle.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

        const timestamp = new Date(recording.capturedAt).toISOString().split('T')[0];
        const filename = `recording_${timestamp}_${cleanTitle}.${extension}`;

        console.log('[Download] Extension:', extension, 'Format:', format);
        console.log('[Download] Filename:', filename);

        // Send to service worker to handle the download with proper filename
        const downloadResponse = await chrome.runtime.sendMessage({
            message: 'download_blob',
            url: url,
            filename: filename
        });

        if (!downloadResponse || !downloadResponse.success) {
            throw new Error(downloadResponse?.error || 'Download failed');
        }

        // Clean up
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
        console.error('[Popup] Download recording failed:', error);
        throw error;
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initializePopup();

    // Load recording transcripts
    loadRecordingTranscripts();

    // Start live updates
    startLiveUpdates();

    // Periodically refresh sessions and recordings
    setInterval(async () => {
        await loadActiveSessions();
        await loadRecordingTranscripts();
    }, 30000);
});

// Stop updates when popup closes and clean up temporary storage
window.addEventListener('beforeunload', async () => {
    stopLiveUpdates();

    // Clean up temporary historicalSession_ keys to prevent orphaned storage
    try {
        const allKeys = await chrome.storage.local.get(null);
        const keysToRemove = Object.keys(allKeys).filter(key => key.startsWith('historicalSession_'));
        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
            console.log(`[Popup] Cleaned up ${keysToRemove.length} temporary session keys`);
        }
    } catch (error) {
        console.warn('[Popup] Failed to clean up temporary storage:', error);
    }
});
