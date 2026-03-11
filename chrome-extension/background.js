/**
 * SonaxSync Background Service Worker
 *
 * Ticimax admin panelinden sepet verilerini ceker.
 * Kullanicinin yerel Chrome session'ini kullanir (residential IP, Cloudflare sorunu yok).
 *
 * Akis:
 *   Dashboard "Verileri Guncelle" -> content.js -> background.js
 *   -> Ticimax tab ac -> login kontrolu -> sayfalari tara -> veriyi don
 */

// Startup log - this confirms the service worker loaded successfully
console.log('[SonaxSync] Background service worker LOADED at', new Date().toISOString());

const TICIMAX_BASE = 'https://www.sonaxshop.com.tr';
const CART_REPORT_URL = `${TICIMAX_BASE}/Admin/UyeSepetRapor.aspx`;

// Log when extension is installed or updated
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[SonaxSync] Extension installed/updated:', details.reason);
});

// --- Port-based messaging for progress updates ---

chrome.runtime.onConnect.addListener((port) => {
  console.log('[SonaxSync] onConnect fired, port name:', port.name);

  if (port.name === 'sonax-sync') {
    console.log('[SonaxSync] Port connected from content script');

    port.onMessage.addListener(async (msg) => {
      console.log('[SonaxSync] Port message received:', msg.type);
      if (msg.type === 'start') {
        console.log('[SonaxSync] Sync started');
        try {
          await handleSyncCarts(port);
        } catch (err) {
          console.error('[SonaxSync] Sync error:', err);
          try {
            port.postMessage({
              type: 'COMPLETE',
              data: { error: err.message || 'Bilinmeyen hata' },
            });
          } catch (e) {
            console.error('[SonaxSync] Could not send error to port:', e);
          }
        }
      }
    });
  }
});

// --- Main sync function ---

