import { Injectable } from "@nestjs/common";
import { HealthService } from "../health/health.service";
import { MonitoringHooksService } from "../performance-monitoring/services/monitoring-hooks.service";
import { AuditLogService } from "../audit/services/audit-log.service";

export interface DashboardMetrics {
  availability: AvailabilityMetrics;
  latency: LatencyMetrics;
  jobHealth: JobHealthMetrics;
  analyzerFailures: AnalyzerFailureMetrics;
  resourceUsage: ResourceUsageMetrics;
  timestamp: string;
}

export interface AvailabilityMetrics {
  uptime: number;
  serviceStatus: string;
  endpointAvailability: Record<string, number>;
  lastDowntime: string | null;
}

export interface LatencyMetrics {
  averageLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  endpointLatency: Record<string, number>;
}

export interface JobHealthMetrics {
  totalJobs: number;
  successfulJobs: number;
  failedJobs: number;
  pendingJobs: number;
  successRate: number;
  avgJobDuration: number;
}

export interface AnalyzerFailureMetrics {
  totalAnalyzers: number;
  healthyAnalyzers: number;
  failedAnalyzers: number;
  failureRate: number;
  recentFailures: Array<{
    analyzerId: string;
    timestamp: string;
    error: string;
  }>;
}

export interface ResourceUsageMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  activeConnections: number;
  requestRate: number;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly healthService: HealthService,
    private readonly monitoringHooks: MonitoringHooksService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const healthCheck = this.healthService.check();
    const monitoringSnapshot = this.monitoringHooks.getSnapshot();

    return {
      availability: this.getAvailabilityMetrics(healthCheck),
      latency: this.getLatencyMetrics(monitoringSnapshot),
      jobHealth: await this.getJobHealthMetrics(),
      analyzerFailures: await this.getAnalyzerFailureMetrics(),
      resourceUsage: this.getResourceUsageMetrics(monitoringSnapshot),
      timestamp: new Date().toISOString(),
    };
  }

  private getAvailabilityMetrics(healthCheck: any): AvailabilityMetrics {
    return {
      uptime: healthCheck.uptime,
      serviceStatus: healthCheck.status,
      endpointAvailability: this.calculateEndpointAvailability(healthCheck.checks),
      lastDowntime: null,
    };
  }

  private calculateEndpointAvailability(checks: Record<string, string>): Record<string, number> {
    const availability: Record<string, number> = {};
    for (const [endpoint, status] of Object.entries(checks)) {
      availability[endpoint] = status === "healthy" ? 100 : 0;
    }
    return availability;
  }

  private getLatencyMetrics(snapshot: any): LatencyMetrics {
    const latencyHistogram = snapshot.histograms.find(
      (h: any) => h.name === "request_latency",
    );

    return {
      averageLatency: latencyHistogram?.average || 0,
      p50Latency: latencyHistogram?.average || 0,
      p95Latency: latencyHistogram?.max || 0,
      p99Latency: latencyHistogram?.max || 0,
      endpointLatency: {},
    };
  }

  private async getJobHealthMetrics(): Promise<JobHealthMetrics> {
    const successCounter = this.monitoringHooks.getSnapshot().counters.find(
      (c: any) => c.name === "job_success",
    );
    const failureCounter = this.monitoringHooks.getSnapshot().counters.find(
      (c: any) => c.name === "job_failure",
    );

    const successfulJobs = successCounter?.value || 0;
    const failedJobs = failureCounter?.value || 0;
    const totalJobs = successfulJobs + failedJobs;

    return {
      totalJobs,
      successfulJobs,
      failedJobs,
      pendingJobs: 0,
      successRate: totalJobs > 0 ? (successfulJobs / totalJobs) * 100 : 100,
      avgJobDuration: 0,
    };
  }

  private async getAnalyzerFailureMetrics(): Promise<AnalyzerFailureMetrics> {
    const failureCounter = this.monitoringHooks.getSnapshot().counters.find(
      (c: any) => c.name === "analyzer_failure",
    );

    const failedAnalyzers = failureCounter?.value || 0;
    const totalAnalyzers = 10; // Default value, should be configurable

    return {
      totalAnalyzers,
      healthyAnalyzers: totalAnalyzers - failedAnalyzers,
      failedAnalyzers,
      failureRate: totalAnalyzers > 0 ? (failedAnalyzers / totalAnalyzers) * 100 : 0,
      recentFailures: [],
    };
  }

  private getResourceUsageMetrics(snapshot: any): ResourceUsageMetrics {
    const cpuGauge = snapshot.gauges.find((g: any) => g.name === "cpu_usage");
    const memoryGauge = snapshot.gauges.find((g: any) => g.name === "memory_usage");
    const requestCounter = snapshot.counters.find((c: any) => c.name === "api_requests");

    return {
      cpuUsage: cpuGauge?.value || 0,
      memoryUsage: memoryGauge?.value || 0,
      diskUsage: 0,
      activeConnections: 0,
      requestRate: requestCounter?.value || 0,
    };
  }
}
