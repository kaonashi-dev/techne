import { Injectable } from "@kaonashi-dev/bnest";

@Injectable()
export class AppService {
  getHello() {
    return {
      message: "Hello from Bnest!",
    };
  }
}
