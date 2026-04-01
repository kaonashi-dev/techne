import { Controller, Get } from "@kaonashi-dev/bnest";
import { AppService } from "./app.service";

@Controller("/")
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get("/")
  getHello() {
    return this.appService.getHello();
  }
}
