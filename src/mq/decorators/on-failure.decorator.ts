import "../../reflect-setup";
import { MQ_ON_FAILURE_METADATA } from "../../common/constants";
import {
  defineMetadataFromContext,
  getMetadataFromContext,
  isDecoratorContext,
} from "../../core/metadata-store";

/**
 * Bind a method to the failure lifecycle of a named job.
 *
 * When the named job fails its final attempt, the decorated method is called
 * with `(payload, error)`. Place this decorator on a method inside a
 * `@Processor` class.
 *
 * @example
 *   @Processor(MyQueueDef)
 *   class MyWorker {
 *     @On("my-job")
 *     async process(job: Job) { ... }
 *
 *     @OnFailure("my-job")
 *     async onMyJobFailed(payload: MyPayload, error: Error) { ... }
 *   }
 */
export function OnFailure(jobName: string): MethodDecorator {
  return (target: object, propertyKey: any, _descriptor?: PropertyDescriptor) => {
    if (isDecoratorContext(propertyKey) && propertyKey.metadata) {
      const existing =
        getMetadataFromContext<Record<string, string>>(
          propertyKey.metadata,
          MQ_ON_FAILURE_METADATA,
        ) || {};
      existing[String(propertyKey.name)] = jobName;
      defineMetadataFromContext(propertyKey.metadata, MQ_ON_FAILURE_METADATA, existing);
      return;
    }
    const existing = Reflect.getMetadata(MQ_ON_FAILURE_METADATA, target.constructor) || {};
    existing[String(propertyKey)] = jobName;
    Reflect.defineMetadata(MQ_ON_FAILURE_METADATA, existing, target.constructor);
  };
}
