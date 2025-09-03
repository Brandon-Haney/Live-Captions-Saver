// Session Manager - Handles multiple concurrent meeting sessions
// Supports Teams, Zoom, and Google Meet with live session tracking

class SessionManager {
    constructor() {
        this.sessions = new Map(); // Active sessions in memory
        this.MAX_SESSIONS = 20; // Support up to 20 concurrent meetings
        this.MAX_CHUNK_SIZE = 7000; // Stay under 8KB limit per key
        this.STORAGE_QUOTA = 8 * 1024 * 1024; // Reserve 8MB for sessions
        this.initializeFromStorage();
    }

    // Initialize sessions from storage on extension load
    async initializeFromStorage() {
        try {
            // First, migrate any old sessions to new format
            await this.migrateOldSessions();
            
            const { activeSessions = [] } = await chrome.storage.local.get('activeSessions');
            
            // Load metadata for each active session
            for (const sessionId of activeSessions) {
                const sessionData = await chrome.storage.local.get([
                    `${sessionId}_metadata`,
                    `${sessionId}_stats`
                ]);
                
                if (sessionData[`${sessionId}_metadata`]) {
                    this.sessions.set(sessionId, {
                        metadata: sessionData[`${sessionId}_metadata`],
                        stats: sessionData[`${sessionId}_stats`] || {}
                    });
                }
            }
            
            // Clean up stale sessions
            await this.cleanupStaleSessions();
        } catch (error) {
            console.error('[SessionManager] Error initializing:', error);
        }
    }

    // Migrate old session format to new format
    async migrateOldSessions() {
        try {
            // Check if we have old session_index
            const { session_index, migration_completed } = await chrome.storage.local.get(['session_index', 'migration_completed']);
            
            // Skip if already migrated or no old sessions
            if (migration_completed || !session_index || session_index.length === 0) {
                return;
            }
            
            console.log(`[SessionManager] Migrating ${session_index.length} old sessions to new format...`);
            
            const migratedSessions = [];
            
            for (const oldSession of session_index) {
                try {
                    // Convert old session ID to new format
                    const newSessionId = `session_migrated_${oldSession.id.replace('session_', '')}`;
                    
                    // Load old chunks
                    const chunkKeys = [];
                    for (let i = 0; i < (oldSession.chunkCount || 0); i++) {
                        chunkKeys.push(`${oldSession.id}_chunk_${i}`);
                    }
                    
                    const chunks = await chrome.storage.local.get(chunkKeys);
                    const transcriptArray = [];
                    
                    for (let i = 0; i < (oldSession.chunkCount || 0); i++) {
                        const chunk = chunks[`${oldSession.id}_chunk_${i}`];
                        if (chunk) {
                            transcriptArray.push(...chunk);
                        }
                    }
                    
                    // Load old attendee data
                    const attendeeData = await chrome.storage.local.get(`${oldSession.id}_attendees`);
                    const attendeeReport = attendeeData[`${oldSession.id}_attendees`] || null;
                    
                    // Determine platform from old data
                    let platform = 'teams'; // Default to teams for old sessions
                    if (oldSession.title && oldSession.title.toLowerCase().includes('zoom')) {
                        platform = 'zoom';
                    } else if (oldSession.title && oldSession.title.toLowerCase().includes('meet')) {
                        platform = 'meet';
                    }
                    
                    // Create new format metadata
                    const newMetadata = {
                        sessionId: newSessionId,
                        tabId: 'migrated',
                        platform: platform,
                        url: '',
                        meetingTitle: oldSession.title || 'Migrated Meeting',
                        startTime: oldSession.timestamp || new Date().toISOString(),
                        status: 'ended',
                        lastActivity: oldSession.timestamp || new Date().toISOString(),
                        endTime: oldSession.timestamp || new Date().toISOString(),
                        chunkCount: oldSession.chunkCount || 0
                    };
                    
                    // Create new format stats
                    const newStats = {
                        captionCount: oldSession.captionCount || transcriptArray.length || 0,
                        attendeeCount: oldSession.attendeeCount || 0,
                        chatCount: 0,
                        duration: this.parseDurationToSeconds(oldSession.duration || '0 min'),
                        speakers: oldSession.speakers || [],
                        speakerCount: oldSession.speakers ? oldSession.speakers.length : 0
                    };
                    
                    // Save in new format
                    await chrome.storage.local.set({
                        [`${newSessionId}_metadata`]: newMetadata,
                        [`${newSessionId}_stats`]: newStats
                    });
                    
                    // Save transcript chunks with new session ID
                    if (transcriptArray.length > 0) {
                        const newChunks = this.chunkTranscript(transcriptArray);
                        for (let i = 0; i < newChunks.length; i++) {
                            await chrome.storage.local.set({
                                [`${newSessionId}_chunk_${i}`]: newChunks[i]
                            });
                        }
                        newMetadata.chunkCount = newChunks.length;
                        
                        // Update metadata with new chunk count
                        await chrome.storage.local.set({
                            [`${newSessionId}_metadata`]: newMetadata
                        });
                    }
                    
                    // Save attendee data with new session ID
                    if (attendeeReport) {
                        await chrome.storage.local.set({
                            [`${newSessionId}_attendees`]: attendeeReport
                        });
                    }
                    
                    migratedSessions.push(newSessionId);
                    
                    // Clean up old data
                    const keysToDelete = [`${oldSession.id}_attendees`];
                    for (let i = 0; i < (oldSession.chunkCount || 0); i++) {
                        keysToDelete.push(`${oldSession.id}_chunk_${i}`);
                    }
                    await chrome.storage.local.remove(keysToDelete);
                    
                    console.log(`[SessionManager] Migrated session: ${oldSession.title}`);
                    
                } catch (error) {
                    console.error(`[SessionManager] Failed to migrate session ${oldSession.id}:`, error);
                }
            }
            
            // Save migration status and cleanup
            await chrome.storage.local.set({ 
                migration_completed: true,
                sessionHistory: migratedSessions 
            });
            
            // Remove old session_index
            await chrome.storage.local.remove('session_index');
            
            console.log(`[SessionManager] Migration completed. Migrated ${migratedSessions.length} sessions.`);
            
        } catch (error) {
            console.error('[SessionManager] Migration failed:', error);
        }
    }
    
