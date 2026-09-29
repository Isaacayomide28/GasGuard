import { findingsRepository } from '../findings.repository';
import { findingsService } from '../findings.service';

describe('tenant and repository isolation (#996)', () => {
  beforeEach(() => {
    findingsRepository.clear();
  });

  it('list never returns another organization\'s findings', () => {
    findingsService.create({
      organizationId: 'org-a',
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'A only',
      description: 'secret-a',
      severity: 'high',
      ruleId: 'r1',
    });
    findingsService.create({
      organizationId: 'org-b',
      repositoryId: 'repo-1',
      analysisJobId: 'job-2',
      title: 'B only',
      description: 'secret-b',
      severity: 'high',
      ruleId: 'r1',
    });

    const pageA = findingsService.list({ organizationId: 'org-a', limit: 50 });
    expect(pageA.items).toHaveLength(1);
    expect(pageA.items[0].title).toBe('A only');
    expect(pageA.items.every((f) => f.organizationId === 'org-a')).toBe(true);

    const pageB = findingsService.list({ organizationId: 'org-b', limit: 50 });
    expect(pageB.items).toHaveLength(1);
    expect(pageB.items[0].title).toBe('B only');
  });

  it('getForTenant returns undefined for cross-tenant id (no existence leak)', () => {
    const a = findingsService.create({
      organizationId: 'org-a',
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Owned by A',
      description: 'x',
      severity: 'medium',
      ruleId: 'r1',
    });

    expect(findingsService.getForTenant(a.id, 'org-a')).toBeDefined();
    expect(findingsService.getForTenant(a.id, 'org-b')).toBeUndefined();
    expect(findingsService.getForTenant('missing', 'org-a')).toBeUndefined();
  });

  it('repository filter cannot read sibling repos under same org without id', () => {
    findingsService.create({
      organizationId: 'org-a',
      repositoryId: 'repo-1',
      analysisJobId: 'j1',
      title: 'R1',
      description: 'x',
      severity: 'low',
      ruleId: 'r',
    });
    findingsService.create({
      organizationId: 'org-a',
      repositoryId: 'repo-2',
      analysisJobId: 'j2',
      title: 'R2',
      description: 'x',
      severity: 'low',
      ruleId: 'r',
    });

    const only1 = findingsService.list({
      organizationId: 'org-a',
      repositoryId: 'repo-1',
      limit: 50,
    });
    expect(only1.items).toHaveLength(1);
    expect(only1.items[0].repositoryId).toBe('repo-1');
  });

  it('requires organizationId on list', () => {
    expect(() =>
      findingsService.list({ organizationId: '', limit: 10 } as never),
    ).toThrow(/organizationId/);
  });
});
