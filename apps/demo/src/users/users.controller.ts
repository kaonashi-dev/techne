import {
  Body,
  Controller,
  CsrfExempt,
  Delete,
  Get,
  Headers,
  Middleware,
  OnResponse,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Version,
} from "../../../../src/common/index.ts";
import { CacheControlHook } from "../common/cache.hook";
import { requestLoggingMiddleware } from "../common/logging.middleware";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UsersService } from "./users.service";

/**
 * Full CRUD controller. Exercises every HTTP verb, route + query + path
 * parameters, header binding, DTO body validation, header-based versioning,
 * a controller-level middleware, and a response hook.
 */
@Controller("users")
@Version("1")
@CsrfExempt()
@Middleware(requestLoggingMiddleware)
@OnResponse(CacheControlHook)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("/")
  findAll(@Query("page") page?: string, @Query("limit") limit?: string) {
    return this.usersService.findAll(Number(page) || 1, Number(limit) || 10);
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Post("/")
  create(@Body(CreateUserDto) dto: CreateUserDto, @Headers("x-request-id") requestId?: string) {
    return { requestId: requestId ?? null, user: this.usersService.create(dto) };
  }

  @Put("/:id")
  replace(@Param("id") id: string, @Body(CreateUserDto) dto: CreateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Patch("/:id")
  update(@Param("id") id: string, @Body(UpdateUserDto) dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete("/:id")
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }
}
