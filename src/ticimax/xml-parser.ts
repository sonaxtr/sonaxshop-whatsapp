import { parseStringPromise } from 'xml2js';
import { logger } from '../utils/logger';

/**
 * XML parser for Ticimax SOAP responses
 */
export class TicimaxXmlParser {
  /**
   * Parse product search results
   */
  async parseUrunler(xml: string): Promise<UrunResult[]> {
    try {
      const result = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      const body = this.getBody(result);
      const response = body?.SelectUrunlerResponse?.SelectUrunlerResult;

      if (!response) return [];

      // Handle WebUrunKarti array
      let urunler = response?.Urunler?.WebUrunKarti || response?.WebUrunKarti;
      if (!urunler) return [];
      if (!Array.isArray(urunler)) urunler = [urunler];

      return urunler.map((u: any) => ({
        id: parseInt(u.ID) || 0,
        urunAdi: u.UrunAdi || '',
        barkod: u.Barkod || '',
        stokKodu: u.StokKodu || '',
        fiyat: parseFloat(u.SatisFiyati || u.Fiyat || '0'),
        stokAdedi: parseInt(u.StokAdedi || '0'),
        resimUrl: u.ResimUrl || u.Resim || '',
        url: u.Url || '',
        aktif: u.Aktif === 'true',
      }));
    } catch (error: any) {
      logger.error('Parse urunler error', { error: error.message });
      return [];
    }
  }

  /**
   * Parse order results
   */
  async parseSiparisler(xml: string): Promise<SiparisResult[]> {
    try {
      const result = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      const body = this.getBody(result);
      const response = body?.SelectSiparisResponse?.SelectSiparisResult;

      if (!response) return [];

      let siparisler = response?.Siparisler?.WebSiparis || response?.WebSiparis;
      if (!siparisler) return [];
      if (!Array.isArray(siparisler)) siparisler = [siparisler];

      return siparisler
        .filter((s: any) => {
          // Filter out orders without payments (test orders)
          const odemeler = s.Odemeler?.WebSiparisOdeme;
          return odemeler && (Array.isArray(odemeler) ? odemeler.length > 0 : true);
        })
        .map((s: any) => ({
          id: parseInt(s.ID) || 0,
          siparisNo: s.SiparisNo || s.SiparisKodu || '',
          tarih: s.SiparisTarihi || s.Tarih || '',
          durum: this.getSiparisDurum(s.SiparisDurumu),
          toplamTutar: parseFloat(s.GenelToplam || s.ToplamTutar || '0'),
          kargoFirma: s.KargoFirmasi || '',
          kargoTakipNo: s.KargoTakipNo || '',
          kargoTakipUrl: s.KargoTakipUrl || '',
        }));
    } catch (error: any) {
      logger.error('Parse siparisler error', { error: error.message });
      return [];
    }
  }

  /**
   * Parse store/magazine list
   */
  async parseMagazalar(xml: string): Promise<MagazaResult[]> {
    try {
      const result = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      const body = this.getBody(result);
      const response = body?.GetMagazalarResponse?.GetMagazalarResult;

      if (!response) return [];

      let magazalar = response?.WebMagaza || response;
      if (!magazalar) return [];
      if (!Array.isArray(magazalar)) magazalar = [magazalar];

      return magazalar.map((m: any) => ({
        id: parseInt(m.ID) || 0,
        ad: m.MagazaAdi || m.Adi || m.Tanim || '',
        adres: m.Adres || '',
        telefon: m.Telefon || '',
        il: m.Il || m.Sehir || '',
        ilce: m.Ilce || '',
        calismaSaatleri: m.CalismaSaatleri || '',
        latitude: m.Latitude || '',
        longitude: m.Longitude || '',
        aktif: m.Aktif !== 'false',
      }));
    } catch (error: any) {
      logger.error('Parse magazalar error', { error: error.message });
      return [];
    }
  }

  /**
   * Parse gift coupon response
   */
  async parseHediyeCeki(xml: string): Promise<HediyeCekiResult | null> {
    try {
      const result = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      const body = this.getBody(result);
      const response = body?.SelectHediyeCekiResponse?.SelectHediyeCekiResult;

      if (!response || response.Sonuc === 'false' || response.Code === '') return null;

      return {
        code: response.Code || '',
        discountValue: parseFloat(response.DiscountValue || '0'),
        discountType: response.DiscountType || '',
        minOrderAmount: parseFloat(response.MinOrderAmount || '0'),
        startDate: response.StartDate || '',
        endDate: response.EndDate || '',
        isActive: response.IsActive === 'true',
        usageCount: parseInt(response.UsageCount || '0'),
        maxUsageCount: parseInt(response.MaxUsageCount || '0'),
      };
    } catch (error: any) {
      logger.error('Parse hediye ceki error', { error: error.message });
      return null;
    }
  }

  // ============================
  // HELPERS
  // ============================

  private getBody(result: any): any {
    return result?.['s:Envelope']?.['s:Body'] ||
      result?.['soap:Envelope']?.['soap:Body'] ||
      result?.['soapenv:Envelope']?.['soapenv:Body'] ||
      null;
  }

  private getSiparisDurum(durum: string | number): string {
    const durumMap: Record<string, string> = {
      '0': 'Sipariş Alındı',
      '1': 'Hazırlanıyor',
      '2': 'Kargoya Verildi',
      '3': 'Teslim Edildi',
      '4': 'İptal Edildi',
      '5': 'İade Edildi',
    };
    return durumMap[String(durum)] || `Durum: ${durum}`;
  }
}

// Result types
export interface UrunResult {
  id: number;
  urunAdi: string;
  barkod: string;
  stokKodu: string;
  fiyat: number;
  stokAdedi: number;
  resimUrl: string;
  url: string;
  aktif: boolean;
}

export interface SiparisResult {
  id: number;
  siparisNo: string;
  tarih: string;
  durum: string;
  toplamTutar: number;
  kargoFirma: string;
  kargoTakipNo: string;
  kargoTakipUrl: string;
}

export interface MagazaResult {
  id: number;
  ad: string;
  adres: string;
  telefon: string;
  il: string;
  ilce: string;
  calismaSaatleri: string;
  latitude: string;
  longitude: string;
  aktif: boolean;
}

export interface HediyeCekiResult {
  code: string;
  discountValue: number;
  discountType: string;
  minOrderAmount: number;
  startDate: string;
  endDate: string;
  isActive: boolean;
  usageCount: number;
  maxUsageCount: number;
}

export const xmlParser = new TicimaxXmlParser();
