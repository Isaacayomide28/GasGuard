import { IsIn } from "class-validator";

/**
 * Destructive endpoints require the literal string "DELETE" in the body so a
 * stray/replayed request can't trigger irreversible deletion, mirroring the
 * explicit-approval pattern already used for destructive migrations
 * (see docs/MIGRATION_SAFETY.md).
 */
export class ConfirmDeletionDto {
  @IsIn(["DELETE"])
  confirm: "DELETE";
}
