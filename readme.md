![](IMG/logo.png)

# Live Captions Saver Browser Extension v5.2

The Live Captions Saver is a powerful Chrome extension that captures, saves, and exports live captions from Microsoft Teams, Google Meet, and Zoom meetings. With advanced features like AI-ready formatting with custom prompts, speaker tracking, attendee monitoring, and automated exports, it's the perfect tool for meeting documentation and accessibility across all major video conferencing platforms.

## Key Features

### Core Functionality
- **Real-time Caption Capture** - Automatically captures live captions during Teams meetings
- **Multiple Export Formats** - Save as TXT, Markdown, JSON, YAML, DOC, or AI-optimized formats
- **Speaker Identification & Aliasing** - Track who said what with customizable speaker names
- **Attendee Tracking** - Monitor meeting participants with join/leave timestamps
- **Smart Attendee Fallback** - Automatically generates attendee lists from speakers when tracking is disabled
- **Auto-Save on Meeting End** - Never lose your transcripts with automatic saving

### Advanced Features
- **AI-Ready Export Format** - Prepend custom instructions/prompts to transcripts for use with ChatGPT, Claude, or other AI tools
- **9 Built-in AI Templates** - Pre-written prompts for common meeting types (Standup, Retrospective, Planning, etc.)
- **Custom AI Instructions** - Create and save your own reusable AI analysis prompts
- **Meeting Analytics Dashboard** - View speaker participation, word counts, and statistics
- **Live Transcript Viewer** - Search and filter transcripts in real-time
- **Recording Transcript Downloader** - Automatically captures Teams recording transcripts when they become available
- **Format Selection Dialogs** - Choose export format (TXT/JSON/Markdown/AI) for all save methods
- **Enhanced Markdown Exports** - Comprehensive metadata headers with meeting info and speaker grouping
- **Customizable Filename Patterns** - Use variables like {date}, {time}, {title}, {attendees}
- **Multiple Timestamp Formats** - Choose between 12-hour, 24-hour, or relative timestamps

## Install from the Chrome Store

