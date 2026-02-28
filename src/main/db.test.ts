import Database from 'better-sqlite3';
import {
  initDb,
  insertInvoice,
  getInvoice,
  getAllInvoices,
  updateInvoiceStatus,
  markSentToAccountant,
  getSetting,
  setSetting,
  insertScanRange,
  getScanRanges,
  updateScanRangeStatus,
} from './db';
import type { Invoice, ScanRange } from '../shared/types';

// Chaque test repart d'une DB vide en memoire -- rapide et isole
let db: Database.Database;
beforeEach(() => {
  db = initDb(':memory:');
});
afterEach(() => {
  db.close();
});

// --- initDb ---

describe('initDb', () => {
  it('cree les trois tables invoices, settings, scan_ranges', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('invoices');
    expect(names).toContain('settings');
    expect(names).toContain('scan_ranges');
  });
});

// --- invoices ---

const invoiceFixture: Invoice = {
  openedit_id: 1091,
  year: 2026,
  file_path: '/data/invoices/2026/79-2026-1091.pdf',
  issue_date: '2026-01-15',
  amount_cents: 4900,
  is_paid: true,
  status: 'downloaded',
  downloaded_at: '2026-02-28T10:00:00.000Z',
};

describe('insertInvoice + getInvoice', () => {
  it('retrouve une facture apres insertion', () => {
    insertInvoice(db, invoiceFixture);
    const result = getInvoice(db, 1091, 2026);
    expect(result).not.toBeNull();
    expect(result?.openedit_id).toBe(1091);
    expect(result?.year).toBe(2026);
    expect(result?.amount_cents).toBe(4900);
    expect(result?.is_paid).toBe(true);
  });

  it('retourne null pour une facture inexistante', () => {
    const result = getInvoice(db, 9999, 2026);
    expect(result).toBeNull();
  });

  it('rejette un doublon (meme openedit_id + year)', () => {
    insertInvoice(db, invoiceFixture);
    expect(() => insertInvoice(db, invoiceFixture)).toThrow();
  });
});

describe('getAllInvoices', () => {
  it('retourne toutes les factures inserees', () => {
    insertInvoice(db, invoiceFixture);
    insertInvoice(db, { ...invoiceFixture, openedit_id: 1092 });
    const all = getAllInvoices(db);
    expect(all).toHaveLength(2);
  });

  it('retourne un tableau vide si aucune facture', () => {
    expect(getAllInvoices(db)).toEqual([]);
  });
});

describe('updateInvoiceStatus', () => {
  it('met a jour le statut d\'une facture', () => {
    insertInvoice(db, invoiceFixture);
    updateInvoiceStatus(db, 1091, 2026, 'sent_to_accountant');
    const result = getInvoice(db, 1091, 2026);
    expect(result?.status).toBe('sent_to_accountant');
  });
});

describe('markSentToAccountant', () => {
  it('passe le statut a sent_to_accountant et renseigne sent_at', () => {
    insertInvoice(db, invoiceFixture);
    markSentToAccountant(db, 1091, 2026);
    const result = getInvoice(db, 1091, 2026);
    expect(result?.status).toBe('sent_to_accountant');
    expect(result?.sent_at).not.toBeNull();
  });
});

// --- settings ---

describe('getSetting + setSetting', () => {
  it('retrouve une valeur apres ecriture', () => {
    setSetting(db, 'tenant_id', '79');
    expect(getSetting(db, 'tenant_id')).toBe('79');
  });

  it('retourne undefined pour une cle inexistante', () => {
    expect(getSetting(db, 'cle_inconnue')).toBeUndefined();
  });

  it('ecrase la valeur existante (upsert)', () => {
    setSetting(db, 'tenant_id', '79');
    setSetting(db, 'tenant_id', '42');
    expect(getSetting(db, 'tenant_id')).toBe('42');
  });
});

// --- scan_ranges ---

const rangeFixture: ScanRange = {
  year: 2026,
  range_start: 1000,
  range_end: 1100,
  status: 'pending',
};

describe('insertScanRange + getScanRanges', () => {
  it('retrouve un range apres insertion', () => {
    insertScanRange(db, rangeFixture);
    const ranges = getScanRanges(db);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].range_start).toBe(1000);
    expect(ranges[0].range_end).toBe(1100);
    expect(ranges[0].status).toBe('pending');
  });
});

describe('updateScanRangeStatus', () => {
  it('met a jour le statut d\'un range', () => {
    insertScanRange(db, rangeFixture);
    const ranges = getScanRanges(db);
    const id = (ranges[0] as { id: number }).id;
    updateScanRangeStatus(db, id, 'completed');
    const updated = getScanRanges(db);
    expect(updated[0].status).toBe('completed');
  });
});
