document.addEventListener('DOMContentLoaded', function () {
    // Code inside this block will execute after the extension is fully loaded
    console.log('popup.js loaded!');   

    const saveButton = document.getElementById('saveButton');
    const viewButton = document.getElementById('viewButton');
    const saveAiButton = document.getElementById('saveAiButton');
    const statusMessage = document.getElementById('status-message');
    const autoSaveToggle = document.getElementById('autoSaveToggle');
    const autoSaveAiToggle = document.getElementById('autoSaveAiToggle');

    function handleToggleDependency() {
        const subSettingItem = autoSaveAiToggle.closest('.setting-item');

        if (autoSaveToggle.checked) {
            autoSaveAiToggle.disabled = false;
            subSettingItem.classList.remove('disabled');
        } else {
            autoSaveAiToggle.disabled = true;
            autoSaveAiToggle.checked = false;
            chrome.storage.sync.set({ autoSaveAiVersion: false });
            subSettingItem.classList.add('disabled');
        }
    }

    chrome.storage.sync.get(['autoSaveOnLeave', 'autoSaveAiVersion'], function(result) {
        autoSaveToggle.checked = !!result.autoSaveOnLeave;
        autoSaveAiToggle.checked = !!result.autoSaveAiVersion;
        handleToggleDependency();
    });

    autoSaveToggle.addEventListener('change', function() {
        chrome.storage.sync.set({ autoSaveOnLeave: this.checked });
        handleToggleDependency();
    });

    autoSaveAiToggle.addEventListener('change', function() {
        chrome.storage.sync.set({ autoSaveAiVersion: this.checked });
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