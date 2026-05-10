# Changelog

All notable changes to the Live Captions Saver extension will be documented in this file.

## [5.3.4] - 2026-04-07

### Fixed
- **M365 Keep-Alive auto-joining Teams meetings**: The keep-alive dialog detector was clicking unrelated primary buttons, causing the Teams calendar to auto-open the pre-join screen for the first meeting of the day
  - Root cause: `button.ms-Button--primary` in `DIALOG_SELECTORS` matched any Fluent primary button. Because `m365_keepalive.js` runs inside the `outlook.office.com` iframe embedded in Teams v2 calendar (with `all_frames: true`), it was finding and clicking the calendar's "Join" button
  - Removed the overly-broad `button.ms-Button--primary` selector and the unreliable `:contains()` / `input[value="Yes"]` entries
  - Added `isInSignInContext()` gate: on non-login hosts, candidate buttons must live inside an actual `[role="dialog"]` / `.ms-Dialog` whose text mentions "stay signed in" or "keep me signed in" before the script will click them
  - Fixed an operator precedence bug in the text-based fallback where `text.includes('stay signed in') || text.includes('keep me signed in') || text.includes('yes') && btn.closest('[role="dialog"]')` let the first two branches match anywhere on the page; all three branches now require sign-in dialog context

## [5.3.3] - 2026-02-20

### Enhanced
- **Keyword Toast Context & Viewer Integration**: Meeting page keyword toasts now show conversational context and link to the Live Transcript viewer
  - Dark background with orange accents for high-contrast readability (replaces all-orange design)
  - Toasts display up to 5 context lines before the match plus 1 following line as it arrives
  - Matched line highlighted with orange left accent bar; keyword shown in dark orange pill
  - Context lines shown in subdued gray for clear visual hierarchy
  - "View in Transcript" button opens the Live Transcript viewer scrolled to the exact caption
  - Auto-dismiss after 2 minutes; hover pauses the dismiss timer
  - Explicit X dismiss button in the header bar (no longer relying on click-anywhere-to-dismiss discovery)

### Added
- **Live-Updating Toasts**: Keyword alerts now appear instantly and update in real-time
  - Toast fires the moment a keyword appears mid-sentence (removed 800ms debounce)
  - Toast content refreshes every 300ms for 30 seconds as the caption text continues filling in
  - Following conversation line appears below the match as it's spoken, giving additional context
- **Same-Keyword Toast Deduplication**: Duplicate toasts for the same keyword are replaced in-place instead of stacking
  - Nearby captions containing the same keyword update the existing toast rather than creating a new one

### Fixed
- **Toasts persisting after meeting end**: All keyword toasts are now dismissed when the meeting ends or a new capture session starts
- **Auto-dismiss timer reliability**: Dismiss timer now stored on the toast element and properly cleaned up on hover/removal

## [5.3.2] - 2026-02-19

### Added
- **Keyword Alerts on Meeting Page**: Keyword detection now works directly on the Teams/Meet/Zoom meeting page, not just in the Live Transcript viewer
  - Orange toast notifications appear at bottom-right when a keyword is spoken during a meeting
  - Slide-in animation with auto-dismiss after 8 seconds; hover pauses dismiss timer
  - Keyword highlighted in toast text excerpt for quick scanning
  - Consolidation prevents toast flooding when same keyword is spoken repeatedly
  - Max 3 toasts visible at once; click to dismiss
  - Works for both captions and chat messages
  - Iframe guard prevents duplicate toasts on multi-frame pages
  - Shared `keywordEngine.js` module extracts core matching logic for both viewer and content script
  - Settings sync: keyword changes in the viewer/popup are reflected on the meeting page in real-time

## [5.3.1] - 2026-02-19

