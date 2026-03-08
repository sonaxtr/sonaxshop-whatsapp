import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Ticimax SOAP client — Sends SOAP XML requests and returns raw XML responses
 */
export class TicimaxSoapClient {
  private uyeKodu: string;
  private baseUrl: string;

  constructor() {
    this.uyeKodu = config.ticimax.uyeKodu;
    this.baseUrl = config.ticimax.baseUrl;
  }

  /**
   * Send a SOAP request to a Ticimax endpoint
   */
  async request(endpoint: string, action: string, body: string): Promise<string> {
    const url = `${this.baseUrl}${endpoint}`;
    const soapAction = `http://tempuri.org/I${this.getServiceName(endpoint)}/${action}`;

    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/" xmlns:ns="http://schemas.datacontract.org/2004/07/">
  <soapenv:Header/>
  <soapenv:Body>
    ${body}
  </soapenv:Body>
</soapenv:Envelope>`;

    try {
      const response = await axios.post(url, envelope, {
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: soapAction,
        },
        timeout: 15000,
      });

      return response.data;
    } catch (error: any) {
      logger.error('SOAP request failed', {
        endpoint,
        action,
        error: error.response?.data || error.message,
      });
      throw error;
    }
  }

  private getServiceName(endpoint: string): string {
    if (endpoint.includes('UrunServis')) return 'UrunServis';
    if (endpoint.includes('UyeServis')) return 'UyeServis';
    if (endpoint.includes('SiparisServis')) return 'SiparisServis';
    if (endpoint.includes('CustomServis')) return 'CustomServis';
    return 'UnknownServis';
  }

  // ============================
  // ÜRÜN SERVİS
  // ============================

  /**
   * Search products by barcode
   */
  async selectUrunByBarkod(barkod: string, pageSize: number = 5): Promise<string> {
    const body = `<tem:SelectUrun>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:f>
        <ns:Aktif>1</ns:Aktif>
        <ns:Barkod>${this.xmlEscape(barkod)}</ns:Barkod>
      </tem:f>
      <tem:s>
        <ns:BaslangicIndex>0</ns:BaslangicIndex>
        <ns:KayitSayisi>${pageSize}</ns:KayitSayisi>
        <ns:SiralamaDegeri>Sira</ns:SiralamaDegeri>
        <ns:SiralamaYonu>ASC</ns:SiralamaYonu>
      </tem:s>
    </tem:SelectUrun>`;

    return this.request(config.ticimax.endpoints.urun, 'SelectUrun', body);
  }

  /**
   * Search products by stock code
   */
  async selectUrunByStokKodu(stokKodu: string, pageSize: number = 5): Promise<string> {
    const body = `<tem:SelectUrun>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:f>
        <ns:Aktif>1</ns:Aktif>
        <ns:StokKodu>${this.xmlEscape(stokKodu)}</ns:StokKodu>
      </tem:f>
      <tem:s>
        <ns:BaslangicIndex>0</ns:BaslangicIndex>
        <ns:KayitSayisi>${pageSize}</ns:KayitSayisi>
        <ns:SiralamaDegeri>Sira</ns:SiralamaDegeri>
        <ns:SiralamaYonu>ASC</ns:SiralamaYonu>
      </tem:s>
    </tem:SelectUrun>`;

    return this.request(config.ticimax.endpoints.urun, 'SelectUrun', body);
  }

  /**
   * Search product by UrunKartiID
   */
  async selectUrunByKartiId(urunKartiId: number): Promise<string> {
    const body = `<tem:SelectUrun>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:f>
        <ns:Aktif>1</ns:Aktif>
        <ns:UrunKartiID>${urunKartiId}</ns:UrunKartiID>
      </tem:f>
      <tem:s>
      </tem:s>
    </tem:SelectUrun>`;

    return this.request(config.ticimax.endpoints.urun, 'SelectUrun', body);
  }

  /**
   * Get all active products (for text search cache)
   */
  async selectAllUrunler(pageSize: number = 1000): Promise<string> {
    const body = `<tem:SelectUrun>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:f>
        <ns:Aktif>1</ns:Aktif>
      </tem:f>
      <tem:s>
        <ns:BaslangicIndex>0</ns:BaslangicIndex>
        <ns:KayitSayisi>${pageSize}</ns:KayitSayisi>
        <ns:SiralamaDegeri>Sira</ns:SiralamaDegeri>
        <ns:SiralamaYonu>ASC</ns:SiralamaYonu>
      </tem:s>
    </tem:SelectUrun>`;

    return this.request(config.ticimax.endpoints.urun, 'SelectUrun', body);
  }

  // ============================
  // SİPARİŞ SERVİS
  // ============================

  /**
   * Get orders by member phone or order ID
   */
  async selectSiparis(siparisId?: number, telefon?: string): Promise<string> {
    const body = `<tem:SelectSiparis>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:f>
        <ns:IptalEdilmisUrunler>true</ns:IptalEdilmisUrunler>
        <ns:OdemeDurumu>-1</ns:OdemeDurumu>
        <ns:OdemeTipi>-1</ns:OdemeTipi>
        <ns:SiparisDurumu>-1</ns:SiparisDurumu>
        <ns:SiparisID>${siparisId || -1}</ns:SiparisID>
        <ns:TedarikciID>-1</ns:TedarikciID>
        ${telefon ? `<ns:UyeTelefon>${this.xmlEscape(telefon)}</ns:UyeTelefon>` : ''}
      </tem:f>
      <tem:s>
        <ns:BaslangicIndex>0</ns:BaslangicIndex>
        <ns:KayitSayisi>5</ns:KayitSayisi>
        <ns:SiralamaDegeri>ID</ns:SiralamaDegeri>
        <ns:SiralamaYonu>DESC</ns:SiralamaYonu>
      </tem:s>
    </tem:SelectSiparis>`;

    return this.request(config.ticimax.endpoints.siparis, 'SelectSiparis', body);
  }

  // ============================
  // CUSTOM SERVİS
  // ============================

  /**
   * Get store/application center list
   */
  async getMagazalar(): Promise<string> {
    const body = `<tem:GetMagazalar>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
    </tem:GetMagazalar>`;

    return this.request(config.ticimax.endpoints.custom, 'GetMagazalar', body);
  }

  /**
   * Query gift coupon by code
   */
  async selectHediyeCeki(code: string): Promise<string> {
    const body = `<tem:SelectHediyeCeki>
      <tem:HediyeCekiKodu>${this.xmlEscape(code)}</tem:HediyeCekiKodu>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
    </tem:SelectHediyeCeki>`;

    return this.request(config.ticimax.endpoints.custom, 'SelectHediyeCeki', body);
  }

  // ============================
  // ÜYE SERVİS
  // ============================

  /**
   * Look up a member by phone number
   */
  async selectUyeler(telefon: string): Promise<string> {
    const body = `<tem:SelectUyeler>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:filtre>
        <ns:Aktif>1</ns:Aktif>
        <ns:AlisverisYapti>-1</ns:AlisverisYapti>
        <ns:Cinsiyet>-1</ns:Cinsiyet>
        <ns:MailIzin>-1</ns:MailIzin>
        <ns:SmsIzin>-1</ns:SmsIzin>
        <ns:Telefon>${this.xmlEscape(telefon)}</ns:Telefon>
        <ns:UyeID>-1</ns:UyeID>
      </tem:filtre>
      <tem:sayfalama>
        <ns:KayitSayisi>1</ns:KayitSayisi>
        <ns:SiralamaDegeri>id</ns:SiralamaDegeri>
        <ns:SiralamaYonu>Desc</ns:SiralamaYonu>
        <ns:SayfaNo>1</ns:SayfaNo>
      </tem:sayfalama>
    </tem:SelectUyeler>`;

    return this.request(config.ticimax.endpoints.uye, 'SelectUyeler', body);
  }

  /**
   * Get member details by UyeID
   */
  async selectUyelerById(uyeId: number): Promise<string> {
    const body = `<tem:SelectUyeler>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:filtre>
        <ns:Aktif>1</ns:Aktif>
        <ns:AlisverisYapti>-1</ns:AlisverisYapti>
        <ns:Cinsiyet>-1</ns:Cinsiyet>
        <ns:MailIzin>-1</ns:MailIzin>
        <ns:SmsIzin>-1</ns:SmsIzin>
        <ns:UyeID>${uyeId}</ns:UyeID>
      </tem:filtre>
      <tem:sayfalama>
        <ns:KayitSayisi>1</ns:KayitSayisi>
        <ns:SiralamaDegeri>id</ns:SiralamaDegeri>
        <ns:SiralamaYonu>Desc</ns:SiralamaYonu>
        <ns:SayfaNo>1</ns:SayfaNo>
      </tem:sayfalama>
    </tem:SelectUyeler>`;

    return this.request(config.ticimax.endpoints.uye, 'SelectUyeler', body);
  }

  // ============================
  // KATEGORİ (ÜRÜN SERVİS)
  // ============================

  /**
   * Get product categories
   */
  async selectKategoriler(ustKategoriId: number = 0): Promise<string> {
    const body = `<tem:SelectKategori>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:kategoriID>0</tem:kategoriID>
      <tem:dil></tem:dil>
      <tem:parentID>${ustKategoriId}</tem:parentID>
    </tem:SelectKategori>`;

    return this.request(config.ticimax.endpoints.urun, 'SelectKategori', body);
  }

  /**
   * Get products by category ID
   */
  async selectUrunlerByKategori(kategoriId: number, page: number = 1, pageSize: number = 5): Promise<string> {
    const body = `<tem:SelectUrun>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:f>
        <ns:Aktif>1</ns:Aktif>
        <ns:KategoriID>${kategoriId}</ns:KategoriID>
      </tem:f>
      <tem:s>
        <ns:BaslangicIndex>${(page - 1) * pageSize}</ns:BaslangicIndex>
        <ns:KayitSayisi>${pageSize}</ns:KayitSayisi>
        <ns:SiralamaDegeri>Sira</ns:SiralamaDegeri>
        <ns:SiralamaYonu>ASC</ns:SiralamaYonu>
      </tem:s>
    </tem:SelectUrun>`;

    return this.request(config.ticimax.endpoints.urun, 'SelectUrun', body);
  }

  /**
   * Get orders by member ID (UyeID)
   */
  async selectSiparisByUyeId(uyeId: number): Promise<string> {
    const body = `<tem:SelectSiparis>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
      <tem:f>
        <ns:IptalEdilmisUrunler>true</ns:IptalEdilmisUrunler>
        <ns:OdemeDurumu>-1</ns:OdemeDurumu>
        <ns:OdemeTipi>-1</ns:OdemeTipi>
        <ns:SiparisDurumu>-1</ns:SiparisDurumu>
        <ns:SiparisID>-1</ns:SiparisID>
        <ns:TedarikciID>-1</ns:TedarikciID>
        <ns:UyeID>${uyeId}</ns:UyeID>
      </tem:f>
      <tem:s>
        <ns:BaslangicIndex>0</ns:BaslangicIndex>
        <ns:KayitSayisi>5</ns:KayitSayisi>
        <ns:SiralamaDegeri>ID</ns:SiralamaDegeri>
        <ns:SiralamaYonu>DESC</ns:SiralamaYonu>
      </tem:s>
    </tem:SelectSiparis>`;

    return this.request(config.ticimax.endpoints.siparis, 'SelectSiparis', body);
  }

  // ============================
  // HELPERS
  // ============================

  private xmlEscape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

export const soapClient = new TicimaxSoapClient();
