export abstract class ClientProxy {
  abstract connect(): Promise<void>;
  abstract close(): Promise<void>;
  abstract send<T = any>(pattern: string, data: any): Promise<T>;
  abstract emit(pattern: string, data: any): Promise<void> | void;
}
