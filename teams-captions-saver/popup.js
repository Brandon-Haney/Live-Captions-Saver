document.addEventListener('DOMContentLoaded', function () {
    // Code inside this block will execute after the extension is fully loaded
    console.log('popup.js loaded!');   

    const saveButton = document.getElementById('saveButton');
    const viewButton = document.getElementById('viewButton');
    const saveAiButton = document.getElementById('saveAiButton');
    const statusMessage = document.getElementById('status-message');
    const autoSaveStandardToggle = document.getElementById('autoSaveStandardToggle');
    const autoSaveAiToggle = document.getElementById('autoSaveAiToggle');
    const aiInstructions = document.getElementById('aiInstructions');
    const autoEnableCaptionsToggle = document.getElementById('autoEnableCaptionsToggle');

    // Load saved settings from storage
    chrome.storage.sync.get(['autoSaveStandard', 'autoSaveAi', 'aiInstructions', 'autoEnableCaptions'], function(result) {
        autoSaveStandardToggle.checked = !!result.autoSaveStandard;
        autoSaveAiToggle.checked = !!result.autoSaveAi;
        autoEnableCaptionsToggle.checked = !!result.autoEnableCaptions;
        aiInstructions.value = result.aiInstructions || '';
    });

    autoSaveStandardToggle.addEventListener('change', function() {
        chrome.storage.sync.set({ autoSaveStandard: this.checked });
    });

    autoSaveAiToggle.addEventListener('change', function() {
        chrome.storage.sync.set({ autoSaveAi: this.checked });
    });
    
    autoEnableCaptionsToggle.addEventListener('change', function() {
        chrome.storage.sync.set({ autoEnableCaptions: this.checked });
    });

    aiInstructions.addEventListener('change', function() {
        console.log("AI instructions changed and saved.");
        chrome.storage.sync.set({ aiInstructions: this.value });
    });

    function updatePopupUI(status) {
        saveButton.disabled = true;
        viewButton.disabled = true;
        saveAiButton.disabled = true;

        if (!status || !status.capturing) {
            statusMessage.textContent = 'Not capturing. In a meeting?';
            statusMessage.style.color = '#dc3545';
        } else if (status.captionCount === 0) {
            statusMessage.textContent = 'Capturing... (Waiting for speech)';
            statusMessage.style.color = '#ffc107';
        } else {
            statusMessage.textContent = `Capturing! (${status.captionCount} lines recorded)`;
            statusMessage.style.color = '#28a745';
            saveButton.disabled = false;
            viewButton.disabled = false;
            saveAiButton.disabled = false;
        }
    }

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length === 0 || !tabs[0].url.startsWith("https://teams.microsoft.com")) {
            statusMessage.textContent = "Open a Teams tab to use.";
            statusMessage.style.color = '#dc3545';
            return;
        }
        chrome.tabs.sendMessage(tabs[0].id, { message: "get_status" }, function(response) {
            if (chrome.runtime.lastError) {
                console.log(chrome.runtime.lastError.message);
                statusMessage.textContent = "Error: Refresh your Teams tab.";
                statusMessage.style.color = '#dc3545';
            } else {
                updatePopupUI(response);
            }
        });
    });

    saveButton.addEventListener('click', function () {
        console.log('save_captions clicked!');
        // Get active tab and send message
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {message: "return_transcript"});
        });
    });

    viewButton.addEventListener('click', function () {
        console.log('view_captions clicked!');
        // Get active tab and send message
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {message: "get_captions_for_viewing"});
        });
    });
    
    saveAiButton.addEventListener('click', function () {
        console.log('AI_transcript clicked!');
        // Get active tab and send message
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {message: "return_transcript_for_ai"});
        });
    });
});