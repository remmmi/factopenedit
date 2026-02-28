// Generateur d'URLs de factures a partir de segments de plage
import type { UrlSegment } from '../shared/types';

export const DEFAULT_BASE_URL = 'https://saisie.open-edit.io';

export function generateUrl(
  tenantId: number,
  year: number,
  seq: number,
  baseUrl: string = DEFAULT_BASE_URL
): string {
  const seqPadded = String(seq).padStart(4, '0');
  return `${baseUrl}/invoices/${tenantId}/${year}/${tenantId}-${year}-${seqPadded}.pdf`;
}

export function generateUrls(
  tenantId: number,
  segments: UrlSegment[],
  baseUrl: string = DEFAULT_BASE_URL
): string[] {
  const urls: string[] = [];
  for (const segment of segments) {
    for (let seq = segment.from; seq <= segment.to; seq++) {
      urls.push(generateUrl(tenantId, segment.year, seq, baseUrl));
    }
  }
  return urls;
}
