import { Module } from "@nestjs/common";
import { AlertController } from "./alert.controller";
import { AlertConfigService } from "./alert-config.service";

@Module({
  controllers: [AlertController],
  providers: [AlertConfigService],
  exports: [AlertConfigService],
})
export class AlertingModule {}
