import { generateUrl, generateUrls } from './url-generator';
import type { UrlSegment } from '../shared/types';

describe('generateUrl', () => {
  it('genere une URL avec le bon format de base', () => {
    const url = generateUrl(79, 2026, 1091);
    expect(url).toBe('https://openedit.io/invoices/79/2026/79-2026-1091.pdf');
  });

  it('zero-padde le numero de sequence sur 4 digits', () => {
    expect(generateUrl(79, 2026, 1)).toBe(
      'https://openedit.io/invoices/79/2026/79-2026-0001.pdf'
    );
    expect(generateUrl(79, 2026, 10)).toBe(
      'https://openedit.io/invoices/79/2026/79-2026-0010.pdf'
    );
    expect(generateUrl(79, 2026, 100)).toBe(
      'https://openedit.io/invoices/79/2026/79-2026-0100.pdf'
    );
  });

  it("utilise l'annee dans le path ET dans le nom de fichier", () => {
    const url2025 = generateUrl(79, 2025, 999);
    expect(url2025).toContain('/2025/');
    expect(url2025).toContain('79-2025-');
  });
});

describe('generateUrls', () => {
  it('genere toutes les URLs d\'un segment simple', () => {
    const segments: UrlSegment[] = [{ year: 2026, from: 1090, to: 1092 }];
    const urls = generateUrls(79, segments);
    expect(urls).toEqual([
      'https://openedit.io/invoices/79/2026/79-2026-1090.pdf',
      'https://openedit.io/invoices/79/2026/79-2026-1091.pdf',
      'https://openedit.io/invoices/79/2026/79-2026-1092.pdf',
    ]);
  });

  it('genere une seule URL quand from === to', () => {
    const segments: UrlSegment[] = [{ year: 2026, from: 1091, to: 1091 }];
    const urls = generateUrls(79, segments);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://openedit.io/invoices/79/2026/79-2026-1091.pdf');
  });

  it('concatene les URLs de plusieurs segments', () => {
    const segments: UrlSegment[] = [
      { year: 2025, from: 998, to: 999 },
      { year: 2026, from: 1000, to: 1001 },
    ];
    const urls = generateUrls(79, segments);
    expect(urls).toEqual([
      'https://openedit.io/invoices/79/2025/79-2025-0998.pdf',
      'https://openedit.io/invoices/79/2025/79-2025-0999.pdf',
      'https://openedit.io/invoices/79/2026/79-2026-1000.pdf',
      'https://openedit.io/invoices/79/2026/79-2026-1001.pdf',
    ]);
  });

  it('retourne un tableau vide pour une liste de segments vide', () => {
    expect(generateUrls(79, [])).toEqual([]);
  });
});
