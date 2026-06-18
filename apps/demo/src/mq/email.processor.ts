import { InjectLogger, Logger } from "../../../../src/common/index.ts";
import { type Job, MqProcess, MqProcessor } from "../../../../src/mq/index.ts";
import type { SendEmailPayload } from "./email.queue";

/**
 * Worker bound to the `emails` queue. With the default `mode: "all"`, the MQ
 * registry starts the worker automatically and routes `send` jobs here.
 */
@MqProcessor("emails")
export class EmailProcessor {
  constructor(@InjectLogger("EmailProcessor") private readonly logger: Logger) {}

  @MqProcess("send")
  async send(job: Job<SendEmailPayload>) {
    this.logger.log("delivering email", { to: job.data.to, subject: job.data.subject });
    return { delivered: job.data.to };
  }
}
