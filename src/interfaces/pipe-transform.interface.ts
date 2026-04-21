export interface ArgumentMetadata {
  type: "body" | "param" | "query" | "headers" | "file";
  name?: string;
  metatype?: Function;
}

export interface PipeTransform {
  transform(value: any, metadata: ArgumentMetadata): any;
}
