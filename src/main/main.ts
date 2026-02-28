import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import Database from 'better-sqlite3';

const TENANT_ID = 79;
const BASE_URL = 'https://saisie.open-edit.io';
// Dossier de telechargement fixe, cree automatiquement si absent
const DOWNLOAD_DIR = path.join(app.getAppPath(), 'pdf_download');

import { initDb, getAllInvoices, markSentToAccountant, getSetting, setSetting, insertInvoice, updateClientFields, updateAvoirFields } from './db';
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

  // DevTools : ouvrir en fenetre detachee pour ne pas ecraser le layout
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ---------------------------------------------------------------------------
// Initialisation de la DB
// ---------------------------------------------------------------------------

function initDatabase(): void {
  // En prod : ~/.config/fact-openedit/invoices.db (Linux) ou equivalent
  // En dev  : meme endroit, userData pointe vers un dossier de dev Electron
  const dbPath = path.join(app.getPath('userData'), 'invoices.db');
  db = initDb(dbPath);

  // (pas de settings dynamiques pour l'instant)

  // Creer le dossier de telechargement si absent
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
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

// Detecte les avoirs depuis le raw_text stocke en DB (sans relire les PDFs)
// Synchrone (better-sqlite3), rapide sur 500+ factures.
function backfillAvoirFields(): void {
  const invoices = getAllInvoices(db).filter(inv => inv.raw_text);
  for (const inv of invoices) {
    const text = inv.raw_text!;
    const isAvoir = /FACTURE\s*\(AVOIR\)/i.test(text);
    const match = text.match(/Avoir sur facture \d+-(\d{4})-(\d+)/i);
    const cancelsYear = match ? parseInt(match[1], 10) : null;
    const cancelsSeq  = match ? parseInt(match[2], 10) : null;

    // Mettre a jour seulement si valeur change
    if (isAvoir !== inv.is_avoir
        || cancelsSeq !== (inv.cancels_openedit_id ?? null)
        || cancelsYear !== (inv.cancels_year ?? null)) {
      updateAvoirFields(db, inv.openedit_id, inv.year, isAvoir, cancelsSeq, cancelsYear);
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

  // -- Scan ------------------------------------------------------------------

  ipcMain.handle('scan:plan', (_event, _tenantId: number, segments: UrlSegment[]) => {
    return generateScanPlan(TENANT_ID, segments, BASE_URL);
  });

  ipcMain.handle('scan:start', async (_event, _tenantId: number, segments: UrlSegment[], opts?: { delayMs?: number; delayMaxMs?: number }) => {
    const downloadDir = DOWNLOAD_DIR;

    const invoices = await scanSegments({
      tenantId: TENANT_ID,
      segments,
      baseUrl: BASE_URL,
      downloadDir,
      delayMs:    opts?.delayMs,
      delayMaxMs: opts?.delayMaxMs,
      // Pour chaque etape, on pousse un evenement vers le renderer
      // webContents.send = push main -> renderer, sans attendre de reponse
      onProgress: (progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan:progress', progress);
        }
      },
    });

    // Inserer en DB toutes les factures telechargees
    for (const invoice of invoices) {
      try {
        insertInvoice(db, invoice);
      } catch {
        // Doublon -- facture deja telechargee lors d'un scan precedent, on ignore
      }
    }

    return invoices.length;
  });

  ipcMain.handle('scan:daily', async (_event, maxSeq: number, maxYear: number) => {
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
      tenantId: TENANT_ID,
      segments: [segment],
      baseUrl:  BASE_URL,
      downloadDir: DOWNLOAD_DIR,
      stopAfterConsecutiveMisses: 3,
      onProgress: (progress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan:progress', progress);
        }
      },
    });

    for (const invoice of invoices) {
      try { insertInvoice(db, invoice); } catch { /* doublon */ }
    }
    return invoices.length;
  });

  ipcMain.handle('scan:initial',
    async (_event,
           startSeq: number,
           startYear: number,
           count: number,
           opts?: { delayMs?: number; delayMaxMs?: number }
    ) => {
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
        tenantId:    TENANT_ID,
        segments:    [segment],
        baseUrl:     BASE_URL,
        downloadDir: DOWNLOAD_DIR,
        delayMs:     opts?.delayMs,
        delayMaxMs:  opts?.delayMaxMs,
        maxDownloads: count,
        onProgress: (progress) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scan:progress', progress);
          }
        },
      });

      for (const invoice of invoices) {
        try { insertInvoice(db, invoice); } catch { /* doublon */ }
      }
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
  backfillClientFields().catch(() => {});
  backfillAvoirFields(); // synchrone, regex sur raw_text en memoire
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
