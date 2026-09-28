import { findingsRepository, FindingsRepository } from './findings.repository';
import {
  Finding,
  FindingListPage,
  FindingListQuery,
  FindingSeverity,
  FindingStatus,
} from './finding.types';

export interface CreateFindingInput {
  organizationId: string;
  repositoryId: string;
  analysisJobId: string;
  title: string;
  description: string;
  severity: FindingSeverity;
  status?: FindingStatus;
  ruleId: string;
  filePath?: string;
  line?: number;
}

function newId(): string {
  return `fnd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export class FindingsService {
  constructor(private readonly repo: FindingsRepository = findingsRepository) {}

  create(input: CreateFindingInput): Finding {
    const now = new Date().toISOString();
    const finding: Finding = {
      id: newId(),
      organizationId: input.organizationId,
      repositoryId: input.repositoryId,
      analysisJobId: input.analysisJobId,
      title: input.title,
      description: input.description,
      severity: input.severity,
      status: input.status ?? 'open',
      ruleId: input.ruleId,
      filePath: input.filePath,
      line: input.line,
      createdAt: now,
      updatedAt: now,
    };
    return this.repo.upsert(finding);
  }

  /**
   * Persist findings produced by an analysis job (E2E workflow #994).
   */
  persistAnalysisFindings(
    organizationId: string,
    repositoryId: string,
    analysisJobId: string,
    issues: Array<{
      title: string;
      description: string;
      severity: FindingSeverity;
      ruleId: string;
      filePath?: string;
      line?: number;
    }>,
  ): Finding[] {
    return issues.map((issue) =>
      this.create({
        organizationId,
        repositoryId,
        analysisJobId,
        ...issue,
      }),
    );
  }

  list(query: FindingListQuery): FindingListPage {
    return this.repo.list(query);
  }

  getForTenant(id: string, organizationId: string): Finding | undefined {
    return this.repo.getForTenant(id, organizationId);
  }
}

export const findingsService = new FindingsService();
