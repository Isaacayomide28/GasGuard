import { Module } from "@nestjs/common";
import { StagingParityController } from "./staging-parity.controller";
import { StagingParityService } from "./staging-parity.service";

@Module({
  controllers: [StagingParityController],
  providers: [StagingParityService],
  exports: [StagingParityService],
})
export class StagingParityModule {}
