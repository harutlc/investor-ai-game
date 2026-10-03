import type { Logger } from 'pino';

export type CheckStatus = 'ok' | 'error';

export interface ProviderHealth {
  thinking: CheckStatus;
  decision: CheckStatus;
}

interface Pingable {
  readonly name: string;
  ping(): Promise<void>;
}

export interface ProviderHealthMonitorOptions {
  cacheMs: number;
  logger: Logger;
  timeoutMs?: number;
  now?: () => number;
}

/**
 * Cached reachability of the active providers for /api/health: probes hit external services (some paid),
 * so results are reused for `cacheMs`, and concurrent callers share one in-flight check.
 */
export class ProviderHealthMonitor {
  static readonly DEFAULT_TIMEOUT_MS = 3000;
  private cached: { value: ProviderHealth; at: number } | undefined;
  private inFlight: Promise<ProviderHealth> | undefined;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly providers: { thinking: Pingable; decision: Pingable },
    private readonly options: ProviderHealthMonitorOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? ProviderHealthMonitor.DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  status(): Promise<ProviderHealth> {
    if (this.cached && this.now() - this.cached.at < this.options.cacheMs)
      return Promise.resolve(this.cached.value);
    this.inFlight ??= this.check()
      .then((value) => {
        this.cached = { value, at: this.now() };
        return value;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }

  private async check(): Promise<ProviderHealth> {
    const [thinking, decision] = await Promise.all([
      this.probe('thinking', this.providers.thinking),
      this.probe('decision', this.providers.decision),
    ]);
    return { thinking, decision };
  }

  private async probe(kind: keyof ProviderHealth, provider: Pingable): Promise<CheckStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
    });
    try {
      await Promise.race([provider.ping(), timeout]);
      return 'ok';
    } catch (error) {
      // Provider identity goes to the logs only; the health response never names it.
      this.options.logger.warn(
        { kind, provider: provider.name, err: error instanceof Error ? error.message : String(error) },
        'provider health check failed',
      );
      return 'error';
    } finally {
      clearTimeout(timer);
    }
  }
}
