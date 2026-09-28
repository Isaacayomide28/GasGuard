import { Queue, Worker, QueueEvents, JobsOptions } from "bullmq";
import { createClient } from "ioredis";
import { performScan } from "../scan.js";
import { createInMemoryQueue } from "./memory.js";
import { cacheService } from "../common/cache/index.js";
import { MetricsCollector } from "./metrics.js";
import { GracefulShutdown } from "./shutdown.js";

type InitOptions = { redisUrl: string; queueName: string };

export const metricsCollector = new MetricsCollector();
export const gracefulShutdown = new GracefulShutdown();

export function initQueue({ redisUrl, queueName }: InitOptions) {
  if (!redisUrl) {
    const { queue, worker, events } = createInMemoryQueue(queueName);
    return { queue, worker, events };
  }
  const connection = new createClient(redisUrl);
  const queue = new Queue(queueName, { connection });
  const events = new QueueEvents(queueName, { connection });
  const worker = new Worker(
    queueName,
    async (job) => {
      const span = metricsCollector.startTrace(`job:${job.name}`, {
        jobId: job.id || "unknown",
      });

      try {
        metricsCollector.incrementQueueDepth();
        const payload = job.data.payload;
        await job.updateProgress(10);
        const startTime = Date.now();
        const result = await performScan(payload, (p) => job.updateProgress(p));
        const duration = Date.now() - startTime;

        metricsCollector.recordJobCompleted(duration);
        metricsCollector.endTrace(span, "ok");

        if (payload?.project?.repositoryUrl && payload?.project?.commitHash) {
          const cacheKey = cacheService.generateKey(
            payload.project.repositoryUrl,
            payload.project.commitHash,
          );
          await cacheService.set(cacheKey, { ...result, jobId: job.id });
        }

        return result;
      } catch (error) {
        metricsCollector.recordJobFailed();
        metricsCollector.endTrace(span, "error");
        throw error;
      } finally {
        metricsCollector.decrementQueueDepth();
      }
    },
    { connection },
  );

  gracefulShutdown.registerShutdownHook(async () => {
    console.log("[Queue] Closing worker...");
    await worker.close();
    console.log("[Queue] Closing queue...");
    await queue.close();
    console.log("[Queue] Closing connection...");
    await connection.quit();
  });

  return { queue, worker, events };
}

export const defaultJobOptions: JobsOptions = {
  removeOnComplete: true,
  removeOnFail: true,
};
