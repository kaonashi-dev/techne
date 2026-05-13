import { HttpException, type HttpExceptionOptions } from "./http-exception";

export class BadRequestException extends HttpException {
  constructor(message: string = "Bad Request", options?: HttpExceptionOptions) {
    super(400, message, options ?? "Bad Request");
    if (options) this.error = "Bad Request";
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message: string = "Unauthorized", options?: HttpExceptionOptions) {
    super(401, message, options ?? "Unauthorized");
    if (options) this.error = "Unauthorized";
  }
}

export class ForbiddenException extends HttpException {
  constructor(message: string = "Forbidden resource", options?: HttpExceptionOptions) {
    super(403, message, options ?? "Forbidden");
    if (options) this.error = "Forbidden";
  }
}

export class NotFoundException extends HttpException {
  constructor(message: string = "Not Found", options?: HttpExceptionOptions) {
    super(404, message, options ?? "Not Found");
    if (options) this.error = "Not Found";
  }
}

export class ConflictException extends HttpException {
  constructor(message: string = "Conflict", options?: HttpExceptionOptions) {
    super(409, message, options ?? "Conflict");
    if (options) this.error = "Conflict";
  }
}

export class GoneException extends HttpException {
  constructor(message: string = "Gone", options?: HttpExceptionOptions) {
    super(410, message, options ?? "Gone");
    if (options) this.error = "Gone";
  }
}

export class UnprocessableEntityException extends HttpException {
  constructor(message: string = "Unprocessable Entity", options?: HttpExceptionOptions) {
    super(422, message, options ?? "Unprocessable Entity");
    if (options) this.error = "Unprocessable Entity";
  }
}

export class TooManyRequestsException extends HttpException {
  constructor(message: string = "Too Many Requests", options?: HttpExceptionOptions) {
    super(429, message, options ?? "Too Many Requests");
    if (options) this.error = "Too Many Requests";
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(message: string = "Internal Server Error", options?: HttpExceptionOptions) {
    super(500, message, options ?? "Internal Server Error");
    if (options) this.error = "Internal Server Error";
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(message: string = "Service Unavailable", options?: HttpExceptionOptions) {
    super(503, message, options ?? "Service Unavailable");
    if (options) this.error = "Service Unavailable";
  }
}
