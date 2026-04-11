// `NotImplementedError` and the `notImplementedStore` factory.
//
// Slice 1 only implements the workspaces store; the seven other stores
// are surfaced as Proxies that throw `NotImplementedError` on every
// method call. The throw is intentional — these are programming
// errors, not business errors. Returning a `Result.err` would let
// calling code paper over a missing impl; throwing forces the next
// slice that needs the store to actually wire it up.

export class NotImplementedError extends Error {
  constructor(member: string) {
    super(`${member} is not implemented in @cobook/storage-memory yet`);
    this.name = "NotImplementedError";
  }
}

/**
 * Build a stand-in store whose every method throws `NotImplementedError`.
 * Each future slice replaces one of these with a real impl as it needs it.
 */
export function notImplementedStore<T extends object>(storeName: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const name = `${storeName}.${String(prop)}`;
      return () => {
        throw new NotImplementedError(name);
      };
    },
  });
}