    // Helper function to parse old duration format to seconds
    parseDurationToSeconds(durationStr) {
        if (!durationStr) return 0;
        
        // Parse formats like "45 min" or "1h 30m"
        const hourMatch = durationStr.match(/(\d+)h/);
        const minMatch = durationStr.match(/(\d+)\s*m/);
        
        let seconds = 0;
        if (hourMatch) {
            seconds += parseInt(hourMatch[1]) * 3600;
        }
        if (minMatch) {
            seconds += parseInt(minMatch[1]) * 60;
        }
        
        // If no matches, try to parse as just minutes
        if (!hourMatch && !minMatch) {
            const plainMinMatch = durationStr.match(/(\d+)/);
            if (plainMinMatch) {
                seconds = parseInt(plainMinMatch[1]) * 60;
            }
        }
        
        return seconds;
    }
    
    // Create a new session for a tab
    createSession(tabId, platform, url) {
        const sessionId = `session_${tabId}_${Date.now()}`;
        const session = {
            metadata: {
                sessionId,
                tabId,
                platform,
                url,
                meetingTitle: 'Untitled Meeting',
                startTime: new Date().toISOString(),
                status: 'active', // active, paused, ended
                lastActivity: new Date().toISOString()
            },
            stats: {
                captionCount: 0,
                attendeeCount: 0,
                chatCount: 0,
                duration: 0,
                speakers: new Set()
            }
        };

        this.sessions.set(sessionId, session);
        this.persistSession(sessionId);
        console.log(`[SessionManager] Created session ${sessionId} for ${platform}`);
        
        return sessionId;
    }

    // Get or create session for a tab
    getOrCreateSession(tabId, platform, url) {
        // Check if there's an active session for this tab
        const existingSession = this.getSessionByTabId(tabId);
        if (existingSession && existingSession.metadata.status === 'active') {
            return existingSession.sessionId;
        }
        
        // Create new session
        return this.createSession(tabId, platform, url);
    }

