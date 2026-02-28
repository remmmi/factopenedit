// Module de telechargement des factures PDF
import { net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { generateUrls } from './url-generator';
import { parsePdf } from './pdf-parser';
import type { UrlSegment, Invoice, ScanProgress } from '../shared/types';

// Delai entre deux requetes pour ne pas se faire rate-limiter (ms)
const REQUEST_DELAY_MS = 300;

export interface ScanOptions {
  downloadDir: string;       // dossier racine ou sauvegarder les PDFs
  tenantId: number;
  segments: UrlSegment[];
  baseUrl?: string;
  delayMs?: number;          // surcharge du delai par defaut
  onProgress?: (p: ScanProgress) => void;
}

/**
 * Fait une requete HEAD pour verifier si une URL existe.
 * net.request utilise les cookies de session.defaultSession automatiquement
 * quand useSessionCookies est true -- pas de CORS, pas de credentials a passer.
 *
 * @returns true si HTTP 200, false si 404 ou autre erreur
 */
function checkUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = net.request({ method: 'HEAD', url, useSessionCookies: true });
    req.on('response', (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.end();
  });
}

/**
 * Telecharge un PDF depuis une URL et le sauvegarde sur le disque.
 * net.request streame la reponse en chunks -- on les accumule dans un Buffer
 * puis on ecrit d'un coup pour eviter un fichier corrompu en cas d'erreur.
 *
 * @returns Buffer du PDF telecharge
 */
function downloadPdf(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url, useSessionCookies: true });

    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Construit le chemin local d'une facture.
 * Structure : {downloadDir}/{year}/{tenantId}-{year}-{seq:04d}.pdf
 */
function buildFilePath(
  downloadDir: string,
  tenantId: number,
  year: number,
  seq: number
): string {
  const seqPadded = String(seq).padStart(4, '0');
  const filename = `${tenantId}-${year}-${seqPadded}.pdf`;
  return path.join(downloadDir, String(year), filename);
}

/** Petit utilitaire pour attendre N ms entre les requetes */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scanne une liste de segments, telecharge les PDFs trouves,
 * parse leurs infos et retourne les factures extraites.
 *
 * Sequence pour chaque URL :
 *   1. HEAD -> si 404, on skippe (la facture n'existe pas encore ou gap)
 *   2. GET  -> telecharge le PDF
 *   3. Sauvegarde sur disque
 *   4. Parse le PDF pour extraire date, montant, statut
 *   5. Attend REQUEST_DELAY_MS avant la prochaine requete
 *
 * Le callback onProgress permet a l'UI de suivre l'avancement en temps reel
 * via IPC (le main process appellera ipcMain -> renderer).
 */
export async function scanSegments(opts: ScanOptions): Promise<Invoice[]> {
  const {
    downloadDir,
    tenantId,
    segments,
    baseUrl,
    delayMs = REQUEST_DELAY_MS,
    onProgress,
  } = opts;

  const urls = generateUrls(tenantId, segments, baseUrl);
  const invoices: Invoice[] = [];

  for (const url of urls) {
    // Extraire year et seq depuis le nom de fichier dans l'URL
    // ex: .../79/2026/79-2026-1091.pdf -> year=2026, seq=1091
    const urlMatch = url.match(/\/(\d{4})\/\d+-(\d{4})-(\d{4})\.pdf$/);
    if (!urlMatch) continue;
    const year = parseInt(urlMatch[1], 10);
    const seq = parseInt(urlMatch[3], 10);

    onProgress?.({ url, seq, year, status: 'checking' });

    const exists = await checkUrl(url);
    if (!exists) {
      onProgress?.({ url, seq, year, status: 'skipped' });
      await sleep(delayMs);
      continue;
    }

    onProgress?.({ url, seq, year, status: 'downloading' });

    try {
      const buffer = await downloadPdf(url);
      const filePath = buildFilePath(downloadDir, tenantId, year, seq);

      // Creer le dossier {downloadDir}/{year}/ si necessaire
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buffer);

      // Parser le PDF pour extraire les metadonnees
      const parsed = await parsePdf(filePath);

      const invoice: Invoice = {
        openedit_id: seq,
        year,
        file_path: filePath,
        issue_date: parsed.issueDate ?? undefined,
        amount_cents: parsed.amountCents ?? undefined,
        is_paid: parsed.isPaid,
        status: 'downloaded',
        downloaded_at: new Date().toISOString(),
      };

      invoices.push(invoice);
      onProgress?.({ url, seq, year, status: 'saved' });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      onProgress?.({ url, seq, year, status: 'error', error });
    }

    await sleep(delayMs);
  }

  return invoices;
}
