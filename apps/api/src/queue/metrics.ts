export interface MetricsSnapshot {
  timestamp: Date;
  queueDepth: number;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  avgLatencyMs: number;
  errorRate: number;
  analyzerDurations: Record<string, number>;
}

export interface TraceSpan {
  traceId: string;
  spanId: string;
  operationName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: "ok" | "error";
  tags: Record<string, string>;
  parentId?: string;
}

export class MetricsCollector {
  private queueDepth = 0;
  private totalJobs = 0;
  private completedJobs = 0;
  private failedJobs = 0;
  private latencySum = 0;
  private latencyCount = 0;
  private errorCount = 0;
  private analyzerDurations: Record<string, number> = {};
  private traceSpans: TraceSpan[] = [];
  private snapshotHistory: MetricsSnapshot[] = [];
  private maxHistory = 100;

  incrementQueueDepth(): void {
    this.queueDepth++;
  }

  decrementQueueDepth(): void {
    this.queueDepth = Math.max(0, this.queueDepth - 1);
  }

  recordJobCompleted(durationMs: number): void {
    this.totalJobs++;
    this.completedJobs++;
    this.latencySum += durationMs;
    this.latencyCount++;
  }

  recordJobFailed(): void {
    this.totalJobs++;
    this.failedJobs++;
    this.errorCount++;
  }

  recordAnalyzerDuration(analyzer: string, durationMs: number): void {
    this.analyzerDurations[analyzer] = durationMs;
  }

  startTrace(operationName: string, tags: Record<string, string> = {}): TraceSpan {
    const span: TraceSpan = {
      traceId: this.generateId(),
      spanId: this.generateId(),
      operationName,
      startTime: Date.now(),
      status: "ok",
      tags,
    };
    this.traceSpans.push(span);
    return span;
  }

  endTrace(span: TraceSpan, status: "ok" | "error" = "ok"): void {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
  }

  takeSnapshot(): MetricsSnapshot {
    const snapshot: MetricsSnapshot = {
      timestamp: new Date(),
      queueDepth: this.queueDepth,
      totalJobs: this.totalJobs,
      completedJobs: this.completedJobs,
      failedJobs: this.failedJobs,
      avgLatencyMs: this.latencyCount > 0 ? this.latencySum / this.latencyCount : 0,
      errorRate: this.totalJobs > 0 ? this.errorCount / this.totalJobs : 0,
      analyzerDurations: { ...this.analyzerDurations },
    };

    this.snapshotHistory.push(snapshot);
    if (this.snapshotHistory.length > this.maxHistory) {
      this.snapshotHistory.shift();
    }

    return snapshot;
  }

  getSnapshotHistory(): MetricsSnapshot[] {
    return [...this.snapshotHistory];
  }

  getTraceSpans(): TraceSpan[] {
    return [...this.traceSpans];
  }

  private generateId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
