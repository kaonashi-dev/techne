import { Dto, IsEmail, IsString, MinLength } from "../../../../src/common/index.ts";

/** Validated wire shape for the `emails:send` job. */
@Dto()
export class SendEmailDto {
  @IsEmail()
  to!: string;

  @IsString()
  @MinLength(1)
  subject!: string;
}
