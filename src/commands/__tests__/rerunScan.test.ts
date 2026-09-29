import { ScanRerunService, ScanRepository, ScanRecord } from '../rerunScan';

class MockScanRepository implements ScanRepository {
  private scans = new Map<string, ScanRecord>([
    ['scan_fail_01', { id: 'scan_fail_01', status: 'failed', targetPath: './contracts/Token.sol', gasProfile: 'default', createdAt: new Date() }],
    ['scan_success_01', { id: 'scan_success_01', status: 'completed', targetPath: './contracts/Vault.sol', gasProfile: 'strict', createdAt: new Date() }],
  ]);

  async findById(id: string): Promise<ScanRecord | null> {
    return this.scans.get(id) || null;
  }

  async saveScan(_record: ScanRecord): Promise<void> {}
}

describe('Scan Rerun Command (#1078)', () => {
  let service: ScanRerunService;
  let mockDispatch: jest.Mock;

  beforeEach(() => {
    const repo = new MockScanRepository();
    mockDispatch = jest.fn().mockResolvedValue('scan_new_02');
    service = new ScanRerunService(repo, mockDispatch);
  });

  it('successfully reruns a failed scan and dispatches a new job', async () => {
    const newId = await service.rerunFailedScan('scan_fail_01');

    expect(newId).toBe('scan_new_02');
    expect(mockDispatch).toHaveBeenCalledWith('./contracts/Token.sol', 'default');
  });

  it('throws an error when attempting to rerun a non-existent scan', async () => {
    await expect(service.rerunFailedScan('invalid_id')).rejects.toThrow('Scan with ID "invalid_id" not found.');
  });

  it('rejects rerunning a scan that did not fail', async () => {
    await expect(service.rerunFailedScan('scan_success_01')).rejects.toThrow('Cannot rerun scan "scan_success_01" because its current status is "completed"');
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});