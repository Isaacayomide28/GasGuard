// src/ci/__tests__/commitStatusReporter.test.ts
import { CommitStatusReporter, SCMClient, CommitStatusPayload } from '../commitStatusReporter';

class MockSCMClient implements SCMClient {
  public lastPayload?: CommitStatusPayload;
  public shouldFail = false;

  async createCommitStatus(payload: CommitStatusPayload): Promise<void> {
    if (this.shouldFail) {
      throw new Error('API Rate Limit Exceeded');
    }
    this.lastPayload = payload;
  }
}

describe('Commit Status Reporter Service (#1075)', () => {
  let reporter: CommitStatusReporter;
  let mockClient: MockSCMClient;

  beforeEach(() => {
    mockClient = new MockSCMClient();
    reporter = new CommitStatusReporter(mockClient);
  });

  it('successfully reports commit status with valid payload', async () => {
    const payload: CommitStatusPayload = {
      owner: 'MDTechLabs',
      repo: 'GasGuard',
      sha: 'abc12345',
      state: 'success',
      description: 'Gas audit passed with 0 critical issues',
      context: 'gasguard/audit',
    };

    await reporter.reportStatus(payload);

    expect(mockClient.lastPayload).toEqual(payload);
  });

  it('throws an error when required repository context is missing', async () => {
    const invalidPayload: CommitStatusPayload = {
      owner: '',
      repo: 'GasGuard',
      sha: '',
      state: 'failure',
      description: 'Failed check',
      context: 'gasguard/audit',
    };

    await expect(reporter.reportStatus(invalidPayload)).rejects.toThrow(
      'Owner, repo, and commit SHA are required to report commit status.'
    );
  });

  it('propagates errors when SCM client fails', async () => {
    mockClient.shouldFail = true;
    const payload: CommitStatusPayload = {
      owner: 'MDTechLabs',
      repo: 'GasGuard',
      sha: 'abc12345',
      state: 'error',
      description: 'Error running audit',
      context: 'gasguard/audit',
    };

    await expect(reporter.reportStatus(payload)).rejects.toThrow('API Rate Limit Exceeded');
  });
});