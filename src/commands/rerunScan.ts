// src/commands/rerunScan.ts
import { logger } from '../utils/logger';

export interface ScanRecord {
  id: string;
  status: 'completed' | 'failed' | 'pending' | 'running';
  targetPath: string;
  gasProfile: string;
  createdAt: Date;
}

// Mock persistence layer interface for demonstration
export interface ScanRepository {
  findById(id: string): Promise<ScanRecord | null>;
  saveScan(record: ScanRecord): Promise<void>;
}

export class ScanRerunService {
  constructor(private scanRepo: ScanRepository, private dispatchFn: (target: string, profile: string) => Promise<string>) {}

  async rerunFailedScan(scanId: string): Promise<string> {
    logger.info({ scanId }, 'Attempting to rerun failed gas scan');

    const scan = await this.scanRepo.findById(scanId);
    if (!scan) {
      throw new Error(`Scan with ID "${scanId}" not found.`);
    }

    if (scan.status !== 'failed') {
      throw new Error(`Cannot rerun scan "${scanId}" because its current status is "${scan.status}" (only failed scans can be rerun).`);
    }

    // Create a new retry record or re-dispatch job
    const newScanId = await this.dispatchFn(scan.targetPath, scan.gasProfile);
    
    logger.info({ originalScanId: scanId, newScanId }, 'Failed scan successfully re-dispatched');
    return newScanId;
  }
}