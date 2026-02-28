import './styles.css';
import type { Invoice, UrlSegment, ScanProgress, ScanPlanEntry } from '../shared/types';

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
      getScanPlan: (tenantId: number, segments: UrlSegment[]) => Promise<ScanPlanEntry[]>;
      startScan: (tenantId: number, segments: UrlSegment[], opts?: { delayMs?: number; delayMaxMs?: number }) => Promise<number>;
      scanDaily: (maxSeq: number, maxYear: number) => Promise<number>;
      scanInitial: (
        startSeq: number,
        startYear: number,
        count: number,
        opts?: { delayMs?: number; delayMaxMs?: number }
      ) => Promise<number>;
      onScanProgress: (cb: (p: ScanProgress) => void) => () => void;
    };
  }
}

// ---------------------------------------------------------------------------
// Etat local
// ---------------------------------------------------------------------------

let allInvoices: (Invoice & { id: number })[] = [];
let tenantId = 79;

let sortKey = 'openedit_id';
let sortAsc = true;

// Doit etre identique a YEAR_SWITCH_THRESHOLD dans url-generator.ts
const YEAR_SWITCH_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Helpers formatage
// ---------------------------------------------------------------------------

function formatAmount(cents: number | undefined): string {
  if (cents === undefined || cents === null) return '-';
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) + ' EUR';
}

function truncate(s: string | undefined, len = 28): string {
  if (!s) return '-';
  return s.length > len ? s.slice(0, len) + '...' : s;
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
// Fuzzy search (Levenshtein <= 2)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function fuzzyMatch(query: string, text: string, maxDist = 2): boolean {
  if (!text) return false;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return true;
  if (q.length < 3) return false;
  for (let i = 0; i <= t.length - q.length; i++) {
    if (levenshtein(q, t.slice(i, i + q.length)) <= maxDist) return true;
  }
  return false;
}

