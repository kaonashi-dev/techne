import "reflect-metadata";

export interface ModuleMetadata {
  imports?: any[];
  controllers?: any[];
  providers?: any[];
  exports?: any[];
}

export function Module(metadata: ModuleMetadata): ClassDecorator {
  return (target: Function) => {
    for (const property in metadata) {
      if (metadata.hasOwnProperty(property)) {
        Reflect.defineMetadata(property, (metadata as any)[property], target);
      }
    }
  };
}
