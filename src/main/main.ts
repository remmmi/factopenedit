import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';

const BASE_URL = 'https://saisie.open-edit.io';

// tenantId lu depuis la DB apres init ; null avant le premier telechargement
let tenantId: number | null = null;
// Dossier de telechargement : userData pour eviter les orphelins apres mises a jour Squirrel
let DOWNLOAD_DIR: string;

import { initDb, getAllInvoices, getInvoice, markSentToAccountant, updateInvoiceStatus, getSetting, setSetting, insertInvoice, updateClientFields, updateAvoirFields, updateRawText } from './db';
import { parsePdf } from './pdf-parser';
import { openLoginWindow, isSessionValid } from './auth';
import { scanSegments } from './downloader';
import { generateScanPlan } from './url-generator';
import type { UrlSegment, Invoice } from '../shared/types';

// Constantes Webpack injectees par Electron Forge au build
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) app.quit();

// DB et fenetre principale -- initialisees dans app.ready
let db: Database.Database;
let mainWindow: BrowserWindow;

// ---------------------------------------------------------------------------
// Fenetre principale
// ---------------------------------------------------------------------------

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'fact_openedit',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      // contextIsolation: true est le defaut depuis Electron 12
      // nodeIntegration: false est le defaut -- le renderer n'a pas acces a Node.js
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

}

// ---------------------------------------------------------------------------
// Initialisation de la DB
// ---------------------------------------------------------------------------

function initDatabase(): void {
  // En prod : ~/.config/fact-openedit/invoices.db (Linux) ou equivalent
  // En dev  : meme endroit, userData pointe vers un dossier de dev Electron
  const dbPath = path.join(app.getPath('userData'), 'invoices.db');
  db = initDb(dbPath);

  // Lire le tenant_id stocke en DB
  const savedTenant = getSetting(db, 'tenant_id');
  if (savedTenant) tenantId = parseInt(savedTenant, 10);

  // Dossier de telechargement dans userData (portable entre mises a jour)
  DOWNLOAD_DIR = path.join(app.getPath('userData'), 'pdf_download');
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

  // Fallback : detecter le tenant_id depuis les noms de fichiers PDF existants
  // Format attendu : "{tenant}-{year}-{seq}.pdf" ex: "79-2026-1110.pdf"
  if (tenantId === null) {
    const detected = detectTenantFromPdfs(DOWNLOAD_DIR);
    if (detected !== null) {
      tenantId = detected;
      setSetting(db, 'tenant_id', String(detected));
      console.log(`[init] tenant_id=${detected} detecte depuis les PDFs existants`);
    }
  }
}

function detectTenantFromPdfs(dir: string): number | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const file of fs.readdirSync(path.join(dir, entry.name))) {
        const m = file.match(/^(\d+)-\d{4}-\d+\.pdf$/);
        if (m) return parseInt(m[1], 10);
      }
    }
    if (entry.isFile() && entry.name.endsWith('.pdf')) {
      const m = entry.name.match(/^(\d+)-\d{4}-\d+\.pdf$/);
      if (m) return parseInt(m[1], 10);
    }
  }
  return null;
}

