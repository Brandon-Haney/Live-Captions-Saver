// Transcript Interceptor - Injected into page context to intercept fetch() calls
// This runs in the page's context (not the extension's) to access the native fetch API

(function() {
    'use strict';

    console.log('[Recording Transcript] Interceptor initialized');

    const originalFetch = window.fetch;

    window.fetch = function(...args) {
        const url = args[0];

        // Check if this is a Teams recording transcript request
        if (typeof url === 'string' && url.includes('streamContent') && url.includes('format=json')) {
            console.log('[Recording Transcript] Detected transcript request:', url);

            // Call original fetch and intercept the response
            return originalFetch.apply(this, args).then(response => {
                // Clone the response so we can read it without consuming the original
                const clonedResponse = response.clone();

                // Extract the JSON data
                clonedResponse.json().then(data => {
                    console.log('[Recording Transcript] Successfully captured transcript data');

                    // Send the data to the content script via postMessage
                    window.postMessage({
                        type: 'TEAMS_RECORDING_TRANSCRIPT',
                        data: data,
                        url: url,
                        timestamp: new Date().toISOString()
                    }, '*');
                }).catch(err => {
                    console.error('[Recording Transcript] Failed to parse JSON:', err);
                });

                // Return the original response unchanged
                return response;
            });
        }

        // Not a transcript request - pass through unchanged
        return originalFetch.apply(this, args);
    };

    console.log('[Recording Transcript] Fetch interceptor installed');
})();
