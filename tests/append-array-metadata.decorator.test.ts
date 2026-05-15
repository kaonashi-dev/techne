import { describe, expect, test } from "bun:test";
import { AppendArrayMetadata } from "../src/decorators/append-array-metadata.decorator";
describe("AppendArrayMetadata", () => {
  test("appends class metadata in decoration order", () => {
    const key = "append-array-class-test";
    class TestController {}
    AppendArrayMetadata(key, ["class-a"])(TestController);
    AppendArrayMetadata(key, ["class-b", "class-c"])(TestController);
    expect(Reflect.getMetadata(key, TestController)).toEqual(["class-a", "class-b", "class-c"]);
  });
  test("appends method metadata on the handler function", () => {
    const key = "append-array-method-test";
    class TestController {
      handler() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(TestController.prototype, "handler")!;
    AppendArrayMetadata(key, ["method-a"])(TestController.prototype, "handler", descriptor);
    AppendArrayMetadata(key, ["method-b"])(TestController.prototype, "handler", descriptor);
    expect(Reflect.getMetadata(key, descriptor.value)).toEqual(["method-a", "method-b"]);
  });
});
