import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer-core';
import * as cheerio from 'cheerio';
import { config } from '../config';
import { logger } from '../utils/logger';

// Apply stealth plugin to bypass Cloudflare bot detection
puppeteer.use(StealthPlugin());

export interface CartReportRow {
  uyeId: number;
  uyeName: string;
  email: string;
  phone: string;
  smsPermit: boolean;
  mailPermit: boolean;
  productCount: number;
  cartDate: string;
}

interface ScrapeResult {
  rows: CartReportRow[];
  totalRecords: number;
  totalPages: number;
  currentPage: number;
}

/**
 * Ticimax Admin Panel Scraper (Puppeteer-based)
 *
 * Uses headless Chromium + stealth plugin to bypass Cloudflare JS challenge.
 * Scrapes UyeSepetRapor.aspx for abandoned cart data.
 *
 * Architecture:
 *   Launch Chromium → Login via /UyeGiris → Navigate to UyeSepetRapor.aspx → Parse HTML
 *
 * This gives 700+ records vs SOAP SelectSepet (~100, mostly anonymous).
 * Results are cached for 5 minutes to avoid excessive browser launches.
 */
export class TicimaxAdminScraper {
  private baseUrl: string;
  private username: string;
  private password: string;

  // Result cache to avoid frequent browser launches
  private cache: { rows: CartReportRow[]; totalRecords: number; timestamp: number } | null = null;
  private static CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Mutex: prevent concurrent scraping (single browser at a time)
  private activeScrape: Promise<{ rows: CartReportRow[]; totalRecords: number }> | null = null;

  constructor() {
    this.baseUrl = (config.ticimax.adminUrl || '').replace(/\/$/, '');
    this.username = config.ticimax.adminUser || '';
    this.password = config.ticimax.adminPass || '';
  }

  /**
   * Get Chromium executable path based on environment
   */
  private getChromiumPath(): string | undefined {
    // Docker/Render: set via env var
    if (process.env.CHROMIUM_PATH) {
      return process.env.CHROMIUM_PATH;
    }

    // Linux: system Chromium
    if (process.platform === 'linux') {
      return '/usr/bin/chromium';
    }

    // Windows: try common Chrome locations (for local dev)
    if (process.platform === 'win32') {
      const paths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      ];
      // Return first path (puppeteer will error if not found)
      return paths[0];
    }

    // macOS
    if (process.platform === 'darwin') {
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    }

