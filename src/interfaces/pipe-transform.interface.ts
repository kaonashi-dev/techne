export interface ArgumentMetadata {
  type: "body" | "param" | "query" | "headers";
  name?: string;
}

export interface PipeTransform {
  transform(value: any, metadata: ArgumentMetadata): any;
}
