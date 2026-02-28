// Types partages entre main et renderer process

export interface UrlSegment {
  year: number;
  from: number; // numero de sequence debut (inclus)
  to: number;   // numero de sequence fin (inclus)
}