async function handleSyncCarts(port) {
  const sendProgress = (message) => {
    console.log('[SonaxSync]', message);
    try {
      port.postMessage({ type: 'PROGRESS', data: { message } });
    } catch (e) {
      console.warn('[SonaxSync] Progress send failed:', e);
    }
  };

  sendProgress('Ticimax admin paneli aciliyor...');

  // Step 1: Open Ticimax cart report page in a background tab
  const tab = await chrome.tabs.create({
    url: CART_REPORT_URL,
    active: false,
  });
  console.log('[SonaxSync] Tab created:', tab.id);

  try {
    await waitForTabComplete(tab.id);

    // Step 2: Check if redirected to login page
    const tabInfo = await chrome.tabs.get(tab.id);
    const currentUrl = tabInfo.url || '';
    console.log('[SonaxSync] Tab URL after load:', currentUrl);

    if (currentUrl.includes('UyeGiris') || currentUrl.includes('Login')) {
      sendProgress('Ticimax girisi gerekiyor - lutfen giris yapin...');

      // Make the tab visible so user can log in
      await chrome.tabs.update(tab.id, { active: true });
      if (tabInfo.windowId) {
        await chrome.windows.update(tabInfo.windowId, { focused: true });
      }

      // Wait for user to log in (max 3 minutes)
      await waitForUrlChange(tab.id, 'UyeGiris', 180000);

      sendProgress('Giris basarili! Sepet raporu aciliyor...');

      // After login, navigate to cart report
      await chrome.tabs.update(tab.id, {
        url: CART_REPORT_URL,
        active: false,
      });
      await waitForTabComplete(tab.id);
    }

    sendProgress('Sayfa boyutu ayarlaniyor...');

    // Step 3: Set page size to 100 (max) for fewer pages
    // IMPORTANT: world:'MAIN' is required to access page JS functions like __doPostBack
    const pageSizeResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const sel = document.getElementById('cphPageContent_ddlKayitSayisi');
        if (sel && sel.value !== '100') {
          sel.value = '100';
          // Trigger ASP.NET postback
          if (typeof __doPostBack === 'function') {
            __doPostBack('ctl00$cphPageContent$ddlKayitSayisi', '');
          } else {
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true; // Page will reload
        }
        return false; // Already set to 100
      },
    });

    console.log('[SonaxSync] Page size changed:', pageSizeResult[0]?.result);

    if (pageSizeResult[0]?.result === true) {
      // Wait for ASP.NET postback navigation: loading -> complete
      await waitForNavigation(tab.id);
    }

    // Step 3.5: Debug - capture page structure info before scraping
    const debugResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        const bodyText = document.body.innerText || '';
        // Find pagination text
        const pagMatch = bodyText.match(/Toplam[\s\S]{0,200}?kayit[\s\S]{0,100}?bulun\S*/i) ||
                         bodyText.match(/Toplam[\s\S]{0,200}?sayfa\S*/);
        const paginationText = pagMatch ? pagMatch[0].substring(0, 300) : 'NOT FOUND';

        // Find all buttons with "Sonraki" or next-like text
        const allBtns = [];
        document.querySelectorAll('a, input, button').forEach((el) => {
          const text = (el.textContent || '').trim();
          const id = el.id || '';
          const href = el.getAttribute('href') || '';
          if (id.includes('Sonraki') || id.includes('sonraki') ||
              text.includes('Sonraki') || text.includes('>') ||
              href.includes('Sonraki') || href.includes('btnSonraki')) {
            allBtns.push({
              tag: el.tagName, id, text: text.substring(0, 50),
              href: href.substring(0, 150),
              disabled: el.disabled || false,
            });
          }
        });

        // Check __doPostBack availability
        const hasDoPostBack = typeof __doPostBack === 'function';

        return { paginationText, buttons: allBtns, hasDoPostBack };
      },
    });
    console.log('[SonaxSync] DEBUG - Page structure:', JSON.stringify(debugResult[0]?.result, null, 2));

    // Step 4: Scrape all pages
    const allRows = [];
    let currentPage = 1;
    let totalPages = 1;

    while (true) {
      sendProgress(`Sayfa ${currentPage} taraniyor...`);

      const scrapeResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: scrapeCartReportPage,
      });

      const pageData = scrapeResult[0]?.result;
      console.log('[SonaxSync] Page', currentPage, 'scrape result:', {
        rows: pageData?.rows?.length,
        totalPages: pageData?.totalPages,
        currentPageNum: pageData?.currentPageNum,
        error: pageData?.error,
      });

      if (!pageData || !pageData.rows) {
        sendProgress('Tablo bulunamadi!');
        break;
      }

      allRows.push(...pageData.rows);
      totalPages = pageData.totalPages || 1;

      sendProgress(
        `Sayfa ${currentPage}/${totalPages} tamamlandi (${allRows.length} kayit)`
      );

      // Check if more pages exist
      if (currentPage >= totalPages) break;

      // Click "next" button for pagination using __doPostBack
      // IMPORTANT: world:'MAIN' is required to access __doPostBack
      const nextResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: () => {
          // Strategy 1: Use __doPostBack directly (most reliable for ASP.NET)
          if (typeof __doPostBack === 'function') {
            // Try common ASP.NET postback target names for "next" button
            const possibleTargets = [
              'ctl00$cphPageContent$btnSonraki',
              'cphPageContent$btnSonraki',
            ];

            // Also try to extract the target from the button's href
            const btn =
              document.getElementById('cphPageContent_btnSonraki') ||
              document.querySelector('a[id*="btnSonraki"]') ||
              document.querySelector('input[id*="btnSonraki"]');

            if (btn) {
              const href = btn.getAttribute('href') || '';
              const onclickAttr = btn.getAttribute('onclick') || '';
              const btnTag = btn.tagName;
              const btnType = btn.type || '';

              console.log('[SonaxSync-page] Next button found:', {
                tag: btnTag, id: btn.id, type: btnType,
                href: href.substring(0, 100),
                onclick: onclickAttr.substring(0, 100),
                disabled: btn.disabled,
              });

              // Extract __doPostBack target from href like: javascript:__doPostBack('target','')
              const postbackMatch = href.match(/__doPostBack\('([^']+)'/);
              if (postbackMatch) {
                possibleTargets.unshift(postbackMatch[1]); // Add extracted target first
              }

              // For input/button types, just click (they submit forms)
              if (btnTag === 'INPUT' || btnTag === 'BUTTON') {
                btn.click();
                return { clicked: true, method: 'input-click', target: btn.id };
              }
            }

            // Execute __doPostBack with the first available target
            for (const target of possibleTargets) {
              try {
                __doPostBack(target, '');
                return { clicked: true, method: '__doPostBack', target };
              } catch (e) {
                console.warn('[SonaxSync-page] __doPostBack failed for', target, e.message);
              }
            }
          }

          // Strategy 2: Click the button element directly (fallback)
          const btn =
            document.getElementById('cphPageContent_btnSonraki') ||
            document.querySelector('a[id*="btnSonraki"]') ||
            document.querySelector('input[id*="btnSonraki"]');

          if (btn) {
            // For <a> tags with javascript: href, eval the href
            const href = btn.getAttribute('href') || '';
            if (href.startsWith('javascript:')) {
              try {
                eval(href.replace('javascript:', ''));
                return { clicked: true, method: 'eval-href', target: btn.id };
              } catch (e) {
                console.warn('[SonaxSync-page] eval href failed:', e.message);
              }
            }

            btn.click();
            return { clicked: true, method: 'click-fallback', target: btn.id };
          }

          // Strategy 3: Look for any pagination links
          const paginationLinks = document.querySelectorAll('a[href*="__doPostBack"][href*="Sonraki"]');
          if (paginationLinks.length > 0) {
            const href = paginationLinks[0].getAttribute('href') || '';
            const m = href.match(/__doPostBack\('([^']+)'/);
            if (m) {
              __doPostBack(m[1], '');
              return { clicked: true, method: 'pagination-link', target: m[1] };
            }
          }

          return { clicked: false, method: 'none' };
        },
      });

      const clickInfo = nextResult[0]?.result;
      console.log('[SonaxSync] Next button result:', JSON.stringify(clickInfo));

      if (!clickInfo?.clicked) {
        sendProgress('Sonraki sayfa butonu bulunamadi, durduruluyor');
        break;
      }

      sendProgress(`Sayfa ${currentPage + 1} yukleniyor... (${clickInfo.method})`);
      currentPage++;

      // Wait for page content to actually change (not just tab loading status)
      // ASP.NET postbacks can complete too fast for tab status polling
      const changed = await waitForPageContentChange(tab.id, currentPage, pageData.rows?.[0]?.uyeId);

      if (!changed) {
        sendProgress(`Sayfa ${currentPage} yuklenemedi - sayfa icerigi degismedi. Durduruluyor.`);
        console.error('[SonaxSync] Page content did not change after clicking next. Stopping.');
        break;
      }
    }

    console.log('[SonaxSync] Scraping complete. Total rows:', allRows.length);

    // Deduplicate by uyeId - keep the row with the latest cartDate for each member
    sendProgress('Tekrar eden kayitlar temizleniyor...');
    const uniqueMap = new Map();
    for (const row of allRows) {
      const existing = uniqueMap.get(row.uyeId);
      if (!existing) {
        uniqueMap.set(row.uyeId, row);
      } else {
        // Keep the one with the latest cart date
        // Turkish date format: DD.MM.YYYY HH:mm:ss
        const parseDate = (s) => {
          const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2}):?(\d{2})?/);
          if (!m) return 0;
          return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime();
        };
        if (parseDate(row.cartDate) > parseDate(existing.cartDate)) {
          uniqueMap.set(row.uyeId, row);
        }
      }
    }
    const dedupedRows = Array.from(uniqueMap.values());
    console.log('[SonaxSync] Deduplication:', allRows.length, '->', dedupedRows.length, 'unique members');
    sendProgress(`Tamamlandi! ${dedupedRows.length} tekil uye bulundu (${allRows.length} kayittan).`);

    // Close the Ticimax tab
    try {
      await chrome.tabs.remove(tab.id);
    } catch {}

    // Send final result
    port.postMessage({
      type: 'COMPLETE',
      data: {
        rows: dedupedRows,
        totalRecords: dedupedRows.length,
        rawTotal: allRows.length,
        totalPages,
        source: 'extension',
        syncedAt: new Date().toISOString(),
      },
    });
    console.log('[SonaxSync] COMPLETE message sent with', dedupedRows.length, 'unique rows');
  } catch (err) {
    console.error('[SonaxSync] Error in handleSyncCarts:', err);
    // Clean up tab on error
    try {
      await chrome.tabs.remove(tab.id);
    } catch {}
    throw err;
  }
}

