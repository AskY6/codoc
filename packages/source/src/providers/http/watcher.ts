// HTTP watcher: polling / ETag / Last-Modified change detection.
// Stub — will be implemented when watch orchestration is added.

export interface HttpWatcherOptions {
  url: string;
  intervalMs?: number;
}

export function createHttpWatcher(_options: HttpWatcherOptions): void {
  // TODO: implement polling with ETag / Last-Modified support
}
