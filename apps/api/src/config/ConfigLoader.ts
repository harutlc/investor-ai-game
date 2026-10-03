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
  'secrets.anthropicApiKey': 'ANTHROPIC_API_KEY',
  'secrets.typesafeApiKey': 'TYPESAFE_API_KEY',
  'secrets.layaApiKey': 'LAYA_API_KEY',
};

interface EnvOverride {
  /** Dotted config path, any depth. */
  path: string;
  env: string;
  parse?: (raw: string) => unknown;
}

const commaList = (raw: string) =>
  raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** "true"/"false" become booleans; anything else is left for the schema to reject. */
const booleanFlag = (raw: string): unknown => {
  const value = raw.trim().toLowerCase();
  return value === 'true' ? true : value === 'false' ? false : raw;
};

/** Config values an environment variable may override (the env value wins). */
const ENV_OVERRIDES: readonly EnvOverride[] = [
  { path: 'server.port', env: 'PORT' },
  { path: 'cors.origins', env: 'CORS_ORIGINS', parse: commaList },
  { path: 'database.file', env: 'DATABASE_FILE' },
  { path: 'logging.level', env: 'LOG_LEVEL' },
  { path: 'security.csrf.enabled', env: 'CSRF_ENABLED', parse: booleanFlag },
  { path: 'llm.thinking.provider', env: 'THINKING_PROVIDER' },
  { path: 'llm.decision.provider', env: 'DECISION_PROVIDER' },
  { path: 'llm.thinking.providers.ollama.baseUrl', env: 'OLLAMA_BASE_URL' },
  { path: 'llm.decision.providers.laya.baseUrl', env: 'LAYA_BASE_URL' },
];

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
    const overridden = new Map<string, string>();

    for (const { path: configPath, env: name, parse } of ENV_OVERRIDES) {
      const raw = env[name];
      if (raw === undefined) continue;
      ConfigLoader.setPath(file, configPath, parse ? parse(raw) : raw);
      overridden.set(configPath, name);
    }

    const result = AppConfigSchema.safeParse({
      ...file,
      nodeEnv: env.NODE_ENV ?? 'development',
      secrets: {
        cookieSecret: env.COOKIE_SECRET,
        csrfSecret: env.CSRF_SECRET,
        anthropicApiKey: env.ANTHROPIC_API_KEY,
        typesafeApiKey: env.TYPESAFE_API_KEY,
        layaApiKey: env.LAYA_API_KEY,
      },
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

  /** Sets `target.a.b.c = value`, creating intermediate objects (replacing non-objects) on the way. */
  private static setPath(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
    const keys = dottedPath.split('.');
    const last = keys.pop()!;
    let node = target;
    for (const key of keys) {
      const child = node[key];
      if (child === null || typeof child !== 'object' || Array.isArray(child)) node[key] = {};
      node = node[key] as Record<string, unknown>;
    }
    node[last] = value;
  }

  private describeIssues(error: z.ZodError, overridden: ReadonlyMap<string, string>): string[] {
    return error.issues.map((issue) => {
      const segments = issue.path.map(String);
      const dotted = segments.join('.');
      let name = ENV_NAMES[dotted] ?? (dotted || '(root)');
      // Attribute the issue to the env var that overrode the longest matching prefix of its path.
      for (let length = segments.length; length > 0; length--) {
        const envName = overridden.get(segments.slice(0, length).join('.'));
        if (envName) {
          name += ` (from ${envName})`;
          break;
        }
      }
      return `${name} ${issue.message}`;
    });
  }
}
