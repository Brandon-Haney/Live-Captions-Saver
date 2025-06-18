// Service worker is a script that your browser runs in the background, separate from a web page, opening the door to features that don't need a web page 
// or user interaction.
// Service worker script will be forcefully terminated after about 30 seconds of inactivity, and restarted when it's next needed.
// https://stackoverflow.com/questions/66618136/persistent-service-worker-in-chrome-extension/66618269#66618269

// This code is not used. But without it, the extension does not work
function jsonToYaml(json) {
    return json.map(entry => {
        return `Name: ${entry.Name}\nText: ${entry.Text}\nTime: ${entry.Time}\n----`;
    }).join('\n');
}

function saveTranscripts(meetingTitle, transcriptArray, saveAsPrompt = true) {
    const yaml = jsonToYaml(transcriptArray);
    
    let sanitizedTitle = meetingTitle.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_').trim() || "Meeting";

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

function saveAiTranscript(meetingTitle, transcriptArray, saveAsPrompt = true) {
    if (!transcriptArray || transcriptArray.length === 0) return;

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

    const formattedText = mergedTranscript.map(entry => 
        `[${entry.Time}] ${entry.Name}: ${entry.Text}`
    ).join('\n\n');

    let sanitizedTitle = meetingTitle.replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_').trim() || "Meeting";

    // Create a YYYY-MM-DD formatted date string
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${year}-${month}-${day}`;

    // Construct the final filename with the date prefix and -AI suffix
    const filename = `${datePrefix} - ${sanitizedTitle}-AI.txt`;


    chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(formattedText),
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

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    console.log("Service worker received message:", message.message);
    
    switch (message.message) {
        case 'download_captions': // message from Content script
            saveTranscripts(message.meetingTitle, message.transcriptArray, true);
            break;

        case 'save_on_leave':
            console.log('Auto-saving transcript on leave...');
            // Always save the default version without a prompt
            saveTranscripts(message.meetingTitle, message.transcriptArray, false);
            
            // Also, check if we should save the AI version
            chrome.storage.sync.get(['autoSaveAiVersion'], function(result) {
                if (result.autoSaveAiVersion) {
                    console.log('Also auto-saving AI version as per user setting.');
                    // The 'saveAs' prompt for the AI version is true by default, but we can override to false for auto-save
                    saveAiTranscript(message.meetingTitle, message.transcriptArray, false);
                }
            });
            break;

        case 'display_captions': // message from Content script with captions for viewing
            createViewerTab(message.transcriptArray);
            break;
        
        case 'download_ai_captions':
            // Manual AI save will still prompt the user
            saveAiTranscript(message.meetingTitle, message.transcriptArray);
            break;
    }
});