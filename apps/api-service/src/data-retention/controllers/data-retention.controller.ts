import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DataRetentionCleanupService } from "../services/data-retention-cleanup.service";
import { UserDataDeletionService } from "../services/user-data-deletion.service";
import { ConfirmDeletionDto } from "../dto/confirm-deletion.dto";
import { AdminOnly } from "../../rbac/decorators";
import { RolesGuard } from "../../rbac/guards";

/**
 * Manual/on-demand entry points for the workflows documented in
 * docs/DATA_RETENTION_AND_DELETION.md (Issue #1011). Admin-only: these purge
 * or irreversibly anonymize data.
 */
@ApiTags("Data Retention")
@Controller("admin/data-retention")
@UseGuards(RolesGuard)
@AdminOnly()
export class DataRetentionController {
  constructor(
    private readonly cleanupService: DataRetentionCleanupService,
    private readonly userDataDeletionService: UserDataDeletionService,
  ) {}

  /** Runs the scheduled retention purge (audit logs + analysis results) immediately. */
  @Post("purge")
  @HttpCode(HttpStatus.OK)
  async runCleanup() {
    return this.cleanupService.runCleanup();
  }

  /** Anonymizes a user's PII in place; audit log entries keep referencing the same id. */
  @Delete("users/:userId")
  @HttpCode(HttpStatus.OK)
  async deleteUser(
    @Param("userId") userId: string,
    @Body() body: ConfirmDeletionDto,
  ) {
    this.assertConfirmed(body);
    return this.userDataDeletionService.anonymizeUser(userId);
  }

  /** Deletes scanned source code and findings for a merchant. */
  @Delete("merchants/:merchantId/analysis-results")
  @HttpCode(HttpStatus.OK)
  async deleteMerchantAnalysisResults(
    @Param("merchantId") merchantId: string,
    @Body() body: ConfirmDeletionDto,
  ) {
    this.assertConfirmed(body);
    return this.userDataDeletionService.purgeAnalysisResultsForMerchant(
      merchantId,
    );
  }

  private assertConfirmed(body: ConfirmDeletionDto): void {
    if (body?.confirm !== "DELETE") {
      throw new BadRequestException(
        'This is a destructive operation. Set "confirm": "DELETE" in the request body to proceed.',
      );
    }
  }
}
