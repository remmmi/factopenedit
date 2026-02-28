// Module d'extraction d'infos depuis les PDFs
import pdf from 'pdf-parse';
import * as fs from 'fs';

export interface ParsedInvoice {
  issueDate: string | null;    // format ISO : "2026-02-26"
  amountCents: number | null;  // en centimes : 26000 pour 260,00 EUR
  isPaid: boolean;
  rawText: string;
}

// "Facture émise le 26/02/2026" -> "2026-02-26"
function parseDate(text: string): string | null {
  const match = text.match(/Facture\s+émise\s+le\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

// "Total TTC260,00 €" ou "TOTAL À RÉGLER260,00 € TTC" -> 26000
function parseAmountCents(text: string): number | null {
  // On prend le "Total TTC" suivi du montant (le premier trouvé)
  const match = text.match(/Total TTC\s*([\d\s]+,\d{2})\s*€/);
  if (!match) return null;
  // Supprimer les espaces insécables ou normaux utilisés comme séparateurs de milliers
  const normalized = match[1].replace(/[\s\u00a0]/g, '').replace(',', '.');
  return Math.round(parseFloat(normalized) * 100);
}

// "FACTURE (ACQUITTEE)" ou "Facture acquittée le..."
function parsePaid(text: string): boolean {
  return /ACQUITT[EÉ]E?/i.test(text);
}

export async function parsePdf(filePath: string): Promise<ParsedInvoice> {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);
  const text = data.text;

  return {
    issueDate: parseDate(text),
    amountCents: parseAmountCents(text),
    isPaid: parsePaid(text),
    rawText: text,
  };
}
