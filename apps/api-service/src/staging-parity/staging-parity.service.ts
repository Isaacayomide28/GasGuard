import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StagingParityChecker, ParityReport } from "../../../src/config/staging-parity-check";
import { SystemConfiguration } from "../../../src/config/config.types";

@Injectable()
export class StagingParityService {
  constructor(private readonly configService: ConfigService) {}

  async runParityCheck(): Promise<ParityReport> {
    const productionConfig = this.loadProductionConfig();
    const stagingConfig = this.loadStagingConfig();

    const checker = new StagingParityChecker(productionConfig, stagingConfig);
    return checker.checkParity();
  }

  private loadProductionConfig(): SystemConfiguration {
    return {
      version: this.configService.get<string>("PROD_VERSION", "1.0.0"),
      environment: "production",
      logging: {
        level: this.configService.get<string>("PROD_LOG_LEVEL", "info"),
        enableConsole: this.configService.get<boolean>("PROD_LOG_CONSOLE", false),
        enableFile: this.configService.get<boolean>("PROD_LOG_FILE", true),
        enableAudit: this.configService.get<boolean>("PROD_LOG_AUDIT", true),
      },
      performance: {
        maxConcurrency: this.configService.get<number>("PROD_MAX_CONCURRENCY", 10),
        timeoutMs: this.configService.get<number>("PROD_TIMEOUT_MS", 30000),
        enableParallelExecution: this.configService.get<boolean>("PROD_PARALLEL_EXEC", true),
      },
      security: {
        enableApiKeyValidation: this.configService.get<boolean>("PROD_API_KEY_VALIDATION", true),
        enableRateLimiting: this.configService.get<boolean>("PROD_RATE_LIMITING", true),
        maxRequestsPerMinute: this.configService.get<number>("PROD_MAX_REQUESTS", 100),
      },
      features: {
        enableAutoFix: this.configService.get<boolean>("PROD_AUTO_FIX", false),
        enableDetailedReporting: this.configService.get<boolean>("PROD_DETAILED_REPORTING", true),
        enableRealTimeMonitoring: this.configService.get<boolean>("PROD_REALTIME_MONITORING", true),
      },
    };
  }

  private loadStagingConfig(): SystemConfiguration {
    return {
      version: this.configService.get<string>("STAGING_VERSION", "1.0.0"),
      environment: "staging",
      logging: {
        level: this.configService.get<string>("STAGING_LOG_LEVEL", "info"),
        enableConsole: this.configService.get<boolean>("STAGING_LOG_CONSOLE", true),
        enableFile: this.configService.get<boolean>("STAGING_LOG_FILE", true),
        enableAudit: this.configService.get<boolean>("STAGING_LOG_AUDIT", true),
      },
      performance: {
        maxConcurrency: this.configService.get<number>("STAGING_MAX_CONCURRENCY", 10),
        timeoutMs: this.configService.get<number>("STAGING_TIMEOUT_MS", 30000),
        enableParallelExecution: this.configService.get<boolean>("STAGING_PARALLEL_EXEC", true),
      },
      security: {
        enableApiKeyValidation: this.configService.get<boolean>("STAGING_API_KEY_VALIDATION", true),
        enableRateLimiting: this.configService.get<boolean>("STAGING_RATE_LIMITING", true),
        maxRequestsPerMinute: this.configService.get<number>("STAGING_MAX_REQUESTS", 100),
      },
      features: {
        enableAutoFix: this.configService.get<boolean>("STAGING_AUTO_FIX", false),
        enableDetailedReporting: this.configService.get<boolean>("STAGING_DETAILED_REPORTING", true),
        enableRealTimeMonitoring: this.configService.get<boolean>("STAGING_REALTIME_MONITORING", true),
      },
    };
  }
}
