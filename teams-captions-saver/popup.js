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
    const manualStartInfo = document.getElementById('manual-start-info');

    // Load saved settings from storage
    chrome.storage.sync.get(['autoSaveStandard', 'autoSaveAi', 'aiInstructions', 'autoEnableCaptions'], function(result) {
        autoSaveStandardToggle.checked = !!result.autoSaveStandard;
        autoSaveAiToggle.checked = !!result.autoSaveAi;
        autoEnableCaptionsToggle.checked = !!result.autoEnableCaptions;
        aiInstructions.value = result.aiInstructions || '';
        manualStartInfo.style.display = result.autoEnableCaptions ? 'none' : 'block';
    });

    autoSaveStandardToggle.addEventListener('change', function() {
        chrome.storage.sync.set({ autoSaveStandard: this.checked });
    });

    autoSaveAiToggle.addEventListener('change', function() {
        chrome.storage.sync.set({ autoSaveAi: this.checked });
    });
    
    autoEnableCaptionsToggle.addEventListener('change', function() {
        chrome.storage.sync.set({ autoEnableCaptions: this.checked });
        manualStartInfo.style.display = this.checked ? 'none' : 'block';
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

    document.querySelectorAll('.prompt-button').forEach(button => {
        button.addEventListener('click', function() {
            const prompts = {
                "Summarize": "You are a senior analyst. Create a concise summary of the following meeting transcript, intended for an executive who missed the meeting. Format the output using Markdown with two sections: '## Key Discussion Points' and '## Overall Outcome'. Use bullet points under each heading.",
                "List Action Items": "You are a meticulous project coordinator. Your goal is to identify every action item from the transcript. Format the output as a Markdown task list. For each item, state the task and the person assigned. If no person is mentioned, mark it as '(Unassigned)'. Example: - [ ] Jane Doe - Follow up with the marketing team.",
                "Find Decisions": "You are a strategic advisor. Review the transcript and extract only the firm decisions that were finalized. Ignore proposals or undecided topics. List each decision as a numbered item and briefly state the reason for the decision if mentioned. Example: 1. The project deadline will be extended to May 30th to allow for additional QA testing."
            };
            aiInstructions.value = prompts[this.textContent];
            aiInstructions.dispatchEvent(new Event('change'));
        });
    });

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length === 0 || !tabs[0].url.startsWith("https://teams.microsoft.com")) {
            statusMessage.innerHTML = '<a href="https://teams.microsoft.com" target="_blank" rel="noopener noreferrer">Open a Teams tab to use.</a>';
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
        statusMessage.textContent = "Saving standard version...";
        statusMessage.style.color = '#17a2b8';
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
        statusMessage.textContent = "Saving AI version...";
        statusMessage.style.color = '#17a2b8';
        // Get active tab and send message
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {message: "return_transcript_for_ai"});
        });
    });
});