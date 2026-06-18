import { Controller, Get } from "../../../../src/common/index.ts";
import { HealthCheckService } from "../../../../src/health/index.ts";

/**
 * A custom health endpoint built on `HealthCheckService`. This is independent
 * of the framework's auto-registered `/healthz` (liveness) and `/readyz`
 * (readiness) probes.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  @Get("/")
  check() {
    return this.health.check([
      this.health.pingCheck("self"),
      this.health.memoryCheck("memory", 512 * 1024 * 1024),
    ]);
  }
}
