import {
  BnestFactory,
  Module,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Injectable,
  Schema,
} from "./index";

@Injectable()
class UserService {
  private users = [{ id: 1, name: "Alice" }];

  getAll() {
    return this.users;
  }

  getOne(id: number) {
    return this.users.find((u) => u.id === id);
  }

  create(user: any) {
    const newUser = { id: this.users.length + 1, ...user };
    this.users.push(newUser);
    return newUser;
  }
}

const CreateUserSchema = Schema.Object({
  name: Schema.String(),
});

@Controller("users")
class UserController {
  constructor(private userService: UserService) {}

  @Get("/")
  findAll() {
    return this.userService.getAll();
  }

  @Get("/:id")
  findOne(@Param("id") id: string) {
    return this.userService.getOne(parseInt(id));
  }

  @Post("/", { body: CreateUserSchema })
  create(@Body() body: any) {
    return this.userService.create(body);
  }
}

@Module({
  controllers: [UserController],
  providers: [UserService],
})
class AppModule {}

const app = BnestFactory.create(AppModule);

app.listen(3000, () => {
  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`);
});
