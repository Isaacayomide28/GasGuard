import { Injectable } from "@nestjs/common";

export interface AlertThreshold {
  name: string;
  metric: string;
  threshold: number;
  operator: "gt" | "lt" | "eq";
  severity: "info" | "warning" | "critical";
  description: string;
}

export interface OnCallOwnership {
  team: string;
  contact: string;
  escalationPath: string[];
  runbookUrl: string;
  services: string[];
}

export interface AlertRule {
  id: string;
  name: string;
  threshold: AlertThreshold;
  onCall: OnCallOwnership;
  enabled: boolean;
}

@Injectable()
export class AlertConfigService {
  private readonly alertRules: AlertRule[] = [
    {
      id: "availability-critical",
      name: "Service Availability Critical",
      threshold: {
        name: "availability",
        metric: "service_availability",
        threshold: 99.9,
        operator: "lt",
        severity: "critical",
        description: "Service availability below 99.9%",
      },
      onCall: {
        team: "Infrastructure",
        contact: "infra-oncall@gasguard.io",
        escalationPath: ["Infrastructure Lead", "CTO"],
        runbookUrl: "https://docs.gasguard.io/runbooks/availability",
        services: ["api", "scanner", "analyzer"],
      },
      enabled: true,
    },
    {
      id: "latency-warning",
      name: "High API Latency",
      threshold: {
        name: "latency",
        metric: "p95_latency",
        threshold: 2000,
        operator: "gt",
        severity: "warning",
        description: "P95 latency above 2000ms",
      },
      onCall: {
        team: "Platform",
        contact: "platform-oncall@gasguard.io",
        escalationPath: ["Platform Lead", "CTO"],
        runbookUrl: "https://docs.gasguard.io/runbooks/latency",
        services: ["api"],
      },
      enabled: true,
    },
    {
      id: "job-failure-critical",
      name: "High Job Failure Rate",
      threshold: {
        name: "job_failure_rate",
        metric: "job_failure_rate",
        threshold: 5,
        operator: "gt",
        severity: "critical",
        description: "Job failure rate above 5%",
      },
      onCall: {
        team: "Platform",
        contact: "platform-oncall@gasguard.io",
        escalationPath: ["Platform Lead", "CTO"],
        runbookUrl: "https://docs.gasguard.io/runbooks/job-failures",
        services: ["scanner", "analyzer"],
      },
      enabled: true,
    },
    {
      id: "analyzer-failure-warning",
      name: "Analyzer Failures",
      threshold: {
        name: "analyzer_failure_rate",
        metric: "analyzer_failure_rate",
        threshold: 10,
        operator: "gt",
        severity: "warning",
        description: "Analyzer failure rate above 10%",
      },
      onCall: {
        team: "Engineering",
        contact: "eng-oncall@gasguard.io",
        escalationPath: ["Engineering Lead", "CTO"],
        runbookUrl: "https://docs.gasguard.io/runbooks/analyzer-failures",
        services: ["analyzer"],
      },
      enabled: true,
    },
    {
      id: "resource-usage-critical",
      name: "High Resource Usage",
      threshold: {
        name: "cpu_usage",
        metric: "cpu_usage",
        threshold: 90,
        operator: "gt",
        severity: "critical",
        description: "CPU usage above 90%",
      },
      onCall: {
        team: "Infrastructure",
        contact: "infra-oncall@gasguard.io",
        escalationPath: ["Infrastructure Lead", "CTO"],
        runbookUrl: "https://docs.gasguard.io/runbooks/resource-usage",
        services: ["api", "scanner", "analyzer"],
      },
      enabled: true,
    },
    {
      id: "auth-failure-critical",
      name: "High Authentication Failure Rate",
      threshold: {
        name: "auth_failure_rate",
        metric: "auth_failure_rate",
        threshold: 5,
        operator: "gt",
        severity: "critical",
        description: "Authentication failure rate above 5%",
      },
      onCall: {
        team: "Security",
        contact: "security-oncall@gasguard.io",
        escalationPath: ["Security Lead", "CTO"],
        runbookUrl: "https://docs.gasguard.io/runbooks/auth-failures",
        services: ["api"],
      },
      enabled: true,
    },
  ];

  getAllAlertRules(): AlertRule[] {
    return this.alertRules.filter((rule) => rule.enabled);
  }

  getAlertRuleById(id: string): AlertRule | undefined {
    return this.alertRules.find((rule) => rule.id === id);
  }

  getOnCallOwnership(service: string): OnCallOwnership | undefined {
    for (const rule of this.alertRules) {
      if (rule.onCall.services.includes(service)) {
        return rule.onCall;
      }
    }
    return undefined;
  }

  evaluateThreshold(metricName: string, value: number): AlertThreshold[] {
    const triggered: AlertThreshold[] = [];

    for (const rule of this.alertRules) {
      if (!rule.enabled) continue;

      const threshold = rule.threshold;
      if (threshold.metric !== metricName) continue;

      let triggered = false;
      switch (threshold.operator) {
        case "gt":
          triggered = value > threshold.threshold;
          break;
        case "lt":
          triggered = value < threshold.threshold;
          break;
        case "eq":
          triggered = value === threshold.threshold;
          break;
      }

      if (triggered) {
        triggered.push(threshold);
      }
    }

    return triggered;
  }
}
