import './styles.css';
import type { Invoice, UrlSegment, ScanProgress } from '../shared/types';

// window.api est expose par preload.ts via contextBridge
declare global {
  interface Window {
    api: {
      login: () => Promise<{ success: boolean }>;
      checkSession: () => Promise<boolean>;
      getAllInvoices: () => Promise<(Invoice & { id: number })[]>;
      markSentToAccountant: (openeditId: number, year: number) => Promise<{ success: boolean }>;
      openPdf: (filePath: string) => Promise<{ success: boolean }>;
      getAllSettings: () => Promise<{ tenant_id?: string; base_url?: string; download_dir?: string }>;
      setSetting: (key: string, value: string) => Promise<{ success: boolean }>;
      previewScan: (tenantId: number, segments: UrlSegment[]) => Promise<string[]>;
      startScan: (tenantId: number, segments: UrlSegment[]) => Promise<number>;
      onScanProgress: (cb: (p: ScanProgress) => void) => () => void;
    };
  }
}

// ---------------------------------------------------------------------------
// Etat local
// ---------------------------------------------------------------------------

let allInvoices: (Invoice & { id: number })[] = [];
let tenantId = 79;

// ---------------------------------------------------------------------------
// Helpers formatage
// ---------------------------------------------------------------------------

function formatAmount(cents: number | undefined): string {
  if (cents === undefined || cents === null) return '-';
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' EUR';
}

function formatDate(iso: string | undefined): string {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

async function refreshSession(): Promise<void> {
  const label = document.getElementById('session-label')!;
  const btn = document.getElementById('btn-login') as HTMLButtonElement;

  const ok = await window.api.checkSession();
  if (ok) {
    label.textContent = 'Connecte';
    label.classList.add('connected');
    btn.textContent = 'Reconnexion';
  } else {
    label.textContent = 'Non connecte';
    label.classList.remove('connected');
    btn.textContent = 'Se connecter';
  }
}

// ---------------------------------------------------------------------------
// Factures : chargement et rendu
// ---------------------------------------------------------------------------

async function loadInvoices(): Promise<void> {
  allInvoices = await window.api.getAllInvoices();
  populateYearFilter();
  renderInvoices();
}

function populateYearFilter(): void {
  const select = document.getElementById('filter-year') as HTMLSelectElement;
  const years = [...new Set(allInvoices.map((i) => i.year))].sort((a, b) => b - a);
  const current = select.value;
  // Garder uniquement l'option "toutes"
  select.innerHTML = '<option value="">Toutes les annees</option>';
  for (const y of years) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    if (String(y) === current) opt.selected = true;
    select.appendChild(opt);
  }
}

