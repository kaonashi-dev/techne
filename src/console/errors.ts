export class ConsoleArgumentError extends Error {}
export class UnknownCommandError extends Error {
  constructor(public readonly name: string) {
    super(`Unknown command: ${name}`);
  }
}
