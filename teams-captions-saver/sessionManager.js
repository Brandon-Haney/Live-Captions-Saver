// Session Manager - Handles multiple concurrent meeting sessions
// Supports Teams, Zoom, and Google Meet with live session tracking

// Wrap class definition to avoid redeclaration errors
(function() {
    // Skip if already defined (can happen when loaded in both service worker and popup)
    if (typeof self.SessionManager !== 'undefined') {
        return;
    }

class SessionManager {
    constructor() {
        this.sessions = new Map(); // Active sessions in memory
        this.MAX_SESSIONS = 20; // Support up to 20 concurrent meetings
        this.MAX_CHUNK_SIZE = 7000; // Stay under 8KB limit per key
        this.STORAGE_QUOTA = 8 * 1024 * 1024; // Reserve 8MB for sessions
        this._initialized = false; // Track initialization state
        this._initPromise = this.initializeFromStorage(); // Store promise for awaiting
        this._sessionLocks = new Map(); // Per-session locks to prevent read/write conflicts
        this._emergencyCleanupInProgress = false; // Guard against concurrent emergency cleanup
    }

    // Acquire a lock for a specific session (prevents concurrent read/write)
    async _acquireSessionLock(sessionId, timeout = 10000) {
        const startTime = Date.now();
        while (this._sessionLocks.get(sessionId)) {
            if (Date.now() - startTime > timeout) {
                console.warn(`[SessionManager] Lock timeout for session ${sessionId}`);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        this._sessionLocks.set(sessionId, true);
        return true;
    }

    // Release a session lock
    _releaseSessionLock(sessionId) {
        this._sessionLocks.delete(sessionId);
    }

    // Ensure initialization is complete before operations
    async ensureInitialized() {
        if (!this._initialized) {
            await this._initPromise;
        }
    }

    // Initialize sessions from storage on extension load
    async initializeFromStorage() {
        try {
            // First, migrate any old sessions to new format
            await this.migrateOldSessions();

            // Fix any incorrectly detected platforms
            await this.fixSessionPlatforms();

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
            this._initialized = true; // Mark as initialized
        } catch (error) {
            console.error('[SessionManager] Error initializing:', error);
            this._initialized = true; // Still mark as initialized to prevent infinite waiting
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
                        // Validate chunk is array before spreading
                        if (chunk && Array.isArray(chunk)) {
                            transcriptArray.push(...chunk);
                        }
                    }
                    
                    // Load old attendee data
                    const attendeeData = await chrome.storage.local.get(`${oldSession.id}_attendees`);
                    const attendeeReport = attendeeData[`${oldSession.id}_attendees`] || null;
                    
                    // Determine platform from old data
                    // Default to teams for old sessions (since this extension was originally Teams-only)
                    let platform = 'teams';
                    // Use specific patterns to avoid false positives
                    // e.g., "Zoom Meeting" should match, but "Let's zoom in on..." should not
                    if (oldSession.title) {
                        const titleLower = oldSession.title.toLowerCase();
                        // Check for Zoom - match "zoom meeting", "zoom call", standalone "zoom" at word boundary
                        if (/\bzoom\s+(meeting|call|webinar)\b/i.test(oldSession.title) ||
                            /^zoom\b/i.test(oldSession.title)) {
                            platform = 'zoom';
                        // Check for Google Meet - match explicit "google meet" or meet.google URLs
                        } else if (/\bgoogle\s+meet\b/i.test(oldSession.title) ||
                                   /meet\.google\.com/i.test(oldSession.title)) {
                            platform = 'meet';
                        }
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
            const hours = parseInt(hourMatch[1], 10);
            if (!isNaN(hours)) {
                seconds += hours * 3600;
            }
        }
        if (minMatch) {
            const mins = parseInt(minMatch[1], 10);
            if (!isNaN(mins)) {
                seconds += mins * 60;
            }
        }

        // If no matches, try to parse as just minutes
        if (!hourMatch && !minMatch) {
            const plainMinMatch = durationStr.match(/(\d+)/);
            if (plainMinMatch) {
                const mins = parseInt(plainMinMatch[1], 10);
                if (!isNaN(mins)) {
                    seconds = mins * 60;
                }
            }
        }

        return seconds;
    }

    // Validate sessionId format
    isValidSessionId(sessionId) {
        if (!sessionId || typeof sessionId !== 'string') return false;
        // Valid formats: session_tabId_timestamp or session_migrated_timestamp
        return /^session_(\d+_\d+|migrated_\d+)$/.test(sessionId);
    }

    // Safely extract timestamp from sessionId
    extractTimestampFromSessionId(sessionId) {
        if (!sessionId || typeof sessionId !== 'string') return null;

        // Handle session_migrated_timestamp format
        if (sessionId.startsWith('session_migrated_')) {
            const timestampStr = sessionId.replace('session_migrated_', '');
            const timestamp = parseInt(timestampStr, 10);
            return isNaN(timestamp) ? null : timestamp;
        }

        // Handle session_tabId_timestamp format
        const parts = sessionId.split('_');
        if (parts.length === 3 && parts[0] === 'session') {
            const timestamp = parseInt(parts[2], 10);
            return isNaN(timestamp) ? null : timestamp;
        }

        return null;
    }

    // Create a new session for a tab
    async createSession(tabId, platform, url) {
        await this.ensureInitialized(); // Wait for initialization before creating sessions
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
                speakers: [] // Use array instead of Set for JSON serialization compatibility
            }
        };

        this.sessions.set(sessionId, session);
        // Don't persist to storage yet - wait until we have actual content
        console.log(`[SessionManager] Created session ${sessionId} for ${platform} (not persisted yet)`);
        
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
        
        // Update meeting title if provided
        if (data.meetingTitle && data.meetingTitle !== 'Untitled Meeting') {
            session.metadata.meetingTitle = data.meetingTitle;
            console.log(`[SessionManager] Updated meeting title: ${data.meetingTitle}`);
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

        // Update speakers (use array for JSON compatibility)
        if (data.speakers) {
            // Ensure unique speakers using Set, then convert back to array
            session.stats.speakers = [...new Set(data.speakers)];
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

        // Only persist sessions with actual content
        if (session.stats.captionCount === 0 && session.stats.attendeeCount === 0) {
            console.log(`[SessionManager] Skipping persist for empty session ${sessionId}`);
            return;
        }

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
        // Skip chunking if transcript is empty
        if (!transcriptArray || transcriptArray.length === 0) {
            return true; // Nothing to save, but not an error
        }

        // Acquire lock to prevent concurrent read/write
        const lockAcquired = await this._acquireSessionLock(sessionId);
        if (!lockAcquired) {
            console.error(`[SessionManager] Could not acquire lock for session ${sessionId}`);
            return false;
        }

        try {
            if (!this.sessions.has(sessionId)) {
                console.warn(`[SessionManager] Session ${sessionId} not found`);
                return false;
            }

            // Check storage quota BEFORE chunking to avoid wasted memory
            let currentUsage = 0;
            if (chrome.storage.local.getBytesInUse) {
                try {
                    currentUsage = await chrome.storage.local.getBytesInUse(null);
                } catch (error) {
                    currentUsage = await this.getStorageUsage();
                }
            } else {
                currentUsage = await this.getStorageUsage();
            }

            // Estimate new data size before chunking (rough estimate based on JSON size)
            const estimatedTranscriptSize = this.calculateSize(transcriptArray);
            const estimatedAttendeeSize = attendeeReport ? this.calculateSize(attendeeReport) : 0;
            const estimatedChatSize = chatMessages ? this.calculateSize(chatMessages) : 0;
            const estimatedNewDataSize = estimatedTranscriptSize + estimatedAttendeeSize + estimatedChatSize;

            // Use 7MB as safe limit to leave room for other data
            const SAFE_QUOTA = 7 * 1024 * 1024;

            if (currentUsage + estimatedNewDataSize > SAFE_QUOTA) {
                console.log(`[SessionManager] Storage cleanup needed. Current: ${(currentUsage / 1024 / 1024).toFixed(2)}MB, Estimated new data: ${(estimatedNewDataSize / 1024 / 1024).toFixed(2)}MB`);
                // Need to clean up old sessions - free up enough space plus 1MB buffer
                await this.cleanupOldSessions(estimatedNewDataSize + 1024 * 1024);
            }

            // Now chunk the transcript after quota check passes
            const chunks = this.chunkTranscript(transcriptArray);

            // Save transcript chunks using Promise.allSettled to handle partial failures
            const chunkPromises = chunks.map((chunk, index) =>
                chrome.storage.local.set({
                    [`${sessionId}_chunk_${index}`]: chunk
                }).then(() => ({ index, success: true }))
                  .catch(error => ({ index, success: false, error }))
            );
            const chunkResults = await Promise.allSettled(chunkPromises);

            // Check which chunks actually saved successfully
            const successfulChunks = [];
            const failedChunks = [];
            for (const result of chunkResults) {
                if (result.status === 'fulfilled' && result.value.success) {
                    successfulChunks.push(result.value.index);
                } else {
                    const chunkInfo = result.status === 'fulfilled' ? result.value : { index: -1, error: result.reason };
                    failedChunks.push(chunkInfo);
                }
            }

            // If any chunks failed, log warning but continue with what we have
            if (failedChunks.length > 0) {
                console.warn(`[SessionManager] ${failedChunks.length}/${chunks.length} chunks failed to save for session ${sessionId}`);
                // If ALL chunks failed, this is a critical error
                if (successfulChunks.length === 0) {
                    throw new Error(`All ${chunks.length} chunks failed to save`);
                }
            }

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

            // Update session stats - use actual saved chunk count, not intended count
            // This ensures metadata matches what's actually in storage
            const actualChunkCount = successfulChunks.length;
            await this.updateSession(sessionId, {
                captionCount: transcriptArray.length,
                attendeeCount: attendeeReport?.totalUniqueAttendees || 0,
                chatCount: chatMessages?.length || 0,
                speakers: [...new Set(transcriptArray.map(c => c.Name).filter(n => n))],
                metadata: {
                    chunkCount: actualChunkCount,
                    partialSave: failedChunks.length > 0 // Flag if some data was lost
                }
            });

            if (failedChunks.length > 0) {
                console.log(`[SessionManager] Partial save: ${actualChunkCount}/${chunks.length} chunks saved for session ${sessionId}`);
            } else {
                console.log(`[SessionManager] Saved transcript for session ${sessionId} with ${chunks.length} chunks`);
            }
            return true;

        } catch (error) {
            console.error('[SessionManager] Failed to save session transcript:', error);
            return false;
        } finally {
            // Always release the lock
            this._releaseSessionLock(sessionId);
        }
    }

    // Load full session data from storage
    async loadSessionData(sessionId) {
        await this.ensureInitialized(); // Wait for initialization before loading

        // Acquire lock to prevent reading while write is in progress
        const lockAcquired = await this._acquireSessionLock(sessionId);
        if (!lockAcquired) {
            throw new Error(`Could not acquire lock for session ${sessionId} - save may be in progress`);
        }

        try {
            const session = this.sessions.get(sessionId);
            let metadata = null;
            let stats = {};

            if (session) {
                metadata = session.metadata;
                stats = session.stats;
            } else {
                // Try loading from storage
                const metadataKey = `${sessionId}_metadata`;
                const stored = await chrome.storage.local.get(metadataKey);
                if (stored[metadataKey]) {
                    metadata = stored[metadataKey];
                    const statsData = await chrome.storage.local.get(`${sessionId}_stats`);
                    stats = statsData[`${sessionId}_stats`] || {};
                }
            }

            // If no metadata found, check if this is an orphaned migrated session
            if (!metadata && sessionId.includes('session_migrated_')) {
                console.log(`[SessionManager] Loading orphaned migrated session: ${sessionId}`);
                // Get all storage to find chunks
                const allKeys = await chrome.storage.local.get(null);

                // Find chunk count
                let maxChunkIndex = -1;
                for (const key in allKeys) {
                    if (key.startsWith(`${sessionId}_chunk_`)) {
                        const chunkIndex = parseInt(key.replace(`${sessionId}_chunk_`, ''));
                        if (!isNaN(chunkIndex)) {
                            maxChunkIndex = Math.max(maxChunkIndex, chunkIndex);
                        }
                    }
                }

                if (maxChunkIndex >= 0) {
                    // Create basic metadata for orphaned session (uses SM-9 safe extraction)
                    const timestamp = this.extractTimestampFromSessionId(sessionId);
                    metadata = {
                        sessionId,
                        chunkCount: maxChunkIndex + 1,
                        meetingTitle: 'Migrated Meeting',
                        startTime: timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
                        status: 'ended'
                    };
                } else {
                    throw new Error('Session not found');
                }
            }

            if (!metadata) {
                throw new Error('Session metadata not found');
            }
            
            // Load all chunks
            const chunkKeys = [];
            const chunkCount = metadata.chunkCount || 0;

            // Validate chunk count
            if (typeof chunkCount !== 'number' || chunkCount < 0 || isNaN(chunkCount)) {
                console.error(`[SessionManager] Invalid chunkCount: ${chunkCount} for session ${sessionId}`);
                throw new Error('Corrupted session metadata: invalid chunkCount');
            }

            for (let i = 0; i < chunkCount; i++) {
                chunkKeys.push(`${sessionId}_chunk_${i}`);
            }

            const chunks = await chrome.storage.local.get(chunkKeys);
            const transcriptArray = [];
            let missingChunks = [];

            for (let i = 0; i < chunkCount; i++) {
                const chunk = chunks[`${sessionId}_chunk_${i}`];
                // Validate chunk is array before spreading
                if (chunk && Array.isArray(chunk)) {
                    transcriptArray.push(...chunk);
                } else if (chunk) {
                    console.warn(`[SessionManager] Chunk ${i} is not an array:`, typeof chunk);
                } else {
                    missingChunks.push(i);
                }
            }

            // Warn about missing chunks but don't fail - return partial data
            if (missingChunks.length > 0) {
                console.warn(`[SessionManager] Missing ${missingChunks.length} chunks for session ${sessionId}: [${missingChunks.join(', ')}]`);
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
        } finally {
            // Always release the lock
            this._releaseSessionLock(sessionId);
        }
    }

    // Get all active sessions
    async getActiveSessions() {
        await this.ensureInitialized(); // Wait for initialization before getting sessions
        const activeSessions = [];
        for (const [sessionId, session] of this.sessions) {
            if (session?.metadata?.status === 'active') {
                activeSessions.push({
                    sessionId,
                    ...session.metadata,
                    ...session.stats,
                    speakers: Array.from(session.stats.speakers || []),
                    lastUpdate: session.metadata.lastActivity || session.metadata.startTime
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
        
        // Check if session has any content
        if (session.stats.captionCount === 0 && session.stats.attendeeCount === 0) {
            console.log(`[SessionManager] Session ${sessionId} has no content, deleting instead of ending`);
            return await this.deleteSession(sessionId);
        }
        
        session.metadata.status = 'ended';
        session.metadata.endTime = new Date().toISOString();
        
        // Calculate final duration
        const start = new Date(session.metadata.startTime);
        const end = new Date(session.metadata.endTime);
        session.stats.duration = Math.round((end - start) / 1000); // in seconds

        await this.persistSession(sessionId);
        
        // Add to session history
        const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
        if (!sessionHistory.includes(sessionId)) {
            sessionHistory.push(sessionId);
            await chrome.storage.local.set({ sessionHistory });
            console.log(`[SessionManager] Added session ${sessionId} to history`);
        }
        
        console.log(`[SessionManager] Ended session ${sessionId} with ${session.stats.captionCount} captions`);
        
        return true;
    }

    // Delete a session
    async deleteSession(sessionId) {
        try {
            console.log(`[SessionManager] Deleting session: ${sessionId}`);

            // Images (slides, embedded chat attachments) live in IndexedDB; drop them with the session
            if (typeof ImageStore !== 'undefined' && ImageStore.deleteBySession) {
                ImageStore.deleteBySession(sessionId)
                    .then(n => { if (n) console.log(`[SessionManager] Removed ${n} image(s) for session ${sessionId}`); })
                    .catch(err => console.warn('[SessionManager] Image cleanup failed:', err));
            }

            // Get metadata from memory or storage
            let metadata = this.sessions.get(sessionId)?.metadata;
            let chunkCount = 0;

            // If not in memory, try loading from storage
            if (!metadata) {
                const storedMetadata = await chrome.storage.local.get(`${sessionId}_metadata`);
                metadata = storedMetadata[`${sessionId}_metadata`];
                if (metadata) {
                    chunkCount = metadata.chunkCount || 0;
                }
            } else {
                chunkCount = metadata.chunkCount || 0;
            }

            // If still no metadata, scan for chunks to find all related keys
            const allKeys = await chrome.storage.local.get(null);
            const keysToDelete = [];

            // Find all keys related to this session
            for (const key in allKeys) {
                if (key.startsWith(sessionId)) {
                    keysToDelete.push(key);
                    console.log(`[SessionManager] Found key to delete: ${key}`);
                }
            }

            // Also explicitly add standard keys
            const standardKeys = [
                `${sessionId}_metadata`,
                `${sessionId}_stats`,
                `${sessionId}_attendees`,
                `${sessionId}_chat`
            ];

            for (const key of standardKeys) {
                if (!keysToDelete.includes(key)) {
                    keysToDelete.push(key);
                }
            }

            // Add chunk keys based on chunk count if we found it
            if (chunkCount > 0) {
                for (let i = 0; i < chunkCount; i++) {
                    const chunkKey = `${sessionId}_chunk_${i}`;
                    if (!keysToDelete.includes(chunkKey)) {
                        keysToDelete.push(chunkKey);
                    }
                }
            }

            console.log(`[SessionManager] Deleting ${keysToDelete.length} keys for session ${sessionId}`);

            // Delete all found keys
            if (keysToDelete.length > 0) {
                await chrome.storage.local.remove(keysToDelete);
            }

            // Remove from memory
            this.sessions.delete(sessionId);

            // Update active sessions list
            const activeSessions = Array.from(this.sessions.keys()).filter(id => {
                const s = this.sessions.get(id);
                return s && s.metadata.status === 'active';
            });
            await chrome.storage.local.set({ activeSessions });

            // Also update sessionHistory to remove this session
            const { sessionHistory = [] } = await chrome.storage.local.get('sessionHistory');
            const updatedHistory = sessionHistory.filter(id => id !== sessionId);
            if (updatedHistory.length !== sessionHistory.length) {
                await chrome.storage.local.set({ sessionHistory: updatedHistory });
                console.log(`[SessionManager] Removed ${sessionId} from sessionHistory`);
            }

            console.log(`[SessionManager] Successfully deleted session ${sessionId}`);
            
        } catch (error) {
            console.error('[SessionManager] Failed to delete session:', error);
        }
    }

    // Get list of all sessions (active and ended)
    async getAllSessions() {
        await this.ensureInitialized(); // Wait for initialization before getting sessions
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
        // This is important for finding migrated sessions and sessions not in history
        const allKeys = await chrome.storage.local.get(null);

        // First look for sessions with _metadata
        for (const key in allKeys) {
            if (key.endsWith('_metadata') && !key.includes('chunk')) {
                const sessionId = key.replace('_metadata', '');
                if (!sessionIds.has(sessionId)) {
                    try {
                        const metadata = allKeys[key];
                        const statsKey = `${sessionId}_stats`;
                        const stats = allKeys[statsKey] || {};

                        console.log(`[SessionManager] Found session with metadata: ${sessionId}`);

                        allSessions.push({
                            sessionId,
                            ...metadata,
                            ...stats,
                            speakers: Array.from(stats.speakers || [])
                        });
                        sessionIds.add(sessionId);
                    } catch (error) {
                        console.error(`Failed to load session from key ${key}:`, error);
                    }
                }
            }
        }

        // NEW: Reconstruct sessions from chunks if no metadata exists (for migrated sessions)
        // Find all unique session IDs from chunk keys
        const orphanedSessionIds = new Set();
        for (const key in allKeys) {
            if (key.includes('session_migrated_') && key.includes('_chunk_')) {
                // Extract session ID from keys like session_migrated_1755108101254_chunk_0
                const match = key.match(/(session_migrated_\d+)_chunk_/);
                if (match && !sessionIds.has(match[1])) {
                    orphanedSessionIds.add(match[1]);
                }
            }
        }

        console.log(`[SessionManager] Found ${orphanedSessionIds.size} orphaned migrated sessions to reconstruct`);

        // Reconstruct metadata for orphaned sessions
        for (const sessionId of orphanedSessionIds) {
            try {
                // Load all chunks for this session
                const chunkKeys = [];
                let maxChunkIndex = -1;

                // Find all chunk keys for this session
                for (const key in allKeys) {
                    if (key.startsWith(`${sessionId}_chunk_`)) {
                        const chunkIndex = parseInt(key.replace(`${sessionId}_chunk_`, ''));
                        if (!isNaN(chunkIndex)) {
                            maxChunkIndex = Math.max(maxChunkIndex, chunkIndex);
                            chunkKeys.push(key);
                        }
                    }
                }

                if (chunkKeys.length === 0) continue;

                // Load first chunk to get sample data
                const firstChunk = allKeys[`${sessionId}_chunk_0`] || [];
                if (!firstChunk || firstChunk.length === 0) continue;

                // Extract info from first caption
                const firstCaption = firstChunk[0];
                const lastChunk = allKeys[`${sessionId}_chunk_${maxChunkIndex}`] || [];
                const lastCaption = lastChunk[lastChunk.length - 1] || firstCaption;

                // Count total captions
                let totalCaptions = 0;
                let speakers = new Set();
                for (const chunkKey of chunkKeys) {
                    const chunk = allKeys[chunkKey];
                    if (Array.isArray(chunk)) {
                        totalCaptions += chunk.length;
                        chunk.forEach(caption => {
                            if (caption.Name) speakers.add(caption.Name);
                        });
                    }
                }

                // Create reconstructed session info (uses SM-9 safe extraction)
                const timestamp = this.extractTimestampFromSessionId(sessionId);
                const fallbackTime = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
                const reconstructedSession = {
                    sessionId,
                    tabId: 'migrated',
                    platform: 'teams', // Default to teams for migrated sessions
                    url: '',
                    meetingTitle: firstCaption.Name ? `Meeting with ${firstCaption.Name}` : 'Migrated Meeting',
                    startTime: firstCaption.Time || fallbackTime,
                    endTime: lastCaption.Time || new Date().toISOString(),
                    status: 'ended',
                    lastActivity: new Date().toISOString(),
                    chunkCount: maxChunkIndex + 1,
                    captionCount: totalCaptions,
                    attendeeCount: 0,
                    chatCount: 0,
                    duration: 0,
                    speakers: Array.from(speakers),
                    speakerCount: speakers.size
                };

                console.log(`[SessionManager] Reconstructed orphaned session: ${sessionId} with ${totalCaptions} captions`);
                allSessions.push(reconstructedSession);
                sessionIds.add(sessionId);

            } catch (error) {
                console.error(`Failed to reconstruct session ${sessionId}:`, error);
            }
        }
        
        // Deduplicate sessions based on similar timestamps and content
        // Sometimes the same session gets saved twice with slightly different IDs
        const dedupedSessions = [];
        const seenSessions = new Map();

        for (const session of allSessions) {
            // Create a key based on meeting title and approximate time (within 5 minutes)
            const sessionTime = Math.max(0, new Date(session.startTime || 0).getTime());
            const timeWindow = Math.floor(sessionTime / (5 * 60 * 1000)); // 5-minute windows
            const dedupKey = `${session.meetingTitle || 'untitled'}_${timeWindow}_${session.captionCount || 0}`;

            // Check if we've seen a similar session
            const existing = seenSessions.get(dedupKey);
            if (existing) {
                // Keep the session with more data or the newer one (use timestamps not string comparison)
                const existingCaptions = existing.captionCount || 0;
                const currentCaptions = session.captionCount || 0;
                // Compare by extracted timestamps for proper chronological ordering
                const existingTimestamp = this.extractTimestampFromSessionId(existing.sessionId) || 0;
                const currentTimestamp = this.extractTimestampFromSessionId(session.sessionId) || 0;
                if (currentCaptions > existingCaptions ||
                    (currentCaptions === existingCaptions && currentTimestamp > existingTimestamp)) {
                    // Replace with current session
                    const index = dedupedSessions.findIndex(s => s.sessionId === existing.sessionId);
                    if (index >= 0) {
                        dedupedSessions[index] = session;
                        seenSessions.set(dedupKey, session);
                        console.log(`[SessionManager] Replaced duplicate session: ${existing.sessionId} with ${session.sessionId}`);
                    }
                }
            } else {
                dedupedSessions.push(session);
                seenSessions.set(dedupKey, session);
            }
        }

        // Sort by start time (newest first)
        dedupedSessions.sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0));

        console.log(`[SessionManager] getAllSessions found ${allSessions.length} sessions, deduped to ${dedupedSessions.length}`);

        // Update sessionHistory with all found sessions to ensure consistency
        if (dedupedSessions.length > 0) {
            const allSessionIds = dedupedSessions.map(s => s.sessionId);
            const currentHistory = await chrome.storage.local.get('sessionHistory');
            const existingHistory = currentHistory.sessionHistory || [];

            // Merge and deduplicate
            const mergedHistory = [...new Set([...existingHistory, ...allSessionIds])];
            if (mergedHistory.length !== existingHistory.length) {
                await chrome.storage.local.set({ sessionHistory: mergedHistory });
                console.log(`[SessionManager] Updated sessionHistory with ${mergedHistory.length} sessions`);
            }
        }

        return dedupedSessions;
    }

    // Clean up stale sessions (older than 24 hours and ended, or active but older than 12 hours)
    async cleanupStaleSessions() {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
        const sessionsToDelete = [];
        const sessionsToEnd = [];

        for (const [sessionId, session] of this.sessions) {
            const lastActivity = new Date(session.metadata.lastActivity || session.metadata.startTime);

            // Delete ended sessions older than 24 hours
            if (lastActivity < oneDayAgo && session.metadata.status === 'ended') {
                sessionsToDelete.push(sessionId);
            }
            // End active sessions older than 12 hours (likely stale)
            else if (lastActivity < twelveHoursAgo && session.metadata.status === 'active') {
                sessionsToEnd.push(sessionId);
            }
        }

        // End stale active sessions first
        for (const sessionId of sessionsToEnd) {
            await this.endSession(sessionId);
            console.log(`[SessionManager] Ended stale active session: ${sessionId}`);
        }

        for (const sessionId of sessionsToDelete) {
            await this.deleteSession(sessionId);
        }

        if (sessionsToDelete.length > 0 || sessionsToEnd.length > 0) {
            console.log(`[SessionManager] Cleaned up ${sessionsToDelete.length} deleted, ${sessionsToEnd.length} ended stale sessions`);
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
            // Count ALL items in storage, not just session_ prefixed ones
            // This includes session data, metadata, viewer data, etc.
            totalSize += this.calculateSize(items[key]);
        }

        return totalSize;
    }

    // Clean up orphaned data (data without valid sessions)
    async cleanupOrphanedData() {
        console.log('[SessionManager] Cleaning up orphaned data...');
        const items = await chrome.storage.local.get(null);
        const validSessionIds = new Set();
        const keysToDelete = [];
        let freedSize = 0;

        // First, identify all valid session IDs
        for (const key in items) {
            if (key.endsWith('_metadata')) {
                const sessionId = key.replace('_metadata', '');
                validSessionIds.add(sessionId);
            }
        }

        console.log(`[SessionManager] Found ${validSessionIds.size} valid sessions`);

        // Now find orphaned data
        for (const key in items) {
            // Skip non-session data
            if (!key.includes('session_') && !key.includes('chunk_') && !key.includes('_metadata') && !key.includes('_stats') && !key.includes('_attendees')) {
                continue;
            }

            // Extract session ID from the key
            let sessionId = null;
            if (key.includes('session_')) {
                // Keys like session_123_chunk_0, session_123_metadata, etc.
                const match = key.match(/session_\d+_\d+/);
                if (match) {
                    sessionId = match[0];
                }
            }

            // If we found a session ID and it's not valid, mark for deletion
            if (sessionId && !validSessionIds.has(sessionId)) {
                keysToDelete.push(key);
                freedSize += this.calculateSize(items[key]);
            }
        }

        // Also clean up temporary data that shouldn't persist
        const tempKeys = ['captionsToView', 'viewerData', 'viewerSessionId', 'backupTranscript'];
        for (const tempKey of tempKeys) {
            if (items[tempKey]) {
                keysToDelete.push(tempKey);
                freedSize += this.calculateSize(items[tempKey]);
            }
        }

        if (keysToDelete.length > 0) {
            console.log(`[SessionManager] Deleting ${keysToDelete.length} orphaned keys, freeing ${(freedSize / 1024 / 1024).toFixed(2)}MB`);
            console.log('[SessionManager] Orphaned keys:', keysToDelete.slice(0, 10), keysToDelete.length > 10 ? '...' : '');

            // Delete in batches to avoid quota exceeded errors
            const batchSize = 50;
            for (let i = 0; i < keysToDelete.length; i += batchSize) {
                const batch = keysToDelete.slice(i, i + batchSize);
                await chrome.storage.local.remove(batch);
            }
        } else {
            console.log('[SessionManager] No orphaned data found');
        }

        return freedSize;
    }

    // Clean up old sessions to make room
    async cleanupOldSessions(requiredSpace) {
        console.log(`[SessionManager] Starting cleanup to free ${(requiredSpace / 1024 / 1024).toFixed(2)}MB`);
        const allSessions = await this.getAllSessions();
        let freedSpace = 0;
        let deletedCount = 0;

        // First, clean up any temporary viewer data
        try {
            await chrome.storage.local.remove(['captionsToView', 'viewerData', 'viewerSessionId']);
            console.log('[SessionManager] Cleaned up temporary viewer data');
        } catch (error) {
            console.error('[SessionManager] Failed to clean viewer data:', error);
        }

        // Delete oldest ended sessions first
        const endedSessions = allSessions.filter(s => s.status === 'ended' || !s.status);
        endedSessions.sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0)); // Oldest first

        for (const session of endedSessions) {
            if (freedSpace >= requiredSpace && deletedCount > 0) break;

            try {
                const size = await this.getSessionSize(session.sessionId);
                await this.deleteSession(session.sessionId);
                freedSpace += size;
                deletedCount++;
                console.log(`[SessionManager] Deleted session ${session.meetingTitle || session.sessionId}, freed ${(size / 1024).toFixed(2)}KB`);
            } catch (error) {
                console.error(`[SessionManager] Failed to delete session ${session.sessionId}:`, error);
            }
        }

        // If we still need more space, delete active sessions (oldest first)
        if (freedSpace < requiredSpace) {
            const activeSessions = allSessions.filter(s => s.status === 'active');
            activeSessions.sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0));

            for (const session of activeSessions) {
                if (freedSpace >= requiredSpace) break;

                try {
                    const size = await this.getSessionSize(session.sessionId);
                    await this.deleteSession(session.sessionId);
                    freedSpace += size;
                    deletedCount++;
                    console.log(`[SessionManager] Deleted active session ${session.meetingTitle || session.sessionId}, freed ${(size / 1024).toFixed(2)}KB`);
                } catch (error) {
                    console.error(`[SessionManager] Failed to delete session ${session.sessionId}:`, error);
                }
            }
        }

        console.log(`[SessionManager] Cleanup complete. Deleted ${deletedCount} sessions, freed ${(freedSpace / 1024 / 1024).toFixed(2)}MB`);
        return freedSpace;
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

    // Diagnostic function to analyze what's in storage
    async analyzeStorage() {
        const items = await chrome.storage.local.get(null);
        const analysis = {
            totalKeys: 0,
            keysByPrefix: {},
            largestItems: [],
            totalSize: 0
        };

        for (const key in items) {
            analysis.totalKeys++;
            const itemSize = this.calculateSize(items[key]);
            analysis.totalSize += itemSize;

            // Group by prefix
            const prefix = key.split('_')[0];
            if (!analysis.keysByPrefix[prefix]) {
                analysis.keysByPrefix[prefix] = { count: 0, size: 0, keys: [] };
            }
            analysis.keysByPrefix[prefix].count++;
            analysis.keysByPrefix[prefix].size += itemSize;
            if (analysis.keysByPrefix[prefix].keys.length < 5) {
                analysis.keysByPrefix[prefix].keys.push(key);
            }

            // Track largest items
            analysis.largestItems.push({ key, size: itemSize });
        }

        // Sort and keep top 10 largest
        analysis.largestItems.sort((a, b) => b.size - a.size);
        analysis.largestItems = analysis.largestItems.slice(0, 10);

        // Log the analysis
        console.log('[SessionManager] Storage Analysis:');
        console.log(`Total keys: ${analysis.totalKeys}`);
        console.log(`Total size: ${(analysis.totalSize / 1024 / 1024).toFixed(2)}MB`);
        console.log('Keys by prefix:', analysis.keysByPrefix);
        console.log('Top 10 largest items:');
        analysis.largestItems.forEach(item => {
            console.log(`  ${item.key}: ${(item.size / 1024).toFixed(2)}KB`);
        });

        return analysis;
    }

    // Get storage statistics
    async getStorageStats() {
        let usage = 0;
        let quotaBytes = this.STORAGE_QUOTA;

        // Try to use Chrome's storage API for accurate numbers if available
        if (chrome.storage.local.getBytesInUse) {
            try {
                usage = await chrome.storage.local.getBytesInUse(null);
                // Chrome's actual quota for local storage (usually 10MB)
                // But we'll still use our conservative 8MB limit
                quotaBytes = Math.min(this.STORAGE_QUOTA, 10 * 1024 * 1024);
            } catch (error) {
                // Fallback to manual calculation
                usage = await this.getStorageUsage();
            }
        } else {
            usage = await this.getStorageUsage();
        }

        const allSessions = await this.getAllSessions();

        // Sort sessions by start time to get oldest and newest
        const sortedSessions = allSessions.sort((a, b) =>
            new Date(a.startTime || 0) - new Date(b.startTime || 0)
        );

        // If usage exceeds quota, we need to clean up immediately (with guard against concurrent runs)
        if (usage > quotaBytes && !this._emergencyCleanupInProgress) {
            console.warn(`[SessionManager] Storage usage (${usage} bytes) exceeds quota (${quotaBytes} bytes)`);

            // Run diagnostic to see what's taking up space
            await this.analyzeStorage();

            // Calculate how much we need to free (overage + 2MB buffer)
            const bytesToFree = usage - quotaBytes + (2 * 1024 * 1024);
            console.log(`[SessionManager] Need to free ${(bytesToFree / 1024 / 1024).toFixed(2)}MB`);

            // Set guard flag before starting cleanup
            this._emergencyCleanupInProgress = true;

            // Trigger immediate cleanup - don't wait, do it now
            (async () => {
                try {
                    console.log('[SessionManager] Starting emergency storage cleanup...');

                    // First, clean orphaned data
                    const orphanedFreed = await this.cleanupOrphanedData();
                    console.log(`[SessionManager] Freed ${(orphanedFreed / 1024 / 1024).toFixed(2)}MB from orphaned data`);

                    // Check if we still need more space
                    const currentUsage = await this.getStorageUsage();
                    if (currentUsage > quotaBytes) {
                        const stillNeeded = currentUsage - quotaBytes + (1024 * 1024); // Plus 1MB buffer
                        console.log(`[SessionManager] Still need to free ${(stillNeeded / 1024 / 1024).toFixed(2)}MB`);
                        const sessionsFreed = await this.cleanupOldSessions(stillNeeded);
                        console.log(`[SessionManager] Freed ${(sessionsFreed / 1024 / 1024).toFixed(2)}MB from old sessions`);
                    }

                    // Final check
                    const finalUsage = await this.getStorageUsage();
                    console.log(`[SessionManager] Cleanup complete. Final usage: ${(finalUsage / 1024 / 1024).toFixed(2)}MB / ${(quotaBytes / 1024 / 1024).toFixed(2)}MB`);
                } catch (error) {
                    console.error('[SessionManager] Emergency cleanup failed:', error);
                } finally {
                    // Always release the guard flag
                    this._emergencyCleanupInProgress = false;
                }
            })();
        }

        return {
            usedBytes: usage,
            usedMB: (usage / (1024 * 1024)).toFixed(2),
            quotaMB: (quotaBytes / (1024 * 1024)).toFixed(2),
            percentUsed: quotaBytes > 0 ? ((usage / quotaBytes) * 100).toFixed(1) : '0.0',
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
    
    // Emergency storage cleanup - more aggressive
    async emergencyCleanup() {
        console.log('[SessionManager] Running emergency storage cleanup...');

        // First get diagnostic
        await this.analyzeStorage();

        // Clean all temporary and orphaned data
        const orphanedFreed = await this.cleanupOrphanedData();

        // Get all sessions and delete oldest 50%
        const allSessions = await this.getAllSessions();
        const toDelete = Math.ceil(allSessions.length / 2);

        // Sort by date (oldest first)
        allSessions.sort((a, b) => new Date(a.startTime || 0) - new Date(b.startTime || 0));

        let freedTotal = orphanedFreed;
        for (let i = 0; i < toDelete && i < allSessions.length; i++) {
            try {
                const size = await this.getSessionSize(allSessions[i].sessionId);
                await this.deleteSession(allSessions[i].sessionId);
                freedTotal += size;
                console.log(`[SessionManager] Deleted session ${i + 1}/${toDelete}: ${allSessions[i].meetingTitle || allSessions[i].sessionId}`);
            } catch (error) {
                console.error(`Failed to delete session:`, error);
            }
        }

        // Clean up any remaining temp data
        const tempKeys = ['captionsToView', 'viewerData', 'viewerSessionId', 'backupTranscript', 'migration_completed'];
        try {
            await chrome.storage.local.remove(tempKeys);
        } catch (error) {
            // Silent fail
        }

        const finalUsage = await this.getStorageUsage();
        console.log(`[SessionManager] Emergency cleanup complete. Freed ${(freedTotal / 1024 / 1024).toFixed(2)}MB. Final usage: ${(finalUsage / 1024 / 1024).toFixed(2)}MB`);

        return freedTotal;
    }

    // Clear all sessions
    async clearAllSessions() {
        console.log('[SessionManager] Clearing all sessions...');

        // First get all sessions we know about
        const allSessions = await this.getAllSessions();

        // Delete each known session
        for (const session of allSessions) {
            await this.deleteSession(session.sessionId);
        }

        // Now scan for ANY remaining session-related keys in storage
        const allKeys = await chrome.storage.local.get(null);
        const remainingSessionKeys = [];

        for (const key in allKeys) {
            // Look for any key that looks like session data
            if (key.includes('session_') ||
                key.includes('_chunk_') ||
                key.includes('_metadata') ||
                key.includes('_stats') ||
                key.includes('_attendees') ||
                key.includes('captionsToView') ||
                key.includes('viewerData') ||
                key.includes('backupTranscript')) {
                remainingSessionKeys.push(key);
            }
        }

        if (remainingSessionKeys.length > 0) {
            console.log(`[SessionManager] Found ${remainingSessionKeys.length} orphaned keys to clean up`);
            await chrome.storage.local.remove(remainingSessionKeys);
        }

        // Clear all session-related storage keys
        await chrome.storage.local.set({
            'activeSessions': [],
            'sessionHistory': [],
            'migration_completed': false // Reset migration flag to allow re-migration if needed
        });

        // Clear in-memory sessions
        this.sessions.clear();

        console.log('[SessionManager] Successfully cleared all sessions');
    }

    // Fix incorrectly detected platforms (for migrated sessions)
    async fixSessionPlatforms() {
        console.log('[SessionManager] Fixing session platforms...');
        const allKeys = await chrome.storage.local.get(null);
        let fixed = 0;

        for (const key in allKeys) {
            if (key.endsWith('_metadata')) {
                const metadata = allKeys[key];
                if (metadata && metadata.meetingTitle) {
                    let correctedPlatform = null;

                    // Check if this is incorrectly marked as MEET
                    if (metadata.platform === 'meet' &&
                        metadata.meetingTitle.toLowerCase().includes('meeting with') &&
                        !metadata.meetingTitle.toLowerCase().includes('google meet')) {
                        // This is likely a Teams meeting incorrectly marked as Meet
                        correctedPlatform = 'teams';
                    }

                    if (correctedPlatform) {
                        metadata.platform = correctedPlatform;
                        await chrome.storage.local.set({ [key]: metadata });
                        fixed++;
                        console.log(`[SessionManager] Fixed platform for ${metadata.meetingTitle}: meet -> ${correctedPlatform}`);
                    }
                }
            }
        }

        console.log(`[SessionManager] Fixed ${fixed} session platforms`);
        return fixed;
    }
    
    // Get formatted session index for viewer display
    async getSessionIndex() {
        const allSessions = await this.getAllSessions();
        const formattedSessions = [];
        
        for (const session of allSessions) {
            try {
                // Format platform name for display
                let platformPrefix = '';
                if (session.platform) {
                    switch(session.platform) {
                        case 'teams':
                            platformPrefix = '[TEAMS] ';
                            break;
                        case 'zoom':
                            platformPrefix = '[ZOOM] ';
                            break;
                        case 'meet':
                            platformPrefix = '[MEET] ';
                            break;
                    }
                }
                
                // Format the session for display
                formattedSessions.push({
                    id: session.sessionId,
                    title: platformPrefix + (session.meetingTitle || 'Untitled Meeting'),
                    timestamp: session.startTime,
                    date: new Date(session.startTime).toLocaleDateString(),
                    time: new Date(session.startTime).toLocaleTimeString(),
                    duration: this.formatDuration(session.duration || 0),
                    captionCount: session.captionCount || 0,
                    attendeeCount: session.attendeeCount || 0,
                    speakers: session.speakers || []
                });
            } catch (error) {
                console.error(`[SessionManager] Error formatting session ${session.sessionId}:`, error);
            }
        }
        
        // Sort by timestamp (newest first)
        formattedSessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        return formattedSessions;
    }
}

    // Make SessionManager available globally
    self.SessionManager = SessionManager;

    // Also expose to window for popup context
    if (typeof window !== 'undefined') {
        window.SessionManager = SessionManager;
    }

    // Export for use in other scripts
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = SessionManager;
    }

})(); // End wrapper function