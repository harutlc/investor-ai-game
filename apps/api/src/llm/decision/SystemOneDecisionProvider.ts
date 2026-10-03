import {
  APIConnectionError,
  APIError,
  TypeSafeClient,
  TypeSafeError,
  type Logger as SdkLogger,
  type Questions,
} from '@typesafe-ai/sdk';
import type { Logger } from 'pino';
import type { AppConfig } from '../../config/AppConfig.js';
import { AppError } from '../../errors/AppError.js';
import { ProviderBadResponseError } from '../errors/ProviderBadResponseError.js';
import { ProviderUnavailableError } from '../errors/ProviderUnavailableError.js';
import type { ProviderDeps } from '../ProviderDeps.js';
import { DecisionAnswerMapper } from './DecisionAnswerMapper.js';
import {
  validateDecisionRequest,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResult,
  type QuestionSet,
} from './DecisionProvider.js';

type SystemOneSettings = AppConfig['llm']['decision']['providers']['jev'];
type SystemOneName = 'jev' | 'laya';

const PING_TIMEOUT_MS = 3000;
/** laya-serve ignores the bearer token when LAYA_API_KEY is unset; the SDK insists on some key. */
const KEYLESS_PLACEHOLDER = 'unused';
const KEY_ENV: Record<SystemOneName, string> = { jev: 'TYPESAFE_API_KEY', laya: 'LAYA_API_KEY' };

/**
 * Jev (hosted TypeSafe API) and Laya (self-hosted laya-serve) speak the same System One wire protocol,
 * so both use the official TypeSafe client, differing only in base URL, key and model. Every option is
 * passed explicitly: ConfigLoader does not export .env into process.env, so the SDK's TYPESAFE_* env
 * fallbacks would otherwise see the wrong (or no) values.
 */
export class SystemOneDecisionProvider implements DecisionProvider {
  private readonly client: TypeSafeClient;
  private readonly logger: Logger;
  private readonly fetch: typeof globalThis.fetch;

  constructor(
    readonly name: SystemOneName,
    private readonly settings: SystemOneSettings,
    private readonly apiKey: string | undefined,
    deps: ProviderDeps,
  ) {
    this.logger = deps.logger;
    this.fetch = deps.fetch ?? globalThis.fetch;
    this.client = new TypeSafeClient({
      apiKey: apiKey ?? KEYLESS_PLACEHOLDER,
      baseURL: settings.baseUrl,
      defaultModel: settings.model,
      timeout: settings.timeoutMs,
      retry: { maxRetries: settings.maxRetries },
      logLevel: 'warn',
      logger: SystemOneDecisionProvider.sdkLogger(deps.logger, name),
      fetch: this.fetch,
    });
  }

  async decide<const Q extends QuestionSet>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
    validateDecisionRequest(request);
    const started = performance.now();
    let result: Awaited<ReturnType<TypeSafeClient['systemOne']>>;
    try {
      result = await this.client.systemOne({
        state: request.state as Parameters<TypeSafeClient['systemOne']>[0]['state'],
        questions: request.questions as unknown as Questions,
      });
    } catch (error) {
      throw this.toProviderError(error);
    }
    const answers = DecisionAnswerMapper.map(request.questions, result.answers);
    return {
      provider: this.name,
      model: result.model,
      answers: answers as DecisionResult<Q>['answers'],
      // Typed as required, but tolerate a backend that omits usage rather than crash.
      usage: { inputTokens: (result.usage as typeof result.usage | undefined)?.input_tokens ?? 0 },
      latencyMs: Math.round(performance.now() - started),
    };
  }

  decideMany(requests: readonly DecisionRequest[]): Promise<DecisionResult[]> {
    return Promise.all(requests.map((request) => this.decide(request)));
  }

  async ping(): Promise<void> {
    try {
      if (this.name === 'jev') {
        // Lists models with the configured key: proves reachability and credentials, spends nothing.
        await this.client.models.list({ timeout: PING_TIMEOUT_MS, retry: { maxRetries: 0 } });
        return;
      }
      const response = await this.fetch(`${this.settings.baseUrl.replace(/\/+$/, '')}/health`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      if (!response.ok) throw new ProviderUnavailableError(`Laya health check answered ${response.status}`);
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  private toProviderError(error: unknown): unknown {
    if (error instanceof AppError) return error;
    if (error instanceof APIConnectionError) {
      this.logger.warn({ provider: this.name, err: error.message }, 'Decision provider unreachable');
      return new ProviderUnavailableError(undefined, { cause: error });
    }
    if (error instanceof APIError) {
      const context = { provider: this.name, status: error.status, requestId: error.requestId };
      if (error.status === 401 || error.status === 403) {
        this.logger.error(context, `Decision provider rejected the credentials, check ${KEY_ENV[this.name]}`);
        return new ProviderUnavailableError(undefined, { cause: error });
      }
      this.logger.warn({ ...context, err: error.message }, 'Decision request failed');
      return error.status === 429 || error.status >= 500
        ? new ProviderUnavailableError(undefined, { cause: error })
        : new ProviderBadResponseError(undefined, { cause: error });
    }
    // Any other SDK error means the backend answered with something malformed.
    if (error instanceof TypeSafeError) {
      this.logger.warn(
        { provider: this.name, err: error.message },
        'Decision provider returned a malformed response',
      );
      return new ProviderBadResponseError(undefined, { cause: error });
    }
    // fetch() failures and timeouts from the Laya health probe.
    if (error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')) {
      this.logger.warn({ provider: this.name, err: error.message }, 'Decision provider unreachable');
      return new ProviderUnavailableError(undefined, { cause: error });
    }
    return error;
  }

  /** Routes SDK log output into pino (the SDK redacts credential headers itself). */
  private static sdkLogger(logger: Logger, provider: SystemOneName): SdkLogger {
    const child = logger.child({ provider, sdk: 'typesafe' });
    return {
      debug: (message, ...args) => child.debug({ args }, message),
      info: (message, ...args) => child.info({ args }, message),
      warn: (message, ...args) => child.warn({ args }, message),
      error: (message, ...args) => child.error({ args }, message),
    };
  }
}
