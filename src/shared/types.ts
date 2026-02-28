// Types partages entre main et renderer process

export interface UrlSegment {
  year: number;
  from: number; // numero de sequence debut (inclus)
  to: number;   // numero de sequence fin (inclus)
}

export type InvoiceStatus = 'downloaded' | 'sent_to_accountant';

export interface Invoice {
  openedit_id: number;
  year: number;
  file_path?: string;
  issue_date?: string;
  amount_cents?: number;
  is_paid: boolean;
  status: InvoiceStatus;
  downloaded_at: string;
  sent_at?: string;
  raw_text?: string;
}

export type ScanRangeStatus = 'pending' | 'scanning' | 'completed';

export interface ScanRange {
  year: number;
  range_start: number;
  range_end: number;
  status: ScanRangeStatus;
}
