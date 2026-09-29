// src/ci/__tests__/preCommitValidator.test.ts
import { PreCommitValidator } from '../preCommitValidator';

describe('Pre-Commit Validator Service (#1074)', () => {
  it('passes successfully when no relevant files are staged', async () => {
    const result = await PreCommitValidator.validateStagedFiles({
      stagedFiles: ['README.md', 'docs/architecture.md'],
    });
    expect(result).toBe(true);
  });

  it('successfully validates staged smart contract files', async () => {
    const result = await PreCommitValidator.validateStagedFiles({
      stagedFiles: ['contracts/Vault.sol', 'src/index.ts'],
    });
    expect(result).toBe(true);
  });

  it('handles empty staged file lists gracefully', async () => {
    const result = await PreCommitValidator.validateStagedFiles({
      stagedFiles: [],
    });
    expect(result).toBe(true);
  });
});