    return undefined;
  }

  /**
   * Launch a fresh browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    const executablePath = this.getChromiumPath();

    logger.info('Launching Chromium for scraping...', {
      executablePath: executablePath || 'auto',
      platform: process.platform,
    });

    const browser = await puppeteer.launch({
      executablePath,
      headless: 'new' as any, // Chrome's new headless mode (less detectable)
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-zygote',
        // Anti-detection flags
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--enable-features=NetworkService,NetworkServiceInProcess',
        // Standard flags
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
        '--window-size=1366,768',
        '--lang=en-US',
      ],
      ignoreDefaultArgs: ['--enable-automation'], // Remove "Chrome is being controlled" flag
    });

    return browser as unknown as Browser;
  }

  /**
   * Check if page title indicates a Cloudflare challenge
   * Cloudflare shows localized titles: "Just a moment..." (EN), "Bir dakika lütfen..." (TR), etc.
   */
  private isCloudflareChallenge(title: string): boolean {
    const lower = title.toLowerCase();
    return (
      lower.includes('just a moment') ||
      lower.includes('bir dakika') ||       // Turkish
      lower.includes('un moment') ||         // French
      lower.includes('einen moment') ||      // German
      lower.includes('un momento') ||        // Spanish/Italian
      lower.includes('cloudflare') ||
      lower.includes('challenge') ||
      lower === ''                           // Empty title during challenge load
    );
  }

  /**
   * Wait for Cloudflare JS challenge to resolve
   * The challenge page shows localized "Just a moment..." title while JS runs
   */
  private async waitForCloudflare(page: Page, maxWaitMs: number = 30000): Promise<void> {
    const startTime = Date.now();

    // Initial wait for page to settle
    await new Promise((r) => setTimeout(r, 2000));

    while (Date.now() - startTime < maxWaitMs) {
      const title = await page.title();
      if (!this.isCloudflareChallenge(title)) {
        logger.info('Page ready (Cloudflare passed)', {
          title,
          elapsed: Math.round((Date.now() - startTime) / 1000) + 's',
        });
        return;
      }
      logger.info('Waiting for Cloudflare challenge...', {
        title,
        elapsed: Math.round((Date.now() - startTime) / 1000) + 's',
      });
      await new Promise((r) => setTimeout(r, 3000));
    }

    const finalTitle = await page.title();
    if (this.isCloudflareChallenge(finalTitle)) {
      throw new Error(`Cloudflare challenge not resolved in ${maxWaitMs / 1000}s. Title: ${finalTitle}`);
    }
  }

  /**
   * Login to Ticimax admin panel via /UyeGiris
   * Returns authenticated page ready for admin navigation
   */
  private async loginAndGetPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();

    // Realistic Chrome user agent (Chrome 131 on Windows)
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9,tr-TR;q=0.8,tr;q=0.7',
    });

    // Manual stealth patches (safety net alongside stealth plugin)
    await page.evaluateOnNewDocument(`
      // Remove webdriver flag
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Fake chrome object
      window.chrome = {
        runtime: { onConnect: { addListener: function(){} }, onMessage: { addListener: function(){} } },
        loadTimes: function(){ return {} },
        csi: function(){ return {} }
      };

      // Override permissions query
      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = function(params) {
        if (params.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission });
        }
        return originalQuery(params);
      };

      // Fake plugins array (non-empty)
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ]
      });

      // Hardware concurrency
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

      // Languages
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en', 'tr'] });

      // WebGL vendor/renderer (fake real GPU)
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Google Inc. (NVIDIA)';
        if (parameter === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)';
        return getParameter.call(this, parameter);
      };
    `);

    // Navigate to login page
    const loginUrl = `${this.baseUrl}/UyeGiris?ReturnUrl=%2fAdmin%2fLogin.aspx`;
    logger.info('Navigating to login page...', { url: loginUrl });

    await page.goto(loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await this.waitForCloudflare(page);

    // Wait for login form
    logger.info('Login page loaded, filling credentials...');
    await page.waitForSelector(
      'input[name="txtUyeGirisEmail"], input[id*="txtUyeGirisEmail"]',
      { timeout: 10000 }
    );

    // Fill email
    const emailInput = await page.$('input[name="txtUyeGirisEmail"]') ||
                       await page.$('input[id*="txtUyeGirisEmail"]');
    if (!emailInput) throw new Error('Email input not found on login page');
    await emailInput.click({ clickCount: 3 });
    await emailInput.type(this.username, { delay: 30 });

    // Fill password
    const passInput = await page.$('input[name="txtUyeGirisPassword"]') ||
                      await page.$('input[id*="txtUyeGirisPassword"]');
    if (!passInput) throw new Error('Password input not found on login page');
    await passInput.click({ clickCount: 3 });
    await passInput.type(this.password, { delay: 30 });

    // Submit form — find submit button
    logger.info('Submitting login form...');
    const submitBtn = await page.$('input[type="submit"]') ||
                      await page.$('button[type="submit"]') ||
                      await page.$('.btnGirisYap') ||
                      await page.$('a.btnGirisYap');

    if (submitBtn) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        submitBtn.click(),
      ]);
    } else {
      // Fallback: press Enter
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        page.keyboard.press('Enter'),
      ]);
    }

    // Wait for any post-login Cloudflare challenge
    await this.waitForCloudflare(page);

    const currentUrl = page.url();
    logger.info('After login', { url: currentUrl });

    // Verify login success
    if (currentUrl.includes('/UyeGiris') && !currentUrl.includes('ReturnUrl')) {
      // Still on login page = login failed
      const pageHtml = await page.content();
      const errorHint = pageHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 200);
      throw new Error(`Login failed - still on login page. Page text: ${errorHint}`);
    }

    logger.info('Ticimax admin login successful');
    return page;
  }

  /**
   * Parse cart report HTML page and extract data
   */
  private parseCartReportPage(html: string, pageNum: number): ScrapeResult {
    const $ = cheerio.load(html);

    // Extract pagination info
    // "Toplam 71 sayfanın 1 sayfasındasınız. Toplam 702 kayıt bulunmaktadır."
    const infoText = $('body').text();
    const totalMatch = infoText.match(/Toplam\s+(\d+)\s+sayfa.*?Toplam\s+(\d+)\s+kayıt/);
    const totalPages = totalMatch ? parseInt(totalMatch[1]) : 1;
    const totalRecords = totalMatch ? parseInt(totalMatch[2]) : 0;

    // Parse the data table
    const rows: CartReportRow[] = [];
    const table = $('table').filter(function () {
      return $(this).find('th, td').first().text().trim().includes('Üye ID');
    });

    if (table.length === 0) {
      logger.warn('Cart report table not found on page ' + pageNum);
      return { rows: [], totalRecords, totalPages, currentPage: pageNum };
    }

    table.find('tr').each(function (i) {
      if (i === 0) return; // Skip header row
      const cells = $(this).find('td');
      if (cells.length < 8) return;

      const uyeId = parseInt($(cells[0]).text().trim()) || 0;
      const uyeName = $(cells[1]).text().trim();
      const email = $(cells[2]).text().trim();
      const phone = $(cells[3]).text().trim().replace(/\s+/g, '').replace(/\+/g, '');
      const smsPermit = $(cells[4]).text().trim().toLowerCase() === 'evet';
      const mailPermit = $(cells[5]).text().trim().toLowerCase() === 'evet';
      const productCount = parseInt($(cells[6]).text().trim()) || 0;
      const cartDate = $(cells[7]).text().trim();

      if (uyeId > 0) {
        rows.push({ uyeId, uyeName, email, phone, smsPermit, mailPermit, productCount, cartDate });
      }
    });

    return { rows, totalRecords, totalPages, currentPage: pageNum };
  }

  /**
   * Perform the actual scraping (browser launch → login → scrape → close)
   */
  private async doScrape(maxPages: number): Promise<{ rows: CartReportRow[]; totalRecords: number }> {
    let browser: Browser | null = null;

    try {
      browser = await this.launchBrowser();
      const page = await this.loginAndGetPage(browser);

      // Navigate to cart report page
      logger.info('Navigating to UyeSepetRapor...');
      await page.goto(`${this.baseUrl}/Admin/UyeSepetRapor.aspx`, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });
      await this.waitForCloudflare(page);

      // Get initial HTML to check page size
      let html = await page.content();
      const $check = cheerio.load(html);
      const currentPageSize = $check('#cphPageContent_ddlKayitSayisi').val();

      // Change page size to 100 if needed (ASP.NET autopostback reloads page)
      if (currentPageSize !== '100') {
        logger.info('Changing page size to 100...');
        const selectEl = await page.$('#cphPageContent_ddlKayitSayisi');
        if (selectEl) {
          await page.select('#cphPageContent_ddlKayitSayisi', '100');
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
          html = await page.content();
        }
      }

      // Parse first page
      const allRows: CartReportRow[] = [];
      const firstResult = this.parseCartReportPage(html, 1);
      allRows.push(...firstResult.rows);

      const totalPages = firstResult.totalPages;
      const totalRecords = firstResult.totalRecords;

      logger.info(`Page 1: ${firstResult.rows.length} rows. Total: ${totalRecords} records, ${totalPages} pages`);

      // Determine how many pages to scrape
      const pagesToScrape = maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;

      // Scrape remaining pages by clicking "next" button
      for (let pageIdx = 2; pageIdx <= pagesToScrape; pageIdx++) {
        logger.info(`Scraping page ${pageIdx}/${pagesToScrape}...`);

        try {
          // Find and click the "next" button (ASP.NET LinkButton)
          const nextBtn =
            (await page.$('#cphPageContent_btnSonraki')) ||
            (await page.$('a[id*="btnSonraki"]')) ||
            (await page.$('input[id*="btnSonraki"]'));

          if (!nextBtn) {
            logger.warn('Next button not found, stopping pagination');
            break;
          }

          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
            nextBtn.click(),
          ]);

          html = await page.content();
          const pageResult = this.parseCartReportPage(html, pageIdx);
          allRows.push(...pageResult.rows);

          logger.info(`Page ${pageIdx}: ${pageResult.rows.length} rows (total: ${allRows.length})`);

          if (pageResult.rows.length === 0) {
            logger.info('Empty page, stopping pagination');
            break;
          }
        } catch (err) {
          logger.error(`Failed on page ${pageIdx}`, { error: (err as any).message });
          break;
        }

        // Small delay between pages
        await new Promise((r) => setTimeout(r, 300));
      }

      logger.info(`Scraping complete: ${allRows.length} rows from ${Math.min(pagesToScrape, totalPages)} pages`);

      return { rows: allRows, totalRecords };
    } finally {
      // Always close browser to free memory
      if (browser) {
        try {
          await browser.close();
        } catch (err) {
          logger.warn('Error closing browser', { error: (err as any).message });
        }
      }
    }
  }

  /**
   * Fetch cart report data (with caching and concurrency control)
   * @param maxPages Maximum pages to scrape (0 = all pages)
   */
  async getCartReport(maxPages: number = 0): Promise<{ rows: CartReportRow[]; totalRecords: number }> {
    // Return cached result if fresh
    if (this.cache && Date.now() - this.cache.timestamp < TicimaxAdminScraper.CACHE_TTL) {
      logger.info('Returning cached cart report', {
        rows: this.cache.rows.length,
        age: Math.round((Date.now() - this.cache.timestamp) / 1000) + 's',
      });
      return { rows: this.cache.rows, totalRecords: this.cache.totalRecords };
    }

    // If already scraping, wait for that to complete (prevent concurrent browser launches)
    if (this.activeScrape) {
      logger.info('Waiting for existing scrape operation to complete...');
      return this.activeScrape;
    }

    // Start new scrape
    logger.info('Starting new cart report scrape...');
    this.activeScrape = this.doScrape(maxPages);

    try {
      const result = await this.activeScrape;
      this.cache = { rows: result.rows, totalRecords: result.totalRecords, timestamp: Date.now() };
      return result;
    } finally {
      this.activeScrape = null;
    }
  }
}

// Singleton
let scraperInstance: TicimaxAdminScraper | null = null;

export function getAdminScraper(): TicimaxAdminScraper {
  if (!scraperInstance) {
    scraperInstance = new TicimaxAdminScraper();
  }
  return scraperInstance;
}
