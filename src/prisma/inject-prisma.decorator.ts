import { Inject } from "../decorators/inject.decorator";
import { PRISMA_CLIENT } from "./tokens";

export const InjectPrisma = (): ParameterDecorator => Inject(PRISMA_CLIENT);
