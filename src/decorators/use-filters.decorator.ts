import "../reflect-setup";
import { EXCEPTION_FILTERS_METADATA } from "../common/constants";

export function UseFilters(...filters: any[]): MethodDecorator & ClassDecorator {
  return (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>,
  ) => {
    if (descriptor) {
      const existing: any[] =
        Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, descriptor.value) || [];
      Reflect.defineMetadata(
        EXCEPTION_FILTERS_METADATA,
        [...existing, ...filters],
        descriptor.value,
      );
    } else {
      const existing: any[] = Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, target) || [];
      Reflect.defineMetadata(EXCEPTION_FILTERS_METADATA, [...existing, ...filters], target);
    }
  };
}