// --- Scraping function (runs in Ticimax page context) ---

function scrapeCartReportPage() {
  // Parse pagination info: "Toplam X sayfanin Y sayfasindasiniz. Toplam Z kayit bulunmaktadir."
  const bodyText = document.body.innerText || '';
  // Pattern: "Toplam 8 sayfanın 1 sayfasındasınız. Toplam 708 kayıt bulunmaktadır."
  const totalMatch = bodyText.match(
    /Toplam\s+(\d+)\s+sayfa\S*\s+(\d+)\s+sayfa.*?Toplam\s+(\d+)\s+kay/
  );
  const totalPages = totalMatch ? parseInt(totalMatch[1]) : 1;
  const currentPageNum = totalMatch ? parseInt(totalMatch[2]) : 1;
  const totalRecords = totalMatch ? parseInt(totalMatch[3]) : 0;

  // Find the data table by looking for header text
  const tables = document.querySelectorAll('table');
  let dataTable = null;

  for (const table of tables) {
    const firstRow = table.querySelector('tr');
    if (!firstRow) continue;
    const headerText = firstRow.innerText || '';
    if (
      headerText.includes('Üye ID') ||
      headerText.includes('UyeID') ||
      headerText.includes('Üye Adı') ||
      headerText.includes('Uye ID')
    ) {
      dataTable = table;
      break;
    }
  }

  if (!dataTable) {
    // Try finding by ASP.NET GridView ID patterns
    dataTable =
      document.getElementById('cphPageContent_gvSepetRapor') ||
      document.querySelector('[id*="gvSepet"]') ||
      document.querySelector('[id*="GridView"]') ||
      document.querySelector('table.GridView');
  }

  if (!dataTable) {
    // Last resort: find the largest table on the page
    let maxRows = 0;
    for (const table of tables) {
      const rowCount = table.querySelectorAll('tr').length;
      if (rowCount > maxRows) {
        maxRows = rowCount;
        dataTable = table;
      }
    }
  }

  if (!dataTable) {
    return {
      rows: [],
      totalPages,
      totalRecords,
      error: 'Tablo bulunamadi. Tables found: ' + tables.length,
    };
  }

  const rows = [];
  const trs = dataTable.querySelectorAll('tr');

  for (let i = 1; i < trs.length; i++) {
    // Skip header row
    const cells = trs[i].querySelectorAll('td');
    if (cells.length < 8) continue;

    const uyeId = parseInt(cells[0].textContent.trim()) || 0;
    if (uyeId <= 0) continue;

    const phone = cells[3].textContent
      .trim()
      .replace(/\s+/g, '')
      .replace(/\+/g, '');

    // Extract cart GUID from action column (last cell)
    let cartGuid = '';
    const lastCell = cells[cells.length - 1];
    if (lastCell) {
      const sepetLink = lastCell.querySelector('a[href*="openUyeSepet"]');
      if (sepetLink) {
        const href = sepetLink.getAttribute('href') || '';
        const guidMatch = href.match(/openUyeSepet\('([^']+)'\)/);
        if (guidMatch) cartGuid = guidMatch[1];
      }
    }

    rows.push({
      uyeId,
      uyeName: cells[1].textContent.trim(),
      email: cells[2].textContent.trim(),
      phone,
      smsPermit: cells[4].textContent.trim().toLowerCase() === 'evet',
      mailPermit: cells[5].textContent.trim().toLowerCase() === 'evet',
      productCount: parseInt(cells[6].textContent.trim()) || 0,
      cartDate: cells[7].textContent.trim(),
      cartGuid,
    });
  }

  return { rows, totalPages, totalRecords, currentPageNum };
}

