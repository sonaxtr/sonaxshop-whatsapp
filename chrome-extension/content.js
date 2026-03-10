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
  // Prevent multiple content scripts from running simultaneously
  // (Chrome may inject the script more than once after extension reload)
  if (window.__sonaxSyncLoaded) {
    console.log('[SonaxSync] Content script already loaded, skipping duplicate');
    return;
  }
  window.__sonaxSyncLoaded = true;

  console.log('[SonaxSync] Content script loaded on', window.location.href);

  // Signal that extension is installed (dashboard page checks this attribute)
  document.documentElement.setAttribute('data-sonax-sync', 'installed');

  let syncInProgress = false;

  // Listen for sync requests from the dashboard page
  window.addEventListener('message', (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return;

    if (event.data && event.data.type === 'SONAX_SYNC_REQUEST') {
      if (syncInProgress) {
        console.log('[SonaxSync] Sync already in progress, ignoring duplicate request');
        return;
      }
      console.log('[SonaxSync] Sync request received from page');
      startSync();
    }
  });

  function startSync() {
    syncInProgress = true;
    let completed = false;
    let port;

    try {
      port = chrome.runtime.connect({ name: 'sonax-sync' });
      console.log('[SonaxSync] Port connected to background');
    } catch (err) {
      console.error('[SonaxSync] Failed to connect to background:', err);

      // Common error: "Extension context invalidated" - extension was reloaded but page wasn't refreshed
      syncInProgress = false;
      const errorMsg = err.message || 'Extension baglantisi kurulamadi';
      let userMessage = errorMsg;
      if (errorMsg.includes('invalidated') || errorMsg.includes('context')) {
        userMessage = 'Extension yeniden yuklendi - lutfen sayfayi yenileyiniz (F5)';
      } else if (errorMsg.includes('Receiving end does not exist')) {
        userMessage =
          'Extension background servisi bulunamadi - chrome://extensions adresinden extension aktif oldugundan emin olun';
      }

      window.postMessage(
        { type: 'SONAX_SYNC_COMPLETE', data: { error: userMessage } },
        '*'
      );
      return;
    }

    port.onMessage.addListener((msg) => {
      console.log(
        '[SonaxSync] Message from background:',
        msg.type,
        msg.data?.message || ''
      );

      if (msg.type === 'PROGRESS') {
        // Forward progress to dashboard page
        window.postMessage(
          { type: 'SONAX_SYNC_PROGRESS', data: msg.data },
          '*'
        );
      } else if (msg.type === 'COMPLETE') {
        completed = true;
        syncInProgress = false;
        console.log(
          '[SonaxSync] Sync complete. Rows:',
          msg.data?.rows?.length || 0,
          'Error:',
          msg.data?.error || 'none'
        );
        // Forward final result to dashboard page
        window.postMessage(
          { type: 'SONAX_SYNC_COMPLETE', data: msg.data },
          '*'
        );
        try {
          port.disconnect();
        } catch {}
      }
    });

    port.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError?.message || '';
      console.log(
        '[SonaxSync] Port disconnected. Completed:',
        completed,
        'LastError:',
        lastError
      );

      // If not yet completed, notify dashboard of the disconnection
      if (!completed) {
        syncInProgress = false;
        let errorMsg =
          lastError || 'Extension baglantisi kesildi (service worker durmus olabilir)';

        // Provide actionable error messages
        if (lastError.includes('message port closed')) {
          errorMsg =
            'Background service worker durdu. chrome://extensions sayfasindan extension\'i yenileyip tekrar deneyin.';
        }

        window.postMessage(
          { type: 'SONAX_SYNC_COMPLETE', data: { error: errorMsg } },
          '*'
        );
      }
    });

    // Start the sync
    try {
      port.postMessage({ type: 'start' });
      console.log('[SonaxSync] Start message sent to background');
    } catch (err) {
      console.error('[SonaxSync] Failed to send start message:', err);
      window.postMessage(
        {
          type: 'SONAX_SYNC_COMPLETE',
          data: { error: 'Background\'a mesaj gonderilemedi: ' + err.message },
        },
        '*'
      );
    }
  }

  // Notify dashboard that extension is ready
  window.postMessage({ type: 'SONAX_EXTENSION_READY' }, '*');
  console.log('[SonaxSync] Extension ready signal sent');
})();
