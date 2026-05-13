import { EXCEPTION_FILTERS_METADATA } from "../common/constants";
import { AppendArrayMetadata } from "./append-array-metadata.decorator";

export function UseFilters(...filters: any[]): MethodDecorator & ClassDecorator {
  return AppendArrayMetadata(EXCEPTION_FILTERS_METADATA, filters);
}
