import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import type { z } from 'zod';
import { deepFreeze, type AppConfig } from './AppConfig.js';
import { AppConfigSchema } from './AppConfigSchema.js';
import { ConfigError } from './ConfigError.js';

export interface ConfigLoaderOptions {
  /** Monorepo root; relative paths (config file, database file) resolve against it. */
  rootDir: string;
  /** Environment to read; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Read `<rootDir>/.env` (real environment variables still win). Defaults to true. */
  loadDotenv?: boolean;
}

type Env = Record<string, string | undefined>;

/** Config paths that are named by their environment variable in error messages. */
const ENV_NAMES: Record<string, string> = {
  nodeEnv: 'NODE_ENV',
  'secrets.cookieSecret': 'COOKIE_SECRET',
  'secrets.csrfSecret': 'CSRF_SECRET',
};

/** Config paths an environment variable may override. */
const ENV_OVERRIDES: Record<string, string> = {
  'server.port': 'PORT',
  'cors.origins': 'CORS_ORIGINS',
  'database.file': 'DATABASE_FILE',
  'logging.level': 'LOG_LEVEL',
};

const DEFAULT_CONFIG_PATH = 'config/app.config.json';
const IN_MEMORY_DB = ':memory:';

/** Loads `config/app.config.json` + environment, applies env overrides and validates the result. */
export class ConfigLoader {
  private readonly rootDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly loadDotenv: boolean;

  constructor(options: ConfigLoaderOptions) {
    this.rootDir = options.rootDir;
    this.env = options.env ?? process.env;
    this.loadDotenv = options.loadDotenv ?? true;
  }

  load(): AppConfig {
    const env = this.readEnv();
    const file = this.readConfigFile(env);
    const overridden = new Set<string>();

    const set = (configPath: string, value: unknown) => {
      overridden.add(configPath);
      const [section, key] = configPath.split('.') as [string, string];
      const target = (file[section] ??= {}) as Record<string, unknown>;
      target[key] = value;
    };

    if (env.PORT !== undefined) set('server.port', env.PORT);
    if (env.CORS_ORIGINS !== undefined) {
      set(
        'cors.origins',
        env.CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      );
    }
    if (env.DATABASE_FILE !== undefined) set('database.file', env.DATABASE_FILE);
    if (env.LOG_LEVEL !== undefined) set('logging.level', env.LOG_LEVEL);

    const result = AppConfigSchema.safeParse({
      ...file,
      nodeEnv: env.NODE_ENV ?? 'development',
      secrets: { cookieSecret: env.COOKIE_SECRET, csrfSecret: env.CSRF_SECRET },
    });
    if (!result.success) throw new ConfigError(this.describeIssues(result.error, overridden));

    const config = result.data;
    if (config.database.file !== IN_MEMORY_DB) {
      config.database.file = path.resolve(this.rootDir, config.database.file);
    }
    return deepFreeze({ ...config, isProduction: config.nodeEnv === 'production', rootDir: this.rootDir });
  }

  /** Process env merged over `.env`; empty strings count as unset. */
  private readEnv(): Env {
    const fromFile = this.loadDotenv ? this.readDotenv() : {};
    const merged: Env = { ...fromFile, ...this.env };
    for (const [key, value] of Object.entries(merged)) {
      if (value === undefined || value.trim() === '') delete merged[key];
    }
    return merged;
  }

  private readDotenv(): Env {
    try {
      return parseDotenv(readFileSync(path.join(this.rootDir, '.env')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw new ConfigError([`.env could not be read: ${(error as Error).message}`]);
    }
  }

  private readConfigFile(env: Env): Record<string, unknown> {
    const filePath = path.resolve(this.rootDir, env.APP_CONFIG_PATH ?? DEFAULT_CONFIG_PATH);
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      throw new ConfigError([`config file not found or unreadable: ${filePath}`]);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ConfigError([`config file is not valid JSON (${filePath}): ${(error as Error).message}`]);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ConfigError([`config file must contain a JSON object: ${filePath}`]);
    }
    return parsed as Record<string, unknown>;
  }

  private describeIssues(error: z.ZodError, overridden: ReadonlySet<string>): string[] {
    return error.issues.map((issue) => {
      const dotted = issue.path.map(String).join('.');
      const base = issue.path.slice(0, 2).map(String).join('.');
      let name = ENV_NAMES[dotted] ?? (dotted || '(root)');
      const envName = ENV_OVERRIDES[base];
      if (envName && overridden.has(base)) name += ` (from ${envName})`;
      return `${name} ${issue.message}`;
    });
  }
}
