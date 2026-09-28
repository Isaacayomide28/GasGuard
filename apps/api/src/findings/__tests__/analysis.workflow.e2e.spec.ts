/**
 * End-to-end analysis workflow (#994):
 * submit → process (simulated) → persist findings → list/retrieve by job.
 */

import { findingsRepository } from '../findings.repository';
import { findingsService } from '../findings.service';
import { AnalysisResult, Issue } from '../../schemas/analysis.schema';

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

interface JobRecord {
  id: string;
  organizationId: string;
  repositoryId: string;
  status: JobStatus;
  result?: AnalysisResult;
}

/** Minimal in-process stand-in for queue + worker. */
class AnalysisWorkflowHarness {
  private jobs = new Map<string, JobRecord>();

  submit(input: {
    organizationId: string;
    repositoryId: string;
    issues: Issue[];
  }): { jobId: string; status: JobStatus } {
    const id = `job_${Math.random().toString(36).slice(2, 10)}`;
    this.jobs.set(id, {
      id,
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      status: 'queued',
    });
    // Simulate async worker
    this.process(id, input.issues);
    return { jobId: id, status: 'queued' };
  }

  private process(jobId: string, issues: Issue[]): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'processing';

    findingsService.persistAnalysisFindings(
      job.organizationId,
      job.repositoryId,
      jobId,
      issues.map((i) => ({
        title: i.title,
        description: i.description,
        severity: i.severity,
        ruleId: i.rule,
        filePath: undefined,
        line: i.location?.line,
      })),
    );

    const completedAt = new Date().toISOString();
    job.status = 'completed';
    job.result = {
      jobId,
      status: 'completed',
      completedAt,
      duration: 12,
      summary: {
        totalFiles: 1,
        totalIssues: issues.length,
        issuesBySeverity: {},
        issuesByType: {},
      },
      files: [],
      metadata: {} as AnalysisResult['metadata'],
    };
  }

  getStatus(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId)?.status;
  }

  getResult(jobId: string): AnalysisResult | undefined {
    return this.jobs.get(jobId)?.result;
  }
}

describe('analysis workflow e2e (#994)', () => {
  beforeEach(() => {
    findingsRepository.clear();
  });

  it('covers submit → process → persist → list by analysisJobId', () => {
    const harness = new AnalysisWorkflowHarness();
    const issues: Issue[] = [
      {
        id: 'i1',
        type: 'gas-optimization',
        severity: 'high',
        title: 'Unbounded loop',
        description: 'Loop may consume excessive gas',
        location: { line: 42 },
        rule: 'gas-unbounded-loop',
        impact: 'high',
      },
      {
        id: 'i2',
        type: 'security',
        severity: 'critical',
        title: 'Missing auth',
        description: 'Entrypoint lacks require_auth',
        location: { line: 10 },
        rule: 'sec-auth',
        impact: 'critical',
      },
    ];

    const { jobId } = harness.submit({
      organizationId: 'org-e2e',
      repositoryId: 'repo-e2e',
      issues,
    });

    expect(harness.getStatus(jobId)).toBe('completed');
    const result = harness.getResult(jobId);
    expect(result?.status).toBe('completed');
    expect(result?.summary.totalIssues).toBe(2);

    const page = findingsService.list({
      organizationId: 'org-e2e',
      analysisJobId: jobId,
      limit: 50,
    });
    expect(page.items).toHaveLength(2);
    expect(page.items.every((f) => f.analysisJobId === jobId)).toBe(true);
    expect(page.items.map((f) => f.ruleId).sort()).toEqual(
      ['gas-unbounded-loop', 'sec-auth'].sort(),
    );
  });

  it('failure path: empty issues still completes with zero findings', () => {
    const harness = new AnalysisWorkflowHarness();
    const { jobId } = harness.submit({
      organizationId: 'org-e2e',
      repositoryId: 'repo-e2e',
      issues: [],
    });
    expect(harness.getStatus(jobId)).toBe('completed');
    const page = findingsService.list({
      organizationId: 'org-e2e',
      analysisJobId: jobId,
      limit: 10,
    });
    expect(page.items).toHaveLength(0);
  });
});
