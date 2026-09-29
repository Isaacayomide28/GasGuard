/**
 * Reassignment Operational Metrics & Structured Logging (#1035).
 *
 * Tracks metrics and emits audit-compliant logs without leaking sensitive data or secrets.
 */

import { ReassignmentRecord } from './types';

export interface ReassignmentMetricsSnapshot {
  totalRequests: number;
  successfulReassignments: number;
  failedReassignments: number;
  reassignmentsByAssignee: Record<string, number>;
  reassignmentsByActor: Record<string, number>;
}

export class ReassignmentMetrics {
  private totalRequests = 0;
  private successfulReassignments = 0;
  private failedReassignments = 0;
  private readonly byAssignee: Record<string, number> = {};
  private readonly byActor: Record<string, number> = {};

  recordAttempt(): void {
    this.totalRequests++;
  }

  recordSuccess(record: ReassignmentRecord): void {
    this.successfulReassignments++;
    this.byAssignee[record.newAssignee] = (this.byAssignee[record.newAssignee] ?? 0) + 1;
    this.byActor[record.reassignedBy] = (this.byActor[record.reassignedBy] ?? 0) + 1;

    // Structured operational audit log
    this.logInfo('finding.reassigned', {
      reassignmentId: record.id,
      findingId: record.findingId,
      organizationId: record.organizationId,
      previousAssignee: record.previousAssignee ?? 'unassigned',
      newAssignee: record.newAssignee,
      reassignedBy: record.reassignedBy,
      timestamp: record.timestamp,
    });
  }

  recordFailure(findingId: string, organizationId: string, errorCode: string, reason: string): void {
    this.failedReassignments++;

    this.logWarn('finding.reassignment_failed', {
      findingId,
      organizationId,
      errorCode,
      errorReason: reason,
    });
  }

  getSnapshot(): ReassignmentMetricsSnapshot {
    return {
      totalRequests: this.totalRequests,
      successfulReassignments: this.successfulReassignments,
      failedReassignments: this.failedReassignments,
      reassignmentsByAssignee: { ...this.byAssignee },
      reassignmentsByActor: { ...this.byActor },
    };
  }

  reset(): void {
    this.totalRequests = 0;
    this.successfulReassignments = 0;
    this.failedReassignments = 0;
    for (const key of Object.keys(this.byAssignee)) delete this.byAssignee[key];
    for (const key of Object.keys(this.byActor)) delete this.byActor[key];
  }

  private logInfo(event: string, payload: Record<string, unknown>): void {
    const entry = JSON.stringify({
      level: 'info',
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    });
    // Standard operational stream
    if (process.env.NODE_ENV !== 'test') {
      console.info(entry);
    }
  }

  private logWarn(event: string, payload: Record<string, unknown>): void {
    const entry = JSON.stringify({
      level: 'warn',
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    });
    if (process.env.NODE_ENV !== 'test') {
      console.warn(entry);
    }
  }
}

export const reassignmentMetrics = new ReassignmentMetrics();
