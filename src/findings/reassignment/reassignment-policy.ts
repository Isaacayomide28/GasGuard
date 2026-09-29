/**
 * Reassignment Policy Enforcer (#1035).
 *
 * Implements validation rules and secure defaults for finding reassignments.
 */

import { Severity } from '../../../libs/engine/core';
import { ReassignmentPolicyOptions, ReassignmentRequest } from './types';

export class ReassignmentPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = 'ReassignmentPolicyError';
  }
}

export class ReassignmentPolicy {
  private readonly requireReason: boolean;
  private readonly minReasonLength: number;
  private readonly allowReassignmentToCurrent: boolean;
  private readonly maxBatchSize: number;
  private readonly allowedAssignees?: Set<string>;
  private readonly disallowedAssignees?: Set<string>;
  private readonly restrictedSeverities?: Set<Severity>;

  constructor(options: ReassignmentPolicyOptions = {}) {
    this.requireReason = options.requireReason ?? true;
    this.minReasonLength = options.minReasonLength ?? 5;
    this.allowReassignmentToCurrent = options.allowReassignmentToCurrent ?? false;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.allowedAssignees = options.allowedAssignees ? new Set(options.allowedAssignees) : undefined;
    this.disallowedAssignees = options.disallowedAssignees ? new Set(options.disallowedAssignees) : undefined;
    this.restrictedSeverities = options.restrictedSeverities ? new Set(options.restrictedSeverities) : undefined;
  }

  /**
   * Validate a single reassignment request against policy rules.
   */
  validateRequest(
    request: ReassignmentRequest,
    currentAssignee?: string,
    findingSeverity?: Severity,
  ): void {
    if (!request.organizationId || !request.organizationId.trim()) {
      throw new ReassignmentPolicyError(
        'VALIDATION_ERROR',
        'organizationId is required and cannot be blank',
        400,
      );
    }

    if (!request.findingId || !request.findingId.trim()) {
      throw new ReassignmentPolicyError(
        'VALIDATION_ERROR',
        'findingId is required and cannot be blank',
        400,
      );
    }

    if (!request.newAssignee || !request.newAssignee.trim()) {
      throw new ReassignmentPolicyError(
        'VALIDATION_ERROR',
        'newAssignee is required and cannot be blank',
        400,
      );
    }

    if (!request.reassignedBy || !request.reassignedBy.trim()) {
      throw new ReassignmentPolicyError(
        'VALIDATION_ERROR',
        'reassignedBy is required and cannot be blank',
        400,
      );
    }

    // Reason validation
    if (this.requireReason) {
      if (!request.reason || typeof request.reason !== 'string') {
        throw new ReassignmentPolicyError(
          'REASON_REQUIRED',
          'A non-empty justification reason is required for reassignment',
          400,
        );
      }
      const trimmedReason = request.reason.trim();
      if (trimmedReason.length < this.minReasonLength) {
        throw new ReassignmentPolicyError(
          'REASON_TOO_SHORT',
          `Reassignment reason must be at least ${this.minReasonLength} characters (received: ${trimmedReason.length})`,
          400,
        );
      }
    }

    // Current assignee check
    const normalizedNew = request.newAssignee.trim();
    if (!this.allowReassignmentToCurrent && currentAssignee) {
      if (currentAssignee.trim() === normalizedNew) {
        throw new ReassignmentPolicyError(
          'ALREADY_ASSIGNED',
          `Finding is already assigned to '${normalizedNew}'`,
          409,
        );
      }
    }

    // Optimistic concurrency check
    if (
      request.expectedPreviousAssignee !== undefined &&
      currentAssignee !== undefined &&
      request.expectedPreviousAssignee.trim() !== currentAssignee.trim()
    ) {
      throw new ReassignmentPolicyError(
        'CONCURRENCY_CONFLICT',
        `Reassignment failed: expected previous assignee '${request.expectedPreviousAssignee}', but finding is currently assigned to '${currentAssignee}'`,
        409,
      );
    }

    // Allowed / disallowed assignees
    if (this.allowedAssignees && !this.allowedAssignees.has(normalizedNew)) {
      throw new ReassignmentPolicyError(
        'ASSIGNEE_NOT_PERMITTED',
        `Assignee '${normalizedNew}' is not in the allowed assignees list`,
        403,
      );
    }
    if (this.disallowedAssignees && this.disallowedAssignees.has(normalizedNew)) {
      throw new ReassignmentPolicyError(
        'ASSIGNEE_RESTRICTED',
        `Assignee '${normalizedNew}' is in the restricted assignees list`,
        403,
      );
    }

    // Severity restriction
    if (findingSeverity && this.restrictedSeverities && this.restrictedSeverities.has(findingSeverity)) {
      throw new ReassignmentPolicyError(
        'SEVERITY_RESTRICTED',
        `Reassignment is restricted for findings of severity '${findingSeverity}' without elevated privileges`,
        403,
      );
    }
  }

  /**
   * Validate batch reassignment parameters.
   */
  validateBatchSize(count: number): void {
    if (count <= 0) {
      throw new ReassignmentPolicyError(
        'BATCH_EMPTY',
        'Batch reassignment requires at least one findingId',
        400,
      );
    }
    if (count > this.maxBatchSize) {
      throw new ReassignmentPolicyError(
        'BATCH_SIZE_EXCEEDED',
        `Batch size ${count} exceeds maximum allowed limit of ${this.maxBatchSize}`,
        400,
      );
    }
  }
}
