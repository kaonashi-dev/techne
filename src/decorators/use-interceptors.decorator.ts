import "../reflect-setup";
import { INTERCEPTORS_METADATA } from "../common/constants";

export function UseInterceptors(...interceptors: any[]): MethodDecorator & ClassDecorator {
  return (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>,
  ) => {
    if (descriptor) {
      const existing: any[] = Reflect.getMetadata(INTERCEPTORS_METADATA, descriptor.value) || [];
      Reflect.defineMetadata(
        INTERCEPTORS_METADATA,
        [...existing, ...interceptors],
        descriptor.value,
      );
    } else {
      const existing: any[] = Reflect.getMetadata(INTERCEPTORS_METADATA, target) || [];
      Reflect.defineMetadata(INTERCEPTORS_METADATA, [...existing, ...interceptors], target);
    }
  };
}
