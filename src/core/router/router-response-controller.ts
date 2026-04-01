import { HttpException, InternalServerErrorException } from "../../exceptions";

export class RouterResponseController {
  public mapException(context: any, error: unknown) {
    const exception =
      error instanceof HttpException
        ? error
        : new InternalServerErrorException("Internal Server Error");
    context.set.status = exception.statusCode;
    return exception.toJSON();
  }
}
