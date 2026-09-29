import { FindingReassignmentWorkflow } from './reassignment-workflow';
import { ReassignmentMetrics } from './reassignment-metrics';
import { ReassignmentPolicyError } from './reassignment-policy';
import { Severity } from '../../../libs/engine/core';

describe('FindingReassignmentWorkflow (#1035)', () => {
  let workflow: FindingReassignmentWorkflow;
  let metrics: ReassignmentMetrics;

  const ORG_A = 'org_finance_01';
  const ORG_B = 'org_security_02';

  beforeEach(() => {
    metrics = new ReassignmentMetrics();
    workflow = new FindingReassignmentWorkflow({ minReasonLength: 5 }, metrics);
  });

  describe('Single Finding Reassignment', () => {
    it('successfully reassigns finding with valid details and records audit trail', () => {
      const { state, record } = workflow.reassign(
        {
          findingId: 'fnd_001',
          organizationId: ORG_A,
          newAssignee: 'team-token-core',
          reassignedBy: 'auditor-alice',
          reason: 'Transferred to token core maintainers for gas optimization review',
        },
        { currentAssignee: 'team-triage', severity: Severity.HIGH },
      );

      expect(record.id).toMatch(/^reas_/);
      expect(record.findingId).toBe('fnd_001');
      expect(record.previousAssignee).toBe('team-triage');
      expect(record.newAssignee).toBe('team-token-core');
      expect(record.reassignedBy).toBe('auditor-alice');
      expect(record.reason).toBe(
        'Transferred to token core maintainers for gas optimization review',
      );
      expect(record.timestamp).toBeGreaterThan(0);

      expect(state.currentAssignee).toBe('team-token-core');
      expect(state.reassignmentCount).toBe(1);
      expect(state.history).toHaveLength(1);

      // Verify metrics
      const snapshot = metrics.getSnapshot();
      expect(snapshot.totalRequests).toBe(1);
      expect(snapshot.successfulReassignments).toBe(1);
      expect(snapshot.reassignmentsByAssignee['team-token-core']).toBe(1);
      expect(snapshot.reassignmentsByActor['auditor-alice']).toBe(1);
    });

    it('accumulates history across consecutive reassignments', () => {
      workflow.reassign({
        findingId: 'fnd_seq_1',
        organizationId: ORG_A,
        newAssignee: 'developer-bob',
        reassignedBy: 'triage-lead',
        reason: 'Initial assignment to developer',
      });

      const { state, record } = workflow.reassign({
        findingId: 'fnd_seq_1',
        organizationId: ORG_A,
        newAssignee: 'developer-carol',
        reassignedBy: 'developer-bob',
        reason: 'Reassigning due to vacation schedule',
      });

      expect(record.previousAssignee).toBe('developer-bob');
      expect(record.newAssignee).toBe('developer-carol');
      expect(state.reassignmentCount).toBe(2);
      expect(state.history).toHaveLength(2);
      expect(state.history[0]?.newAssignee).toBe('developer-bob');
      expect(state.history[1]?.newAssignee).toBe('developer-carol');
    });

    it('preserves custom metadata attached to reassignment request', () => {
      const { record } = workflow.reassign({
        findingId: 'fnd_meta',
        organizationId: ORG_A,
        newAssignee: 'security-specialist',
        reassignedBy: 'system-agent',
        reason: 'Automated escalation based on high risk score',
        metadata: { escalationLevel: 2, ticketRef: 'SEC-1049' },
      });

      expect(record.metadata).toEqual({ escalationLevel: 2, ticketRef: 'SEC-1049' });
    });
  });

  describe('Policy Validation & Error Handling', () => {
    it('rejects when findingId is missing or empty', () => {
      expect(() =>
        workflow.reassign({
          findingId: '',
          organizationId: ORG_A,
          newAssignee: 'dev-1',
          reassignedBy: 'user-1',
          reason: 'Valid justification reason',
        }),
      ).toThrow(ReassignmentPolicyError);
    });

    it('rejects when organizationId is missing or empty', () => {
      expect(() =>
        workflow.reassign({
          findingId: 'fnd_001',
          organizationId: '  ',
          newAssignee: 'dev-1',
          reassignedBy: 'user-1',
          reason: 'Valid justification reason',
        }),
      ).toThrow(ReassignmentPolicyError);
    });

    it('rejects when reason is too short under minReasonLength policy', () => {
      expect(() =>
        workflow.reassign({
          findingId: 'fnd_001',
          organizationId: ORG_A,
          newAssignee: 'dev-1',
          reassignedBy: 'user-1',
          reason: 'No',
        }),
      ).toThrow(/at least 5 characters/);

      expect(metrics.getSnapshot().failedReassignments).toBe(1);
    });

    it('rejects reassignment to the exact same current assignee by default', () => {
      workflow.reassign({
        findingId: 'fnd_same',
        organizationId: ORG_A,
        newAssignee: 'team-backend',
        reassignedBy: 'lead-1',
        reason: 'Initial assignment',
      });

      expect(() =>
        workflow.reassign({
          findingId: 'fnd_same',
          organizationId: ORG_A,
          newAssignee: 'team-backend',
          reassignedBy: 'lead-2',
          reason: 'Attempting redundant reassignment',
        }),
      ).toThrow(/already assigned to 'team-backend'/);
    });

    it('enforces optimistic concurrency control when expectedPreviousAssignee mismatches', () => {
      workflow.reassign({
        findingId: 'fnd_race',
        organizationId: ORG_A,
        newAssignee: 'team-a',
        reassignedBy: 'user-1',
        reason: 'Assigned to team A',
      });

      expect(() =>
        workflow.reassign({
          findingId: 'fnd_race',
          organizationId: ORG_A,
          newAssignee: 'team-c',
          reassignedBy: 'user-2',
          expectedPreviousAssignee: 'team-b', // Mismatches current 'team-a'
          reason: 'Reassigning assuming team-b had it',
        }),
      ).toThrow(ReassignmentPolicyError);
    });

    it('enforces tenant isolation and prevents cross-tenant reassignment', () => {
      workflow.reassign({
        findingId: 'fnd_iso',
        organizationId: ORG_A,
        newAssignee: 'team-org-a',
        reassignedBy: 'user-a',
        reason: 'Organization A assigned finding',
      });

      expect(() =>
        workflow.reassign({
          findingId: 'fnd_iso',
          organizationId: ORG_B, // Cross-tenant attempt
          newAssignee: 'team-org-b',
          reassignedBy: 'user-b',
          reason: 'Unauthorized cross-tenant assignment',
        }),
      ).toThrow(/does not belong to the requested organization/);
    });

    it('respects allowedAssignees whitelist when configured', () => {
      const restrictedWorkflow = new FindingReassignmentWorkflow({
        allowedAssignees: ['sec-team', 'core-team'],
      });

      expect(() =>
        restrictedWorkflow.reassign({
          findingId: 'fnd_perm',
          organizationId: ORG_A,
          newAssignee: 'external-contractor',
          reassignedBy: 'admin',
          reason: 'Reassigning outside whitelist',
        }),
      ).toThrow(/not in the allowed assignees list/);
    });

    it('respects restrictedSeverities when configured', () => {
      const strictWorkflow = new FindingReassignmentWorkflow({
        restrictedSeverities: [Severity.CRITICAL],
      });

      expect(() =>
        strictWorkflow.reassign(
          {
            findingId: 'fnd_crit',
            organizationId: ORG_A,
            newAssignee: 'junior-dev',
            reassignedBy: 'lead',
            reason: 'Passing critical finding',
          },
          { severity: Severity.CRITICAL },
        ),
      ).toThrow(/restricted for findings of severity 'critical'/);
    });
  });

  describe('Batch Reassignment Workflow', () => {
    it('processes batch reassignment and returns aggregated summary', () => {
      const result = workflow.batchReassign({
        organizationId: ORG_A,
        findingIds: ['fnd_b1', 'fnd_b2', 'fnd_b3'],
        newAssignee: 'infra-team',
        reassignedBy: 'manager-dan',
        reason: 'Batch transferring cloud/gas infrastructure findings',
      });

      expect(result.total).toBe(3);
      expect(result.successful).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.records).toHaveLength(3);
      expect(result.records.map((r) => r.findingId)).toEqual(['fnd_b1', 'fnd_b2', 'fnd_b3']);
    });

    it('handles partial batch failures gracefully and collects per-finding errors', () => {
      // Pre-assign fnd_fail_1 to 'infra-team'
      workflow.reassign({
        findingId: 'fnd_fail_1',
        organizationId: ORG_A,
        newAssignee: 'infra-team',
        reassignedBy: 'lead',
        reason: 'Pre-existing assignment',
      });

      const result = workflow.batchReassign({
        organizationId: ORG_A,
        findingIds: ['fnd_fail_1', 'fnd_fail_2'],
        newAssignee: 'infra-team',
        reassignedBy: 'lead',
        reason: 'Bulk reassignment including already assigned finding',
      });

      expect(result.total).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors[0]?.findingId).toBe('fnd_fail_1');
      expect(result.errors[0]?.code).toBe('ALREADY_ASSIGNED');
    });

    it('rejects empty batch', () => {
      expect(() =>
        workflow.batchReassign({
          organizationId: ORG_A,
          findingIds: [],
          newAssignee: 'team-x',
          reassignedBy: 'lead',
          reason: 'Empty batch test',
        }),
      ).toThrow(/requires at least one findingId/);
    });

    it('rejects batch exceeding maxBatchSize', () => {
      const smallBatchWorkflow = new FindingReassignmentWorkflow({ maxBatchSize: 2 });
      expect(() =>
        smallBatchWorkflow.batchReassign({
          organizationId: ORG_A,
          findingIds: ['1', '2', '3'],
          newAssignee: 'team-x',
          reassignedBy: 'lead',
          reason: 'Too large batch',
        }),
      ).toThrow(/exceeds maximum allowed limit/);
    });
  });

  describe('Audit Querying & Reporting', () => {
    it('queries organizational audit log filtered by assignee and actor', () => {
      workflow.reassign({
        findingId: 'fnd_audit_1',
        organizationId: ORG_A,
        newAssignee: 'audit-target-team',
        reassignedBy: 'actor-1',
        reason: 'First reassignment',
      });

      workflow.reassign({
        findingId: 'fnd_audit_2',
        organizationId: ORG_A,
        newAssignee: 'other-team',
        reassignedBy: 'actor-1',
        reason: 'Second reassignment',
      });

      const logsForAssignee = workflow.queryAuditLogs({
        organizationId: ORG_A,
        assignee: 'audit-target-team',
      });
      expect(logsForAssignee).toHaveLength(1);
      expect(logsForAssignee[0]?.findingId).toBe('fnd_audit_1');

      const logsForActor = workflow.queryAuditLogs({
        organizationId: ORG_A,
        reassignedBy: 'actor-1',
      });
      expect(logsForActor).toHaveLength(2);

      // Verify cross-tenant isolation in audit query
      const orgBLogs = workflow.queryAuditLogs({ organizationId: ORG_B });
      expect(orgBLogs).toHaveLength(0);
    });

    it('retrieves finding history in chronological order', () => {
      workflow.reassign({
        findingId: 'fnd_hist',
        organizationId: ORG_A,
        newAssignee: 'dev-1',
        reassignedBy: 'triage',
        reason: 'Reason 1',
      });
      workflow.reassign({
        findingId: 'fnd_hist',
        organizationId: ORG_A,
        newAssignee: 'dev-2',
        reassignedBy: 'dev-1',
        reason: 'Reason 2',
      });

      const history = workflow.getHistory('fnd_hist', ORG_A);
      expect(history).toHaveLength(2);
      expect(history[0]?.newAssignee).toBe('dev-1');
      expect(history[1]?.newAssignee).toBe('dev-2');
    });
  });
});
