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
  updateAvoirFields,
} from './db';
import type { Invoice } from '../shared/types';

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
  it('cree les tables invoices et settings', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('invoices');
    expect(names).toContain('settings');
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
  is_avoir: false,
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

describe('updateAvoirFields', () => {
  it('marque une facture comme avoir avec reference', () => {
    insertInvoice(db, {
      openedit_id: 908,
      year: 2026,
      is_paid: false,
      is_avoir: false,
      status: 'downloaded',
      downloaded_at: new Date().toISOString(),
    });
    updateAvoirFields(db, 908, 2026, true, 907, 2026);
    const inv = getInvoice(db, 908, 2026)!;
    expect(inv.is_avoir).toBe(true);
    expect(inv.cancels_openedit_id).toBe(907);
    expect(inv.cancels_year).toBe(2026);
  });

  it('peut remettre is_avoir a false', () => {
    insertInvoice(db, {
      openedit_id: 908,
      year: 2026,
      is_paid: false,
      is_avoir: true,
      cancels_openedit_id: 907,
      cancels_year: 2026,
      status: 'downloaded',
      downloaded_at: new Date().toISOString(),
    });
    updateAvoirFields(db, 908, 2026, false, null, null);
    const inv = getInvoice(db, 908, 2026)!;
    expect(inv.is_avoir).toBe(false);
    expect(inv.cancels_openedit_id).toBeUndefined();
    expect(inv.cancels_year).toBeUndefined();
  });
});