// --- Utility functions ---
// ALL wait functions use POLLING instead of event listeners.
// This keeps the service worker active and prevents Chrome from killing it
// (MV3 service workers are terminated after ~30s of idle time).

/**
 * Wait for a tab to complete loading (initial load).
 * Uses polling to keep service worker alive.
 */
async function waitForTabComplete(tabId, timeoutMs = 60000) {
  const startTime = Date.now();
  console.log('[SonaxSync] waitForTabComplete start, tabId:', tabId);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        console.log('[SonaxSync] Tab complete after', Date.now() - startTime, 'ms');
        await sleep(800);
        return;
      }
    } catch (e) {
      console.warn('[SonaxSync] Tab get error:', e.message);
      return;
    }
    await sleep(500); // Poll every 500ms - keeps service worker active
  }
  console.warn('[SonaxSync] waitForTabComplete timeout after', timeoutMs, 'ms');
}

/**
 * Wait for page content to actually change after clicking next/prev button.
 * Instead of relying on tab loading status (which can miss fast ASP.NET postbacks),
 * we check the actual page content by looking at the pagination text and first row.
 * Uses polling to keep service worker alive.
 */
async function waitForPageContentChange(tabId, expectedPage, oldFirstUyeId, timeoutMs = 30000) {
  const startTime = Date.now();
  console.log('[SonaxSync] waitForPageContentChange: expecting page', expectedPage, ', old first uyeId:', oldFirstUyeId);

  // First, give the postback a moment to start
  await sleep(500);

  while (Date.now() - startTime < timeoutMs) {
    // First, wait for tab to be in "complete" state
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status !== 'complete') {
        console.log('[SonaxSync] Tab still loading...');
        await sleep(300);
        continue;
      }
    } catch (e) {
      console.warn('[SonaxSync] Tab get error during content check:', e.message);
      return false;
    }

    // Check the actual page content
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => {
          // Get current page number from pagination text
          const bodyText = document.body.innerText || '';

          // Try multiple regex patterns for Turkish pagination text
          let currentPage = -1;

          // Pattern 1: "Toplam X sayfanın Y sayfasındasınız"
          const m1 = bodyText.match(/Toplam\s+\d+\s+sayfa\S*\s+(\d+)\s+sayfa/);
          if (m1) currentPage = parseInt(m1[1]);

          // Pattern 2: "X. sayfadasınız" or "X. sayfa"
          if (currentPage === -1) {
            const m2 = bodyText.match(/(\d+)\.\s*sayfa/);
            if (m2) currentPage = parseInt(m2[1]);
          }

          // Pattern 3: Look for active/selected page number in pager
          if (currentPage === -1) {
            const pagerSpan = document.querySelector('span[disabled]');
            if (pagerSpan) {
              const num = parseInt(pagerSpan.textContent.trim());
              if (num > 0) currentPage = num;
            }
          }

          // Get first data row's uyeId as fingerprint
          let firstUyeId = -1;
          // Try by ASP.NET ID first
          let dataTable = document.getElementById('cphPageContent_gvSepetRapor') ||
                          document.querySelector('[id*="gvSepet"]');

          if (!dataTable) {
            const tables = document.querySelectorAll('table');
            for (const table of tables) {
              const firstRow = table.querySelector('tr');
              if (!firstRow) continue;
              const headerText = firstRow.innerText || '';
              if (headerText.includes('Üye ID') || headerText.includes('UyeID') ||
                  headerText.includes('Üye Adı') || headerText.includes('Uye ID')) {
                dataTable = table;
                break;
              }
            }
          }

          if (dataTable) {
            const dataRows = dataTable.querySelectorAll('tr');
            if (dataRows.length > 1) {
              const cells = dataRows[1].querySelectorAll('td');
              if (cells.length > 0) {
                firstUyeId = parseInt(cells[0].textContent.trim()) || -1;
              }
            }
          }

          // Also capture pagination text for debugging
          const paginationText = bodyText.match(/Toplam.+?kayit.+?bulun\S*/i)?.[0] ||
                                 bodyText.match(/Toplam.+?sayfa\S*/)?.[0] || '';

          return { currentPage, firstUyeId, paginationText: paginationText.substring(0, 200) };
        },
      });

      const pageInfo = result[0]?.result;
      if (pageInfo) {
        console.log('[SonaxSync] Content check: page', pageInfo.currentPage,
                     ', first uyeId:', pageInfo.firstUyeId,
                     ', paginationText:', pageInfo.paginationText);

        // Content has changed if either:
        // 1. Page number matches expected page, OR
        // 2. First row's uyeId is different from the old one
        const pageChanged = pageInfo.currentPage === expectedPage;
        const contentChanged = oldFirstUyeId != null && pageInfo.firstUyeId !== oldFirstUyeId && pageInfo.firstUyeId > 0;

        if (pageChanged || contentChanged) {
          console.log('[SonaxSync] Page content changed! Page:', pageInfo.currentPage,
                       'pageChanged:', pageChanged, 'contentChanged:', contentChanged,
                       'after', Date.now() - startTime, 'ms');
          await sleep(500); // Small buffer for DOM to settle
          return true;
        }
      }
    } catch (e) {
      console.warn('[SonaxSync] Content check script error:', e.message);
      // Page might be mid-navigation, keep polling
    }

    await sleep(400); // Poll every 400ms
  }

  console.error('[SonaxSync] waitForPageContentChange TIMEOUT after', timeoutMs, 'ms. Expected page:', expectedPage, 'Old uyeId:', oldFirstUyeId);
  return false;
}

