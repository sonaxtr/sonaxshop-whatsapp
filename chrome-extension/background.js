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

const TICIMAX_BASE = 'https://www.sonaxshop.com.tr';
const CART_REPORT_URL = `${TICIMAX_BASE}/Admin/UyeSepetRapor.aspx`;
const LOGIN_URL = `${TICIMAX_BASE}/UyeGiris`;

// --- Port-based messaging for progress updates ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sonax-sync') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type === 'start') {
        try {
          await handleSyncCarts(port);
        } catch (err) {
          port.postMessage({
            type: 'COMPLETE',
            data: { error: err.message || 'Bilinmeyen hata' },
          });
        }
      }
    });
  }
});

// --- Main sync function ---

async function handleSyncCarts(port) {
  const sendProgress = (message) => {
    try {
      port.postMessage({ type: 'PROGRESS', data: { message } });
    } catch {}
  };

  sendProgress('Ticimax admin paneli aciliyor...');

  // Step 1: Open Ticimax cart report page in a background tab
  const tab = await chrome.tabs.create({
    url: CART_REPORT_URL,
    active: false,
  });

  try {
    await waitForTabLoad(tab.id);

    // Step 2: Check if redirected to login page
    const tabInfo = await chrome.tabs.get(tab.id);
    const currentUrl = tabInfo.url || '';

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
      await waitForTabLoad(tab.id);
    }

    sendProgress('Sayfa boyutu ayarlaniyor...');

    // Step 3: Set page size to 100 (max) for fewer pages
    const pageSizeResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
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

    if (pageSizeResult[0]?.result === true) {
      await waitForTabLoad(tab.id);
      await sleep(1000);
    }

    // Step 4: Scrape all pages
    const allRows = [];
    let currentPage = 1;
    let totalPages = 1;

    while (true) {
      sendProgress(`Sayfa ${currentPage} taraniyor...`);

      const scrapeResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeCartReportPage,
      });

      const pageData = scrapeResult[0]?.result;
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

      // Click "next" button for pagination
      const nextResult = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const btn =
            document.getElementById('cphPageContent_btnSonraki') ||
            document.querySelector('a[id*="btnSonraki"]') ||
            document.querySelector('input[id*="btnSonraki"]');
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        },
      });

      if (!nextResult[0]?.result) {
        sendProgress('Sonraki sayfa butonu bulunamadi, durduruluyor');
        break;
      }

      currentPage++;
      await waitForTabLoad(tab.id);
      await sleep(500);
    }

    sendProgress(`Tamamlandi! ${allRows.length} kayit bulundu.`);

    // Close the Ticimax tab
    try {
      await chrome.tabs.remove(tab.id);
    } catch {}

    // Send final result
    port.postMessage({
      type: 'COMPLETE',
      data: {
        rows: allRows,
        totalRecords: allRows.length,
        totalPages,
        source: 'extension',
        syncedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
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
  const totalMatch = bodyText.match(
    /Toplam\s+(\d+)\s+sayfa.*?Toplam\s+(\d+)\s+kay/
  );
  const totalPages = totalMatch ? parseInt(totalMatch[1]) : 1;
  const totalRecords = totalMatch ? parseInt(totalMatch[2]) : 0;

  // Find the data table by looking for "Uye ID" header
  const tables = document.querySelectorAll('table');
  let dataTable = null;

  for (const table of tables) {
    const headerText = table.querySelector('tr')?.innerText || '';
    if (
      headerText.includes('Üye ID') ||
      headerText.includes('UyeID') ||
      headerText.includes('Üye Adı')
    ) {
      dataTable = table;
      break;
    }
  }

  if (!dataTable) {
    // Try finding by GridView ID (ASP.NET convention)
    dataTable =
      document.getElementById('cphPageContent_gvSepetRapor') ||
      document.querySelector('table.GridView') ||
      document.querySelector('[id*="gvSepet"]');
  }

  if (!dataTable) {
    return { rows: [], totalPages, totalRecords, error: 'Tablo bulunamadi' };
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

    rows.push({
      uyeId,
      uyeName: cells[1].textContent.trim(),
      email: cells[2].textContent.trim(),
      phone,
      smsPermit: cells[4].textContent.trim().toLowerCase() === 'evet',
      mailPermit: cells[5].textContent.trim().toLowerCase() === 'evet',
      productCount: parseInt(cells[6].textContent.trim()) || 0,
      cartDate: cells[7].textContent.trim(),
    });
  }

  return { rows, totalPages, totalRecords };
}

// --- Utility functions ---

function waitForTabLoad(tabId, timeoutMs = 30000) {
  return new Promise(async (resolve, reject) => {
    // Check if already complete
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        await sleep(800);
        resolve();
        return;
      }
    } catch {}

    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Sayfa yuklenirken zaman asimi'));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        setTimeout(resolve, 1000); // Extra settle time
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function waitForUrlChange(tabId, excludeText, timeoutMs = 120000) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(
        new Error("Giris bekleniyor - lutfen Ticimax'a giris yapin")
      );
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.url && !info.url.includes(excludeText)) {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(timeout);
        setTimeout(resolve, 2000);
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
