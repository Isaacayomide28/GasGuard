/**
 * Types for Finding Reassignment Workflow (#1035).
 *
 * Defines contracts, audit event shapes, batch operations, and policy configurations
 * for reassigning gas analysis findings across engineering modules and teams.
 */

import { Finding, Severity } from '../../../libs/engine/core';

export type ReassignmentStatus = 'completed' | 'rejected' | 'failed';

/** Input payload for a single finding reassignment request. */
export interface ReassignmentRequest {
  findingId: string;
  organizationId: string;
  newAssignee: string;
  reassignedBy: string;
  reason: string;
  /** Optional optimistic concurrency guard: rejects if current assignee doesn't match. */
  expectedPreviousAssignee?: string;
  metadata?: Record<string, unknown>;
}

/** Immutable audit record generated upon every successful reassignment. */
export interface ReassignmentRecord {
  id: string;
  findingId: string;
  organizationId: string;
  previousAssignee?: string;
  newAssignee: string;
  reassignedBy: string;
  reason: string;
  timestamp: number; // epoch ms
  metadata?: Record<string, unknown>;
}

/** Input payload for bulk reassignment of multiple findings. */
export interface BatchReassignmentRequest {
  organizationId: string;
  findingIds: string[];
  newAssignee: string;
  reassignedBy: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

/** Result summary of a batch reassignment operation. */
export interface BatchReassignmentResult {
  total: number;
  successful: number;
  failed: number;
  records: ReassignmentRecord[];
  errors: Array<{ findingId: string; error: string; code: string }>;
}

/** Configuration policy governing finding reassignment constraints. */
export interface ReassignmentPolicyOptions {
  requireReason?: boolean;
  minReasonLength?: number;
  allowReassignmentToCurrent?: boolean;
  maxBatchSize?: number;
  allowedAssignees?: string[];
  disallowedAssignees?: string[];
  restrictedSeverities?: Severity[];
}

/** Filter criteria for querying historical reassignment audit logs. */
export interface ReassignmentAuditFilter {
  organizationId: string;
  findingId?: string;
  assignee?: string;
  reassignedBy?: string;
  since?: number;
  until?: number;
  limit?: number;
}

/** Reassigned finding state representation. */
export interface ReassignedFindingState {
  findingId: string;
  organizationId: string;
  currentAssignee: string;
  lastReassignedBy: string;
  lastReassignedAt: number;
  reassignmentCount: number;
  history: ReassignmentRecord[];
}
