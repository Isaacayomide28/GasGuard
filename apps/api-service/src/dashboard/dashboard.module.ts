import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";
import { HealthModule } from "../health/health.module";
import { PerformanceMonitoringModule } from "../performance-monitoring/performance-monitoring.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [HealthModule, PerformanceMonitoringModule, AuditModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
