/**
 * End-to-end finding reassignment workflow tests (#1035).
 */

import { findingsRepository } from '../findings.repository';
import { findingsService } from '../findings.service';
import { findingsController } from '../findings.controller';
import { Request, Response } from 'express';

const fn = typeof vi !== 'undefined' ? vi.fn : (typeof jest !== 'undefined' ? jest.fn : () => {});

function mockResponse(): {
  res: Response;
  status: any;
  json: any;
} {
  const json = fn();
  const status = fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

describe('findings reassignment e2e (#1035)', () => {
  const ORG_1 = 'org-acme-corp';
  const ORG_2 = 'org-other-corp';

  beforeEach(() => {
    findingsRepository.clear();
  });

  it('covers complete reassignment lifecycle: create → reassign → filter by assignee → history', () => {
    // 1. Create a finding
    const finding = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-soroban',
      analysisJobId: 'job-100',
      title: 'High gas consumption in transfer',
      description: 'Nested loops in entrypoint',
      severity: 'high',
      ruleId: 'gas-loop-transfer',
    });

    expect(finding.assignedTo).toBeUndefined();
    expect(finding.reassignmentCount).toBeUndefined();

    // 2. Reassign finding to 'team-token-core'
    const { finding: updated, record } = findingsService.reassign({
      organizationId: ORG_1,
      findingId: finding.id,
      newAssignee: 'team-token-core',
      reassignedBy: 'auditor-dan',
      reason: 'Assigned to token core maintainers for remediation',
    });

    expect(updated.assignedTo).toBe('team-token-core');
    expect(updated.assignedBy).toBe('auditor-dan');
    expect(updated.reassignmentCount).toBe(1);
    expect(record.newAssignee).toBe('team-token-core');
    expect(record.previousAssignee).toBeUndefined();

    // 3. Filter findings by assignedTo
    const listResult = findingsService.list({
      organizationId: ORG_1,
      assignedTo: 'team-token-core',
    });
    expect(listResult.items).toHaveLength(1);
    expect(listResult.items[0]?.id).toBe(finding.id);

    // Filter by another assignee returns empty
    const emptyResult = findingsService.list({
      organizationId: ORG_1,
      assignedTo: 'team-frontend',
    });
    expect(emptyResult.items).toHaveLength(0);

    // 4. Consecutive reassignment
    const { finding: updated2 } = findingsService.reassign({
      organizationId: ORG_1,
      findingId: finding.id,
      newAssignee: 'developer-eva',
      reassignedBy: 'team-token-core',
      reason: 'Lead assigned task to developer Eva',
      expectedPreviousAssignee: 'team-token-core',
    });

    expect(updated2.assignedTo).toBe('developer-eva');
    expect(updated2.reassignmentCount).toBe(2);

    // 5. Query reassignment audit history
    const history = findingsService.getReassignmentHistory(finding.id, ORG_1);
    expect(history).toHaveLength(2);
    expect(history[0]?.newAssignee).toBe('team-token-core');
    expect(history[1]?.previousAssignee).toBe('team-token-core');
    expect(history[1]?.newAssignee).toBe('developer-eva');
  });

  it('HTTP Controller: reassignOne, batchReassign, and getHistory endpoints', () => {
    const f1 = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 1',
      description: 'Desc 1',
      severity: 'medium',
      ruleId: 'r-1',
    });
    const f2 = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding 2',
      description: 'Desc 2',
      severity: 'low',
      ruleId: 'r-2',
    });

    // Test reassignOne HTTP handler
    const req1 = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: f1.id },
      body: {
        newAssignee: 'security-lead',
        reassignedBy: 'triage-bot',
        reason: 'Automated high priority route',
      },
    } as unknown as Request;
    const { res: res1, status: status1, json: json1 } = mockResponse();

    findingsController.reassignOne(req1, res1);
    expect(status1).toHaveBeenCalledWith(200);
    expect(json1).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finding: expect.objectContaining({ assignedTo: 'security-lead' }),
        }),
      }),
    );

    // Test reassignBatch HTTP handler
    const reqBatch = {
      headers: { 'x-organization-id': ORG_1 },
      body: {
        findingIds: [f1.id, f2.id],
        newAssignee: 'devops-team',
        reassignedBy: 'admin',
        reason: 'Migration to devops review',
      },
    } as unknown as Request;
    const { res: resBatch, status: statusBatch, json: jsonBatch } = mockResponse();

    findingsController.reassignBatch(reqBatch, resBatch);
    expect(statusBatch).toHaveBeenCalledWith(200);
    expect(jsonBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          total: 2,
          successful: 2,
          failed: 0,
        }),
      }),
    );

    // Test getHistory HTTP handler
    const reqHist = {
      headers: { 'x-organization-id': ORG_1 },
      params: { id: f1.id },
    } as unknown as Request;
    const { res: resHist, status: statusHist, json: jsonHist } = mockResponse();

    findingsController.getHistory(reqHist, resHist);
    expect(statusHist).toHaveBeenCalledWith(200);
    expect(jsonHist).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ newAssignee: 'security-lead' }),
          expect.objectContaining({ newAssignee: 'devops-team' }),
        ]),
      }),
    );
  });

  it('enforces tenant boundary isolation across organizations', () => {
    const f1 = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Org 1 finding',
      description: 'Desc',
      severity: 'high',
      ruleId: 'r-1',
    });

    // Tenant 2 tries to reassign Tenant 1's finding
    expect(() =>
      findingsService.reassign({
        organizationId: ORG_2,
        findingId: f1.id,
        newAssignee: 'attacker',
        reassignedBy: 'attacker',
        reason: 'Cross-tenant reassignment attempt',
      }),
    ).toThrow(/Finding not found/);

    // Tenant 2 tries to view Tenant 1's reassignment history
    const history = findingsService.getReassignmentHistory(f1.id, ORG_2);
    expect(history).toEqual([]);
  });

  it('rejects reassignment when optimistic concurrency check fails', () => {
    const f1 = findingsService.create({
      organizationId: ORG_1,
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Finding Concurrent',
      description: 'Desc',
      severity: 'medium',
      ruleId: 'r-1',
    });

    findingsService.reassign({
      organizationId: ORG_1,
      findingId: f1.id,
      newAssignee: 'dev-1',
      reassignedBy: 'lead',
      reason: 'First assignment',
    });

    expect(() =>
      findingsService.reassign({
        organizationId: ORG_1,
        findingId: f1.id,
        newAssignee: 'dev-3',
        reassignedBy: 'lead',
        expectedPreviousAssignee: 'dev-2', // Conflict: current is dev-1
        reason: 'Conflicting reassignment',
      }),
    ).toThrow(/expected previous assignee 'dev-2'/);
  });
});
