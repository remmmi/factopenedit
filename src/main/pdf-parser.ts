// Module d'extraction d'infos depuis les PDFs
//
// On importe directement pdf-parse/lib/pdf-parse.js et non l'index.js :
// l'index.js de pdf-parse v1 contient un appel de test au require() qui
// tente d'ouvrir ./test/data/05-versions-space.pdf -- ce fichier n'existe
// pas dans l'environnement Electron et fait crasher le main process.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdf = require('pdf-parse/lib/pdf-parse.js');
import * as fs from 'fs';

export interface ParsedInvoice {
  issueDate: string | null;
  amountCents: number | null;
  isPaid: boolean;
  clientName: string | null;    // premiere ligne du bloc client
  clientContact: string | null; // responsable (ligne apres le nom)
  clientCity: string | null;    // ville (dernier code postal du bloc client)
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

// Extrait le bloc client : texte entre le numero de l'emetteur et "OBJET :"
function extractClientBlock(text: string): string | null {
  const match = text.match(/04\s*92\s*43\s*72\s*72\s*([\s\S]*?)(?=OBJET\s*:)/);
  return match ? match[1] : null;
}

// Premiere ligne non vide du bloc client -> nom de l'entite cliente
function parseClientName(text: string): string | null {
  const block = extractClientBlock(text);
  if (!block) return null;
  const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  return lines[0] ?? null;
}

// Responsable : ligne apres le nom de l'entite (avant adresse/email/siret)
function parseClientContact(text: string): string | null {
  const block = extractClientBlock(text);
  if (!block) return null;
  const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  // Sauter le nom (1ere ligne) + les continuations (commence par un chiffre ou 1ere se termine par '-')
  let i = 1;
  while (i < lines.length && (lines[i - 1].endsWith('-') || /^\d/.test(lines[i]))) {
    i++;
  }

  // Chercher la 1ere ligne qui ressemble a un nom (pas adresse/email/siret/tel)
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (/\d{5}/.test(l)) break;      // code postal -> fin du bloc noms
    if (/@/.test(l)) break;           // email
    if (/SIRET/i.test(l)) break;      // siret
    if (/^0[1-9](\s\d{2}){4}/.test(l)) break; // telephone
    if (/^\d+\s+\w/.test(l)) continue; // adresse numerotee, on saute
    return l;
  }
  return null;
}

// Dernier code postal + ville du bloc client -- filtre les emails
function parseClientCity(text: string): string | null {
  const block = extractClientBlock(text);
  if (!block) return null;
  const matches = [...block.matchAll(/\d{5}\s+(.+)/g)]
    .filter((m) => !m[1].includes('@') && /^[A-ZÀ-ÿa-z]/.test(m[1].trim()));
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

export async function parsePdf(filePath: string): Promise<ParsedInvoice> {
  const buffer = fs.readFileSync(filePath);
  const data = await pdf(buffer);
  const text = data.text;

  return {
    issueDate: parseDate(text),
    amountCents: parseAmountCents(text),
    isPaid: parsePaid(text),
    clientName: parseClientName(text),
    clientContact: parseClientContact(text),
    clientCity: parseClientCity(text),
    rawText: text,
  };
}
