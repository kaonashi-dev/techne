import { describe, expect, test } from "bun:test";
import { Injectable, Module, NestiaFactory } from "../src";
import { EventPattern, LocalClient, LocalServer, MessagePattern } from "../src/microservices";

@Injectable()
class MessageController {
  public readonly events: string[] = [];

  @MessagePattern("math.add")
  add(data: { a: number; b: number }) {
    return data.a + data.b;
  }

  @EventPattern("user.created")
  onUserCreated(data: { name: string }) {
    this.events.push(data.name);
  }
}

describe("microservices", () => {
  test("supports local request/response and events", async () => {
    const localServer = new LocalServer();
    localServer.registerHandler("math.add", ({ a, b }) => a + b);
    localServer.registerEventHandler("user.created", () => undefined);

    const localClient = new LocalClient(localServer);
    const result = await localClient.send<number>("math.add", { a: 2, b: 3 });
    expect(result).toBe(5);
  });

  test("creates microservice from module", async () => {
    @Module({ providers: [MessageController] })
    class AppModule {}

    const { server, client, container } = NestiaFactory.createMicroservice(AppModule, {
      transport: "local",
    });

    await server.listen();
    const result = await client.send<number>("math.add", { a: 4, b: 6 });
    expect(result).toBe(10);
    await client.emit("user.created", { name: "Ada" });
    expect(container.get<MessageController>(MessageController).events).toEqual(["Ada"]);

    await client.close();
    await server.close();
  });
});
