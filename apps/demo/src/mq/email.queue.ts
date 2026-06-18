import { defineQueue } from "../../../../src/mq/index.ts";
import { SendEmailDto } from "./send-email.dto";

export interface SendEmailPayload {
  to: string;
  subject: string;
}

/**
 * Typed queue contract. `validate: "dispatch"` compiles the DTO once at boot
 * and rejects bad payloads synchronously at `queue.add(...)` time.
 */
export const EmailQueue = defineQueue(
  {
    name: "emails",
    jobs: { send: {} as SendEmailPayload },
    schemas: { send: SendEmailDto },
  },
  { validate: "dispatch" },
);
