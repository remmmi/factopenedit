// Preload script : pont securise entre main process et renderer
//
// POURQUOI contextBridge ?
// Le renderer (HTML/JS) ne peut pas acceder directement a ipcRenderer --
// ce serait une faille de securite (n'importe quel script injecte pourrait
// faire des appels systeme). contextBridge expose UNIQUEMENT les methodes
// qu'on choisit explicitement, rien d'autre.
//
// Le renderer utilise window.api.xxx() pour communiquer avec le main process.

import { contextBridge, ipcRenderer } from 'electron';
import type { UrlSegment, Invoice, ScanRange, ScanProgress } from '../shared/types';

// API exposee au renderer via window.api
const api = {

  // -- Auth ------------------------------------------------------------------

  login: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('auth:login'),

  checkSession: (): Promise<boolean> =>
    ipcRenderer.invoke('auth:check-session'),

  // -- Factures --------------------------------------------------------------

  getAllInvoices: (): Promise<(Invoice & { id: number })[]> =>
    ipcRenderer.invoke('invoices:get-all'),

  markSentToAccountant: (openeditId: number, year: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('invoices:mark-sent', openeditId, year),

  openPdf: (filePath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('invoices:open-pdf', filePath),

  // -- Settings --------------------------------------------------------------

  getAllSettings: (): Promise<{ tenant_id?: string; base_url?: string; download_dir?: string }> =>
    ipcRenderer.invoke('settings:get-all'),

  setSetting: (key: string, value: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:set', key, value),

  // -- Scan ------------------------------------------------------------------

  previewScan: (tenantId: number, segments: UrlSegment[]): Promise<string[]> =>
    ipcRenderer.invoke('scan:preview', tenantId, segments),

  startScan: (tenantId: number, segments: UrlSegment[]): Promise<number> =>
    ipcRenderer.invoke('scan:start', tenantId, segments),

  getScanRanges: (): Promise<(ScanRange & { id: number })[]> =>
    ipcRenderer.invoke('scan-ranges:get'),

  // -- Evenements push (main -> renderer) ------------------------------------
  // Le main envoie des events pendant le scan ; le renderer s'y abonne.

  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ScanProgress) =>
      callback(progress);
    ipcRenderer.on('scan:progress', handler);
    // Retourne une fonction de cleanup pour se desabonner
    return () => ipcRenderer.removeListener('scan:progress', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);

// Type global pour que TypeScript reconnaisse window.api dans le renderer
export type Api = typeof api;