function invoiceMatchesSearch(inv: Invoice, query: string): boolean {
  if (!query) return true;
  const textFields = [inv.client_name, inv.client_contact, inv.client_city];
  if (textFields.some(f => fuzzyMatch(query, f ?? ''))) return true;
  return String(inv.openedit_id).includes(query)
    || String(inv.year).includes(query);
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
  const query = ((document.getElementById('search-input') as HTMLInputElement)?.value ?? '').trim();

  const filteredInvoices = allInvoices.filter((inv) => {
    if (year && String(inv.year) !== year) return false;
    if (status && inv.status !== status) return false;
    if (paid === '1' && !inv.is_paid) return false;
    if (paid === '0' && inv.is_paid) return false;
    if (query && !invoiceMatchesSearch(inv, query)) return false;
    return true;
  });

  // Tri
  const sorted = [...filteredInvoices].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortKey];
    const bv = (b as unknown as Record<string, unknown>)[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const res = typeof av === 'number'
      ? (av as number) - (bv as number)
      : String(av).localeCompare(String(bv), 'fr');
    return sortAsc ? res : -res;
  });

  // Mettre a jour les indicateurs de tri sur les en-tetes
  document.querySelectorAll('#invoices-table thead th[data-sort]').forEach((th) => {
    const el = th as HTMLElement;
    el.classList.remove('sort-asc', 'sort-desc');
    if (el.dataset.sort === sortKey) {
      el.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
    }
  });

  tbody.innerHTML = '';
  empty.hidden = sorted.length > 0;

  for (const inv of sorted) {
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
      <td>${String(inv.openedit_id).padStart(4, '0')}</td>
      <td>${inv.year}</td>
      <td><span title="${inv.client_name ?? ''}">${truncate(inv.client_name)}</span></td>
      <td><span title="${inv.client_contact ?? ''}">${truncate(inv.client_contact)}</span></td>
      <td>${inv.client_city ?? '-'}</td>
      <td>${formatDate(inv.issue_date)}</td>
      <td>${formatAmount(inv.amount_cents)}</td>
      <td>${paidBadge}</td>
      <td>${statusBadge}</td>
      <td style="display:flex;gap:4px;flex-wrap:wrap">${pdfBtn}${sentBtn}</td>
    `;

    tbody.appendChild(tr);
  }

  footer.textContent = `${filteredInvoices.length} facture${filteredInvoices.length > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Scan manuel
// ---------------------------------------------------------------------------

/**
 * Parse "79-2026-1110" ou "2026-1110" ou juste un nombre.
 * Retourne { year, seq } ou null si invalide.
 */
function parseInvoiceRef(raw: string): { year: number; seq: number } | null {
  const parts = raw.trim().split('-').filter(Boolean);
  if (parts.length === 3) {
    const year = parseInt(parts[1], 10);
    const seq  = parseInt(parts[2], 10);
    if (!year || !seq) return null;
    return { year, seq };
  }
  if (parts.length === 2) {
    const year = parseInt(parts[0], 10);
    const seq  = parseInt(parts[1], 10);
    if (!year || !seq) return null;
    return { year, seq };
  }
  return null;
}

function computeCandidateYears(fromYear?: number): number[] {
  const years = new Set(allInvoices.map(inv => inv.year));
  const currentYear = new Date().getFullYear();
  years.add(currentYear);
  if (fromYear) years.add(fromYear);
  // N+1 seulement si on est dans les 90 jours avant le 1er janvier
  const jan1NextMs = new Date(currentYear + 1, 0, 1).getTime();
  if (Math.floor((jan1NextMs - Date.now()) / 86400000) <= 90) {
    years.add(currentYear + 1);
  }
  return [...years].sort((a, b) => a - b);
}

function getSegment(): UrlSegment | null {
  const from = parseInt((document.getElementById('seg-from') as HTMLInputElement).value, 10);
  const to   = parseInt((document.getElementById('seg-to') as HTMLInputElement).value, 10);
  if (!from || !to || from > to) return null;
  return { year: 0, from, to, candidateYears: computeCandidateYears() };
}

// ---------------------------------------------------------------------------
// Modal de confirmation du scan
// ---------------------------------------------------------------------------

function populateScanModal(plan: ScanPlanEntry[]): void {
  const info = document.getElementById('modal-plan-info')!;
  const body = document.getElementById('modal-plan-body')!;

  const scanCount = plan.filter(e => !e.probe).length;
  const probeCount = plan.filter(e => e.probe).length;
  info.textContent = probeCount > 0
    ? `${probeCount} sonde${probeCount > 1 ? 's' : ''} + ${scanCount} URL${scanCount > 1 ? 's' : ''} a tenter`
    : `${scanCount} URL${scanCount > 1 ? 's' : ''} a tenter`;

  const frag = document.createDocumentFragment();

  let inProbeBlock = false;
  for (const entry of plan) {
    if (entry.probe && !inProbeBlock) {
      inProbeBlock = true;
      const hdr = document.createElement('div');
      hdr.className = 'modal-probe-header';
      hdr.textContent = `--- sondage borne superieure (seq ${entry.seq}) ---`;
      frag.appendChild(hdr);
    }
    if (!entry.probe && inProbeBlock) {
      inProbeBlock = false;
    }

    if (!entry.probe && entry.yearSwitch) {
      const sep = document.createElement('div');
      sep.className = 'modal-year-switch';
      sep.textContent = `--- bascule vers ${entry.year} (si ${YEAR_SWITCH_THRESHOLD} misses consecutifs) ---`;
      frag.appendChild(sep);
    }

    const div = document.createElement('div');
    div.className = entry.probe ? 'modal-url-item modal-url-probe' : 'modal-url-item';
    div.title = entry.url;
    div.textContent = entry.url;
    frag.appendChild(div);
  }
  body.innerHTML = '';
  body.appendChild(frag);
}

function waitForModalConfirm(): Promise<boolean> {
  return new Promise(resolve => {
    const modal    = document.getElementById('scan-confirm-modal') as HTMLDialogElement;
    const btnOk    = document.getElementById('modal-btn-confirm') as HTMLButtonElement;
    const btnCancel = document.getElementById('modal-btn-cancel') as HTMLButtonElement;

    function cleanup() {
      modal.close();
      btnOk.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      modal.removeEventListener('cancel', onCancel);
    }
    function onConfirm() { cleanup(); resolve(true); }
    function onCancel()  { cleanup(); resolve(false); }

    btnOk.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    modal.addEventListener('cancel', onCancel); // touche Echap

    modal.showModal();
  });
}

async function startScan(): Promise<void> {
  const seg = getSegment();
  if (!seg) return;

  // Etape 1 : recuperer le plan et montrer le modal de confirmation
  const plan = await window.api.getScanPlan(tenantId, [seg]);
  populateScanModal(plan);
  const confirmed = await waitForModalConfirm();
  if (!confirmed) return;

  // Etape 2 : lancer le scan
  const btnScan = document.getElementById('btn-scan') as HTMLButtonElement;
  const progressSection = document.getElementById('scan-progress')!;
  const progressBar = document.getElementById('progress-bar')!;
  const progressText = document.getElementById('progress-text')!;
  const progressUrl = document.getElementById('progress-url')!;
  const resultSection = document.getElementById('scan-result')!;
  const resultText = document.getElementById('scan-result-text')!;

  const slowMode = (document.getElementById('slow-mode') as HTMLInputElement).checked;
  const delayOpts = slowMode ? { delayMs: 7000, delayMaxMs: 10000 } : undefined;

  btnScan.disabled = true;
  progressSection.hidden = false;
  resultSection.hidden = true;

  const total = seg.to - seg.from + 1;
  let done = 0;

  const unsubscribe = window.api.onScanProgress((p: ScanProgress) => {
    // 'checking' = scan normal (1 par seq) ; 'probing' = sondage borne sup (ne compte pas)
    if (p.status === 'checking') done++;
    const pct = Math.round((done / total) * 100);
    progressBar.style.width = `${pct}%`;
    progressText.textContent = p.status === 'probing'
      ? `sondage ${p.year}...`
      : `${done} / ${total} -- ${p.status}`;
    progressUrl.textContent = p.url;
  });

  try {
    const count = await window.api.startScan(tenantId, [seg], delayOpts);
    resultText.textContent = `${count} facture${count > 1 ? 's' : ''} telechargee${count > 1 ? 's' : ''}`;
    resultSection.hidden = false;
    await loadInvoices();
  } finally {
    unsubscribe();
    btnScan.disabled = false;
    progressBar.style.width = '100%';
  }
}

// ---------------------------------------------------------------------------
// Mode 1 : initial download
// ---------------------------------------------------------------------------

function openInitialModal(): void {
  const modal = document.getElementById('initial-modal') as HTMLDialogElement;
  modal.showModal();
}

async function handleInitialPreview(): Promise<void> {
  const lastInvRaw = (document.getElementById('initial-last-invoice') as HTMLInputElement).value;
  const countRaw   = (document.getElementById('initial-count') as HTMLInputElement).value;
  const errEl      = document.getElementById('initial-parse-error')!;
  errEl.style.display = 'none';

  const parsed = parseInvoiceRef(lastInvRaw);
  const count  = parseInt(countRaw, 10);

  if (!parsed || !count || count < 1) {
    errEl.textContent = 'Format invalide. Exemple : 79-2026-1110';
    errEl.style.display = 'block';
    return;
  }

  const { year, seq } = parsed;
  // Candidats : uniquement annees <= year (on descend dans le passe)
  const candidateYears = computeCandidateYears(year).filter(y => y <= year);

  const plan = await window.api.getScanPlan(0, [{
    year: 0,
    from: Math.max(1, seq - count - 50),
    to: seq,
    candidateYears,
  }]);

  // Fermer le modal initial, ouvrir le modal de confirmation
  (document.getElementById('initial-modal') as HTMLDialogElement).close();

  populateScanModal(plan);
  const confirmed = await waitForModalConfirm();
  if (!confirmed) return;

  // Lancer le scan initial via IPC scan:initial
  const slowMode  = (document.getElementById('initial-slow-mode') as HTMLInputElement).checked;
  const delayOpts = slowMode ? { delayMs: 7000, delayMaxMs: 10000 } : undefined;

  const progressSection = document.getElementById('scan-progress')!;
  const progressBar     = document.getElementById('progress-bar')!;
  const progressText    = document.getElementById('progress-text')!;
  const progressUrl     = document.getElementById('progress-url')!;
  const resultSection   = document.getElementById('scan-result')!;
  const resultText      = document.getElementById('scan-result-text')!;

  progressSection.hidden = false;
  resultSection.hidden   = true;

  let downloaded = 0;
  const total = count;

  const unsubscribe = window.api.onScanProgress((p: ScanProgress) => {
    if (p.status === 'saved') downloaded++;
    if (p.status === 'checking') {
      progressBar.style.width = `${Math.round((downloaded / total) * 100)}%`;
      progressText.textContent = `${downloaded} / ${total} telechargees`;
    }
    progressUrl.textContent = p.url;
  });

  try {
    const n = await window.api.scanInitial(seq, year, count, delayOpts);
    resultText.textContent = `${n} facture${n > 1 ? 's' : ''} telechargee${n > 1 ? 's' : ''}`;
    resultSection.hidden = false;
    await loadInvoices();
  } finally {
    unsubscribe();
    progressBar.style.width = '100%';
  }
}

// ---------------------------------------------------------------------------
// Daily check automatique (mode 2)
// ---------------------------------------------------------------------------

async function performDailyCheck(): Promise<void> {
  if (allInvoices.length === 0) return;

  const maxInvoice = allInvoices.reduce((a, b) =>
    a.openedit_id > b.openedit_id ? a : b
  );

  const progressSection = document.getElementById('auto-scan-progress')!;
  const progressText    = document.getElementById('auto-progress-text')!;
  const resultSection   = document.getElementById('auto-scan-result')!;
  const resultText      = document.getElementById('auto-result-text')!;

  progressSection.hidden = false;
  resultSection.hidden   = true;
  progressText.textContent = 'Verification nouvelles factures...';

  const unsubscribe = window.api.onScanProgress((p: ScanProgress) => {
    if (p.status === 'checking') {
      progressText.textContent = `daily check : ${p.seq}/${p.year}`;
    }
  });

  try {
    const count = await window.api.scanDaily(maxInvoice.openedit_id, maxInvoice.year);
    if (count > 0) {
      resultText.textContent = `${count} nouvelle${count > 1 ? 's' : ''} facture${count > 1 ? 's' : ''}`;
      resultSection.hidden = false;
      await loadInvoices();
    } else {
      progressText.textContent = 'Aucune nouvelle facture.';
    }
  } finally {
    unsubscribe();
    progressSection.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {

  // Header
  document.getElementById('btn-login')!.addEventListener('click', async () => {
    await window.api.login();
    await refreshSession();
  });

  // Filtres
  document.getElementById('filter-year')!.addEventListener('change', renderInvoices);
  document.getElementById('filter-status')!.addEventListener('change', renderInvoices);
  document.getElementById('filter-paid')!.addEventListener('change', renderInvoices);
  document.getElementById('search-input')!.addEventListener('input', renderInvoices);
  document.getElementById('btn-refresh')!.addEventListener('click', loadInvoices);

  // Tri des colonnes (delegation sur thead)
  document.querySelector('#invoices-table thead')!.addEventListener('click', (e) => {
    const th = (e.target as HTMLElement).closest('th[data-sort]') as HTMLElement | null;
    if (!th) return;
    const key = th.dataset.sort!;
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = true; }
    renderInvoices();
  });

  // Scan manuel (mode 3)
  document.getElementById('btn-scan')!.addEventListener('click', startScan);

  // Mode 1 : initial download
  document.getElementById('btn-open-initial')!.addEventListener('click', openInitialModal);
  document.getElementById('initial-btn-cancel')!.addEventListener('click', () => {
    (document.getElementById('initial-modal') as HTMLDialogElement).close();
  });
  document.getElementById('initial-btn-preview')!.addEventListener('click', handleInitialPreview);

  // Delegation : boutons dans le tableau
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

  // Init async
  refreshSession().catch(console.error);
  loadInvoices().then(() => performDailyCheck()).catch(console.error);
});
