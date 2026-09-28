export interface ShutdownHandler {
  shutdown(): Promise<void>;
  isShuttingDown(): boolean;
}

export class GracefulShutdown {
  private shuttingDown = false;
  private handlers: Array<() => Promise<void>> = [];
  private timeoutMs: number;

  constructor(timeoutMs: number = 30000) {
    this.timeoutMs = timeoutMs;
  }

  registerShutdownHook(handler: () => Promise<void>): void {
    this.handlers.push(handler);
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const shutdownPromise = Promise.all(
      this.handlers.map((handler) =>
        Promise.race([
          handler(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error("Shutdown timeout")), this.timeoutMs)
          ),
        ])
      )
    );

    try {
      await shutdownPromise;
    } catch (error) {
      console.error("[GracefulShutdown] Error during shutdown:", error);
    }

    this.shuttingDown = false;
  }

  installSignalHandlers(): void {
    const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

    for (const signal of signals) {
      process.on(signal, async () => {
        console.log(`[GracefulShutdown] Received ${signal}, starting graceful shutdown...`);
        await this.shutdown();
        process.exit(0);
      });
    }
  }
}
