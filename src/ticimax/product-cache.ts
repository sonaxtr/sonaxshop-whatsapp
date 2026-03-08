import { soapClient } from './soap-client';
import { xmlParser, UrunResult } from './xml-parser';
import { logger } from '../utils/logger';

/**
 * In-memory product cache for text search.
 * Ticimax SOAP API doesn't support product name search (UrunFiltre has no UrunAdi field).
 * We cache all active products (~425) and search locally.
 */
class ProductCache {
  private products: UrunResult[] = [];
  private lastRefresh: number = 0;
  private isLoading: boolean = false;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  private readonly PAGE_SIZE = 500;

  /**
   * Initialize cache — call on app startup
   */
  async initialize(): Promise<void> {
    try {
      await this.refresh();
      logger.info('Product cache initialized', { count: this.products.length });
    } catch (error: any) {
      logger.error('Product cache initialization failed', { error: error.message });
    }
  }

  /**
   * Refresh the product cache from SOAP API
   */
  private async refresh(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const allProducts: UrunResult[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const xml = await soapClient.selectUrunByBarkod('', this.PAGE_SIZE);
        // Actually we need a method that gets ALL products, not filtered by barcode
        // Let's use selectUrunAll
        break;
      }

      // Use a single large request — 425 products fits in one call
      const xml = await this.fetchAllProducts();
      const products = await xmlParser.parseUrunler(xml);

      this.products = products;
      this.lastRefresh = Date.now();
      logger.info('Product cache refreshed', { count: products.length });
    } catch (error: any) {
      logger.error('Product cache refresh failed', { error: error.message });
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Fetch all active products from SOAP (no barcode/stock code filter)
   */
  private async fetchAllProducts(): Promise<string> {
    return soapClient.selectAllUrunler(1000);
  }

  /**
   * Ensure cache is fresh
   */
  private async ensureFresh(): Promise<void> {
    if (Date.now() - this.lastRefresh > this.CACHE_TTL_MS || this.products.length === 0) {
      await this.refresh();
    }
  }

  /**
   * Search products by text — matches product name (case-insensitive, Turkish-aware)
   * All search words must appear in the product name.
   */
  async searchByText(query: string, limit: number = 5): Promise<UrunResult[]> {
    await this.ensureFresh();

    const normalizedQuery = this.turkishLower(query.trim());
    const words = normalizedQuery.split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) return [];

    const results = this.products.filter(p => {
      const name = this.turkishLower(p.urunAdi);
      return words.every(word => name.includes(word));
    });

    return results.slice(0, limit);
  }

  /**
   * Check if query looks like a barcode or stock code (numeric/alphanumeric, no spaces)
   */
  isCodeQuery(query: string): boolean {
    const trimmed = query.trim();
    // Barcodes are typically 8-14 digits, stock codes are alphanumeric
    return /^[A-Za-z0-9\-_.]+$/.test(trimmed) && !trimmed.includes(' ');
  }

  /**
   * Turkish-aware lowercase
   */
  private turkishLower(text: string): string {
    return text
      .replace(/İ/g, 'i')
      .replace(/I/g, 'ı')
      .replace(/Ş/g, 'ş')
      .replace(/Ç/g, 'ç')
      .replace(/Ü/g, 'ü')
      .replace(/Ö/g, 'ö')
      .replace(/Ğ/g, 'ğ')
      .toLowerCase();
  }

  /**
   * Get total cached product count
   */
  get count(): number {
    return this.products.length;
  }
}

export const productCache = new ProductCache();
