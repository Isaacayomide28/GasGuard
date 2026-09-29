/**
 * Finding Reassignment Workflow Engine (#1035).
 *
 * Coordinates finding reassignment across modules, teams, and tenants.
 * Ensures strict tenant isolation, immutable audit trails, and concurrency safety.
 */

import { Finding, Severity } from '../../../libs/engine/core';
import { ReassignmentPolicy, ReassignmentPolicyError } from './reassignment-policy';
import { ReassignmentMetrics, reassignmentMetrics } from './reassignment-metrics';
import {
  BatchReassignmentRequest,
  BatchReassignmentResult,
  ReassignmentAuditFilter,
  ReassignmentPolicyOptions,
  ReassignmentRecord,
  ReassignmentRequest,
  ReassignedFindingState,
} from './types';

function generateRecordId(): string {
  return `reas_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export class FindingReassignmentWorkflow {
  private readonly policy: ReassignmentPolicy;
  private readonly metrics: ReassignmentMetrics;
  // findingId -> ReassignedFindingState
  private readonly findingStates = new Map<string, ReassignedFindingState>();
  // organizationId -> ReassignmentRecord[]
  private readonly auditRecordsByOrg = new Map<string, ReassignmentRecord[]>();

  constructor(
    policyOptions: ReassignmentPolicyOptions = {},
    metrics: ReassignmentMetrics = reassignmentMetrics,
  ) {
    this.policy = new ReassignmentPolicy(policyOptions);
    this.metrics = metrics;
  }

  /**
   * Reassign a single finding to a new owner.
   */
  reassign(
    request: ReassignmentRequest,
    findingDetails?: {
      severity?: Severity;
      currentAssignee?: string;
    },
  ): { state: ReassignedFindingState; record: ReassignmentRecord } {
    this.metrics.recordAttempt();

    const existingState = this.findingStates.get(request.findingId);

    // If finding already tracked in workflow, verify organization boundary
    if (existingState && existingState.organizationId !== request.organizationId) {
      this.metrics.recordFailure(
        request.findingId,
        request.organizationId,
        'TENANT_MISMATCH',
        'Finding does not belong to the requested organization',
      );
      throw new ReassignmentPolicyError(
        'TENANT_MISMATCH',
        'Finding does not belong to the requested organization',
        404,
      );
    }

    const currentAssignee =
      existingState?.currentAssignee ?? findingDetails?.currentAssignee;

    try {
      this.policy.validateRequest(
        request,
        currentAssignee,
        findingDetails?.severity,
      );
    } catch (err) {
      if (err instanceof ReassignmentPolicyError) {
        this.metrics.recordFailure(
          request.findingId,
          request.organizationId,
          err.code,
          err.message,
        );
      }
      throw err;
    }

    const now = Date.now();
    const record: ReassignmentRecord = {
      id: generateRecordId(),
      findingId: request.findingId,
      organizationId: request.organizationId,
      previousAssignee: currentAssignee,
      newAssignee: request.newAssignee.trim(),
      reassignedBy: request.reassignedBy.trim(),
      reason: request.reason.trim(),
      timestamp: now,
      metadata: request.metadata,
    };

    const nextCount = (existingState?.reassignmentCount ?? 0) + 1;
    const history = existingState ? [...existingState.history, record] : [record];

    const updatedState: ReassignedFindingState = {
      findingId: request.findingId,
      organizationId: request.organizationId,
      currentAssignee: request.newAssignee.trim(),
      lastReassignedBy: request.reassignedBy.trim(),
      lastReassignedAt: now,
      reassignmentCount: nextCount,
      history,
    };

    this.findingStates.set(request.findingId, updatedState);

    // Append to tenant audit index
    const orgRecords = this.auditRecordsByOrg.get(request.organizationId) ?? [];
    orgRecords.push(record);
    this.auditRecordsByOrg.set(request.organizationId, orgRecords);

    this.metrics.recordSuccess(record);

    return { state: updatedState, record };
  }

  /**
   * Bulk reassign a list of findings to a new owner.
   */
  batchReassign(
    request: BatchReassignmentRequest,
    getFindingDetails?: (findingId: string) => { severity?: Severity; currentAssignee?: string } | undefined,
  ): BatchReassignmentResult {
    this.policy.validateBatchSize(request.findingIds.length);

    const successfulRecords: ReassignmentRecord[] = [];
    const errors: Array<{ findingId: string; error: string; code: string }> = [];

    for (const findingId of request.findingIds) {
      try {
        const details = getFindingDetails?.(findingId);
        const { record } = this.reassign(
          {
            findingId,
            organizationId: request.organizationId,
            newAssignee: request.newAssignee,
            reassignedBy: request.reassignedBy,
            reason: request.reason,
            metadata: request.metadata,
          },
          details,
        );
        successfulRecords.push(record);
      } catch (err) {
        const error = err as ReassignmentPolicyError | Error;
        const code = error instanceof ReassignmentPolicyError ? error.code : 'INTERNAL_ERROR';
        errors.push({
          findingId,
          error: error.message,
          code,
        });
      }
    }

    return {
      total: request.findingIds.length,
      successful: successfulRecords.length,
      failed: errors.length,
      records: successfulRecords,
      errors,
    };
  }

  /**
   * Get current assignment state for a finding.
   */
  getState(findingId: string, organizationId: string): ReassignedFindingState | undefined {
    const state = this.findingStates.get(findingId);
    if (!state || state.organizationId !== organizationId) {
      return undefined;
    }
    return state;
  }

  /**
   * Get chronological reassignment audit history for a finding.
   */
  getHistory(findingId: string, organizationId: string): ReassignmentRecord[] {
    const state = this.getState(findingId, organizationId);
    return state ? [...state.history] : [];
  }

  /**
   * Filter and query organizational audit records.
   */
  queryAuditLogs(filter: ReassignmentAuditFilter): ReassignmentRecord[] {
    let records = this.auditRecordsByOrg.get(filter.organizationId) ?? [];

    if (filter.findingId) {
      records = records.filter((r) => r.findingId === filter.findingId);
    }
    if (filter.assignee) {
      records = records.filter((r) => r.newAssignee === filter.assignee);
    }
    if (filter.reassignedBy) {
      records = records.filter((r) => r.reassignedBy === filter.reassignedBy);
    }
    if (filter.since !== undefined) {
      records = records.filter((r) => r.timestamp >= filter.since!);
    }
    if (filter.until !== undefined) {
      records = records.filter((r) => r.timestamp <= filter.until!);
    }

    // Default newest first
    records.sort((a, b) => b.timestamp - a.timestamp);

    if (filter.limit && filter.limit > 0) {
      records = records.slice(0, filter.limit);
    }

    return records;
  }

  /** Reset internal state (for testing). */
  clear(): void {
    this.findingStates.clear();
    this.auditRecordsByOrg.clear();
  }
}
