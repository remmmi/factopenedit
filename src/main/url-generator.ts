// Generateur d'URLs de factures a partir de segments de plage
import type { UrlSegment, ScanPlanEntry } from '../shared/types';

export const DEFAULT_BASE_URL = 'https://saisie.open-edit.io';

// Nombre de 404 consecutifs avant bascule d'annee (mode exploratoire).
// Les seqs etant globalement croissants, un gap de 3 signifie qu'on a passe
// la frontiere d'annee -- pas besoin d'attendre 30.
export const YEAR_SWITCH_THRESHOLD = 3;

export function generateUrl(
  tenantId: number,
  year: number,
  seq: number,
  baseUrl: string = DEFAULT_BASE_URL
): string {
  const seqPadded = String(seq).padStart(4, '0');
  return `${baseUrl}/invoices/${tenantId}/${year}/${tenantId}-${year}-${seqPadded}.pdf`;
}

/**
 * Genere le plan theorique de scan pour affichage dans le modal de confirmation.
 *
 * Mode normal (year != 0) : URLs en ASC, annee fixe.
 *
 * Mode exploratoire (year === 0) :
 *   Phase 1 - Sondage borne superieure : toutes les annees DESC pour segment.to
 *             (marquees probe:true) -- la premiere qui repond 200 determine l'annee de depart.
 *   Phase 2 - Scan DESC : depuis segment.to-1 vers segment.from avec YEAR_SWITCH_THRESHOLD.
 *             Au seuil, on note le switch et on inclut une entree de retry pour le meme seq.
 *
 * Note : la simulation suppose le pire cas (toutes les tentatives echouent)
 * pour montrer toutes les bascules potentielles.
 */
export function generateScanPlan(
  tenantId: number,
  segments: UrlSegment[],
  baseUrl: string = DEFAULT_BASE_URL
): ScanPlanEntry[] {
  const plan: ScanPlanEntry[] = [];

  for (const segment of segments) {
    if (segment.year === 0 && segment.candidateYears && segment.candidateYears.length > 0) {
      const yearsDesc = [...segment.candidateYears].sort((a, b) => b - a);
      const minYear   = yearsDesc[yearsDesc.length - 1];

      // Phase 1 : sondage de la borne superieure
      for (const y of yearsDesc) {
        plan.push({
          url: generateUrl(tenantId, y, segment.to, baseUrl),
          seq: segment.to,
          year: y,
          probe: true,
        });
      }

      // Phase 2 : simulation scan DESC (pire cas : tout est 404)
      let currentYear = yearsDesc[0];
      let consecutiveMisses = 0;

      for (let seq = segment.to - 1; seq >= segment.from; seq--) {
        const prev = plan[plan.length - 1];
        const yearSwitch: true | undefined =
          prev !== undefined && !prev.probe && prev.year !== currentYear ? true : undefined;

        plan.push({ url: generateUrl(tenantId, currentYear, seq, baseUrl), seq, year: currentYear, yearSwitch });

        consecutiveMisses++;
        if (consecutiveMisses >= YEAR_SWITCH_THRESHOLD && currentYear > minYear) {
          const newYear = currentYear - 1;
          // Entree de retry : meme seq, annee suivante
          plan.push({ url: generateUrl(tenantId, newYear, seq, baseUrl), seq, year: newYear, yearSwitch: true });
          currentYear = newYear;
          consecutiveMisses = 0;
        }
      }
    } else {
      // Mode normal : ASC, annee fixe
      for (let seq = segment.from; seq <= segment.to; seq++) {
        plan.push({ url: generateUrl(tenantId, segment.year, seq, baseUrl), seq, year: segment.year });
      }
    }
  }

  return plan;
}
