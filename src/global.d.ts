declare namespace Reflect {
  function metadata(key: string, value: any): ClassDecorator & MethodDecorator;
  function defineMetadata(key: string, value: any, target: any, propertyKey?: string): void;
  function getMetadata(key: string, target: any, propertyKey?: string): any;
}
