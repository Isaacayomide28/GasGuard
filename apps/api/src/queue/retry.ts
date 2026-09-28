import { JobsOptions } from "bullmq";

export interface RetryConfig {
  maxRetries: number;
  backoffDelay: number;
  backoffMultiplier: number;
  deadLetterQueue: string;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  backoffDelay: 1000,
  backoffMultiplier: 2,
  deadLetterQueue: "dead-letter",
};

export function withRetryOptions(
  config: Partial<RetryConfig> = {}
): JobsOptions {
  const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
  return {
    attempts: cfg.maxRetries,
    backoff: {
      type: "exponential",
      delay: cfg.backoffDelay,
    },
    removeOnComplete: true,
    removeOnFail: false,
  };
}

export function getDeadLetterQueueName(config: Partial<RetryConfig> = {}): string {
  return config.deadLetterQueue || DEFAULT_RETRY_CONFIG.deadLetterQueue;
}
