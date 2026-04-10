export class ParseError extends Error {
  override readonly name = "ParseError";
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(message);
  }
}

export class RefError extends Error {
  override readonly name = "RefError";
  constructor(
    message: string,
    public readonly ref?: string,
  ) {
    super(message);
  }
}

export class InvalidTransition extends Error {
  override readonly name = "InvalidTransition";
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Invalid state transition: ${from} → ${to}`);
  }
}
