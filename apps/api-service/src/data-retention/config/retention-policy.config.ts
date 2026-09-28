import { ConfigService } from "@nestjs/config";

/**
 * Central retention policy for data categories covered by Issue #1011.
 * Defaults mirror the recommendations already published in
 * docs/AUDIT_LOGGING_SYSTEM.md and docs/DATABASE_BACKUP_RESTORE.md; override
 * per-environment via the listed env vars rather than editing these defaults.
 */
export interface RetentionPolicy {
  /** Audit log rows (audit_logs) older than this are purged. */
  auditLogRetentionDays: number;
  /** Analysis results (repositories/findings in analysis_results) older than this are purged. */
  analysisResultRetentionDays: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  auditLogRetentionDays: 90,
  analysisResultRetentionDays: 180,
};

export function getRetentionPolicy(config: ConfigService): RetentionPolicy {
  return {
    auditLogRetentionDays: Number(
      config.get(
        "AUDIT_LOG_RETENTION_DAYS",
        DEFAULT_RETENTION_POLICY.auditLogRetentionDays,
      ),
    ),
    analysisResultRetentionDays: Number(
      config.get(
        "ANALYSIS_RESULT_RETENTION_DAYS",
        DEFAULT_RETENTION_POLICY.analysisResultRetentionDays,
      ),
    ),
  };
}
