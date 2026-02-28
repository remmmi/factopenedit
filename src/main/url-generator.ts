// Generateur d'URLs de factures a partir de segments de plage
import type { UrlSegment } from '../shared/types';

const BASE_URL = 'https://openedit.io';

export function generateUrl(tenantId: number, year: number, seq: number): string {
  const seqPadded = String(seq).padStart(4, '0');
  return `${BASE_URL}/invoices/${tenantId}/${year}/${tenantId}-${year}-${seqPadded}.pdf`;
}

export function generateUrls(tenantId: number, segments: UrlSegment[]): string[] {
  const urls: string[] = [];
  for (const segment of segments) {
    for (let seq = segment.from; seq <= segment.to; seq++) {
      urls.push(generateUrl(tenantId, segment.year, seq));
    }
  }
  return urls;
}
