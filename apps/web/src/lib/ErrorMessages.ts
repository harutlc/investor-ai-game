import { ApiClientError } from '@/api/ApiClientError';

/** Player-facing text for a failed API call. */
export class ErrorMessages {
  static describe(error: unknown): string {
    if (!(error instanceof ApiClientError)) return 'Something went wrong. Please try again.';
    switch (error.code) {
      case 'NETWORK_ERROR':
        return "Can't reach the game server. Is the API running?";
      case 'PROVIDER_UNAVAILABLE':
      case 'PROVIDER_BAD_RESPONSE':
        return 'The investor is unavailable right now (the model provider did not answer). Try again in a moment.';
      case 'TURN_IN_PROGRESS':
        return 'Your previous move is still being processed. Wait a moment and try again.';
      case 'GAME_FINISHED':
        return 'This negotiation is already over.';
      case 'INVALID_MOVE':
        return 'That move is no longer available. Pick another one.';
      case 'RATE_LIMITED':
        return 'Too many requests. Slow down for a minute.';
      case 'CSRF_INVALID':
        return 'Your session expired. Reload the page and try again.';
      case 'BAD_RESPONSE':
        return 'The server sent an unexpected response.';
      default:
        return error.message || 'Something went wrong. Please try again.';
    }
  }

  /** True when the game does not exist for this player (or the id is malformed). */
  static isMissingGame(error: unknown): boolean {
    return error instanceof ApiClientError && (error.status === 404 || error.status === 400);
  }
}
