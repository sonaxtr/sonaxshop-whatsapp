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
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/" xmlns:ns="http://schemas.datacontract.org/2004/07/TiciMax.Entegrasyon.Servisler">
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
   * Search products by name, barcode, or stock code
   */
  async selectUrunler(searchText: string, page: number = 1, pageSize: number = 5): Promise<string> {
    const body = `<tem:SelectUrunler>
      <tem:f>
        <ns:AktifMi>1</ns:AktifMi>
        <ns:Barkod>${this.xmlEscape(searchText)}</ns:Barkod>
        <ns:UrunAdi>${this.xmlEscape(searchText)}</ns:UrunAdi>
      </tem:f>
      <tem:s>
        <ns:BaslangicIndex>${(page - 1) * pageSize}</ns:BaslangicIndex>
        <ns:KayitSayisi>${pageSize}</ns:KayitSayisi>
        <ns:SiralamaDeger>Sira</ns:SiralamaDeger>
        <ns:SiralamaYonu>ASC</ns:SiralamaYonu>
      </tem:s>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
    </tem:SelectUrunler>`;

    return this.request(config.ticimax.endpoints.urun, 'SelectUrunler', body);
  }

  // ============================
  // SİPARİŞ SERVİS
  // ============================

  /**
   * Get orders by member phone or order ID
   */
  async selectSiparis(siparisId?: number, telefon?: string): Promise<string> {
    const body = `<tem:SelectSiparis>
      <tem:f>
        <ns:EntegrasyonParams>
          <ns:AlanDeger></ns:AlanDeger>
          <ns:Deger></ns:Deger>
          <ns:EntegrasyonKodu></ns:EntegrasyonKodu>
          <ns:EntegrasyonParamsAktif>false</ns:EntegrasyonParamsAktif>
          <ns:TabloAlan></ns:TabloAlan>
          <ns:Tanim></ns:Tanim>
        </ns:EntegrasyonParams>
        <ns:IptalEdilmisUrunler>true</ns:IptalEdilmisUrunler>
        <ns:OdemeDurumu>-1</ns:OdemeDurumu>
        <ns:OdemeTipi>-1</ns:OdemeTipi>
        <ns:SiparisDurumu>-1</ns:SiparisDurumu>
        <ns:SiparisID>${siparisId || -1}</ns:SiparisID>
        <ns:TedarikciID>-1</ns:TedarikciID>
        ${telefon ? `<ns:Telefon>${this.xmlEscape(telefon)}</ns:Telefon>` : ''}
      </tem:f>
      <tem:s>
        <ns:BaslangicIndex>0</ns:BaslangicIndex>
        <ns:KayitSayisi>5</ns:KayitSayisi>
        <ns:SiralamaDeger>ID</ns:SiralamaDeger>
        <ns:SiralamaYonu>DESC</ns:SiralamaYonu>
      </tem:s>
      <tem:UyeKodu>${this.uyeKodu}</tem:UyeKodu>
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
