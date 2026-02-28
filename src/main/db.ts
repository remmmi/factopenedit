// Module SQLite - schema et requetes
import Database from 'better-sqlite3';
import type { Invoice, InvoiceStatus, ScanRange, ScanRangeStatus } from '../shared/types';

// better-sqlite3 stocke les booleens en 0/1 -- on convertit en lecture
interface InvoiceRow extends Omit<Invoice, 'is_paid'> {
  id: number;
  is_paid: number;
}

interface ScanRangeRow extends ScanRange {
  id: number;
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

    CREATE TABLE IF NOT EXISTS scan_ranges (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      year        INTEGER NOT NULL,
      range_start INTEGER NOT NULL,
      range_end   INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration pour DB existantes creees avant l'ajout de ces colonnes
  for (const col of ['client_name', 'client_contact', 'client_city']) {
    try {
      db.exec(`ALTER TABLE invoices ADD COLUMN ${col} TEXT`);
    } catch {
      // Colonne deja presente -- on ignore
    }
  }

  return db;
}

// -- invoices --

function rowToInvoice(row: InvoiceRow): Invoice & { id: number } {
  return { ...row, is_paid: row.is_paid === 1 };
}

export function insertInvoice(db: Database.Database, invoice: Invoice): void {
  db.prepare(`
    INSERT INTO invoices
      (openedit_id, year, file_path, issue_date, amount_cents, is_paid,
       status, downloaded_at, sent_at, raw_text, client_name, client_contact, client_city)
    VALUES
      (@openedit_id, @year, @file_path, @issue_date, @amount_cents, @is_paid,
       @status, @downloaded_at, @sent_at, @raw_text, @client_name, @client_contact, @client_city)
  `).run({
    ...invoice,
    is_paid: invoice.is_paid ? 1 : 0,
    // better-sqlite3 rejette undefined -- convertir les optionnels en null
    file_path: invoice.file_path ?? null,
    issue_date: invoice.issue_date ?? null,
    amount_cents: invoice.amount_cents ?? null,
    sent_at: invoice.sent_at ?? null,
    raw_text: invoice.raw_text ?? null,
    client_name: invoice.client_name ?? null,
    client_contact: invoice.client_contact ?? null,
    client_city: invoice.client_city ?? null,
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

// -- scan_ranges --

export function insertScanRange(db: Database.Database, range: ScanRange): void {
  db.prepare(`
    INSERT INTO scan_ranges (year, range_start, range_end, status)
    VALUES (@year, @range_start, @range_end, @status)
  `).run(range);
}

export function getScanRanges(db: Database.Database): (ScanRange & { id: number })[] {
  return db.prepare('SELECT * FROM scan_ranges ORDER BY id').all() as ScanRangeRow[];
}

export function updateScanRangeStatus(
  db: Database.Database,
  id: number,
  status: ScanRangeStatus
): void {
  db.prepare('UPDATE scan_ranges SET status = ? WHERE id = ?').run(status, id);
}
