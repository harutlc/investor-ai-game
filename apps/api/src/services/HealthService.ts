import type { HealthDto } from '@investor/shared';
import type { Database } from '../db/Database.js';
import type { ProviderHealthMonitor } from '../llm/ProviderHealthMonitor.js';

export class HealthService {
  static readonly PING_TIMEOUT_MS = 2_000;

  constructor(
    private readonly database: Database,
    private readonly providers: ProviderHealthMonitor,
  ) {}

  /** Only the database decides `status`; provider outages are reported but never fail the probe. */
  async check(): Promise<HealthDto> {
    const database = await this.pingDatabase();
    const { thinking, decision } = await this.providers.status();
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      uptime: process.uptime(),
      checks: { database, thinking, decision },
    };
  }

  /** A hung server (or an exhausted pool) counts as down, so the probe always answers in time. */
  private async pingDatabase(): Promise<HealthDto['checks']['database']> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('database ping timed out')), HealthService.PING_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.database.ping(), timeout]);
      return 'ok';
    } catch {
      return 'error';
    } finally {
      clearTimeout(timer);
    }
  }
}
