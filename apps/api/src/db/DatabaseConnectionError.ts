import type { DatabaseDialect } from '../config/AppConfigSchema.js';

/**
 * The database could not be reached or migrated at startup. The message names the dialect and host and
 * never the password, even when the driver's own message echoes the connection string.
 */
export class DatabaseConnectionError extends Error {
  readonly dialect: DatabaseDialect;
  readonly host: string | undefined;

  constructor(
    dialect: DatabaseDialect,
    location: { url?: string | undefined; file?: string | undefined },
    cause: unknown,
  ) {
    const host = location.url ? DatabaseConnectionError.host(location.url) : undefined;
    const where = host ?? location.file ?? 'unknown location';
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `could not open the ${dialect} database at ${where}: ${DatabaseConnectionError.scrub(reason, location.url)}`,
    );
    this.name = 'DatabaseConnectionError';
    this.dialect = dialect;
    this.host = host;
  }

  /** `host:port` of a connection URL, or undefined when it does not parse. */
  static host(url: string): string | undefined {
    try {
      const { hostname, port } = new URL(url);
      return port ? `${hostname}:${port}` : hostname;
    } catch {
      return undefined;
    }
  }

  /** Removes the URL and its password (raw and percent-decoded) from `text`. */
  static scrub(text: string, url: string | undefined): string {
    if (!url) return text;
    const secrets = [url];
    try {
      const { password } = new URL(url);
      if (password) secrets.push(password, decodeURIComponent(password));
    } catch {
      // An unparsable URL is removed whole.
    }
    return secrets.reduce((result, secret) => result.split(secret).join('[Redacted]'), text);
  }
}
