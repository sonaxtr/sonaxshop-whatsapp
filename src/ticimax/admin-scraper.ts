import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config';
import { logger } from '../utils/logger';

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
 * Ticimax Admin Panel Scraper
 * Scrapes UyeSepetRapor.aspx for abandoned cart data
 *
 * This approach gives 700+ records vs SOAP SelectSepet which only returns ~100 (mostly anonymous).
 * The admin panel shows all registered members with items in their carts.
 */
export class TicimaxAdminScraper {
  private baseUrl: string;
  private username: string;
  private password: string;
  private client: AxiosInstance;
  private sessionCookie: string = '';
  private lastLoginTime: number = 0;
  private static SESSION_TTL = 25 * 60 * 1000; // 25 minutes

  constructor() {
    this.baseUrl = (config.ticimax.adminUrl || '').replace(/\/$/, '');
    this.username = config.ticimax.adminUser || '';
    this.password = config.ticimax.adminPass || '';

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
      },
    });
  }

  /**
   * Login to Ticimax admin panel via /UyeGiris page
   * Ticimax redirects /Admin/Login.aspx → /UyeGiris?ReturnUrl=...
   * We login through the member login form which grants admin access
   */
  async login(): Promise<void> {
    // Reuse session if still valid
    if (this.sessionCookie && Date.now() - this.lastLoginTime < TicimaxAdminScraper.SESSION_TTL) {
      return;
    }

    logger.info('Logging into Ticimax admin panel...');

    // Step 1: GET the UyeGiris page (member login) with admin ReturnUrl
    const loginUrl = '/UyeGiris?ReturnUrl=%2fAdmin%2fLogin.aspx';
    const loginPageResp = await this.client.get(loginUrl, {
      maxRedirects: 5,
      validateStatus: (s) => s < 400,
    });

    const $ = cheerio.load(loginPageResp.data);
    const viewState = $('input[name="__VIEWSTATE"]').val() as string || '';
    const viewStateGenerator = $('input[name="__VIEWSTATEGENERATOR"]').val() as string || '';
    const requestVerificationToken = $('input[name="__RequestVerificationToken"]').val() as string || '';

    // Extract cookies from login page
    const setCookies = loginPageResp.headers['set-cookie'] || [];
    let cookies = setCookies.map((c: string) => c.split(';')[0]).join('; ');

    logger.info('Login page loaded, posting credentials...', {
      hasViewState: !!viewState,
      hasToken: !!requestVerificationToken,
      cookieCount: setCookies.length,
    });

    // Step 2: POST login credentials to UyeGiris
    const loginData = new URLSearchParams();
    loginData.append('__VIEWSTATE', viewState);
    loginData.append('__VIEWSTATEGENERATOR', viewStateGenerator);
    if (requestVerificationToken) loginData.append('__RequestVerificationToken', requestVerificationToken);
    loginData.append('txtUyeGirisEmail', this.username);
    loginData.append('txtUyeGirisPassword', this.password);

    const loginResp = await this.client.post(loginUrl, loginData.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies,
        'Referer': `${this.baseUrl}${loginUrl}`,
      },
      maxRedirects: 0,
      validateStatus: (s) => s < 400 || s === 302,
    });

    // Extract auth cookies from login response
    const authCookies = loginResp.headers['set-cookie'] || [];
    const allCookies = [...setCookies, ...authCookies];
    this.sessionCookie = allCookies.map((c: string) => c.split(';')[0]).join('; ');

    // Follow redirect chain to get any additional cookies
    if (loginResp.status === 302) {
      const redirectUrl = loginResp.headers['location'] || '';
      logger.info('Login redirect', { redirectUrl });

      if (redirectUrl) {
        const followResp = await this.client.get(redirectUrl, {
          headers: { 'Cookie': this.sessionCookie },
          maxRedirects: 5,
          validateStatus: (s) => s < 400 || s === 302,
        });
        const followCookies = followResp.headers['set-cookie'] || [];
        if (followCookies.length > 0) {
          const allFollowCookies = [...allCookies, ...followCookies];
          this.sessionCookie = allFollowCookies.map((c: string) => c.split(';')[0]).join('; ');
        }
      }
    }

    if (!this.sessionCookie.includes('.ASPXAUTH') && !this.sessionCookie.includes('ASP.NET_SessionId')) {
      logger.error('Login may have failed', { cookies: this.sessionCookie.substring(0, 200) });
      throw new Error('Login failed - no auth cookie received');
    }

    this.lastLoginTime = Date.now();
    logger.info('Ticimax admin login successful');
  }

  /**
   * Scrape a single page of UyeSepetRapor
   */
  private async scrapePage(pageNum: number, pageSize: number, viewState?: string): Promise<{ result: ScrapeResult; viewState: string }> {
    let html: string;

    if (pageNum === 1 && !viewState) {
      // First page: simple GET with page size parameter
      const resp = await this.client.get('/Admin/UyeSepetRapor.aspx', {
        headers: { 'Cookie': this.sessionCookie },
      });
      html = resp.data;
    } else {
      // Subsequent pages: POST with ViewState for pagination
      const formData = new URLSearchParams();
      formData.append('__VIEWSTATE', viewState || '');
      formData.append('__VIEWSTATEGENERATOR', '');
      formData.append('ctl00$cphPageContent$ddlKayitSayisi', String(pageSize));
      formData.append('ctl00$cphPageContent$txtbxSayfaNo', String(pageNum));
      formData.append('ctl00$cphPageContent$txtMinUrunSayisi', '1');
      formData.append('ctl00$cphPageContent$txtMaxUrunSayisi', '100');
      formData.append('ctl00$cphPageContent$dllSiralamaDegeri', 'sepet.TARIH DESC');
      // Trigger page navigation
      formData.append('__EVENTTARGET', 'ctl00$cphPageContent$btnSonraki');
      formData.append('__EVENTARGUMENT', '');

      const resp = await this.client.post('/Admin/UyeSepetRapor.aspx', formData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.sessionCookie,
        },
      });
      html = resp.data;
    }

    return this.parseCartReportPage(html, pageNum);
  }

  /**
   * Parse a UyeSepetRapor page HTML and extract cart data
   */
  private parseCartReportPage(html: string, pageNum: number): { result: ScrapeResult; viewState: string } {
    const $ = cheerio.load(html);
    const newViewState = $('input[name="__VIEWSTATE"]').val() as string || '';

    // Extract total records info
    // "Toplam 71 sayfanın 1 sayfasındasınız. Toplam 702 kayıt bulunmaktadır."
    const infoText = $('body').text();
    const totalMatch = infoText.match(/Toplam\s+(\d+)\s+sayfa.*?Toplam\s+(\d+)\s+kayıt/);
    const totalPages = totalMatch ? parseInt(totalMatch[1]) : 1;
    const totalRecords = totalMatch ? parseInt(totalMatch[2]) : 0;

    // Parse the data table
    const rows: CartReportRow[] = [];
    const table = $('table').filter(function () {
      // Find the table that has "Üye ID" header
      return $(this).find('th, td').first().text().trim().includes('Üye ID');
    });

    if (table.length === 0) {
      logger.warn('Cart report table not found on page ' + pageNum);
      return { result: { rows: [], totalRecords, totalPages, currentPage: pageNum }, viewState: newViewState };
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

    return {
      result: { rows, totalRecords, totalPages, currentPage: pageNum },
      viewState: newViewState,
    };
  }

  /**
   * Fetch all cart report data by scraping multiple pages
   * @param maxPages Maximum pages to scrape (0 = all pages)
   */
  async getCartReport(maxPages: number = 0): Promise<{ rows: CartReportRow[]; totalRecords: number }> {
    await this.login();

    const pageSize = 100; // Max supported by the dropdown
    const allRows: CartReportRow[] = [];

    // First page - GET request
    logger.info('Scraping UyeSepetRapor page 1...');
    const firstResp = await this.client.get('/Admin/UyeSepetRapor.aspx', {
      headers: { 'Cookie': this.sessionCookie },
    });

    // First, set page size to 100 if not already
    const $first = cheerio.load(firstResp.data);
    const currentPageSize = $first('#cphPageContent_ddlKayitSayisi').val();
    let currentHtml = firstResp.data;

    if (currentPageSize !== '100') {
      // POST to change page size
      const viewState = $first('input[name="__VIEWSTATE"]').val() as string || '';
      const viewStateGen = $first('input[name="__VIEWSTATEGENERATOR"]').val() as string || '';

      const formData = new URLSearchParams();
      formData.append('__VIEWSTATE', viewState);
      formData.append('__VIEWSTATEGENERATOR', viewStateGen);
      formData.append('__EVENTTARGET', 'ctl00$cphPageContent$ddlKayitSayisi');
      formData.append('__EVENTARGUMENT', '');
      formData.append('ctl00$cphPageContent$ddlKayitSayisi', '100');
      formData.append('ctl00$cphPageContent$txtMinUrunSayisi', '1');
      formData.append('ctl00$cphPageContent$txtMaxUrunSayisi', '100');
      formData.append('ctl00$cphPageContent$dllSiralamaDegeri', 'sepet.TARIH DESC');
      formData.append('ctl00$cphPageContent$txtbxSayfaNo', '1');

      const pageSizeResp = await this.client.post('/Admin/UyeSepetRapor.aspx', formData.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': this.sessionCookie,
        },
      });
      currentHtml = pageSizeResp.data;
    }

    // Parse first page
    const { result: firstResult, viewState: vs1 } = this.parseCartReportPage(currentHtml, 1);
    allRows.push(...firstResult.rows);
    const totalPages = firstResult.totalPages;
    const totalRecords = firstResult.totalRecords;

    logger.info(`Page 1: ${firstResult.rows.length} rows. Total: ${totalRecords} records, ${totalPages} pages`);

    // Determine how many pages to scrape
    // With pageSize=100: ceil(702/100) = 8 pages
    const pagesToScrape = maxPages > 0 ? Math.min(maxPages, totalPages) : totalPages;
    let currentViewState = vs1;

    // Scrape remaining pages
    for (let page = 2; page <= pagesToScrape; page++) {
      logger.info(`Scraping UyeSepetRapor page ${page}/${pagesToScrape}...`);

      try {
        const { result, viewState } = await this.scrapePage(page, pageSize, currentViewState);
        allRows.push(...result.rows);
        currentViewState = viewState;
        logger.info(`Page ${page}: ${result.rows.length} rows (total so far: ${allRows.length})`);
      } catch (err) {
        logger.error(`Failed to scrape page ${page}`, { error: (err as any).message });
        break; // Stop on error
      }

      // Small delay between pages to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    logger.info(`Scraping complete: ${allRows.length} rows from ${pagesToScrape} pages`);

    return { rows: allRows, totalRecords };
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
