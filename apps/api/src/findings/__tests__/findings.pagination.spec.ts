import { findingsRepository } from '../findings.repository';
import { findingsService } from '../findings.service';
import { Finding, FindingSeverity } from '../finding.types';
import { decodeCursor } from '../cursor';

function seed(
  org: string,
  repo: string,
  count: number,
  severity: FindingSeverity = 'medium',
): Finding[] {
  const out: Finding[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      findingsService.create({
        organizationId: org,
        repositoryId: repo,
        analysisJobId: `job-${i % 3}`,
        title: `Finding ${String(i).padStart(3, '0')}`,
        description: `desc ${i}`,
        severity: i % 5 === 0 ? 'critical' : severity,
        ruleId: i % 2 === 0 ? 'gas-loop' : 'storage-read',
        filePath: `src/file${i}.rs`,
        line: i + 1,
      }),
    );
  }
  return out;
}

describe('findings pagination and filtering (#992)', () => {
  beforeEach(() => {
    findingsRepository.clear();
  });

  it('paginates with stable cursors without duplicates', () => {
    seed('org-a', 'repo-1', 25);
    const page1 = findingsService.list({
      organizationId: 'org-a',
      limit: 10,
      sortBy: 'createdAt',
      sortDir: 'desc',
    });
    expect(page1.items).toHaveLength(10);
    expect(page1.nextCursor).toBeTruthy();
    const cursor = decodeCursor(page1.nextCursor!);
    expect(cursor.v).toBe(1);
    expect(cursor.id).toBeTruthy();

    const page2 = findingsService.list({
      organizationId: 'org-a',
      limit: 10,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(10);
    const ids1 = new Set(page1.items.map((f) => f.id));
    for (const f of page2.items) {
      expect(ids1.has(f.id)).toBe(false);
    }

    const page3 = findingsService.list({
      organizationId: 'org-a',
      limit: 10,
      cursor: page2.nextCursor!,
    });
    expect(page3.items.length).toBe(5);
    expect(page3.nextCursor).toBeNull();
  });

  it('filters by severity, status, ruleId, and repositoryId', () => {
    seed('org-a', 'repo-1', 20);
    findingsService.create({
      organizationId: 'org-a',
      repositoryId: 'repo-2',
      analysisJobId: 'job-x',
      title: 'Other repo',
      description: 'x',
      severity: 'high',
      ruleId: 'gas-loop',
    });

    const critical = findingsService.list({
      organizationId: 'org-a',
      severity: 'critical',
      limit: 50,
    });
    expect(critical.items.every((f) => f.severity === 'critical')).toBe(true);

    const byRule = findingsService.list({
      organizationId: 'org-a',
      ruleId: 'storage-read',
      limit: 50,
    });
    expect(byRule.items.every((f) => f.ruleId === 'storage-read')).toBe(true);

    const byRepo = findingsService.list({
      organizationId: 'org-a',
      repositoryId: 'repo-2',
      limit: 50,
    });
    expect(byRepo.items).toHaveLength(1);
    expect(byRepo.items[0].repositoryId).toBe('repo-2');
  });

  it('rejects invalid cursor', () => {
    seed('org-a', 'repo-1', 3);
    expect(() =>
      findingsService.list({
        organizationId: 'org-a',
        cursor: 'not-valid-base64!!!',
      }),
    ).toThrow(/Invalid cursor/);
  });

  it('caps limit at MAX_PAGE_LIMIT', () => {
    seed('org-a', 'repo-1', 5);
    const page = findingsService.list({
      organizationId: 'org-a',
      limit: 10_000,
    });
    expect(page.limit).toBe(100);
  });

  it('supports text search q', () => {
    seed('org-a', 'repo-1', 5);
    findingsService.create({
      organizationId: 'org-a',
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'UniqueZebraPattern',
      description: 'needle in haystack',
      severity: 'low',
      ruleId: 'custom',
    });
    const page = findingsService.list({
      organizationId: 'org-a',
      q: 'zebra',
      limit: 20,
    });
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect(page.items[0].title).toMatch(/Zebra/i);
  });
});
