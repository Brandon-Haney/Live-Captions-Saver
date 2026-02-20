# Chat Capture Feature - Test Plan

## Overview
This document outlines the testing procedures for the new chat capture feature that integrates Teams chat messages with live captions in the transcript.

## Feature Summary
- Captures Teams chat messages during meetings
- Merges chat messages chronologically with captions
- Uses visual distinction (icons/colors) for message types
- Implements hybrid rotation strategy for panel management
- Includes safety checks for user typing detection

## Test Scenarios

### 1. Basic Chat Capture Toggle
**Steps:**
1. Open extension popup
2. Navigate to Settings > Capture Settings
3. Toggle "Capture Chat Messages" ON
4. Join a Teams meeting
5. Send a test chat message
6. Verify message appears in transcript

**Expected Result:**
- Chat messages should be captured and stored with Type: 'chat'
- Messages should appear in the transcript array

### 2. Visual Distinction in Viewer
**Steps:**
1. With chat capture enabled, send several chat messages
2. Ensure captions are also being captured
3. Click "View Transcript" in extension popup
4. Observe the display of both message types

**Expected Result:**
- Chat messages should have blue background (#f0f7ff)
- Chat messages should show 💬 icon
- Captions should show 🎤 icon
- Both should be chronologically ordered

### 3. Hybrid Panel Rotation
**Steps:**
1. Enable chat capture
2. Open Chat panel in Teams
3. Wait 60 seconds
4. Observe panel switching behavior

**Expected Result:**
- Panel should automatically switch to People after 60 seconds
- Should capture attendee list
- Should switch back to Chat panel after capturing attendees

### 4. Typing Detection Safety
**Steps:**
1. Enable chat capture
2. Start typing a message in Teams chat
3. Wait for the 60-second rotation timer
4. Continue typing

**Expected Result:**
- Panel should NOT switch while user is typing
- Should wait until typing is complete before rotation

### 5. Export Format Testing
Test each export format to ensure chat messages are properly marked:

#### TXT Format
**Expected Output:**
```
[CHAT] [2:30 PM] John Doe: Hello everyone
[2:31 PM] Jane Smith: Good afternoon
```

#### Markdown Format
**Expected Output:**
```markdown
💬 **John Doe** (2:30 PM):
> Hello everyone

**Jane Smith** (2:31 PM):
> Good afternoon
```

#### DOC Format
**Expected Output:**
HTML with `[💬 CHAT]` prefix for chat messages

#### JSON Format
**Expected Output:**
```json
{
  "Name": "John Doe",
  "Text": "Hello everyone",
  "Time": "2:30 PM",
  "Type": "chat"
}
```

### 6. Meeting End Behavior
**Steps:**
1. Enable chat capture and auto-save
2. Send chat messages during meeting
3. End the meeting

**Expected Result:**
- Transcript should auto-save (if enabled)
- Chat messages should be included in saved file
- Chat capture should stop cleanly

### 7. Performance Testing
**Steps:**
1. Send rapid chat messages (10+ in quick succession)
2. Monitor extension performance
3. Check for duplicate messages

**Expected Result:**
- No duplicate chat messages captured
- No performance degradation
- All messages captured accurately

### 8. Edge Cases

#### Test 8.1: Modal/Dialog Interference
**Steps:**
1. Open a modal dialog in Teams
2. Wait for rotation timer

**Expected Result:**
- Should not attempt rotation while modal is open

#### Test 8.2: Empty Chat
**Steps:**
1. Enable chat capture with no messages in chat
2. Let system run through rotation cycle

**Expected Result:**
- Should handle gracefully without errors

#### Test 8.3: Disable During Active Session
**Steps:**
1. Start with chat capture enabled
2. Capture some messages
3. Disable chat capture mid-meeting

**Expected Result:**
- Should stop capturing new messages
- Previously captured messages should remain

## Known Limitations
1. Chat and People panels cannot be open simultaneously in Teams
2. Attendee tracking requires periodic switching to People panel
3. Chat messages may be missed during the brief People panel check

## Success Criteria
- [ ] All chat messages are captured without duplicates
- [ ] Visual distinction is clear in viewer
- [ ] Export formats properly indicate message types
- [ ] No interference with user typing
- [ ] Smooth panel rotation without user disruption
- [ ] Settings toggle works correctly
- [ ] No performance impact on normal caption capture

## Testing Notes
- Test in both active meetings and test calls
- Verify with multiple participants sending messages
- Test with long messages and special characters
- Confirm emoji support in chat messages