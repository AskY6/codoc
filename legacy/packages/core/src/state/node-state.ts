import { InvalidTransition } from "../errors.js";

export type State = "idle" | "computing" | "ready" | "dirty" | "error";

const VALID_TRANSITIONS: Record<State, ReadonlySet<State>> = {
  idle: new Set<State>(["computing", "error"]),
  computing: new Set<State>(["ready", "error"]),
  ready: new Set<State>(["dirty"]),
  dirty: new Set<State>(["computing"]),
  error: new Set<State>(["computing", "idle"]),
};

export class NodeState {
  private _current: State;

  constructor(initial: State = "idle") {
    this._current = initial;
  }

  get current(): State {
    return this._current;
  }

  transition(to: State): void {
    if (!VALID_TRANSITIONS[this._current].has(to)) {
      throw new InvalidTransition(this._current, to);
    }
    this._current = to;
  }
}
