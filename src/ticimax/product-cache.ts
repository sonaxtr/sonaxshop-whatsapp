import { soapClient } from './soap-client';
import { xmlParser, UrunResult } from './xml-parser';
import { logger } from '../utils/logger';

/**
 * In-memory product cache for text & code search.
 * Ticimax SOAP StokKodu filter doesn't always work (variant-level codes),
 * so we cache all active products and search locally.
 */
class ProductCache {
  private products: UrunResult[] = [];
  private lastRefresh: number = 0;
  private isLoading: boolean = false;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
      const xml = await soapClient.selectAllUrunler(1000);
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
   * Search products by barcode or stock code from cache
   */
  async searchByCode(code: string, limit: number = 5): Promise<UrunResult[]> {
    await this.ensureFresh();

    const q = code.trim().toLowerCase();
    const results = this.products.filter(p =>
      p.barkod.toLowerCase() === q ||
      p.stokKodu.toLowerCase() === q
    );

    return results.slice(0, limit);
  }

  /**
   * Search — tries code match first, then text search
   */
  async search(query: string, limit: number = 5): Promise<UrunResult[]> {
    await this.ensureFresh();

    const trimmed = query.trim();

    // If it looks like a code (no spaces, alphanumeric), try exact code match first
    if (this.isCodeQuery(trimmed)) {
      const codeResults = await this.searchByCode(trimmed, limit);
      if (codeResults.length > 0) return codeResults;
    }

    // Fall back to text search
    return this.searchByText(trimmed, limit);
  }

  /**
   * Check if query looks like a barcode or stock code
   */
  isCodeQuery(query: string): boolean {
    const trimmed = query.trim();
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
