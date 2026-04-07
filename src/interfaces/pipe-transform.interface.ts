export interface ArgumentMetadata {
  type: "body" | "param" | "query" | "headers";
  name?: string;
  metatype?: Function;
}

export interface PipeTransform {
  transform(value: any, metadata: ArgumentMetadata): any;
}