    // Get session by tab ID
    getSessionByTabId(tabId) {
        for (const [sessionId, session] of this.sessions) {
            if (session.metadata.tabId === tabId && session.metadata.status === 'active') {
                return { sessionId, ...session };
            }
        }
        return null;
    }

    // Calculate approximate size of data in bytes
    calculateSize(obj) {
        return new Blob([JSON.stringify(obj)]).size;
    }

    // Split large transcripts into chunks
    chunkTranscript(transcriptArray) {
        const chunks = [];
        let currentChunk = [];
        let currentSize = 0;

        for (const item of transcriptArray) {
            const itemSize = this.calculateSize(item);
            if (currentSize + itemSize > this.MAX_CHUNK_SIZE) {
                chunks.push([...currentChunk]);
                currentChunk = [item];
                currentSize = itemSize;
            } else {
                currentChunk.push(item);
                currentSize += itemSize;
            }
        }
        
        if (currentChunk.length > 0) {
            chunks.push(currentChunk);
        }
        
        return chunks;
    }

    // Update session with new data (transcript, attendees, etc.)
    async updateSession(sessionId, data) {
        if (!this.sessions.has(sessionId)) {
            console.warn(`[SessionManager] Session ${sessionId} not found`);
            return false;
        }

        const session = this.sessions.get(sessionId);
        
        // Update metadata
        if (data.metadata) {
            Object.assign(session.metadata, data.metadata);
            session.metadata.lastActivity = new Date().toISOString();
        }

        // Update stats
        if (data.stats) {
            Object.assign(session.stats, data.stats);
        }

        // Update transcript count
        if (data.captionCount !== undefined) {
            session.stats.captionCount = data.captionCount;
        }

        // Update attendee count
        if (data.attendeeCount !== undefined) {
            session.stats.attendeeCount = data.attendeeCount;
        }

        // Update speakers
        if (data.speakers) {
            session.stats.speakers = new Set(data.speakers);
        }

        // Calculate duration if session is active
        if (session.metadata.status === 'active') {
            const start = new Date(session.metadata.startTime);
            const now = new Date();
            session.stats.duration = Math.round((now - start) / 1000); // in seconds
        }

        // Persist to storage
        await this.persistSession(sessionId);
        
        return true;
    }

    // Persist session metadata to storage
    async persistSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return;

