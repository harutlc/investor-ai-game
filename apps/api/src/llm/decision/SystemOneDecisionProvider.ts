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
import { LlmCallLogger, type LlmCallMeta, type LlmResponseInfo } from '../../logging/LlmCallLogger.js';
import { LlmPricing } from '../../logging/LlmPricing.js';
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
 *
 * Every call goes through `LlmCallLogger.run`, and the SDK calls the instrumented `fetch` once per attempt,
 * so retries, 429s and timeouts are logged without any logging here.
 */
export class SystemOneDecisionProvider implements DecisionProvider {
  private readonly client: TypeSafeClient;
  private readonly logger: Logger;
  private readonly fetch: typeof globalThis.fetch;
  private readonly calls: LlmCallLogger;

  constructor(
    readonly name: SystemOneName,
    private readonly settings: SystemOneSettings,
    private readonly apiKey: string | undefined,
    deps: ProviderDeps,
  ) {
    this.logger = deps.logger;
    // Hand-built providers (tests, scripts) get a logger without prices; the container passes the shared one.
    this.calls =
      deps.llmCalls ??
      new LlmCallLogger({ logger: deps.logger, pricing: new LlmPricing({}, deps.logger), logContent: false });
    const fetch = deps.fetch ?? globalThis.fetch;
    this.fetch = this.calls.instrumentFetch((input, init) => fetch(input, init));
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
    const meta: LlmCallMeta = {
      ...this.meta('decide', this.settings.timeoutMs),
      prompt: { state: request.state, questions: request.questions },
    };
    try {
      return await this.calls
        .run(
          meta,
          async () => {
            // Mapping runs inside the call: an answer the questions don't allow is a failed call, not a success.
            const { data, requestId } = await this.client
              .systemOne({
                state: request.state as Parameters<TypeSafeClient['systemOne']>[0]['state'],
                questions: request.questions as unknown as Questions,
              })
              .withResponse();
            const answers = DecisionAnswerMapper.map(request.questions, data.answers);
            // Typed as required, but tolerate a backend that omits usage rather than crash.
            const usage = data.usage as typeof data.usage | undefined;
            const result: DecisionResult<Q> = {
              provider: this.name,
              model: data.model,
              answers: answers as DecisionResult<Q>['answers'],
              usage: { inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 },
              latencyMs: Math.round(performance.now() - started),
            };
            return { result, requestId };
          },
          ({ result, requestId }) => SystemOneDecisionProvider.describe(result, requestId),
        )
        .then(({ result }) => result);
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  decideMany(requests: readonly DecisionRequest[]): Promise<DecisionResult[]> {
    return Promise.all(requests.map((request) => this.decide(request)));
  }

  async ping(): Promise<void> {
    try {
      await this.calls.run(
        this.meta('ping', PING_TIMEOUT_MS),
        () => this.probe(),
        () => ({}),
      );
    } catch (error) {
      throw this.toProviderError(error);
    }
  }

  private async probe(): Promise<void> {
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
  }

  private meta(operation: 'decide' | 'ping', timeoutMs: number): LlmCallMeta {
    // laya-serve is self-hosted: nothing to price.
    return {
      provider: this.name,
      operation,
      model: this.settings.model,
      priced: this.name === 'jev',
      timeoutMs,
    };
  }

  private static describe(result: DecisionResult, requestId: string | undefined): LlmResponseInfo {
    return {
      model: result.model,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      providerRequestId: requestId ?? null,
      answers: result.answers,
    };
  }

  /** LlmCallLogger has logged the failure (llm.call_failed); this only maps it to the API's error codes. */
  private toProviderError(error: unknown): unknown {
    if (error instanceof AppError) return error;
    if (error instanceof APIConnectionError) {
      return new ProviderUnavailableError(undefined, { cause: error });
    }
    if (error instanceof APIError) {
      if (error.status === 401 || error.status === 403) {
        // A hint for operators next to the llm.call_failed line, not a second report.
        this.logger.warn(
          { provider: this.name, status: error.status },
          `Decision provider rejected the credentials, check ${KEY_ENV[this.name]}`,
        );
        return new ProviderUnavailableError(undefined, { cause: error });
      }
      return error.status === 429 || error.status >= 500
        ? new ProviderUnavailableError(undefined, { cause: error })
        : new ProviderBadResponseError(undefined, { cause: error });
    }
    // Any other SDK error means the backend answered with something malformed.
    if (error instanceof TypeSafeError) {
      return new ProviderBadResponseError(undefined, { cause: error });
    }
    // fetch() failures and timeouts from the Laya health probe.
    if (error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')) {
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
