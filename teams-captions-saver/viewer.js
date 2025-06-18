document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['captionsToView'], function(result) {
        const captionsContainer = document.getElementById('captions-container');
        
        if (result.captionsToView && result.captionsToView.length > 0) {
            const transcriptArray = result.captionsToView;
            const htmlContent = transcriptArray.map(item => `
                <div class="caption">
                    <div class="name">${escapeHtml(item.Name)}</div>
                    <div class="text">${escapeHtml(item.Text)}</div>
                    <div class="time">${escapeHtml(item.Time)}</div>
                </div>
            `).join('');

            captionsContainer.innerHTML = htmlContent;

        } else {
            captionsContainer.innerHTML = '<div class="loading">No captions found or an error occurred.</div>';
        }

        chrome.storage.local.remove('captionsToView');
    });
});

function escapeHtml(str) {
    const p = document.createElement("p");
    p.textContent = str;
    return p.innerHTML;
}