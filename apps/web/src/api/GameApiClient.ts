import {
  ApiErrorSchema,
  CsrfTokenDtoSchema,
  DecisionInsightsDtoSchema,
  GameListDtoSchema,
  GameSessionDtoSchema,
  PersonaListDtoSchema,
  TurnResultDtoSchema,
  type CreateGameRequest,
  type DecisionInsightsDto,
  type GameListDto,
  type GameSessionDto,
  type PersonaListDto,
  type PlayTurnRequest,
  type TurnResultDto,
} from '@investor/shared';
import type { z } from 'zod';
import { ApiClientError } from './ApiClientError';
import { CsrfTokenStore } from './CsrfTokenStore';

type Method = 'GET' | 'POST';

export interface GameApiClientOptions {
  /** Prefix for every `/api/...` path; empty for same-origin requests. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

const CSRF_HEADER = 'X-CSRF-Token';

/**
 * Typed access to the game API. Every request carries the player's cookies; every response body is
 * parsed with the shared zod schemas before anyone sees it, so an unexpected field (a hidden number
 * added by mistake) fails as BAD_RESPONSE instead of reaching the screen.
 */
export class GameApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly csrf: CsrfTokenStore;

  constructor(options: GameApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    // Bound so the browser's fetch is never called with a foreign `this`.
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.csrf = new CsrfTokenStore(() => this.loadCsrfToken());
  }

  /** A client configured from `VITE_API_URL`. */
  static fromEnv(): GameApiClient {
    const baseUrl: unknown = import.meta.env.VITE_API_URL;
    return new GameApiClient({ baseUrl: typeof baseUrl === 'string' ? baseUrl : '' });
  }

  listPersonas(): Promise<PersonaListDto> {
    return this.request('GET', '/api/personas', PersonaListDtoSchema);
  }

  listGames(): Promise<GameListDto> {
    return this.request('GET', '/api/games', GameListDtoSchema);
  }

  getGame(id: string): Promise<GameSessionDto> {
    return this.request('GET', `/api/games/${encodeURIComponent(id)}`, GameSessionDtoSchema);
  }

  startGame(body: CreateGameRequest): Promise<GameSessionDto> {
    return this.request('POST', '/api/games', GameSessionDtoSchema, body);
  }

  playTurn(id: string, body: PlayTurnRequest): Promise<TurnResultDto> {
    return this.request('POST', `/api/games/${encodeURIComponent(id)}/turns`, TurnResultDtoSchema, body);
  }

  getInsights(id: string): Promise<DecisionInsightsDto> {
    return this.request('GET', `/api/games/${encodeURIComponent(id)}/insights`, DecisionInsightsDtoSchema);
  }

  private async request<S extends z.ZodType>(
    method: Method,
    path: string,
    schema: S,
    body?: unknown,
  ): Promise<z.output<S>> {
    if (method === 'GET') return this.parse(await this.send(method, path, body, null), schema);

    let response = await this.send(method, path, body, await this.csrf.token());
    if (response.status === 403 && (await GameApiClient.isCsrfRejection(response))) {
      // The token expired or the server turned CSRF on: one fresh token, one retry.
      this.csrf.invalidate();
      response = await this.send(method, path, body, await this.csrf.token());
    }
    return this.parse(response, schema);
  }

  private async send(
    method: Method,
    path: string,
    body: unknown,
    csrfToken: string | null,
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrfToken !== null) headers[CSRF_HEADER] = csrfToken;
    try {
      return await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        credentials: 'include',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new ApiClientError({
        code: 'NETWORK_ERROR',
        message: 'The game server could not be reached.',
        status: null,
        cause,
      });
    }
  }

  private async parse<S extends z.ZodType>(response: Response, schema: S): Promise<z.output<S>> {
    if (!response.ok) throw await GameApiClient.toError(response);
    const parsed = schema.safeParse(await GameApiClient.json(response));
    if (!parsed.success) {
      throw new ApiClientError({
        code: 'BAD_RESPONSE',
        message: 'The server sent a response this app does not understand.',
        status: response.status,
        requestId: response.headers.get('X-Request-Id'),
        details: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /** GET /api/csrf-token; 404 means CSRF is off on this server. */
  private async loadCsrfToken(): Promise<string | null> {
    const response = await this.send('GET', '/api/csrf-token', undefined, null);
    if (response.status === 404) return null;
    return (await this.parse(response, CsrfTokenDtoSchema)).csrfToken;
  }

  private static async isCsrfRejection(response: Response): Promise<boolean> {
    const envelope = ApiErrorSchema.safeParse(await GameApiClient.json(response.clone()));
    return envelope.success && envelope.data.error.code === 'CSRF_INVALID';
  }

  private static async toError(response: Response): Promise<ApiClientError> {
    const envelope = ApiErrorSchema.safeParse(await GameApiClient.json(response));
    if (!envelope.success) {
      return new ApiClientError({
        code: 'UNKNOWN',
        message: `The server answered ${response.status}.`,
        status: response.status,
        requestId: response.headers.get('X-Request-Id'),
      });
    }
    const { code, message, requestId, details } = envelope.data.error;
    return new ApiClientError({ code, message, status: response.status, requestId, details });
  }

  /** The body as JSON, or undefined when it is empty or not JSON. */
  private static async json(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    }
  }
}
