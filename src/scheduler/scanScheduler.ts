import { logger } from '../utils/logger';

export interface ScheduleConfig {
  cronExpression: string;
  targetPath: string;
  gasProfile: string;
  enabled: boolean;
}

export class ScanSchedulerService {
  /**
  * Validates the scheduling configuration parameters.
  */
  static validateConfig(config: ScheduleConfig): void {
    if (!config.cronExpression || typeof config.cronExpression !== 'string') {
      logger.error({ config }, 'Invalid or missing cron expression in schedule config');
      throw new Error('A valid cron expression is required for scheduled scans.');
    }

    if (!config.targetPath || typeof config.targetPath !== 'string') {
      logger.error({ config }, 'Invalid or missing target path in schedule config');
      throw new Error('A valid target path is required for scheduled scans.');
    }
  }

  static executeScheduledJob(config: ScheduleConfig): void {
    this.validateConfig(config);
    logger.info({ target: config.targetPath, profile: config.gasProfile }, 'Executing scheduled gas scan job...');
    // Execution dispatch logic...
  }
}