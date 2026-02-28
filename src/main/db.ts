// Module SQLite - schema et requetes
import Database from 'better-sqlite3';
import type { Invoice, InvoiceStatus } from '../shared/types';

// better-sqlite3 stocke les booleens en 0/1 -- on convertit en lecture
interface InvoiceRow extends Omit<Invoice, 'is_paid' | 'is_avoir'> {
  id: number;
  is_paid: number;
  is_avoir: number;
}


export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      openedit_id     INTEGER NOT NULL,
      year            INTEGER NOT NULL,
      file_path       TEXT,
      issue_date      TEXT,
      amount_cents    INTEGER,
      is_paid         INTEGER NOT NULL DEFAULT 0,
      is_avoir        INTEGER NOT NULL DEFAULT 0,
      cancels_openedit_id INTEGER,
      cancels_year    INTEGER,
      status          TEXT NOT NULL DEFAULT 'downloaded',
      downloaded_at   TEXT NOT NULL,
      sent_at         TEXT,
      raw_text        TEXT,
      client_name     TEXT,
      client_contact  TEXT,
      client_city     TEXT,
      created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(openedit_id, year)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Migration : ajouter les colonnes client si absentes (DB existantes)
    -- SQLite ne supporte pas IF NOT EXISTS sur ALTER TABLE
    -- on tente et on ignore l'erreur si les colonnes existent deja

    DROP TABLE IF EXISTS scan_ranges;
  `);

  // Migration pour DB existantes creees avant l'ajout de ces colonnes
  const migrations: Array<[string, string]> = [
    ['client_name', 'TEXT'],
    ['client_contact', 'TEXT'],
    ['client_city', 'TEXT'],
    ['is_avoir', 'INTEGER NOT NULL DEFAULT 0'],
    ['cancels_openedit_id', 'INTEGER'],
    ['cancels_year', 'INTEGER'],
  ];
  for (const [col, type] of migrations) {
    try {
      db.exec(`ALTER TABLE invoices ADD COLUMN ${col} ${type}`);
    } catch {
      // Colonne deja presente -- on ignore
    }
  }

  return db;
}

// -- invoices --

function nullToUndef<T>(val: T | null): T | undefined {
  return val === null ? undefined : val;
}

function rowToInvoice(row: InvoiceRow): Invoice & { id: number } {
  return {
    ...row,
    is_paid: row.is_paid === 1,
    is_avoir: row.is_avoir === 1,
    // SQLite NULL -> undefined pour les champs optionnels de l'interface
    file_path: nullToUndef(row.file_path ?? null),
    issue_date: nullToUndef(row.issue_date ?? null),
    amount_cents: nullToUndef(row.amount_cents ?? null),
    sent_at: nullToUndef(row.sent_at ?? null),
    raw_text: nullToUndef(row.raw_text ?? null),
    client_name: nullToUndef(row.client_name ?? null),
    client_contact: nullToUndef(row.client_contact ?? null),
    client_city: nullToUndef(row.client_city ?? null),
    cancels_openedit_id: nullToUndef(row.cancels_openedit_id ?? null),
    cancels_year: nullToUndef(row.cancels_year ?? null),
  };
}

export function insertInvoice(db: Database.Database, invoice: Invoice): void {
  db.prepare(`
    INSERT INTO invoices
      (openedit_id, year, file_path, issue_date, amount_cents, is_paid,
       is_avoir, cancels_openedit_id, cancels_year,
       status, downloaded_at, sent_at, raw_text, client_name, client_contact, client_city)
    VALUES
      (@openedit_id, @year, @file_path, @issue_date, @amount_cents, @is_paid,
       @is_avoir, @cancels_openedit_id, @cancels_year,
       @status, @downloaded_at, @sent_at, @raw_text, @client_name, @client_contact, @client_city)
  `).run({
    ...invoice,
    is_paid: invoice.is_paid ? 1 : 0,
    is_avoir: invoice.is_avoir ? 1 : 0,
    // better-sqlite3 rejette undefined -- convertir les optionnels en null
    file_path: invoice.file_path ?? null,
    issue_date: invoice.issue_date ?? null,
    amount_cents: invoice.amount_cents ?? null,
    sent_at: invoice.sent_at ?? null,
    raw_text: invoice.raw_text ?? null,
    client_name: invoice.client_name ?? null,
    client_contact: invoice.client_contact ?? null,
    client_city: invoice.client_city ?? null,
    cancels_openedit_id: invoice.cancels_openedit_id ?? null,
    cancels_year: invoice.cancels_year ?? null,
  });
}

export function getInvoice(
  db: Database.Database,
  openeditId: number,
  year: number
): (Invoice & { id: number }) | null {
  const row = db.prepare(
    'SELECT * FROM invoices WHERE openedit_id = ? AND year = ?'
  ).get(openeditId, year) as InvoiceRow | undefined;
  return row ? rowToInvoice(row) : null;
}

export function getAllInvoices(db: Database.Database): (Invoice & { id: number })[] {
  const rows = db.prepare('SELECT * FROM invoices ORDER BY year, openedit_id').all() as InvoiceRow[];
  return rows.map(rowToInvoice);
}

export function updateClientFields(
  db: Database.Database,
  openeditId: number,
  year: number,
  clientName: string | null,
  clientContact: string | null,
  clientCity: string | null
): void {
  db.prepare(`
    UPDATE invoices
    SET client_name = ?, client_contact = ?, client_city = ?, updated_at = CURRENT_TIMESTAMP
    WHERE openedit_id = ? AND year = ?
  `).run(clientName, clientContact, clientCity, openeditId, year);
}

export function updateInvoiceStatus(
  db: Database.Database,
  openeditId: number,
  year: number,
  status: InvoiceStatus
): void {
  db.prepare(
    'UPDATE invoices SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE openedit_id = ? AND year = ?'
  ).run(status, openeditId, year);
}

export function markSentToAccountant(
  db: Database.Database,
  openeditId: number,
  year: number
): void {
  db.prepare(`
    UPDATE invoices
    SET status = 'sent_to_accountant', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE openedit_id = ? AND year = ?
  `).run(openeditId, year);
}

export function updateAvoirFields(
  db: Database.Database,
  openeditId: number,
  year: number,
  isAvoir: boolean,
  cancelsOpeneditId: number | null,
  cancelsYear: number | null
): void {
  db.prepare(`
    UPDATE invoices
    SET is_avoir = ?, cancels_openedit_id = ?, cancels_year = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE openedit_id = ? AND year = ?
  `).run(
    isAvoir ? 1 : 0,
    cancelsOpeneditId,
    cancelsYear,
    openeditId,
    year
  );
}

export function updateRawText(
  db: Database.Database,
  openeditId: number,
  year: number,
  rawText: string
): void {
  db.prepare(
    'UPDATE invoices SET raw_text = ?, updated_at = CURRENT_TIMESTAMP WHERE openedit_id = ? AND year = ?'
  ).run(rawText, openeditId, year);
}

// -- settings --

export function getSetting(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