        try {
            // Save session metadata and stats
            await chrome.storage.local.set({
                [`${sessionId}_metadata`]: session.metadata,
                [`${sessionId}_stats`]: {
                    ...session.stats,
                    speakers: Array.from(session.stats.speakers || [])
                }
            });

            // Update active sessions list
            const activeSessions = Array.from(this.sessions.keys()).filter(id => {
                const s = this.sessions.get(id);
                return s && s.metadata.status === 'active';
            });
            await chrome.storage.local.set({ activeSessions });
        } catch (error) {
            console.error(`[SessionManager] Error persisting session ${sessionId}:`, error);
        }
    }

    // Save session transcript data
    async saveSessionTranscript(sessionId, transcriptArray, attendeeReport = null, chatMessages = null) {
        try {
            if (!this.sessions.has(sessionId)) {
                console.warn(`[SessionManager] Session ${sessionId} not found`);
                return false;
            }

            const chunks = this.chunkTranscript(transcriptArray);
            
            // Check storage quota before saving
            const currentUsage = await this.getStorageUsage();
            const newDataSize = this.calculateSize(chunks) + 
                               (attendeeReport ? this.calculateSize(attendeeReport) : 0) +
                               (chatMessages ? this.calculateSize(chatMessages) : 0);
            
            if (currentUsage + newDataSize > this.STORAGE_QUOTA) {
                // Need to clean up old sessions
                await this.cleanupOldSessions(newDataSize);
            }

            // Save transcript chunks
            const chunkPromises = chunks.map((chunk, index) => 
                chrome.storage.local.set({
                    [`${sessionId}_chunk_${index}`]: chunk
                })
            );
            await Promise.all(chunkPromises);

            // Save attendee data if exists
            if (attendeeReport) {
                await chrome.storage.local.set({
                    [`${sessionId}_attendees`]: attendeeReport
                });
            }

            // Save chat messages if exists
            if (chatMessages) {
                await chrome.storage.local.set({
                    [`${sessionId}_chat`]: chatMessages
                });
            }

            // Update session stats
            await this.updateSession(sessionId, {
                captionCount: transcriptArray.length,
                attendeeCount: attendeeReport?.totalUniqueAttendees || 0,
                chatCount: chatMessages?.length || 0,
                speakers: [...new Set(transcriptArray.map(c => c.Name).filter(n => n))],
                metadata: {
                    chunkCount: chunks.length
                }
            });
            
            console.log(`[SessionManager] Saved transcript for session ${sessionId} with ${chunks.length} chunks`);
            return true;
            
        } catch (error) {
            console.error('[SessionManager] Failed to save session transcript:', error);
            return false;
        }
    }

    // Load full session data from storage
    async loadSessionData(sessionId) {
        try {
            const session = this.sessions.get(sessionId);
            if (!session) {
                // Try loading from storage
                const metadataKey = `${sessionId}_metadata`;
                const stored = await chrome.storage.local.get(metadataKey);
                if (!stored[metadataKey]) {
                    throw new Error('Session not found');
                }
            }

            const metadata = session?.metadata || (await chrome.storage.local.get(`${sessionId}_metadata`))[`${sessionId}_metadata`];
            const stats = session?.stats || (await chrome.storage.local.get(`${sessionId}_stats`))[`${sessionId}_stats`] || {};
            
            // Load all chunks
            const chunkKeys = [];
            const chunkCount = metadata.chunkCount || 0;
            for (let i = 0; i < chunkCount; i++) {
                chunkKeys.push(`${sessionId}_chunk_${i}`);
            }
            
            const chunks = await chrome.storage.local.get(chunkKeys);
            const transcriptArray = [];
            
            for (let i = 0; i < chunkCount; i++) {
                const chunk = chunks[`${sessionId}_chunk_${i}`];
                if (chunk) {
                    transcriptArray.push(...chunk);
                }
            }

            // Load attendee data if exists
            const attendeeData = await chrome.storage.local.get(`${sessionId}_attendees`);
            const chatData = await chrome.storage.local.get(`${sessionId}_chat`);
            
            return {
                metadata,
                stats,
                transcript: transcriptArray,
                attendeeReport: attendeeData[`${sessionId}_attendees`] || null,
                chatMessages: chatData[`${sessionId}_chat`] || []
            };
            
        } catch (error) {
            console.error('[SessionManager] Failed to load session:', error);
            throw error;
        }
    }

    // Get all active sessions
    getActiveSessions() {
        const activeSessions = [];
        for (const [sessionId, session] of this.sessions) {
            if (session.metadata.status === 'active') {
                activeSessions.push({
                    sessionId,
                    ...session.metadata,
                    ...session.stats,
                    speakers: Array.from(session.stats.speakers || [])
                });
            }
        }
        return activeSessions;
    }

    // End a session
    async endSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            return false;
        }

        const session = this.sessions.get(sessionId);
        session.metadata.status = 'ended';
        session.metadata.endTime = new Date().toISOString();
        
        // Calculate final duration
        const start = new Date(session.metadata.startTime);
        const end = new Date(session.metadata.endTime);
        session.stats.duration = Math.round((end - start) / 1000); // in seconds

        await this.persistSession(sessionId);
        console.log(`[SessionManager] Ended session ${sessionId}`);
        
        return true;
    }

    // Delete a session
    async deleteSession(sessionId) {
        try {
            // Get metadata to find chunk count
            const metadata = this.sessions.get(sessionId)?.metadata;
            const chunkCount = metadata?.chunkCount || 0;
            
            // Delete all session data
            const keysToDelete = [
                `${sessionId}_metadata`,
                `${sessionId}_stats`,
                `${sessionId}_attendees`,
                `${sessionId}_chat`
            ];
            
            // Add chunk keys
            for (let i = 0; i < chunkCount; i++) {
                keysToDelete.push(`${sessionId}_chunk_${i}`);
            }
            
            await chrome.storage.local.remove(keysToDelete);
            
            // Remove from memory
            this.sessions.delete(sessionId);
            
            // Update active sessions list
            const activeSessions = Array.from(this.sessions.keys()).filter(id => {
                const s = this.sessions.get(id);
                return s && s.metadata.status === 'active';
            });
            await chrome.storage.local.set({ activeSessions });
            
            console.log(`[SessionManager] Deleted session ${sessionId}`);
            
        } catch (error) {
            console.error('[SessionManager] Failed to delete session:', error);
        }
    }

    // Get list of all sessions (active and ended)
    async getAllSessions() {
        const allSessions = [];
        const sessionIds = new Set();
        
        // Get from memory first (active sessions)
        for (const [sessionId, session] of this.sessions) {
            allSessions.push({
                sessionId,
                ...session.metadata,
                ...session.stats,
                speakers: Array.from(session.stats.speakers || [])
            });
            sessionIds.add(sessionId);
        }
        
        // Get migrated sessions from storage
        const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
        for (const sessionId of sessionHistory) {
            if (!sessionIds.has(sessionId)) {
                try {
                    const metadata = await chrome.storage.local.get(`${sessionId}_metadata`);
                    const stats = await chrome.storage.local.get(`${sessionId}_stats`);
                    
                    if (metadata[`${sessionId}_metadata`]) {
                        const session = {
                            sessionId,
                            ...metadata[`${sessionId}_metadata`],
                            ...(stats[`${sessionId}_stats`] || {}),
                            speakers: Array.from(stats[`${sessionId}_stats`]?.speakers || [])
                        };
                        allSessions.push(session);
                        sessionIds.add(sessionId);
                    }
                } catch (error) {
                    console.error(`Failed to load session ${sessionId}:`, error);
                }
            }
        }
        
        // Also scan for any other sessions in storage (fallback)
        const allKeys = await chrome.storage.local.get(null);
        for (const key in allKeys) {
            if (key.endsWith('_metadata') && !key.includes('chunk')) {
                const sessionId = key.replace('_metadata', '');
                if (!sessionIds.has(sessionId)) {
                    try {
                        const metadata = allKeys[key];
                        const statsKey = `${sessionId}_stats`;
                        const stats = allKeys[statsKey] || {};
                        
                        allSessions.push({
                            sessionId,
                            ...metadata,
                            ...stats,
                            speakers: Array.from(stats.speakers || [])
                        });
                    } catch (error) {
                        console.error(`Failed to load session from key ${key}:`, error);
                    }
                }
            }
        }
        
        // Sort by start time (newest first)
        allSessions.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));
        
        return allSessions;
    }

    // Clean up stale sessions (older than 24 hours and ended)
    async cleanupStaleSessions() {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const sessionsToDelete = [];

        for (const [sessionId, session] of this.sessions) {
            const lastActivity = new Date(session.metadata.lastActivity);
            if (lastActivity < oneDayAgo && session.metadata.status === 'ended') {
                sessionsToDelete.push(sessionId);
            }
        }

        for (const sessionId of sessionsToDelete) {
            await this.deleteSession(sessionId);
        }

        if (sessionsToDelete.length > 0) {
            console.log(`[SessionManager] Cleaned up ${sessionsToDelete.length} stale sessions`);
        }
    }

    // Format duration for display
    formatDuration(seconds) {
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

    // Detect meeting title from DOM
    detectMeetingTitle(sessionId, platform) {
        const session = this.sessions.get(sessionId);
        if (!session) return 'Untitled Meeting';

        let meetingTitle = 'Untitled Meeting';
        
        try {
            switch(platform) {
                case 'teams':
                    const teamsTitle = document.querySelector('.meeting-title, [data-tid="meeting-title"], .ts-meeting-title');
                    if (teamsTitle) {
                        meetingTitle = teamsTitle.textContent.trim();
                    }
                    break;
                    
                case 'zoom':
                    const zoomTitle = document.querySelector('.meeting-title, .zm-modal-header-title, [aria-label*="Meeting topic"]');
                    if (zoomTitle) {
                        meetingTitle = zoomTitle.textContent.trim();
                    }
                    break;
                    
                case 'meet':
                    // Google Meet often uses meeting code
                    const meetTitle = document.querySelector('[data-meeting-code], .rG0ybd, .roSPhc');
                    if (meetTitle) {
                        meetingTitle = meetTitle.textContent.trim();
                    }
                    break;
            }
        } catch (error) {
            console.warn('[SessionManager] Could not detect meeting title:', error);
        }

        if (meetingTitle !== 'Untitled Meeting') {
            session.metadata.meetingTitle = meetingTitle;
            this.persistSession(sessionId);
        }
        
        return meetingTitle;
    }

    // Get current storage usage
    async getStorageUsage() {
        const items = await chrome.storage.local.get(null);
        let totalSize = 0;
        
        for (const key in items) {
            if (key.startsWith('session_')) {
                totalSize += this.calculateSize(items[key]);
            }
        }
        
        return totalSize;
    }

    // Clean up old sessions to make room
    async cleanupOldSessions(requiredSpace) {
        const allSessions = await this.getAllSessions();
        let freedSpace = 0;
        
        // Delete oldest ended sessions first
        const endedSessions = allSessions.filter(s => s.status === 'ended');
        endedSessions.sort((a, b) => new Date(a.startTime) - new Date(b.startTime)); // Oldest first
        
        for (const session of endedSessions) {
            if (freedSpace >= requiredSpace) break;
            
            const size = await this.getSessionSize(session.sessionId);
            freedSpace += size;
            await this.deleteSession(session.sessionId);
        }
    }

    // Get size of a session in storage
    async getSessionSize(sessionId) {
        try {
            const session = this.sessions.get(sessionId);
            const chunkCount = session?.metadata?.chunkCount || 0;
            
            const keys = [
                `${sessionId}_metadata`,
                `${sessionId}_stats`,
                `${sessionId}_attendees`,
                `${sessionId}_chat`
            ];
            
            for (let i = 0; i < chunkCount; i++) {
                keys.push(`${sessionId}_chunk_${i}`);
            }
            
            const data = await chrome.storage.local.get(keys);
            return this.calculateSize(data);
        } catch (error) {
            return 0;
        }
    }

    // Get storage statistics
    async getStorageStats() {
        const usage = await this.getStorageUsage();
        const allSessions = await this.getAllSessions();
        
        // Sort sessions by start time to get oldest and newest
        const sortedSessions = allSessions.sort((a, b) => 
            new Date(a.startTime || 0) - new Date(b.startTime || 0)
        );
        
        return {
            usedBytes: usage,
            usedMB: (usage / (1024 * 1024)).toFixed(2),
            quotaMB: (this.STORAGE_QUOTA / (1024 * 1024)).toFixed(2),
            percentUsed: ((usage / this.STORAGE_QUOTA) * 100).toFixed(1),
            sessionCount: allSessions.length,
            oldestSession: sortedSessions[0]?.startTime ? new Date(sortedSessions[0].startTime).toLocaleDateString() : 'N/A',
            newestSession: sortedSessions[sortedSessions.length - 1]?.startTime ? new Date(sortedSessions[sortedSessions.length - 1].startTime).toLocaleDateString() : 'N/A'
        };
    }

    // Export all active sessions
    async exportAllActiveSessions() {
        const activeSessions = this.getActiveSessions();
        const allData = [];
        
        for (const sessionInfo of activeSessions) {
            const data = await this.loadSessionData(sessionInfo.sessionId);
            if (data) {
                allData.push({
                    ...sessionInfo,
                    transcript: data.transcript,
                    attendeeReport: data.attendeeReport,
                    chatMessages: data.chatMessages
                });
            }
        }
        
        return allData;
    }

    // Reset migration (for testing/debugging)
    async resetMigration() {
        await chrome.storage.local.remove(['migration_completed']);
        console.log('[SessionManager] Migration reset. Will re-migrate on next load.');
    }
    
    // Clear all sessions
    async clearAllSessions() {
        const allSessions = await this.getAllSessions();
        
        for (const session of allSessions) {
            await this.deleteSession(session.sessionId);
        }
        
        await chrome.storage.local.set({ 
            'activeSessions': [],
            'sessionHistory': []
        });
        this.sessions.clear();
        console.log('[SessionManager] Cleared all sessions');
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SessionManager;
}