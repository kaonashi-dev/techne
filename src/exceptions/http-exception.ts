export class HttpException extends Error {
  public readonly statusCode: number;
  public readonly error: string;

  constructor(statusCode: number, message: string, error: string = "Error") {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.error = error;
  }

  toJSON() {
    return {
      statusCode: this.statusCode,
      message: this.message,
      error: this.error,
    };
  }
}
