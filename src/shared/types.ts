// Types et constantes partages entre main et renderer process

// Nombre de 404 consecutifs avant bascule d'annee (mode exploratoire).
export const YEAR_SWITCH_THRESHOLD = 3;

export interface UrlSegment {
  year: number;              // 0 = mode exploratoire (utiliser candidateYears)
  from: number;              // numero de sequence debut (inclus)
  to: number;                // numero de sequence fin (inclus)
  candidateYears?: number[]; // si year === 0, annees a essayer par ordre ASC
}

export type InvoiceStatus = 'downloaded' | 'sent_to_accountant';

export interface Invoice {
  openedit_id: number;
  year: number;
  file_path?: string;
  issue_date?: string;
  amount_cents?: number;
  is_paid: boolean;
  is_avoir: boolean;            // true si c'est un avoir (note de credit)
  cancels_openedit_id?: number; // seq de la facture annulee (si is_avoir)
  cancels_year?: number;        // annee de la facture annulee (si is_avoir)
  status: InvoiceStatus;
  downloaded_at: string;
  sent_at?: string;
  raw_text?: string;
  client_name?: string;
  client_contact?: string;
  client_city?: string;
}

export interface ScanProgress {
  url: string;
  seq: number;
  year: number;
  // checking  = tentative normale dans le scan DESC
  // probing   = sondage multi-annees de la borne superieure (ne compte pas dans la progression)
  // downloading / saved / skipped / error = states standard
  status: 'checking' | 'probing' | 'downloading' | 'saved' | 'skipped' | 'error';
  error?: string;
}

// Entree du plan de scan : une URL a tenter, avec contexte
export interface ScanPlanEntry {
  url: string;
  seq: number;
  year: number;
  yearSwitch?: true; // premier seq du nouveau bloc d'annee apres switch
  probe?: true;      // tentative de sondage de la borne superieure (plusieurs annees pour un meme seq)
}
