import { NestFactory } from "@nestjs/core";
import { VersioningType } from "@nestjs/common";
import { AppModule } from "./app.module";
import { gracefulShutdown } from "./queue/index.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableVersioning({
    type: VersioningType.URI,
  });

  gracefulShutdown.registerShutdownHook(async () => {
    console.log("[API] Closing NestJS application...");
    await app.close();
  });

  gracefulShutdown.installSignalHandlers();

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 GasGuard API is running on: http://localhost:${port}`);
  console.log(`API versioning enabled - all endpoints require /v1/ prefix`);
}

bootstrap();
