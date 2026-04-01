import { HttpException } from "./http-exception";

export class BadRequestException extends HttpException {
  constructor(message: string = "Bad Request") {
    super(400, message, "Bad Request");
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message: string = "Unauthorized") {
    super(401, message, "Unauthorized");
  }
}

export class ForbiddenException extends HttpException {
  constructor(message: string = "Forbidden resource") {
    super(403, message, "Forbidden");
  }
}

export class NotFoundException extends HttpException {
  constructor(message: string = "Not Found") {
    super(404, message, "Not Found");
  }
}

export class ConflictException extends HttpException {
  constructor(message: string = "Conflict") {
    super(409, message, "Conflict");
  }
}

export class GoneException extends HttpException {
  constructor(message: string = "Gone") {
    super(410, message, "Gone");
  }
}

export class UnprocessableEntityException extends HttpException {
  constructor(message: string = "Unprocessable Entity") {
    super(422, message, "Unprocessable Entity");
  }
}

export class TooManyRequestsException extends HttpException {
  constructor(message: string = "Too Many Requests") {
    super(429, message, "Too Many Requests");
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(message: string = "Internal Server Error") {
    super(500, message, "Internal Server Error");
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(message: string = "Service Unavailable") {
    super(503, message, "Service Unavailable");
  }
}
