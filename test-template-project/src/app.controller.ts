import { Controller, Get } from "@kaonashi-dev/techne/common";
import { AppService } from "./app.service";

@Controller("/")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("/")
  getHello() {
    return this.appService.getHello();
  }
}
