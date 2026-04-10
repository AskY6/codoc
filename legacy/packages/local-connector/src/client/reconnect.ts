const DEFAULT_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const

export class ReconnectBackoff {
  private attempt = 0

  reset(): void {
    this.attempt = 0
  }

  nextDelayMs(): number {
    const index = Math.min(this.attempt, DEFAULT_DELAYS_MS.length - 1)
    this.attempt += 1
    const baseDelay = DEFAULT_DELAYS_MS[index] ?? DEFAULT_DELAYS_MS[DEFAULT_DELAYS_MS.length - 1]!
    const jitter = Math.floor(Math.random() * 100)
    return baseDelay + jitter
  }
}