[Live Captions Saver - Chrome Web Store](https://chromewebstore.google.com/detail/ms-teams-live-captions-sa/ffjfmokaelmhincapcajcnaoelgmpoih)

## Supported Platforms

- **Microsoft Teams** - https://teams.microsoft.com
- **Google Meet** - https://meet.google.com
- **Zoom** - https://zoom.us (web client)

## Quick Start

### Using the Extension

1. **Navigate to your meeting platform** (Teams, Meet, or Zoom)
2. **Join a meeting**
3. **The extension will automatically enable live captions** (if auto-start is enabled)
4. **Capture is automatic** - The extension starts recording once captions appear
5. **Save your transcript** using the extension popup when ready

![Extension Popup - Active Capture](IMG/Extension%20Popup%203.png)

*The extension actively capturing captions with speaker aliases enabled*

### Extension Interface

![Extension Settings](IMG/Extension%20Popup%201.png)

*Comprehensive settings panel with automation options*

The extension popup provides:
- **Real-time status** showing capture progress and attendee count
- **Quick export buttons** with dropdown format selection
- **Speaker alias management** for correcting names
- **Auto-save configuration** with customizable settings
- **AI template selection** for intelligent summaries

## Transcript Viewer

Click "View Transcript" to open the interactive viewer with:

![Transcript Viewer](IMG/View%20Transcript.png)

*Interactive transcript viewer with analytics dashboard*

- **Meeting Analytics** - Total messages, words, and speaker count
- **Speaker Participation Graph** - Visual representation of contribution
- **Search & Filter** - Find specific content or speakers
- **Real-time Updates** - See new captions as they arrive

## Advanced Settings

![Advanced Settings](IMG/Extension%20Popup%202.png)

*AI customization and meeting features configuration*

### Meeting Features
- **Auto-start Live Captions** - Automatically enables Teams captions when joining
- **Track Meeting Attendees** - Records participant join/leave times
- **Timestamp Format Options** - Customize time display format
- **Filename Pattern Variables** - Create dynamic file names

### AI Export Preparation
- **9 Built-in Prompt Templates**:
  - Executive Summary
  - Daily Standup
  - Sprint Retrospective
  - Sprint Planning
  - Design Review
  - Interview Notes
  - All Hands Meeting
  - One-on-One
  - Brainstorming Session
- **Custom Templates** - Create and save your own AI prompts for reuse
- **Quick Template Buttons** - One-click access to common prompt templates
- **Note**: Extension prepares transcript with instructions - you paste into your preferred AI tool (ChatGPT, Claude, etc.)

## Standalone Console Script

For environments where browser extensions cannot be installed:

![Standalone Script](IMG/Standalone%20Script.png)

*Console script v2.0 with attendee tracking and speaker aliases*

### Features:
- Attendee tracking with join/leave times
- Speaker aliasing system
- Enhanced duplicate prevention
- Multiple export formats
- Auto-enable captions
- Draggable UI panel

### Usage:
1. Open Developer Console (F12) in Teams meeting
2. Paste the script from `Standalone-scripts/teams-caption-saver-console.js`
3. Press Enter to run

## Export Formats

All export methods (Previous Sessions, Live Viewer, Recording Transcripts) now offer consistent format selection dialogs.

### Standard Formats
- **TXT** - Plain text with attendee section and timestamps
- **Markdown** - Enhanced with comprehensive metadata headers, meeting title, platform info, speaker grouping with H3 headings, and blockquote formatting
- **JSON** - Structured data array with proper 2-space indentation
- **YAML** - Human-readable structured format
- **DOC** - Microsoft Word document with HTML formatting

### AI-Optimized Format
Prepares transcript for pasting into AI tools (ChatGPT, Claude, etc.):
- Meeting context and metadata header
- Attendee list (tracked or auto-generated from speakers)
- Structured transcript with compact spacing optimized for LLM context windows
- Template-specific prompts prepended to transcript (e.g., "Extract action items...", "Summarize key decisions...")
- User copies entire file content and pastes into their AI tool of choice
- Files include `-AI` suffix for easy identification
- **Note**: Extension does NOT perform AI analysis - it only formats the transcript with instructions for you to use

## Consistent File Structure

All exported files follow a consistent structure across all platforms (Teams, Meet, Zoom):

### Standard File Structure
```
=== MEETING ATTENDEES ===
Total Attendees: [number]
Meeting Start: [date/time]

Attendee List:
- [Attendee Name 1]
- [Attendee Name 2]
...

=== TRANSCRIPT ===
[timestamp] Speaker Name: Caption text
[CHAT] [timestamp] Speaker Name: Chat message
...
```

### Features Consistent Across Platforms
- **Attendee Tracking** - Lists all participants with join/leave history, or auto-generates from speakers if tracking disabled
- **Caption Capture** - Real-time transcription with speaker identification
- **Chat Integration** - Chat messages marked with [CHAT] prefix
- **Timestamp Formats** - Respects user's chosen format (12hr/24hr/relative)
- **Speaker Aliases** - Custom names applied consistently
- **Export Formats** - All formats available for all platforms with consistent format selection dialogs
- **Filename Sanitization** - Consistent naming across all save/export methods

### Platform-Specific Notes
- **Teams**: Full feature support with robust attendee tracking
- **Google Meet**: Speaker detection from captions and participant list
- **Zoom**: Requires web client; attendee tracking via participant panel

## Manual Installation (Developer Mode)

1. Download the `teams-captions-saver` folder
2. Open Chrome/Edge/Brave and navigate to extensions:
   - `chrome://extensions/` - Chrome
   - `edge://extensions/` - Edge
   - `brave://extensions/` - Brave
3. Enable **Developer mode** (top right toggle)
4. Click **"Load unpacked"**
5. Select the `teams-captions-saver` directory

## Contributing

We welcome contributions! To get started:

1. Fork the repository
2. Load the extension in developer mode
3. Make your changes to the `teams-captions-saver` directory
4. Test in a Teams meeting
5. Submit a pull request

### Development Setup
- No build system required - pure JavaScript/HTML/CSS
- Test with actual Teams meetings (captions must be enabled)
- Update version in `manifest.json` for releases

## Requirements

- Chrome, Edge, or Brave browser
- Microsoft Teams web version (teams.microsoft.com)
- Live captions must be enabled in Teams meeting
- Extension works only during active meetings

## Privacy & Legal

### Important Notice
This extension captures and saves live captions from meetings, which may include sensitive information. Before using:

- **Obtain consent** from all meeting participants
- **Comply with local laws** regarding recording and transcription
- **Follow your organization's policies** on meeting documentation
- **Respect privacy** and confidentiality requirements

### Data Handling
- All processing happens locally in your browser
- No data is sent to external servers
- Transcripts are saved to your local device only
- No telemetry or usage tracking

## Troubleshooting

### Common Issues

**Captions not capturing:**
- Ensure live captions are enabled in Teams (More → Turn on live captions)
- Refresh the Teams page after installing the extension
- Check that you're in an active meeting

**Extension not appearing:**
- Verify installation in browser extensions page
- Check permissions for teams.microsoft.com
- Try reloading the extension

**Export not working:**
- Check browser download settings
- Verify sufficient disk space
- Look for errors in browser console (F12)

**Attendee tracking issues:**
- Enable "Track Attendees" in settings
- Ensure roster panel is accessible
- Note: Only shows current participants
- Even if tracking is disabled, attendee section will be auto-generated from speakers

## License

This project is provided "as is" without warranty. Users are responsible for compliance with all applicable laws and regulations. See LICENSE file for details.

## Acknowledgments

- Original concept inspired by the need for accessible meeting documentation
- Built for the Microsoft Teams community
- Special thanks to all contributors and users providing feedback

## Support

For issues, feature requests, or questions:
- Open an issue on [GitHub](https://github.com/Zerg00s/Live-Captions-Saver/issues)
- Check existing issues for solutions
- Provide detailed reproduction steps for bugs

---

**Version:** 5.2
**Last Updated:** November 2025
**Compatibility:** Chrome/Edge/Brave with Manifest V3

## What's New in v5.2

### Enhanced Export Experience
- **Format Selection Dialogs** - All export methods (Previous Sessions, Live Viewer, Recording Transcripts) now prompt you to choose your preferred format
- **Enhanced Markdown Format** - Comprehensive metadata headers with meeting title, platform, attendee count, timestamps, and beautifully formatted speaker sections with blockquotes
- **Smart Attendee Fallback** - Even if attendee tracking is disabled, exports automatically generate attendee lists from unique speakers in the transcript

### Recording Transcript Downloader
- **Automatic Capture** - Intercepts Teams recording transcripts when you play recordings
- **Multiple Formats** - Download as JSON, TXT, or Markdown with one click
- **Badge Notifications** - See at-a-glance how many transcripts are available
- **24-Hour Storage** - Captured transcripts stored temporarily with automatic cleanup

### Quality Improvements
- **Consistent Filenames** - Standardized filename generation across all export methods with proper sanitization
- **AI Format Enhancement** - Compact output with `-AI` suffix for easy identification
- **Reduced Console Noise** - Minimized repetitive logging when browsing Teams outside of meetings
- **Better Error Handling** - Fixed async message channel errors for more reliable exports