/**
 * Wait for a navigation to complete after a postback (e.g. page size change).
 * Uses tab status polling + content readiness check.
 * Uses polling to keep service worker alive.
 */
async function waitForNavigation(tabId, timeoutMs = 60000) {
  const startTime = Date.now();
  console.log('[SonaxSync] waitForNavigation start');

  // Phase 1: Wait for page to START loading (max 5 seconds)
  let sawLoading = false;
  while (Date.now() - startTime < 5000) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'loading') {
        sawLoading = true;
        console.log('[SonaxSync] Navigation started (loading)');
        break;
      }
    } catch (e) {
      return;
    }
    await sleep(200);
  }

  // Phase 2: Wait for page to FINISH loading
  if (sawLoading) {
    while (Date.now() - startTime < timeoutMs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          console.log('[SonaxSync] Navigation complete after', Date.now() - startTime, 'ms');
          await sleep(800);
          return;
        }
      } catch (e) {
        return;
      }
      await sleep(500);
    }
  } else {
    // Postback might have completed too fast - just wait a bit for DOM to settle
    console.warn('[SonaxSync] Navigation did not start within 5s, waiting for DOM settle');
    await sleep(2000);
  }
  console.warn('[SonaxSync] waitForNavigation done');
}

/**
 * Wait for URL to change (e.g. after user logs in).
 * Uses polling to keep service worker alive.
 */
async function waitForUrlChange(tabId, excludeText, timeoutMs = 120000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && !tab.url.includes(excludeText)) {
        console.log('[SonaxSync] URL changed to:', tab.url);
        await sleep(2000);
        return;
      }
    } catch (e) {
      return;
    }
    await sleep(1000); // Poll every second
  }
  throw new Error("Giris bekleniyor - lutfen Ticimax'a giris yapin");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