function renderInvoices(): void {
  const tbody = document.getElementById('invoices-body')!;
  const empty = document.getElementById('invoices-empty')!;
  const footer = document.getElementById('invoices-count')!;

  const year = (document.getElementById('filter-year') as HTMLSelectElement).value;
  const status = (document.getElementById('filter-status') as HTMLSelectElement).value;
  const paid = (document.getElementById('filter-paid') as HTMLSelectElement).value;

  const filtered = allInvoices.filter((inv) => {
    if (year && String(inv.year) !== year) return false;
    if (status && inv.status !== status) return false;
    if (paid === '1' && !inv.is_paid) return false;
    if (paid === '0' && inv.is_paid) return false;
    return true;
  });

  tbody.innerHTML = '';
  empty.hidden = filtered.length > 0;

  for (const inv of filtered) {
    const tr = document.createElement('tr');

    const paidBadge = inv.is_paid
      ? '<span class="badge badge--paid">Acquittee</span>'
      : '<span class="badge badge--unpaid">Non acquittee</span>';

    const statusBadge = inv.status === 'sent_to_accountant'
      ? '<span class="badge badge--sent">Envoye comptable</span>'
      : '<span class="badge badge--dl">Telecharge</span>';

    const pdfBtn = inv.file_path
      ? `<button class="btn-action btn-open-pdf" data-path="${inv.file_path}">Ouvrir PDF</button>`
      : '';

    const sentBtn = inv.status !== 'sent_to_accountant'
      ? `<button class="btn-action btn-mark-sent" data-id="${inv.openedit_id}" data-year="${inv.year}">Marquer envoye</button>`
      : '';

    tr.innerHTML = `
      <td>${inv.openedit_id}</td>
      <td>${inv.year}</td>
      <td>${formatDate(inv.issue_date)}</td>
      <td>${formatAmount(inv.amount_cents)}</td>
      <td>${paidBadge}</td>
      <td>${statusBadge}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">${pdfBtn}${sentBtn}</td>
    `;
    tbody.appendChild(tr);
  }

  footer.textContent = `${filtered.length} facture${filtered.length > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function getSegment(): UrlSegment | null {
  const year = parseInt((document.getElementById('seg-year') as HTMLInputElement).value, 10);
  const from = parseInt((document.getElementById('seg-from') as HTMLInputElement).value, 10);
  const to = parseInt((document.getElementById('seg-to') as HTMLInputElement).value, 10);
  if (!year || !from || !to || from > to) return null;
  return { year, from, to };
}

async function previewScan(): Promise<void> {
  const seg = getSegment();
  if (!seg) return;

  const urls = await window.api.previewScan(tenantId, [seg]);

  const section = document.getElementById('preview-section')!;
  const count = document.getElementById('preview-count')!;
  const list = document.getElementById('preview-list')!;

  count.textContent = `${urls.length} URL${urls.length > 1 ? 's' : ''} a scanner`;
  list.innerHTML = urls.map((u) => `<p>${u}</p>`).join('');
  section.hidden = false;
}

async function startScan(): Promise<void> {
  const seg = getSegment();
  if (!seg) return;

  const btnScan = document.getElementById('btn-scan') as HTMLButtonElement;
  const btnPreview = document.getElementById('btn-preview') as HTMLButtonElement;
  const progressSection = document.getElementById('scan-progress')!;
  const progressBar = document.getElementById('progress-bar')!;
  const progressText = document.getElementById('progress-text')!;
  const progressUrl = document.getElementById('progress-url')!;
  const resultSection = document.getElementById('scan-result')!;
  const resultText = document.getElementById('scan-result-text')!;

  btnScan.disabled = true;
  btnPreview.disabled = true;
  progressSection.hidden = false;
  resultSection.hidden = true;

  const total = seg.to - seg.from + 1;
  let done = 0;
  let saved = 0;

  // Abonnement aux evenements de progression (push main -> renderer via IPC)
  const unsubscribe = window.api.onScanProgress((p: ScanProgress) => {
    done++;
    if (p.status === 'saved') saved++;

    const pct = Math.round((done / total) * 100);
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${done} / ${total} -- ${p.status}`;
    progressUrl.textContent = p.url;
  });

  try {
    const count = await window.api.startScan(tenantId, [seg]);
    resultText.textContent = `${count} facture${count > 1 ? 's' : ''} telechargee${count > 1 ? 's' : ''}`;
    resultSection.hidden = false;
    // Recharger le tableau
    await loadInvoices();
  } finally {
    unsubscribe();
    btnScan.disabled = false;
    btnPreview.disabled = false;
    progressBar.style.width = '100%';
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {

  // Attacher les listeners immediatement (ne pas bloquer sur les appels async)
  // Header
  document.getElementById('btn-login')!.addEventListener('click', async () => {
    await window.api.login();
    await refreshSession();
  });

  // Filtres
  document.getElementById('filter-year')!.addEventListener('change', renderInvoices);
  document.getElementById('filter-status')!.addEventListener('change', renderInvoices);
  document.getElementById('filter-paid')!.addEventListener('change', renderInvoices);
  document.getElementById('btn-refresh')!.addEventListener('click', loadInvoices);

  // Scan
  document.getElementById('btn-preview')!.addEventListener('click', previewScan);
  document.getElementById('btn-scan')!.addEventListener('click', startScan);

  // Init async (en parallele, sans bloquer les listeners)
  refreshSession().catch(console.error);
  loadInvoices().catch(console.error);

  // Delegation : boutons dans le tableau (ouvrir PDF, marquer envoye)
  document.getElementById('invoices-body')!.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;

    if (target.classList.contains('btn-open-pdf')) {
      const p = target.dataset.path!;
      await window.api.openPdf(p);
    }

    if (target.classList.contains('btn-mark-sent')) {
      const id = parseInt(target.dataset.id!, 10);
      const year = parseInt(target.dataset.year!, 10);
      await window.api.markSentToAccountant(id, year);
      await loadInvoices();
    }
  });
});
