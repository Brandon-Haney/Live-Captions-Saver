// Service worker is a script that your browser runs in the background, separate from a web page, opening the door to features that don't need a web page 
// or user interaction.
// Service worker script will be forcefully terminated after about 30 seconds of inactivity, and restarted when it's next needed.
// https://stackoverflow.com/questions/66618136/persistent-service-worker-in-chrome-extension/66618269#66618269

function getMeetingNameFromTitle(fullTitle) {
    const parts = fullTitle.split('|');
    let meetingName;

    if (parts.length > 1) {
        // If the title is like "Location | Meeting Name | App Name", there will be 3+ parts. We want the middle one.
        // If it's "Meeting Name | App Name", there will be 2 parts. We want the first one.
        meetingName = (parts.length > 2) ? parts[1] : parts[0];
    } else {
        meetingName = parts[0];
    }
    return meetingName.replace('Microsoft Teams', '').trim();
}

// This code is not used. But without it, the extension does not work
function jsonToYaml(json) {
    return json.map(entry => {
        return `Name: ${entry.Name}\nText: ${entry.Text}\nTime: ${entry.Time}\n----`;
    }).join('\n');
}

function saveTranscripts(meetingTitle, transcriptArray, saveAsPrompt = true) {
    const yaml = jsonToYaml(transcriptArray);
    
    const meetingName = getMeetingNameFromTitle(meetingTitle);
    let sanitizedTitle = meetingName.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_').trim() || "Meeting";

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${year}-${month}-${day}`;

    const filename = `${datePrefix} - ${sanitizedTitle}.txt`;

    chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(yaml),
        filename: filename,
        saveAs: saveAsPrompt
    });
}

async function saveAiTranscript(meetingTitle, transcriptArray, saveAsPrompt = true) {
    if (!transcriptArray || transcriptArray.length === 0) return;

    const meetingName = getMeetingNameFromTitle(meetingTitle);

    // Fetch AI instructions from storage
    const storageResult = await chrome.storage.sync.get(['aiInstructions']);
    const aiInstructions = storageResult.aiInstructions || '';

    const mergedTranscript = [];
    transcriptArray.forEach(current => {
        const lastEntry = mergedTranscript[mergedTranscript.length - 1];
        if (lastEntry && lastEntry.Name === current.Name) {
            lastEntry.Text += ' ' + current.Text;
            lastEntry.Time = current.Time;
        } else {
            mergedTranscript.push({ ...current });
        }
    });

    const transcriptText = mergedTranscript.map(entry => 
        `[${entry.Time}] ${entry.Name}: ${entry.Text}`
    ).join('\n\n');
    
    const now = new Date();
    const currentDateTime = now.toLocaleString();
    const metadataHeader = `Meeting Title: ${meetingName}\nDate: ${currentDateTime}`;

    let finalContent = '';
    if (aiInstructions) {
        finalContent += `${aiInstructions}\n\n---\n\n`;
    }
    finalContent += `${metadataHeader}\n\n---\n\n`;
    finalContent += transcriptText;

    let sanitizedTitle = meetingName.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_').trim() || "Meeting";

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${year}-${month}-${day}`;

    const filename = `${datePrefix} - ${sanitizedTitle}-AI.txt`;

    chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(finalContent),
        filename: filename, 
        saveAs: saveAsPrompt
    });
}

function createViewerTab(transcriptArray) {
    chrome.storage.local.set({ captionsToView: transcriptArray }, function() {
        if (chrome.runtime.lastError) {
            console.error("Error saving captions to storage:", chrome.runtime.lastError);
            return;
        }
        chrome.tabs.create({
            url: chrome.runtime.getURL('viewer.html')
        });
    });
}

chrome.runtime.onMessage.addListener(async (message, sender) => {
    console.log("Service worker received message:", message.message);
    
    switch (message.message) {
        case 'download_captions': // message from Content script
            saveTranscripts(message.meetingTitle, message.transcriptArray, true);
            break;

        case 'save_on_leave':
            console.log('Auto-saving transcript on leave...');
            
            const result = await chrome.storage.sync.get(['autoSaveStandard', 'autoSaveAi']);
            
            if (result.autoSaveStandard) {
                console.log('Auto-saving Standard version as per user setting.');
                saveTranscripts(message.meetingTitle, message.transcriptArray, false);
            }
            if (result.autoSaveAi) {
                console.log('Auto-saving AI version as per user setting.');
                await saveAiTranscript(message.meetingTitle, message.transcriptArray, false);
            }
            break;

        case 'display_captions': // message from Content script with captions for viewing
            createViewerTab(message.transcriptArray);
            break;
        
        case 'download_ai_captions':
            // Manual AI save will still prompt the user
            await saveAiTranscript(message.meetingTitle, message.transcriptArray, true);
            break;
    }
});