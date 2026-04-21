import { Injectable } from "../decorators/injectable.decorator";

export type HealthIndicator = () => Promise<Record<string, any>> | Record<string, any>;

@Injectable()
export class HealthCheckService {
  async check(indicators: HealthIndicator[]) {
    const details: Record<string, any> = {};
    let healthy = true;

    for (const indicator of indicators) {
      try {
        const result = await indicator();
        Object.assign(details, result);
        for (const value of Object.values(result)) {
          if (value && typeof value === "object" && "status" in value && value.status !== "up") {
            healthy = false;
          }
        }
      } catch (error: any) {
        healthy = false;
        details[indicator.name || "indicator"] = {
          status: "down",
          message: error?.message || "Health indicator failed",
        };
      }
    }

    const info = Object.fromEntries(
      Object.entries(details).filter(([, value]) => value?.status === "up"),
    );
    const error = Object.fromEntries(
      Object.entries(details).filter(([, value]) => value?.status !== "up"),
    );

    return {
      status: healthy ? "ok" : "error",
      info,
      error,
      details,
    };
  }

  pingCheck(name: string) {
    return () => ({ [name]: { status: "up" } });
  }

  memoryCheck(name: string, heapLimit: number) {
    return () => ({
      [name]: {
        status: process.memoryUsage().heapUsed <= heapLimit ? "up" : "down",
        heapUsed: process.memoryUsage().heapUsed,
      },
    });
  }
}
