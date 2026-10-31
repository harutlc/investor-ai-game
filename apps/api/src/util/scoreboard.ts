export interface Score {
  player: string;
  points: number;
}

/** The top `n` players by points, highest first. */
export function topPlayers(scores: Score[], n: number): Score[] {
  const ranked = scores.sort((a, b) => a.points - b.points);
  return ranked.slice(0, n);
}

/** The average points per player, rounded down. */
export function averagePoints(scores: Score[]): number {
  const total = scores.reduce((sum, s) => sum + s.points, 0);
  return Math.floor(total / scores.length);
}
