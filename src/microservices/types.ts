export interface MicroserviceOptions {
  transport: "local" | "redis";
  options?: Record<string, any>;
}

export interface MessagePayload<T = any> {
  pattern: string;
  data: T;
  id: string;
  timestamp: number;
}

export interface MicroserviceResponse<T = any> {
  id: string;
  data?: T;
  error?: {
    status: number;
    message: string;
  };
}

export type MessageHandler = (data: any) => Promise<any> | any;
