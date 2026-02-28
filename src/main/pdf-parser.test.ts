import { parseIsAvoir, parseCancelsRef } from './pdf-parser';

describe('parseIsAvoir', () => {
  it('detecte un avoir', () => {
    expect(parseIsAvoir('FACTURE (AVOIR) N°79-\n2026-0908')).toBe(true);
  });

  it('detecte un avoir avec espaces variables', () => {
    expect(parseIsAvoir('FACTURE  (AVOIR) quelque chose')).toBe(true);
  });

  it('retourne false pour une facture normale', () => {
    expect(parseIsAvoir('FACTURE N°79-2026-0907')).toBe(false);
  });

  it('retourne false pour une chaine vide', () => {
    expect(parseIsAvoir('')).toBe(false);
  });
});

describe('parseCancelsRef', () => {
  it('extrait year et seq depuis la reference', () => {
    const ref = parseCancelsRef('Avoir sur facture 79-2026-0907\nautres lignes');
    expect(ref).toEqual({ year: 2026, seq: 907 });
  });

  it('retourne null si pas de reference', () => {
    expect(parseCancelsRef('FACTURE N°79-2026-0907')).toBeNull();
  });

  it('retourne null pour une chaine vide', () => {
    expect(parseCancelsRef('')).toBeNull();
  });

  it('gere les numeros de sequence sans zero-padding', () => {
    const ref = parseCancelsRef('Avoir sur facture 79-2026-1090');
    expect(ref).toEqual({ year: 2026, seq: 1090 });
  });
});
