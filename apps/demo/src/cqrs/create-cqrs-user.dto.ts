import { Dto, IsEmail, IsString, MinLength } from "../../../../src/common/index.ts";

@Dto()
export class CreateCqrsUserDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEmail()
  email!: string;
}
