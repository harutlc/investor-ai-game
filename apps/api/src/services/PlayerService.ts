import { randomUUID } from 'node:crypto';
import type { Player, PlayerRepository } from '../repositories/PlayerRepository.js';

export type Clock = () => Date;

export interface ResolvedPlayer {
  player: Player;
  /** True when the session cookie must be (re)issued: a new player, or a refreshed sliding expiry. */
  issueCookie: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Anonymous player identity: find the player behind a verified cookie, or mint a new one. */
export class PlayerService {
  /** `lastSeenAt` is written at most this often per player, to limit write load. */
  static readonly TOUCH_INTERVAL_MS = 60_000;

  constructor(
    private readonly players: PlayerRepository,
    private readonly clock: Clock = () => new Date(),
  ) {}

  /** @param verifiedId the player id from a cookie whose signature has already been verified, if any */
  async resolveOrCreate(verifiedId: string | undefined): Promise<ResolvedPlayer> {
    const now = this.clock();
    const existing =
      verifiedId && UUID.test(verifiedId) ? await this.players.findById(verifiedId) : undefined;

    if (!existing) {
      const player = await this.players.create({ id: randomUUID(), createdAt: now, lastSeenAt: now });
      return { player, issueCookie: true };
    }

    if (now.getTime() - existing.lastSeenAt.getTime() > PlayerService.TOUCH_INTERVAL_MS) {
      await this.players.touch(existing.id, now);
      return { player: { ...existing, lastSeenAt: now }, issueCookie: true };
    }
    return { player: existing, issueCookie: false };
  }
}
