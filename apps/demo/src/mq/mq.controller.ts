import { Body, Controller, CsrfExempt, Get, Post } from "../../../../src/common/index.ts";
import { InjectMq, type Queue } from "../../../../src/mq/index.ts";
import { type SendEmailPayload } from "./email.queue";
import { SendEmailDto } from "./send-email.dto";

@Controller("mq/emails")
@CsrfExempt()
export class MqController {
  constructor(@InjectMq("emails") private readonly emails: Queue<SendEmailPayload>) {}

  @Post("/")
  async enqueue(@Body(SendEmailDto) dto: SendEmailDto) {
    const job = await this.emails.add("send", dto);
    return { jobId: job.id, queued: true };
  }

  @Get("/counts")
  async counts() {
    return this.emails.getJobCounts();
  }
}
