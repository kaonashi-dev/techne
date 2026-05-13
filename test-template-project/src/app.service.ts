import { Injectable } from "@kaonashi-dev/techne/common";

@Injectable()
export class AppService {
  getHello() {
    return {
      message: "Hello from Techne!",
    };
  }
}
