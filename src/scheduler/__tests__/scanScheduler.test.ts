// src/scheduler/__tests__/scanScheduler.test.ts
import { ScanSchedulerService, ScheduleConfig } from '../scanScheduler';

describe('Scan Scheduler Service (#1077)', () => {
  it('validates a correct schedule configuration successfully', () => {
    const validConfig: ScheduleConfig = {
      cronExpression: '0 2 * * *',
      targetPath: './contracts',
      gasProfile: 'strict',
      enabled: true,
    };

    expect(() => {
      ScanSchedulerService.validateConfig(validConfig);
    }).not.toThrow();
  });

  it('throws an error when cron expression is missing or invalid', () => {
    const invalidConfig = {
      cronExpression: '',
      targetPath: './contracts',
      gasProfile: 'default',
      enabled: true,
    };

    expect(() => {
      ScanSchedulerService.validateConfig(invalidConfig);
    }).toThrow('A valid cron expression is required for scheduled scans.');
  });

  it('throws an error when target path is missing', () => {
    const invalidConfig = {
      cronExpression: '0 2 * * *',
      targetPath: '',
      gasProfile: 'default',
      enabled: true,
    };

    expect(() => {
      ScanSchedulerService.validateConfig(invalidConfig);
    }).toThrow('A valid target path is required for scheduled scans.');
  });
});