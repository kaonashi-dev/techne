import { ClientProxy } from "../../abstract-client";
import { LocalServer } from "./local-server";

export class LocalClient extends ClientProxy {
  constructor(private readonly server: LocalServer) {
    super();
  }

  async connect(): Promise<void> {}

  async close(): Promise<void> {}

  async send<T = any>(pattern: string, data: any): Promise<T> {
    return await this.server.handle(pattern, data);
  }

  async emit(pattern: string, data: any): Promise<void> {
    await this.server.dispatch(pattern, data);
  }
}
