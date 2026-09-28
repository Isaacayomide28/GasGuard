import { Controller, Get, Version } from "@nestjs/common";
import { DashboardService, DashboardMetrics } from "./dashboard.service";

@Controller("dashboard")
@Version("1")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("metrics")
  async getMetrics(): Promise<DashboardMetrics> {
    return this.dashboardService.getDashboardMetrics();
  }
}
