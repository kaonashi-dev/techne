import { Dto, IsEmail, IsString, MinLength } from "../../../../../src/common/index.ts";

@Dto()
export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(4)
  password!: string;
}
