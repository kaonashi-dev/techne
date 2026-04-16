import { Injectable } from "@kaonashi-dev/bnest/common";

@Injectable()
export class AppService {
  getHello() {
    return {
      message: "Hello from Bnest!",
    };
  }
}