// Integre en DB les PDFs deja telecharges mais absents de la DB
// (ex : scan interrompu avant la phase d'insertion)
// Le nom de fichier doit etre au format "79-2026-1110.pdf"
async function backfillFromPdfDir(dir: string): Promise<number> {
  if (!fs.existsSync(dir)) return 0;

  // Collecte recursive des .pdf
  function collectPdfs(d: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) results.push(...collectPdfs(full));
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) results.push(full);
    }
    return results;
  }

  const pdfs = collectPdfs(dir);
  let inserted = 0;

  for (const filePath of pdfs) {
    const name = path.basename(filePath, '.pdf');
    // Format attendu : "{tenant}-{year}-{seq}" ex: "79-2026-1110"
    const m = name.match(/^(\d+)-(\d{4})-(\d+)$/);
    if (!m) continue;
    const year = parseInt(m[2], 10);
    const seq  = parseInt(m[3], 10);

    // Deja en DB : on saute
    if (getInvoice(db, seq, year)) continue;

    try {
      const parsed = await parsePdf(filePath);
      insertInvoice(db, {
        openedit_id:        seq,
        year,
        file_path:          filePath,
        issue_date:         parsed.issueDate ?? undefined,
        amount_cents:       parsed.amountCents ?? undefined,
        is_paid:            parsed.isPaid,
        is_avoir:           parsed.isAvoir,
        cancels_openedit_id: parsed.cancelsOpeneditId ?? undefined,
        cancels_year:       parsed.cancelsYear ?? undefined,
        status:             'downloaded',
        downloaded_at:      new Date().toISOString(),
        raw_text:           parsed.rawText,
        client_name:        parsed.clientName ?? undefined,
        client_contact:     parsed.clientContact ?? undefined,
        client_city:        parsed.clientCity ?? undefined,
      });
      inserted++;
    } catch {
      // PDF illisible ou doublon concurrent, on ignore
    }
  }

  return inserted;
}

// Re-parse les PDFs locaux des factures sans champs client (migration one-shot)
async function backfillClientFields(): Promise<void> {
  const invoices = getAllInvoices(db).filter(
    (inv) => !inv.client_name && inv.file_path && fs.existsSync(inv.file_path)
  );
  for (const inv of invoices) {
    try {
      const parsed = await parsePdf(inv.file_path!);
      updateClientFields(db, inv.openedit_id, inv.year,
        parsed.clientName, parsed.clientContact, parsed.clientCity);
    } catch {
      // PDF illisible, on ignore
    }
  }
}

