/**
 * Finding domain types and list query contract (#992).
 */

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type FindingStatus = 'open' | 'suppressed' | 'resolved' | 'accepted';

export interface Finding {
  id: string;
  /** Tenant / organization scope — isolation boundary (#996). */
  organizationId: string;
  repositoryId: string;
  analysisJobId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status: FindingStatus;
  ruleId: string;
  filePath?: string;
  line?: number;
  createdAt: string; // ISO
  updatedAt: string;
}

export type FindingSortField = 'createdAt' | 'severity' | 'status' | 'title';
export type SortDirection = 'asc' | 'desc';

export interface FindingListQuery {
  organizationId: string;
  repositoryId?: string;
  analysisJobId?: string;
  severity?: FindingSeverity | FindingSeverity[];
  status?: FindingStatus | FindingStatus[];
  ruleId?: string;
  /** Free-text search over title/description/filePath */
  q?: string;
  sortBy?: FindingSortField;
  sortDir?: SortDirection;
  /** Max items per page (capped server-side). */
  limit?: number;
  /**
   * Opaque stable cursor from a previous response.
   * Encodes sort key + id so pages do not skip/duplicate under inserts.
   */
  cursor?: string;
}

export interface FindingListPage {
  items: Finding[];
  nextCursor: string | null;
  /** Present when inexpensive to compute; may be omitted for very large sets. */
  totalEstimate?: number;
  limit: number;
}

/** Severity rank for sorting (higher = more severe). */
export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const MAX_PAGE_LIMIT = 100;
export const DEFAULT_PAGE_LIMIT = 20;