### Fixed
- **Download filename bug with special characters**: Meeting titles containing `/` (e.g., "TAMS/Store Ops Touchbase") caused Chrome to save the file as "download.txt" instead of using the meeting title
  - Added slash sanitization in `downloadFile()` to replace any `/` or `\` in filenames with `_`
  - Fixed `onDeterminingFilename` handler to also match `data:` URLs (not just `blob:` URLs), resolving a race condition where the queued filename wasn't applied to auto-saved downloads

## [5.3] - 2026-01-29

### Added
- **Hot Keyword Detection**: Real-time alerts when configured keywords appear in the transcript
  - Two keyword scopes: Global (persists across sessions) and Session (temporary, cleared on viewer close)
  - Case-insensitive partial matching (e.g., "Brandon" matches "@Brandon", "brandon")
  - Visual alerts: page flash effect, caption highlighting with orange border, toast overlay
  - Context display: shows 3-5 previous lines for context before the keyword match
  - Alert fatigue prevention: consolidates alerts for same keyword within 5-second window
  - Configurable settings: enable/disable, flash toggle, context line count
  - Max 20 global keywords (synced via chrome.storage.sync) + 10 session keywords
  - Accessible via "Keywords" button in Live Viewer controls
  - Added modal with two sections for global and session keyword management
  - ESC key and click-outside to dismiss alert overlay
  - Auto-dismiss after 10 seconds with "Scroll to Caption" action
  - Added in `viewer.html` and `viewer.js`

- **SRT Subtitle Export**: New export format for syncing captions with external video recordings (OBS, etc.)
  - Generates standard SRT subtitle format compatible with all video editors
  - User inputs their recording start time for accurate timestamp synchronization
  - Calculates relative timestamps from user-provided recording start
  - Smart end-time estimation: uses next caption start time or text-length-based duration
  - Duration capped at 7 seconds to prevent lingering subtitles
  - Available in popup dropdown, Previous Sessions export, and Live Viewer
  - Speaker names included in brackets: `[Speaker Name] Caption text`
  - Added in `service_worker.js`, `popup.js`, `popup.html`, `viewer.js`

### Fixed
- **Health check false alarms**: Fixed issue where health check would warn "No captions captured in X minutes" after joining a new meeting
  - Health check state now resets when meetings start and end
  - `lastCaptionTime` no longer carries over from previous meetings
  - Added `HealthCheck.resetState()` function and called it on meeting transitions
  - Fixed in `content_script.js`

- **Download filename interference**: Fixed issue where extension would rename downloads from other extensions (e.g., Video DownloadHelper)
  - Queue-based filename assignment now only applies to blob: URLs created by this extension
  - Other extensions' downloads are no longer affected
  - Fixed in `service_worker.js:1277-1286`

## [5.2] - 2025-11-08

### Added
- **Teams Cloud URL Support**: Added support for new `teams.cloud.microsoft` domain
  - Extension now works on https://teams.cloud.microsoft/*
  - Added to both host_permissions and content_scripts matches
  - Updated in `manifest.json`

- **Attendee Fallback from Speakers**: All export formats now automatically generate attendee lists from unique speakers if no attendee data was tracked
  - Applies to TXT, Markdown, JSON, AI, and DOC formats
  - Ensures every export includes "MEETING ATTENDEES" section even for old sessions
  - Speaker names extracted from transcript and sorted alphabetically
  - Added in `service_worker.js:218-230, 326-338, 520-528, 423-434` and `viewer.js:1044-1060`

- **Enhanced Markdown Export Format**: Significantly improved Markdown export with comprehensive metadata headers
  - Meeting title as H1 heading
  - "Meeting Information" section with platform, caption counts, timestamps, and export date
  - "Attendees" section with full list
  - Speaker-grouped transcript with H3 headings for each speaker
  - Blockquote formatting for captions with bold timestamps
  - Consistent format across Previous Sessions export, Viewer save, and Recording transcripts
  - Updated in `service_worker.js:274-413` and `viewer.js:976-1015`

- **Format Selection for All Exports**: Added consistent format selection dialogs across all export methods
  - Previous Sessions export now prompts for format (TXT/JSON/Markdown/AI) instead of using default
  - Live Transcript Viewer save prompts for format (TXT/JSON/Markdown)
  - Recording transcripts offer inline buttons (JSON/TXT/MD)
  - Implemented in `popup.js:1113-1181` and `viewer.js:1086-1140`

- **AI Format Filename Suffix**: AI format exports now include `-AI` suffix in filename for easy identification
  - Example: `2025-11-08_Meeting_Title-AI.txt`
  - Added in `service_worker.js:619-622`

- **Recording Transcript Downloader**: Automatically captures and downloads Teams meeting recording transcripts when they become available
  - Intercepts network traffic to detect `streamContent?format=json` requests from Teams recording playback
  - Smart badge notification on extension icon showing count of available transcripts
  - Toast notification appears on page when transcript is detected
  - Purple gradient section at top of popup for high visibility
  - Download in multiple formats: JSON (raw), TXT (formatted), or Markdown
  - 24-hour storage with automatic cleanup of expired transcripts
  - "Time ago" formatting (e.g., "5m ago", "2h ago") for better context
  - Individual delete or "Clear All" options
  - Solves issue where company policies prevent transcript downloads from Teams UI
  - Added in `content_script.js:3373-3497`, `service_worker.js:898-932, 1298-1383`, `popup.html:369-382`, `popup.js:1481, 1683-1889`

- **Join/Leave Events**: Meeting attendees' join and leave events now appear in all export formats (TXT, Markdown, DOC, AI) and the live transcript viewer
  - Green styled cards for joins, red for leaves in viewer
  - Chronologically merged with captions and chat messages
  - Real-time broadcasting when people join/leave meetings
  - Works across Teams, Meet, and Zoom

### Fixed
- **Consistent Filename Generation**: Standardized filename generation across all export methods
  - All methods now use same sanitization logic (handles "Meeting | Teams" format, preserves case)
  - Previous Sessions export: `{date}_{title}.{format}`
  - Live Viewer save: `{date}_{title}-filtered-{speaker}_{time}.{format}` (when filtered)
  - Recording transcripts: `recording_{date}_{title}.{format}`
  - Removed inconsistent lowercase conversion and improved special character handling
  - Fixed in `viewer.js:1111-1122` and `popup.js:1717-1725`

- **Recording Transcript Markdown Format**: Fixed Markdown format for recording transcripts to include proper metadata headers
  - Now generates comprehensive header with meeting info, entry counts, and timestamps
  - Proper `text/markdown` MIME type ensures `.md` extension (Chrome previously forced `.txt`)
  - Enhanced formatting with blockquotes and timestamps
  - Fixed in `popup.js:1689-1712`

- **Compact AI Format Output**: Removed extra blank lines between captions in AI format exports
  - Changed from double newlines (`\n\n`) to single newlines (`\n`)
  - Reduces file size and improves AI tool processing
  - Metadata sections still have proper spacing with `---` separators
  - Fixed in `service_worker.js:557`

- **Async Message Channel Error**: Fixed "message channel closed before response" error in Previous Sessions export
  - Added proper try-catch with `sendResponse()` calls
  - Returns `true` to keep message channel open for async operations
  - Prevents intermittent export failures
  - Fixed in `service_worker.js:1379-1407`

- **Viewer Debug Warning**: Changed debug console.warn to console.log to prevent appearing as error in DevTools
  - No longer shows as yellow warning in Chrome console
  - Still logs debug information for troubleshooting
  - Fixed in `viewer.js:1553`

- **Viewer TXT Format Attendee Section**: Added attendee section to Live Transcript Viewer TXT exports
  - Now includes "=== MEETING ATTENDEES ===" header with full list
  - Matches format from Previous Sessions exports
  - Uses fallback to generate from speakers if no attendee data available
  - Fixed in `viewer.js:1017-1079`

- **Console Log Flooding**: Fixed repetitive "Meeting ended - clearing metadata" messages when browsing Teams outside of meetings
  - Changed to only log during actual state transition (from in-meeting to not-in-meeting)
  - Previously logged every 5 seconds when sitting on Teams page outside of meetings
  - Reduces console noise significantly
  - Fixed in `content_script.js:2507-2527`

- **Chat Capture Default Setting**: Fixed chat capture not starting automatically on first install despite popup showing it as enabled
  - Changed content script to treat undefined `chatCapture` setting as `true` (enabled by default) to match popup behavior
  - Previously, popup defaulted to enabled but content script only started if explicitly set to `true`
  - Now both popup and content script consistently default to enabled
  - Fixed in `content_script.js:2691` and `content_script.js:1559-1561`

- **Image-Only Chat Messages**: Fixed image attachments not being captured when sent without text
  - Previously, messages with no text content were skipped entirely, even if they contained images
  - Now properly captures messages that only contain images/attachments
  - Uses `[Attachment]` placeholder text if message has attachments but no text or aria-label
  - Fixed in `platformConfig.js:151` and `platformConfig.js:260-261`

- **Invalid Chat Message Timestamp Crash**: Fixed "Uncaught RangeError: Invalid time value" error when capturing chat messages with malformed timestamps
  - Added validation to check if Date object is valid before calling `.toISOString()`
  - Falls back to current time if message timestamp is invalid
  - Logs warning message when invalid timestamp is detected
  - Fixed in `content_script.js:1786-1789`

- **Image Filename Display in Viewer**: Removed filename text display below image thumbnails in Live Viewer
  - Previously showed "image.png" or similar filename text below each image thumbnail
  - Images still retain filename in title attribute (shows on hover) and data attributes
  - Cleaner visual presentation of image attachments
  - Fixed in `viewer.js:662`

- **Image Hover Effect Clipping**: Fixed image thumbnails getting clipped when hovering in Live Viewer
  - Parent container `.caption-content` had `overflow: hidden` which clipped scaled images on hover
  - Changed to `overflow: visible` to allow hover scale effect to display properly
  - Added `overflow: visible` to `.attachment-container` for additional overflow support
  - Added `z-index: 10` to hovered thumbnails to ensure they appear above other content
  - Image now scales smoothly without being cut off
  - Fixed in `viewer.html:357`, `viewer.html:647`, and `viewer.html:669`

- **Live Viewer Scroll Button**: Fixed "New captions available" button not scrolling all the way to bottom
  - Changed to scroll to absolute bottom of page instead of scrolling last element into view
  - Updated button text to "↓ New captions - Scroll to bottom" for clarity
  - Button now properly marks user as "at bottom" to prevent immediate re-appearance

- **Join/Leave Event Sorting in Exports**: Fixed join/leave events being appended to end of export files instead of chronological position
  - Updated sorting logic to use `timestamp` field (ISO format) for captions/chat instead of trying to parse formatted `Time` strings
  - Join/leave events now appear at correct timestamps throughout the transcript in all export formats (TXT, Markdown, DOC, AI)

- **Real-Time Join/Leave Detection**: Fixed delayed detection of attendees joining/leaving meetings
  - Added MutationObserver to continuously monitor participant list for changes
  - Join/leave events now broadcast immediately when detected (not delayed until next panel check)
  - Fixed issue where quick rejoins weren't detected (e.g., user leaves and rejoins within seconds)
  - Rejoin events now properly broadcast to live viewer
  - Reduced backup polling interval from 1 minute to 5 minutes (observer handles real-time updates)

- **Old Chat Messages Bug**: Fixed issue where past chat messages from recurring Teams meetings were being captured in new transcripts
  - Added timestamp filtering to skip messages older than 30 seconds before session start
  - Extracts timestamps from message IDs (Teams) or uses current time (Meet/Zoom)

- **Undefined Variable**: Fixed undefined `hasCaptionText` reference in Zoom caption detection (platformConfig.js:1012)

- **Race Condition**: Removed unreachable code in session creation that could cause issues (content_script.js:52-78)

- **Message Listener Error Handling**: Added comprehensive try-catch wrapper to service worker message listener

- **HTML Escaping**: Fixed incomplete HTML entity escaping for single quotes (security improvement)

- **Input Validation**: Added sanitization for template names and user inputs to prevent special characters

- **Null Checks**: Added defensive null checks for DOM operations in popup.js and viewer.js

- **Teams Chat Photos Not Displaying**: Fixed chat message photos not appearing in Live Viewer due to Teams UI changes
  - Updated image selectors to include new `img[data-tid="rich-file-preview-image"]` selector for Teams file attachments
  - Enhanced image URL extraction to use `amspreviewurl` attribute for better quality images
  - Improved filename extraction from button title attribute in new attachment structure
  - Maintained backward compatibility with legacy inline image format

- **Viewer.js Speaker Filter Warnings**: Fixed spurious console warnings when editing speaker aliases
  - Added guards to filter out clicks from alias editing UI (input field, save/cancel buttons)
  - Prevents "Could not find filter button" warnings during normal alias editing operations

- **Zoom Iframe Support**: Re-enabled iframe support for Zoom meetings
  - Changed manifest.json `all_frames` back to `true` to support Zoom's iframe-based meeting structure
  - Added diagnostic logging for Zoom backup and auto-save operations
  - Fixed Zoom selectors to prioritize ID-based caption container

- **Popup Duplicate Script Tags**: Fixed popup.html having duplicate script tags in `<head>` and reference to non-existent `popup-v2.js`
  - Removed duplicate `sessionManager.js` script tag from `<head>`
  - Removed reference to `popup-v2.js` which no longer exists
  - Kept correct script tags at end of `<body>`: `sessionManager.js` and `popup.js`
  - Fixed issue where Previous Sessions, Settings, and AI tabs weren't working after popup file consolidation

- **Undefined attendeeHistory Variable**: Fixed undefined `attendeeHistory` reference in content_script.js line 3155
  - Changed from `attendeeHistory: attendeeHistory` (undefined) to `attendeeHistory: attendeeReport.attendeeHistory`
  - Prevented potential crashes when attendee data was accessed during exports

- **Invalid CSS Selector**: Fixed invalid `:has()` with `:text()` pseudo-selector in platformConfig.js Zoom hangup button selector
  - Removed invalid CSS pseudo-selectors that would cause querySelector to fail
  - `:text()` is not a valid CSS pseudo-selector

- **Duplicate moreButton Key**: Fixed duplicate `moreButton` property in platformConfig.js Zoom configuration
  - Consolidated duplicate definitions into single property

- **Missing teams.cloud.microsoft Config**: Added platform configuration for new `teams.cloud.microsoft` domain
  - Copies Teams configuration with updated name "Microsoft Teams (Cloud)"
  - Ensures all selectors work correctly on the new Teams cloud domain

- **Orphaned setInterval Memory Leak**: Fixed memory leak from orphaned `setInterval` in chat capture
  - Added `panelCheckInterval` tracking to `chatCaptureState` object
  - Properly clears interval in `stopChatCapture()` function
  - Prevents accumulation of timer callbacks when starting/stopping chat capture

- **Duplicate getTimeAgo Function**: Removed duplicate `getTimeAgo` function definition in popup.js
  - Function was defined twice at lines 1183 and 1537
  - Removed second duplicate definition

- **Download Filename Conflict with Other Extensions**: Fixed extension interfering with downloads from other extensions
  - Previously returned `false` in `onDeterminingFilename` handler when extension didn't have pending filename
  - This caused "failed to name the download" errors for other extensions like Video DownloadHelper
  - Changed to not return anything when we don't have a pending filename, letting Chrome/other extensions handle it normally

- **pendingDownloads Map Cleanup**: Improved cleanup of pending download entries to prevent unbounded growth
  - Use unique timestamp-based keys to prevent overwrites
  - Added cleanup of stale entries older than 30 seconds
  - Prevents potential memory issues from orphaned entries

- **Viewer applyFilters Null Check**: Fixed crash in viewer.js when filtering attendance events
  - Added null check for `.text` element which doesn't exist on attendance events (joins/leaves)
  - Attendance events now properly hidden when search/filter is active

- **Analytics Excluding Attendance Events**: Fixed analytics incorrectly counting join/leave events as speaker captions
  - Filter out entries with `Type === 'attendance'` before calculating speaker statistics
  - Prevents inflated word counts and participation percentages

- **Session Chunk Validation**: Added validation and warning for missing or corrupted session chunks in sessionManager.js
  - Validates `chunkCount` is a valid number before attempting to load chunks
  - Logs warning with list of missing chunk indices if any chunks are not found
  - Throws error for corrupted session metadata instead of silently failing

- **Ineffective return true Statements**: Removed misleading `return true` statements inside async IIFE in service_worker.js
  - These statements were inside the async function and didn't actually keep the message channel open
  - The outer message listener already returns `true` at the end, so these were redundant
  - Changed to proper `break` statements to exit switch cases

### Changed
- **Popup File Cleanup**: Removed legacy popup files and consolidated to single version
  - Removed old `popup.html`, `popup.js`, and backup files
  - Renamed `popup-v2.html` and `popup-v2.js` to `popup.html` and `popup.js`
  - Updated `manifest.json` to reference consolidated files
  - Simplifies codebase and eliminates confusion between versions

- **Page Visibility Logging**: Added diagnostic logging to track caption capture when page is hidden (locked screen)
  - Logs when tab becomes hidden/visible with transcript count
  - Logs successful caption captures while page is hidden
  - Helps diagnose behavior when laptop is locked during meetings

- **Deprecated Function Removed**: Removed `getActiveTeamsTab` alias in favor of `getActiveMeetingTab`

- **Debug Logging**: Added DEBUG flag in viewer.js to reduce console spam
  - Set `DEBUG = false` by default (production mode - clean console)
  - Set `DEBUG = true` for troubleshooting (verbose logging)
  - 26 verbose log statements now hidden by default
  - Errors always shown regardless of DEBUG setting

- **Chrome Extension Permissions**: Restricted overly broad permissions
  - Removed wildcard Zoom subdomain permission
  - Changed content script from `all_frames: true` to `all_frames: false` to prevent iframe injection

### Improved
- **Code Quality**:
  - Fixed magic numbers by extracting to constants
  - Removed commented-out code blocks
  - Improved error messages with context
  - Better async/await usage

## File Structure

### Modified Files (Recent Session)
- `content_script.js` - Chat timestamp filtering, join/leave broadcasting
- `service_worker.js` - All export formats updated with join/leave events
- `viewer.html` - CSS styling for attendance events (green/red cards)
- `viewer.js` - Attendance event rendering, DEBUG flag system
- `platformConfig.js` - Timestamp extraction, undefined variable fix
- `popup.js` - Input sanitization, null checks
- `manifest.json` - Improved permissions

### New Files
- `debugUtils.js` - Debug utility for production logging control (not yet integrated)

---

## Format

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format.

### Categories
- **Added** - New features
- **Changed** - Changes in existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security improvements
