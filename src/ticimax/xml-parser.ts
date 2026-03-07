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
      const response = body?.SelectUrunResponse?.SelectUrunResult ||
        body?.SelectUrunlerResponse?.SelectUrunlerResult;

      if (!response) return [];

      // Handle UrunKarti / WebUrunKarti array
      let urunler = response?.UrunKarti || response?.Urunler?.WebUrunKarti || response?.WebUrunKarti;
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

      let siparisler = response?.WebSiparis || response?.Siparisler?.WebSiparis;
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

  /**
   * Parse member lookup results
   */
  async parseUyeler(xml: string): Promise<UyeResult[]> {
    try {
      const result = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      const body = this.getBody(result);
      const response = body?.SelectUyelerResponse?.SelectUyelerResult;

      if (!response) return [];

      let uyeler = response?.Uye || response?.Uyeler?.WebUye || response?.WebUye;
      if (!uyeler) return [];
      if (!Array.isArray(uyeler)) uyeler = [uyeler];

      return uyeler.map((u: any) => ({
        id: parseInt(u.ID) || 0,
        isim: u.Isim || '',
        soyisim: u.Soyisim || '',
        mail: u.Mail || '',
        cepTelefonu: u.CepTelefonu || '',
        telefon: u.Telefon || '',
      }));
    } catch (error: any) {
      logger.error('Parse uyeler error', { error: error.message });
      return [];
    }
  }

  /**
   * Parse category results
   */
  async parseKategoriler(xml: string): Promise<KategoriResult[]> {
    try {
      const result = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      const body = this.getBody(result);
      const response = body?.SelectKategoriResponse?.SelectKategoriResult;

      if (!response) return [];

      let kategoriler = response?.Kategori || response?.Kategoriler?.WebKategori || response?.WebKategori;
      if (!kategoriler) return [];
      if (!Array.isArray(kategoriler)) kategoriler = [kategoriler];

      return kategoriler
        .filter((k: any) => k.Aktif === 'true' || k.Aktif === true)
        .map((k: any) => ({
          id: parseInt(k.ID) || 0,
          kategoriAdi: k.KategoriAdi || k.Adi || '',
          ustKategoriId: parseInt(k.UstKategoriID || '0'),
          url: k.Url || '',
          sira: parseInt(k.Sira || '0'),
        }));
    } catch (error: any) {
      logger.error('Parse kategoriler error', { error: error.message });
      return [];
    }
  }

  /**
   * Parse member ID lookup results (ArrayOfint)
   */
  async parseUyeIds(xml: string): Promise<number[]> {
    try {
      const result = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });
      const body = this.getBody(result);
      const response = body?.SelectUyeIdByMailOrTelResponse?.SelectUyeIdByMailOrTelResult;

      if (!response) return [];

      let ids = response?.int;
      if (!ids) return [];
      if (!Array.isArray(ids)) ids = [ids];

      return ids.map((id: any) => parseInt(id) || 0).filter((id: number) => id > 0);
    } catch (error: any) {
      logger.error('Parse uye ids error', { error: error.message });
      return [];
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

export interface UyeResult {
  id: number;
  isim: string;
  soyisim: string;
  mail: string;
  cepTelefonu: string;
  telefon: string;
}

export interface KategoriResult {
  id: number;
  kategoriAdi: string;
  ustKategoriId: number;
  url: string;
  sira: number;
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
