import { generateUrl } from './url-generator';

describe('generateUrl', () => {
  it('genere une URL avec le bon format de base', () => {
    const url = generateUrl(79, 2026, 1091);
    expect(url).toBe('https://saisie.open-edit.io/invoices/79/2026/79-2026-1091.pdf');
  });

  it('zero-padde le numero de sequence sur 4 digits', () => {
    expect(generateUrl(79, 2026, 1)).toBe(
      'https://saisie.open-edit.io/invoices/79/2026/79-2026-0001.pdf'
    );
    expect(generateUrl(79, 2026, 10)).toBe(
      'https://saisie.open-edit.io/invoices/79/2026/79-2026-0010.pdf'
    );
    expect(generateUrl(79, 2026, 100)).toBe(
      'https://saisie.open-edit.io/invoices/79/2026/79-2026-0100.pdf'
    );
  });

  it("utilise l'annee dans le path ET dans le nom de fichier", () => {
    const url2025 = generateUrl(79, 2025, 999);
    expect(url2025).toContain('/2025/');
    expect(url2025).toContain('79-2025-');
  });
});

