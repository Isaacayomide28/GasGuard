import { GracefulShutdown } from "./shutdown";

describe("GracefulShutdown", () => {
  let shutdown: GracefulShutdown;

  beforeEach(() => {
    shutdown = new GracefulShutdown(5000);
  });

  it("should track shutdown state", () => {
    expect(shutdown.isShuttingDown()).toBe(false);
  });

  it("should execute registered handlers", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    shutdown.registerShutdownHook(handler);

    await shutdown.shutdown();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should execute multiple handlers", async () => {
    const handler1 = jest.fn().mockResolvedValue(undefined);
    const handler2 = jest.fn().mockResolvedValue(undefined);

    shutdown.registerShutdownHook(handler1);
    shutdown.registerShutdownHook(handler2);

    await shutdown.shutdown();
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("should handle handler errors gracefully", async () => {
    const failingHandler = jest.fn().mockRejectedValue(new Error("test error"));
    const successHandler = jest.fn().mockResolvedValue(undefined);

    shutdown.registerShutdownHook(failingHandler);
    shutdown.registerShutdownHook(successHandler);

    await shutdown.shutdown();
    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(successHandler).toHaveBeenCalledTimes(1);
  });

  it("should timeout if handler takes too long", async () => {
    const slowShutdown = new GracefulShutdown(100);
    const slowHandler = jest.fn(
      () => new Promise<void>((resolve) => setTimeout(resolve, 200))
    );
    slowShutdown.registerShutdownHook(slowHandler);

    await slowShutdown.shutdown();
    expect(slowHandler).toHaveBeenCalledTimes(1);
  });
});
