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

function saveTranscripts(meetingTitle, transcriptArray) {
    const yaml = jsonToYaml(transcriptArray);
    chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(yaml),
        filename: meetingTitle + ".txt",
        saveAs: true
    });
}

function saveAiTranscript(meetingTitle, transcriptArray) {
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

    chrome.downloads.download({
        url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(formattedText),
        filename: `${meetingTitle}-AI.txt`,
        saveAs: true
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
            console.log('download_captions triggered!', message);
            saveTranscripts(message.meetingTitle, message.transcriptArray);
            break;

        case 'display_captions': // message from Content script with captions for viewing
            console.log('display_captions triggered!', message);
            createViewerTab(message.transcriptArray);
            break;
        
        case 'download_ai_captions':
            console.log('download_ai triggered!', message);
            saveAiTranscript(message.meetingTitle, message.transcriptArray);
            break;
    }
});