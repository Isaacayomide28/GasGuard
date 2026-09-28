import { MetricsCollector } from "./metrics";

describe("MetricsCollector", () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it("should track queue depth", () => {
    collector.incrementQueueDepth();
    collector.incrementQueueDepth();
    const snapshot = collector.takeSnapshot();
    expect(snapshot.queueDepth).toBe(2);

    collector.decrementQueueDepth();
    const snapshot2 = collector.takeSnapshot();
    expect(snapshot2.queueDepth).toBe(1);
  });

  it("should record completed jobs", () => {
    collector.recordJobCompleted(100);
    collector.recordJobCompleted(200);
    const snapshot = collector.takeSnapshot();
    expect(snapshot.completedJobs).toBe(2);
    expect(snapshot.avgLatencyMs).toBe(150);
  });

  it("should record failed jobs", () => {
    collector.recordJobCompleted(100);
    collector.recordJobFailed();
    const snapshot = collector.takeSnapshot();
    expect(snapshot.totalJobs).toBe(2);
    expect(snapshot.errorRate).toBe(0.5);
  });

  it("should record analyzer durations", () => {
    collector.recordAnalyzerDuration("soroban", 50);
    collector.recordAnalyzerDuration("evm", 100);
    const snapshot = collector.takeSnapshot();
    expect(snapshot.analyzerDurations).toEqual({ soroban: 50, evm: 100 });
  });

  it("should create and end trace spans", () => {
    const span = collector.startTrace("test-op", { key: "value" });
    expect(span.operationName).toBe("test-op");
    expect(span.tags).toEqual({ key: "value" });
    expect(span.status).toBe("ok");

    collector.endTrace(span, "ok");
    expect(span.endTime).toBeDefined();
    expect(span.duration).toBeDefined();

    const spans = collector.getTraceSpans();
    expect(spans).toHaveLength(1);
  });

  it("should maintain snapshot history", () => {
    collector.takeSnapshot();
    collector.takeSnapshot();
    const history = collector.getSnapshotHistory();
    expect(history).toHaveLength(2);
  });
});
