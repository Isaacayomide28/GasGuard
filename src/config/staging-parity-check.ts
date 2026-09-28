import { SystemConfiguration, RuleConfiguration } from './config.types';

export interface ParityCheckResult {
  checkName: string;
  passed: boolean;
  message: string;
  details?: Record<string, any>;
}

export interface ParityReport {
  environment: string;
  timestamp: string;
  checks: ParityCheckResult[];
  overallStatus: 'passed' | 'failed' | 'warning';
}

export class StagingParityChecker {
  private productionConfig: SystemConfiguration;
  private stagingConfig: SystemConfiguration;

  constructor(productionConfig: SystemConfiguration, stagingConfig: SystemConfiguration) {
    this.productionConfig = productionConfig;
    this.stagingConfig = stagingConfig;
  }

  checkParity(): ParityReport {
    const checks: ParityCheckResult[] = [
      this.checkEnvironmentConfiguration(),
      this.checkSecurityControls(),
      this.checkPerformanceSettings(),
      this.checkFeatureFlags(),
      this.checkLoggingConfiguration(),
    ];

    const failedCount = checks.filter(c => !c.passed).length;
    const overallStatus: 'passed' | 'failed' | 'warning' = 
      failedCount === 0 ? 'passed' : 
      failedCount > 2 ? 'failed' : 'warning';

    return {
      environment: this.stagingConfig.environment,
      timestamp: new Date().toISOString(),
      checks,
      overallStatus,
    };
  }

  private checkEnvironmentConfiguration(): ParityCheckResult {
    const issues: string[] = [];

    if (this.stagingConfig.environment !== 'staging') {
      issues.push('Environment is not set to staging');
    }

    if (this.stagingConfig.version !== this.productionConfig.version) {
      issues.push(`Version mismatch: staging=${this.stagingConfig.version}, production=${this.productionConfig.version}`);
    }

    return {
      checkName: 'environment_configuration',
      passed: issues.length === 0,
      message: issues.length === 0 ? 'Environment configuration matches production' : issues.join('; '),
      details: {
        stagingVersion: this.stagingConfig.version,
        productionVersion: this.productionConfig.version,
      },
    };
  }

  private checkSecurityControls(): ParityCheckResult {
    const issues: string[] = [];

    if (this.stagingConfig.security.enableApiKeyValidation !== this.productionConfig.security.enableApiKeyValidation) {
      issues.push('API key validation setting differs from production');
    }

    if (this.stagingConfig.security.enableRateLimiting !== this.productionConfig.security.enableRateLimiting) {
      issues.push('Rate limiting setting differs from production');
    }

    if (this.stagingConfig.security.maxRequestsPerMinute !== this.productionConfig.security.maxRequestsPerMinute) {
      issues.push('Rate limit threshold differs from production');
    }

    return {
      checkName: 'security_controls',
      passed: issues.length === 0,
      message: issues.length === 0 ? 'Security controls match production' : issues.join('; '),
      details: {
        stagingSecurity: this.stagingConfig.security,
        productionSecurity: this.productionConfig.security,
      },
    };
  }

  private checkPerformanceSettings(): ParityCheckResult {
    const issues: string[] = [];

    if (this.stagingConfig.performance.maxConcurrency !== this.productionConfig.performance.maxConcurrency) {
      issues.push('Max concurrency setting differs from production');
    }

    if (this.stagingConfig.performance.timeoutMs !== this.productionConfig.performance.timeoutMs) {
      issues.push('Timeout setting differs from production');
    }

    if (this.stagingConfig.performance.enableParallelExecution !== this.productionConfig.performance.enableParallelExecution) {
      issues.push('Parallel execution setting differs from production');
    }

    return {
      checkName: 'performance_settings',
      passed: issues.length === 0,
      message: issues.length === 0 ? 'Performance settings match production' : issues.join('; '),
      details: {
        stagingPerformance: this.stagingConfig.performance,
        productionPerformance: this.productionConfig.performance,
      },
    };
  }

  private checkFeatureFlags(): ParityCheckResult {
    const issues: string[] = [];

    if (this.stagingConfig.features.enableAutoFix !== this.productionConfig.features.enableAutoFix) {
      issues.push('Auto-fix feature flag differs from production');
    }

    if (this.stagingConfig.features.enableDetailedReporting !== this.productionConfig.features.enableDetailedReporting) {
      issues.push('Detailed reporting feature flag differs from production');
    }

    if (this.stagingConfig.features.enableRealTimeMonitoring !== this.productionConfig.features.enableRealTimeMonitoring) {
      issues.push('Real-time monitoring feature flag differs from production');
    }

    return {
      checkName: 'feature_flags',
      passed: issues.length === 0,
      message: issues.length === 0 ? 'Feature flags match production' : issues.join('; '),
      details: {
        stagingFeatures: this.stagingConfig.features,
        productionFeatures: this.productionConfig.features,
      },
    };
  }

  private checkLoggingConfiguration(): ParityCheckResult {
    const issues: string[] = [];

    if (this.stagingConfig.logging.level !== this.productionConfig.logging.level) {
      issues.push('Log level differs from production');
    }

    if (this.stagingConfig.logging.enableAudit !== this.productionConfig.logging.enableAudit) {
      issues.push('Audit logging setting differs from production');
    }

    return {
      checkName: 'logging_configuration',
      passed: issues.length === 0,
      message: issues.length === 0 ? 'Logging configuration matches production' : issues.join('; '),
      details: {
        stagingLogging: this.stagingConfig.logging,
        productionLogging: this.productionConfig.logging,
      },
    };
  }

  static compareRules(stagingRules: RuleConfiguration[], productionRules: RuleConfiguration[]): ParityCheckResult {
    const stagingRuleIds = new Set(stagingRules.map(r => r.id));
    const productionRuleIds = new Set(productionRules.map(r => r.id));

    const missingInStaging = [...productionRuleIds].filter(id => !stagingRuleIds.has(id));
    const extraInStaging = [...stagingRuleIds].filter(id => !productionRuleIds.has(id));

    const issues: string[] = [];
    if (missingInStaging.length > 0) {
      issues.push(`Missing rules in staging: ${missingInStaging.join(', ')}`);
    }
    if (extraInStaging.length > 0) {
      issues.push(`Extra rules in staging: ${extraInStaging.join(', ')}`);
    }

    return {
      checkName: 'rules_parity',
      passed: issues.length === 0,
      message: issues.length === 0 ? 'Rules match production' : issues.join('; '),
      details: {
        missingInStaging,
        extraInStaging,
        stagingRuleCount: stagingRules.length,
        productionRuleCount: productionRules.length,
      },
    };
  }
}
