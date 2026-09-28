import { Controller, Get, Version } from "@nestjs/common";
import { StagingParityService } from "./staging-parity.service";
import { ParityReport } from "../../../src/config/staging-parity-check";

@Controller("staging-parity")
@Version("1")
export class StagingParityController {
  constructor(private readonly stagingParityService: StagingParityService) {}

  @Get("check")
  async runParityCheck(): Promise<ParityReport> {
    return this.stagingParityService.runParityCheck();
  }
}
