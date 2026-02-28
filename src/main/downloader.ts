// Module de telechargement des factures PDF
import { net } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { generateUrl, YEAR_SWITCH_THRESHOLD } from './url-generator';
import { parsePdf } from './pdf-parser';
import type { UrlSegment, Invoice, ScanProgress } from '../shared/types';

// Delai entre deux requetes pour ne pas se faire rate-limiter (ms)
const REQUEST_DELAY_MS = 300;

export interface ScanOptions {
  downloadDir: string;
  tenantId: number;
  segments: UrlSegment[];
  baseUrl?: string;
  delayMs?: number;
  delayMaxMs?: number;
  onProgress?: (p: ScanProgress) => void;
  stopAfterConsecutiveMisses?: number; // Mode daily : arret apres N 404 consecutifs
  maxDownloads?: number;               // Mode initial : arret apres N factures telechargees
}

function checkUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = net.request({ method: 'HEAD', url, useSessionCookies: true });
    req.on('response', (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.end();
  });
}

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

function buildFilePath(downloadDir: string, tenantId: number, year: number, seq: number): string {
  const seqPadded = String(seq).padStart(4, '0');
  return path.join(downloadDir, String(year), `${tenantId}-${year}-${seqPadded}.pdf`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min: number, max?: number): number {
  if (!max || max <= min) return min;
  return min + Math.random() * (max - min);
}

/**
 * Telecharge et sauvegarde un PDF, parse ses metadonnees.
 * Appelle onProgress avec 'downloading', puis 'saved' ou 'error'.
 */
async function downloadAndSave(
  url: string,
  seq: number,
  year: number,
  downloadDir: string,
  tenantId: number,
  invoices: Invoice[],
  onProgress?: (p: ScanProgress) => void,
): Promise<void> {
  onProgress?.({ url, seq, year, status: 'downloading' });
  try {
    const buffer   = await downloadPdf(url);
    const filePath = buildFilePath(downloadDir, tenantId, year, seq);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    const parsed   = await parsePdf(filePath);
    invoices.push({
      openedit_id:          seq,
      year,
      file_path:            filePath,
      issue_date:           parsed.issueDate           ?? undefined,
      amount_cents:         parsed.amountCents         ?? undefined,
      is_paid:              parsed.isPaid,
      is_avoir:             parsed.isAvoir,
      cancels_openedit_id:  parsed.cancelsOpeneditId  ?? undefined,
      cancels_year:         parsed.cancelsYear         ?? undefined,
      client_name:          parsed.clientName          ?? undefined,
      client_contact:       parsed.clientContact       ?? undefined,
      client_city:          parsed.clientCity          ?? undefined,
      status:               'downloaded',
      downloaded_at:        new Date().toISOString(),
    });
    onProgress?.({ url, seq, year, status: 'saved' });
  } catch (err) {
    onProgress?.({ url, seq, year, status: 'error', error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Scanne une liste de segments et retourne les factures extraites.
 *
 * Mode normal (segment.year != 0) : boucle ASC, annee fixe.
 *
 * Mode exploratoire (segment.year === 0) :
 *   Phase 1 - Sondage de la borne superieure : essaie toutes les annees
 *             candidates DESC pour segment.to jusqu'a trouver une reponse 200.
 *             Si aucune annee ne repond : erreur signalee, scan abandonne.
 *   Phase 2 - Scan DESC avec bascule automatique :
 *             Apres YEAR_SWITCH_THRESHOLD 404 consecutifs, decremente l'annee
 *             et retente immediatement le seq courant dans la nouvelle annee.
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

  const invoices: Invoice[] = [];

  for (const segment of segments) {
    if (segment.year === 0 && segment.candidateYears && segment.candidateYears.length > 0) {

      const yearsDesc = [...segment.candidateYears].sort((a, b) => b - a);
      const minYear   = yearsDesc[yearsDesc.length - 1];
      let currentYear = yearsDesc[0];

      // ---------------------------------------------------------------
      // Phase 1 : sondage de la borne superieure
      // ---------------------------------------------------------------
      let upperFound = false;
      for (const probeYear of yearsDesc) {
        const url = generateUrl(tenantId, probeYear, segment.to, baseUrl);
        onProgress?.({ url, seq: segment.to, year: probeYear, status: 'probing' });
        const exists = await checkUrl(url);
        await sleep(randomDelay(delayMs, opts.delayMaxMs));

        if (exists) {
          currentYear = probeYear;
          upperFound  = true;
          await downloadAndSave(url, segment.to, probeYear, downloadDir, tenantId, invoices, onProgress);
          if (opts.maxDownloads !== undefined && invoices.length >= opts.maxDownloads) {
            return invoices;
          }
          break;
        } else {
          onProgress?.({ url, seq: segment.to, year: probeYear, status: 'skipped' });
        }
      }

      if (!upperFound) {
        const url = generateUrl(tenantId, yearsDesc[0], segment.to, baseUrl);
        onProgress?.({ url, seq: segment.to, year: yearsDesc[0], status: 'error',
          error: `seq ${segment.to} introuvable dans toutes les annees candidates` });
        continue; // passer au segment suivant
      }

      // ---------------------------------------------------------------
      // Phase 2 : scan DESC avec bascule automatique
      // ---------------------------------------------------------------
      let consecutiveMisses = 0;

      for (let seq = segment.to - 1; seq >= segment.from; seq--) {
        const url = generateUrl(tenantId, currentYear, seq, baseUrl);
        onProgress?.({ url, seq, year: currentYear, status: 'checking' });
        const exists = await checkUrl(url);

        if (exists) {
          consecutiveMisses = 0;
          await downloadAndSave(url, seq, currentYear, downloadDir, tenantId, invoices, onProgress);
          if (opts.maxDownloads !== undefined && invoices.length >= opts.maxDownloads) {
            break;
          }
          await sleep(randomDelay(delayMs, opts.delayMaxMs));
        } else {
          consecutiveMisses++;
          onProgress?.({ url, seq, year: currentYear, status: 'skipped' });

          if (consecutiveMisses >= YEAR_SWITCH_THRESHOLD && currentYear > minYear) {
            currentYear--;
            consecutiveMisses = 0;

            // Retenter ce seq dans la nouvelle annee
            const retryUrl = generateUrl(tenantId, currentYear, seq, baseUrl);
            onProgress?.({ url: retryUrl, seq, year: currentYear, status: 'checking' });
            const retryExists = await checkUrl(retryUrl);
            await sleep(randomDelay(delayMs, opts.delayMaxMs));

            if (retryExists) {
              await downloadAndSave(retryUrl, seq, currentYear, downloadDir, tenantId, invoices, onProgress);
              if (opts.maxDownloads !== undefined && invoices.length >= opts.maxDownloads) {
                break;
              }
            } else {
              onProgress?.({ url: retryUrl, seq, year: currentYear, status: 'skipped' });
            }
          } else {
            await sleep(randomDelay(delayMs, opts.delayMaxMs));
          }
        }
      }

    } else {
      // Mode normal : boucle ASC, annee fixe
      let consecutiveMisses = 0;
      for (let seq = segment.from; seq <= segment.to; seq++) {
        const url = generateUrl(tenantId, segment.year, seq, baseUrl);
        onProgress?.({ url, seq, year: segment.year, status: 'checking' });
        const exists = await checkUrl(url);

        if (exists) {
          consecutiveMisses = 0;
          await downloadAndSave(url, seq, segment.year, downloadDir, tenantId, invoices, onProgress);
        } else {
          consecutiveMisses++;
          onProgress?.({ url, seq, year: segment.year, status: 'skipped' });
          if (opts.stopAfterConsecutiveMisses !== undefined && consecutiveMisses >= opts.stopAfterConsecutiveMisses) {
            break;
          }
        }

        await sleep(randomDelay(delayMs, opts.delayMaxMs));
      }
    }
  }

  return invoices;
}
