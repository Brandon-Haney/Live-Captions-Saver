# Chat Capture Platform Modularization Design

## Overview
This document outlines the design for making chat capture platform-agnostic, following the same pattern as caption capture.

## Current State (Teams-specific)
The current implementation is tightly coupled to Microsoft Teams DOM structure:
- Hard-coded selectors for chat panels, buttons, and messages
- Teams-specific panel switching logic
- Direct DOM manipulation for Teams UI

## Proposed Platform-Agnostic Architecture

### 1. Platform Configuration Structure
Each platform config should include:

```javascript
{
    name: 'Platform Name',
    selectors: {
        // Existing caption selectors...
        
        // Chat-specific selectors
        chatPanel: 'selector',
        chatButton: 'selector',
        chatMessage: 'selector',
        chatMessageAuthor: 'selector',
        chatMessageContent: 'selector',
        chatMessageTime: 'selector',
        chatMessageId: 'attribute',
        chatInputField: 'selector',
        
        // Panel management
        peoplePanel: 'selector',
        peopleButton: 'selector',
        modalDialog: 'selector'
    },
    
    // Chat capture methods
    chatCapture: {
        // Check if chat is supported on this platform
        isSupported: () => boolean,
        
        // Get current active panel
        detectCurrentPanel: () => 'chat' | 'people' | 'none',
        
        // Panel navigation
        openChatPanel: async () => boolean,
        openPeoplePanel: async () => boolean,
        
        // Check if user is typing
        isUserTyping: () => boolean,
        
        // Extract chat message data
        getChatMessageData: (element) => {
            return {
                id: string,
                author: string,
                text: string,
                time: string
            }
        },
        
        // Get all chat messages
        getChatMessages: () => NodeList,
        
        // Get unique message ID
        getMessageId: (element) => string
    }
}
```

### 2. Platform Implementations

#### Microsoft Teams
```javascript
chatCapture: {
    isSupported: () => true,
    
    detectCurrentPanel: () => {
        const chatPanel = document.querySelector('#chat-pane-list');
        const peoplePanel = document.querySelector('.fui-FlatTree[role="tree"]');
        // Logic to detect active panel
    },
    
    openChatPanel: async () => {
        const chatButton = document.querySelector('[data-inp="chat-button"]');
        if (chatButton) {
            chatButton.click();
            await delay(500);
            return true;
        }
        return false;
    },
    
    getChatMessageData: (msgElement) => {
        const container = msgElement.closest('.fui-unstable-ChatItem');
        const author = container?.querySelector('[data-tid="message-author-name"]');
        const content = msgElement.querySelector('[id^="content-"]');
        
        return {
            id: msgElement.getAttribute('data-mid'),
            author: author?.textContent || 'Unknown',
            text: content?.textContent || '',
            time: new Date().toLocaleTimeString()
        };
    }
}
```

#### Google Meet
```javascript
chatCapture: {
    isSupported: () => true,
    
    detectCurrentPanel: () => {
        // Google Meet uses different UI - side panel
        const chatPanel = document.querySelector('[data-panel-id="2"]');
        const peoplePanel = document.querySelector('[data-panel-id="1"]');
        // Logic for Google Meet
    },
    
    openChatPanel: async () => {
        const chatButton = document.querySelector('[aria-label*="Chat"]');
        if (chatButton) {
            chatButton.click();
            await delay(500);
            return true;
        }
        return false;
    },
    
    getChatMessageData: (msgElement) => {
        // Google Meet chat structure
        const author = msgElement.querySelector('.GDhqjd');
        const content = msgElement.querySelector('.oIy2qc');
        const time = msgElement.querySelector('.kCtYwe');
        
        return {
            id: msgElement.getAttribute('data-message-id'),
            author: author?.textContent || 'Unknown',
            text: content?.textContent || '',
            time: time?.textContent || new Date().toLocaleTimeString()
        };
    }
}
```

### 3. Refactored Content Script

```javascript
// Platform-agnostic chat capture
function captureChatMessages() {
    if (!chatCaptureState.enabled) return 0;
    if (!platformConfig?.chatCapture?.isSupported()) return 0;
    
    const messages = platformConfig.chatCapture.getChatMessages();
    let newCount = 0;
    
    messages.forEach(msgElement => {
        const messageData = platformConfig.chatCapture.getChatMessageData(msgElement);
        if (!messageData || !messageData.id) return;
        
        // Skip if already captured
        if (chatCaptureState.capturedMessageIds.has(messageData.id)) {
            return;
        }
        
        const chatMessage = {
            Name: messageData.author,
            Text: messageData.text,
            Time: messageData.time,
            Type: 'chat',
            key: `chat_${messageData.id}`
        };
        
        transcriptArray.push(chatMessage);
        chatCaptureState.capturedMessageIds.add(messageData.id);
        newCount++;
    });
    
    return newCount;
}

// Platform-agnostic panel management
async function performHybridRotation() {
    if (!platformConfig?.chatCapture?.isSupported()) return;
    
    // Check if user is typing
    if (platformConfig.chatCapture.isUserTyping()) {
        setTimeout(performHybridRotation, TIMING.TYPING_RECHECK_DELAY);
        return;
    }
    
    // Platform-specific rotation
    if (await platformConfig.chatCapture.openPeoplePanel()) {
        updateAttendeeList();
        await delay(500);
    }
    
    if (await platformConfig.chatCapture.openChatPanel()) {
        captureChatMessages();
    }
}
```

## Benefits of This Approach

1. **Modularity**: Each platform implements its own chat capture logic
2. **Maintainability**: Platform-specific code is isolated
3. **Extensibility**: Easy to add new platforms
4. **Consistency**: Same pattern as caption capture
5. **Testability**: Each platform's implementation can be tested independently

## Migration Steps

1. Add `chatCapture` object to existing Teams config
2. Move Teams-specific functions into platformConfig
3. Update content_script.js to use platform methods
4. Add Google Meet chat capture implementation
5. Test both platforms thoroughly

## Considerations

### Platform Differences
- **Teams**: Separate panels for chat/people (mutually exclusive)
- **Google Meet**: Side panel that can show both
- **Zoom Web**: May have different chat structure
- **Webex**: Different UI patterns

### Feature Availability
Not all platforms may support all features:
- Some may not have chat
- Some may not allow panel switching programmatically
- Some may have rate limits on DOM queries

### Graceful Degradation
If a platform doesn't support chat capture:
- Hide the chat capture toggle in settings
- Show platform-specific message
- Focus on caption capture only