import { withRetryOptions, getDeadLetterQueueName } from "./retry";

describe("Retry configuration", () => {
  it("should return default retry options", () => {
    const options = withRetryOptions();
    expect(options.attempts).toBe(3);
    expect(options.backoff).toEqual({
      type: "exponential",
      delay: 1000,
    });
  });

  it("should allow custom retry config", () => {
    const options = withRetryOptions({
      maxRetries: 5,
      backoffDelay: 2000,
      backoffMultiplier: 3,
    });
    expect(options.attempts).toBe(5);
    expect(options.backoff).toEqual({
      type: "exponential",
      delay: 2000,
    });
  });

  it("should return dead letter queue name", () => {
    const name = getDeadLetterQueueName();
    expect(name).toBe("dead-letter");
  });

  it("should allow custom dead letter queue name", () => {
    const name = getDeadLetterQueueName({ deadLetterQueue: "custom-dlq" });
    expect(name).toBe("custom-dlq");
  });
});
