import { existsSync } from 'node:fs';
import path from 'node:path';

/** Locates the monorepo root (the directory holding `pnpm-workspace.yaml`). */
export class WorkspaceRoot {
  static readonly MARKER = 'pnpm-workspace.yaml';

  static find(startDir: string = process.cwd()): string {
    let dir = path.resolve(startDir);
    for (;;) {
      if (existsSync(path.join(dir, WorkspaceRoot.MARKER))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) {
        throw new Error(`Could not find ${WorkspaceRoot.MARKER} in ${startDir} or any parent directory`);
      }
      dir = parent;
    }
  }
}