// Re-parse les PDFs locaux pour detecter les avoirs non encore analyses.
// Cible : factures avec file_path valide et raw_text NULL (pas encore parse).
async function backfillAvoirFields(): Promise<void> {
  const invoices = getAllInvoices(db).filter(
    (inv) => !inv.raw_text && inv.file_path && fs.existsSync(inv.file_path)
  );
  for (const inv of invoices) {
    try {
      const parsed = await parsePdf(inv.file_path!);
      updateAvoirFields(
        db, inv.openedit_id, inv.year,
        parsed.isAvoir,
        parsed.cancelsOpeneditId,
        parsed.cancelsYear,
      );
      // Stocker raw_text pour eviter de re-parser au prochain demarrage
      updateRawText(db, inv.openedit_id, inv.year, parsed.rawText);
    } catch {
      // PDF illisible, on ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Handlers IPC
//
// Le renderer appelle window.api.xxx() (expose dans preload.ts via contextBridge)
// qui fait ipcRenderer.invoke('canal', args) -> ipcMain.handle('canal', fn)
// ---------------------------------------------------------------------------

function registerIpcHandlers(): void {

  // -- Auth ------------------------------------------------------------------

  ipcMain.handle('auth:login', async () => {
    await openLoginWindow(BASE_URL);
    return { success: true };
  });

  ipcMain.handle('auth:check-session', async () => {
    return isSessionValid(BASE_URL);
  });

  // -- Factures --------------------------------------------------------------

  ipcMain.handle('invoices:get-all', () => {
    return getAllInvoices(db);
  });

  ipcMain.handle('invoices:mark-sent', (_event, openeditId: number, year: number) => {
    markSentToAccountant(db, openeditId, year);
    return { success: true };
  });

  ipcMain.handle('invoices:unmark-sent', (_event, openeditId: number, year: number) => {
    updateInvoiceStatus(db, openeditId, year, 'downloaded');
    return { success: true };
  });

  ipcMain.handle('invoices:open-pdf', async (_event, filePath: string) => {
    // shell.openPath ouvre le fichier avec l'application systeme par defaut (lecteur PDF)
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return { success: true };
  });

  // -- Settings --------------------------------------------------------------

  ipcMain.handle('settings:get-all', () => {
    return {
      tenant_id: getSetting(db, 'tenant_id'),
      base_url: getSetting(db, 'base_url'),
      download_dir: getSetting(db, 'download_dir'),
    };
  });

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    setSetting(db, key, value);
    return { success: true };
  });

  // -- DB admin --------------------------------------------------------------

  ipcMain.handle('db:reset', () => {
    db.prepare('DELETE FROM invoices').run();
    return { success: true };
  });

  ipcMain.handle('db:backfill', async () => {
    const oldDir = path.join(app.getAppPath(), 'pdf_download');
    const n1 = await backfillFromPdfDir(oldDir);
    const n2 = await backfillFromPdfDir(DOWNLOAD_DIR);
    return n1 + n2;
  });

  // -- Transfert entre postes ------------------------------------------------

  ipcMain.handle('transfer:export-zip', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `factures-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Archive ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;

    // Collecte recursive de tous les PDFs
    function collectPdfs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) results.push(...collectPdfs(full));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) results.push(full);
      }
      return results;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require('jszip');
    const zip = new JSZip();

    // Deduplique par nom de fichier (ancien + nouveau dossier peuvent se chevaucher)
    const seen = new Set<string>();
    const dirs = [DOWNLOAD_DIR, path.join(app.getAppPath(), 'pdf_download')];
    for (const dir of dirs) {
      for (const fp of collectPdfs(dir)) {
        const rel = path.relative(dir, fp); // ex: "2026/79-2026-1110.pdf"
        if (!seen.has(rel)) {
          seen.add(rel);
          zip.file(rel, fs.readFileSync(fp));
        }
      }
    }

    const buffer: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(result.filePath, buffer);
    return result.filePath;
  });

  ipcMain.handle('transfer:import-zip', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [{ name: 'Archive ZIP', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require('jszip');
    const data = fs.readFileSync(result.filePaths[0]);
    const zip = await JSZip.loadAsync(data);

    let extracted = 0;
    for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
      const entry = zipEntry as { dir: boolean; async: (type: string) => Promise<Buffer> };
      if (entry.dir) continue;
      if (!relativePath.toLowerCase().endsWith('.pdf')) continue;
      const destPath = path.join(DOWNLOAD_DIR, relativePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const content = await entry.async('nodebuffer');
      fs.writeFileSync(destPath, content);
      extracted++;
    }

    const inserted = await backfillFromPdfDir(DOWNLOAD_DIR);
    return { extracted, inserted };
  });

  // -- Comptable -------------------------------------------------------------

  ipcMain.handle('accountant:download-zip', async (_event, filePaths: string[]) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `factures-comptable-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Archive ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const JSZip = require('jszip');
    const zip = new JSZip();
    for (const fp of filePaths) {
      if (fs.existsSync(fp)) {
        zip.file(path.basename(fp), fs.readFileSync(fp));
      }
    }
    const buffer: Buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(result.filePath, buffer);
    return result.filePath;
  });

  // -- Scan ------------------------------------------------------------------

  ipcMain.handle('scan:plan', (_event, tenantId_arg: number, segments: UrlSegment[]) => {
    const tid = tenantId_arg || tenantId;
    if (!tid) throw new Error('tenant_id non configure — faites un premier telechargement');
    return generateScanPlan(tid, segments, BASE_URL);
  });

  ipcMain.handle('scan:start', async (_event, tenantId_arg: number, segments: UrlSegment[], opts?: { delayMs?: number; delayMaxMs?: number }) => {
    const tid = tenantId_arg || tenantId;
    if (!tid) throw new Error('tenant_id non configure — faites un premier telechargement');
    if (tenantId !== tid) {
      setSetting(db, 'tenant_id', String(tid));
      tenantId = tid;
    }
    const downloadDir = DOWNLOAD_DIR;

    const invoices = await scanSegments({
      tenantId: tid,
      segments,
      baseUrl: BASE_URL,
      downloadDir,
      delayMs:    opts?.delayMs,
      delayMaxMs: opts?.delayMaxMs,
      onProgress: (progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan:progress', progress);
        }
      },
      existsInDb: (seq, year) => !!getInvoice(db, seq, year),
      onSave: (invoice) => {
        try { insertInvoice(db, invoice); } catch { /* doublon */ }
      },
    });

    return invoices.length;
  });

  ipcMain.handle('scan:daily', async (_event, maxSeq: number, maxYear: number) => {
    if (tenantId === null) throw new Error('tenant_id non configure — faites un premier telechargement');
    const currentYear = new Date().getFullYear();
    const startYear   = Math.max(maxYear, currentYear);
    // Borne haute : 50 seq de buffer, stopAfterConsecutiveMisses coupe avant
    const TO_BUFFER = 50;
    const segment: UrlSegment = {
      year:  startYear,
      from:  maxSeq + 1,
      to:    maxSeq + TO_BUFFER,
    };

    const invoices = await scanSegments({
      tenantId: tenantId,
      segments: [segment],
      baseUrl:  BASE_URL,
      downloadDir: DOWNLOAD_DIR!,
      stopAfterConsecutiveMisses: 3,
      existsInDb: (seq, year) => !!getInvoice(db, seq, year),
      onProgress: (progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan:progress', progress);
        }
      },
      onSave: (invoice) => {
        try { insertInvoice(db, invoice); } catch { /* doublon */ }
      },
    });

    return invoices.length;
  });

  ipcMain.handle('scan:initial',
    async (_event,
           tenantId_arg: number,
           startSeq: number,
           startYear: number,
           count: number,
           opts?: { delayMs?: number; delayMaxMs?: number }
    ) => {
      // Stocker en DB si nouveau ou different
      if (tenantId !== tenantId_arg) {
        setSetting(db, 'tenant_id', String(tenantId_arg));
        tenantId = tenantId_arg;
      }

      // candidateYears : de minYear jusqu'a startYear (ASC requis)
      const minYear = 2010;
      const candidateYears: number[] = [];
      for (let y = minYear; y <= startYear; y++) candidateYears.push(y);

      const segment: UrlSegment = {
        year:           0,
        from:           Math.max(1, startSeq - count - 50), // marge
        to:             startSeq,
        candidateYears,
      };

      const invoices = await scanSegments({
        tenantId:    tenantId,
        segments:    [segment],
        baseUrl:     BASE_URL,
        downloadDir: DOWNLOAD_DIR!,
        delayMs:     opts?.delayMs,
        delayMaxMs:  opts?.delayMaxMs,
        maxDownloads: count,
        existsInDb: (seq, year) => !!getInvoice(db, seq, year),
        onProgress: (progress) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scan:progress', progress);
          }
        },
        onSave: (invoice) => {
          try { insertInvoice(db, invoice); } catch { /* doublon */ }
        },
      });

      return invoices.length;
    }
  );
}

// ---------------------------------------------------------------------------
// Cycle de vie Electron
// ---------------------------------------------------------------------------

app.on('ready', () => {
  initDatabase();
  registerIpcHandlers();
  createWindow();
  // Backfill silencieux apres ouverture de fenetre
  // 1. Integre les PDFs existants non encore en DB (scan interrompu, ancien dossier)
  const oldPdfDir = path.join(app.getAppPath(), 'pdf_download');
  backfillFromPdfDir(oldPdfDir)
    .then(n => { if (n > 0) console.log(`[backfill] ${n} factures integrees depuis ${oldPdfDir}`); })
    .catch(() => {});
  backfillFromPdfDir(DOWNLOAD_DIR)
    .then(n => { if (n > 0) console.log(`[backfill] ${n} factures integrees depuis ${DOWNLOAD_DIR}`); })
    .catch(() => {});
  // 2. Migrations champs client et avoirs
  backfillClientFields().catch(() => {});
  backfillAvoirFields().catch(() => {});
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('quit', () => {
  // Fermer la DB proprement avant de quitter
  db?.close();
});
