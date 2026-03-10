/**
 * SonaxSync Content Script
 *
 * Dashboard sayfasina enjekte edilir.
 * Dashboard page <-> Extension background arasinda kopru gorevi gorur.
 *
 * Iletisim:
 *   Dashboard page --[postMessage]--> content.js --[chrome.runtime]--> background.js
 *   background.js --[port.postMessage]--> content.js --[postMessage]--> Dashboard page
 */

(function () {
  // Signal that extension is installed (dashboard page checks this)
  document.documentElement.setAttribute('data-sonax-sync', 'installed');

  // Listen for sync requests from the dashboard page
  window.addEventListener('message', (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    if (event.data && event.data.type === 'SONAX_SYNC_REQUEST') {
      startSync();
    }
  });

  function startSync() {
    // Open a persistent connection to background for progress updates
    const port = chrome.runtime.connect({ name: 'sonax-sync' });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'PROGRESS') {
        // Forward progress to dashboard page
        window.postMessage(
          {
            type: 'SONAX_SYNC_PROGRESS',
            data: msg.data,
          },
          '*'
        );
      } else if (msg.type === 'COMPLETE') {
        // Forward final result to dashboard page
        window.postMessage(
          {
            type: 'SONAX_SYNC_COMPLETE',
            data: msg.data,
          },
          '*'
        );
        port.disconnect();
      }
    });

    port.onDisconnect.addListener(() => {
      // If port disconnects unexpectedly, notify dashboard
      if (chrome.runtime.lastError) {
        window.postMessage(
          {
            type: 'SONAX_SYNC_COMPLETE',
            data: { error: chrome.runtime.lastError.message },
          },
          '*'
        );
      }
    });

    // Start the sync
    port.postMessage({ type: 'start' });
  }

  // Notify dashboard that extension is ready
  window.postMessage({ type: 'SONAX_EXTENSION_READY' }, '*');
})();
