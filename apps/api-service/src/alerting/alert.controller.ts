import { Controller, Get, Version, Param } from "@nestjs/common";
import { AlertConfigService, AlertRule, OnCallOwnership } from "./alert-config.service";

@Controller("alerting")
@Version("1")
export class AlertController {
  constructor(private readonly alertConfigService: AlertConfigService) {}

  @Get("rules")
  getAllAlertRules(): AlertRule[] {
    return this.alertConfigService.getAllAlertRules();
  }

  @Get("rules/:id")
  getAlertRuleById(@Param("id") id: string): AlertRule | undefined {
    return this.alertConfigService.getAlertRuleById(id);
  }

  @Get("oncall/:service")
  getOnCallOwnership(@Param("service") service: string): OnCallOwnership | undefined {
    return this.alertConfigService.getOnCallOwnership(service);
  }
}
