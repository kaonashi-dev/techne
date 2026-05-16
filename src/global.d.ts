declare namespace Reflect {
  function metadata(key: PropertyKey, value: any): ClassDecorator & MethodDecorator;
  function defineMetadata(
    key: PropertyKey,
    value: any,
    target: any,
    propertyKey?: PropertyKey,
  ): void;
  function getMetadata(key: PropertyKey, target: any, propertyKey?: PropertyKey): any;
}

interface SymbolConstructor {
  readonly metadata: symbol;
}
