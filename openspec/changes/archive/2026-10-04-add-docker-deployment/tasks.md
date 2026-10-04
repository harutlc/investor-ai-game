## 1. TRUST_PROXY env override

- [x] 1.1 Add a `trustProxy` parser to `apps/api/src/config/ConfigLoader.ts`:
  - `"false"` → `false`
  - digits → number
  - anything else → `commaList`
  - `"true"` is passed through unchanged

  Register `{ path: 'server.trustProxy', env: 'TRUST_PROXY' }` in `ENV_OVERRIDES`. Verify with `pnpm typecheck`.
- [x] 1.2 Extend `apps/api/test/config/ConfigLoader.test.ts` with these cases:
  - `TRUST_PROXY=1` → `1`
  - `TRUST_PROXY=10.0.0.0/8,172.16.0.0/12` → a two-item array
  - `TRUST_PROXY=false` → `false`
  - `TRUST_PROXY=true` → a `ConfigError` naming `server.trustProxy (from TRUST_PROXY)`

  Verify that `pnpm --filter @investor/api test` passes.
- [x] 1.3 Document `TRUST_PROXY` in `.env.example` and in the README configuration table. Verify by checking that both files list it with its accepted values.

## 2. Build context

- [x] 2.1 Add `.dockerignore` with the exclusions from design §7. Verify that the build context sent stays small and has no `.env`, `data` or `node_modules`. Run `docker build --target build .` and check the "transferring context" size.

## 3. Dockerfile

- [x] 3.1 Write the shared stages of the root `Dockerfile`:
  - `base`: `node:24-bookworm-slim` with `corepack enable`, `WORKDIR /app`.
  - `deps`: toolchain, then copy the workspace manifests and lockfile, then `pnpm install --frozen-lockfile`.
  - `build`: copy the sources, then `pnpm build && pnpm build:web`.

  Verify that `docker build --target build .` succeeds, and that changing only a `.ts` file reuses the cached `deps` layer.
- [x] 3.2 Add the `prod-deps` stage: toolchain plus manifests, then `pnpm install --frozen-lockfile --prod --filter @investor/api...`. Verify that `docker build --target prod-deps .` succeeds and that `node_modules/.pnpm` has `better-sqlite3` but no `vitest`, `tsx` or `typescript`.
- [x] 3.3 Add the `api` target (design §2):
  - Copy `node_modules` from `prod-deps`.
  - Copy the `dist` folders from `build`.
  - Copy the root `package.json`, `pnpm-workspace.yaml`, `config/` and `apps/api/src/db/migrations`.
  - Create `/app/data` owned by `node`, then `USER node` and `EXPOSE 3001`.
  - Use the exec-form `CMD ["node", "apps/api/dist/main.js"]`.

  Verify with `docker build --target api -t investor-api .`, then `docker run --rm -e COOKIE_SECRET=<32+ chars> -e NODE_ENV=development -e THINKING_PROVIDER=fake -e DECISION_PROVIDER=fake investor-api`, which logs "API listening". Also verify that `docker run --rm investor-api` exits non-zero and names `COOKIE_SECRET`.
- [x] 3.4 Add the `web` target: `nginxinc/nginx-unprivileged` (stable alpine) with an `ARG VITE_CSRF_ENABLED` passed to the build stage, `apps/web/dist` copied to `/usr/share/nginx/html`, and `docker/nginx.conf` copied in. Verify that `docker build --target web .` succeeds and the image runs as a non-root user.

## 4. nginx config

- [x] 4.1 Write `docker/nginx.conf` per design §4:
  - `/api/` proxy to `http://api:3001` with forwarded headers and 180-second timeouts.
  - `/assets/` cached as immutable.
  - SPA `try_files` fallback, with `index.html` `no-cache`.
  - gzip on, `server_tokens off`, listening on 8080.

  Verify that `nginx -t` passes inside the web image. Use `docker run --rm --add-host api:127.0.0.1 <web-image> nginx -t`, because nginx resolves the `api` upstream at startup.

## 5. Compose

- [x] 5.1 Write `docker-compose.yml` per design §6:
  - **`api`**: `target: api`, `env_file: .env`, and the pinned `environment:` values. Also `extra_hosts` host-gateway, `init: true`, `stop_grace_period: 15s`, the Node fetch healthcheck, the `game-data` volume at `/app/data`, and no published ports.
  - **`web`**: `target: web`, the `VITE_CSRF_ENABLED: ${CSRF_ENABLED:-}` build arg, `depends_on: api: service_healthy`, and `${WEB_PORT:-8080}:8080`.

  Verify that `docker compose config` renders without errors and shows `NODE_ENV=production` even when `.env` has `NODE_ENV=development`.
- [x] 5.2 Document the `DOCKER_NODE_ENV`, `DOCKER_OLLAMA_BASE_URL`, `DOCKER_LAYA_BASE_URL` and `WEB_PORT` compose variables in `.env.example`, in a clearly marked "Docker Compose" block. Verify by reading the file.

## 6. End-to-end verification

- [x] 6.1 Production path, after running `docker compose up --build`. Verify:
  - The `api` service reaches `healthy`.
  - `curl -i localhost:8080/api/health` returns 200 JSON.
  - `curl -i localhost:8080/games/x` returns 200 HTML.
  - Host port 3001 is not bound (`lsof -i :3001` is empty).
- [x] 6.2 Development override: `DOCKER_NODE_ENV=development THINKING_PROVIDER=fake DECISION_PROVIDER=fake docker compose up --build`. Play a game in the browser at `http://localhost:8080`: start a game, take a turn, then open the game's deep link after a reload.
- [x] 6.3 Persistence: start a game, run `docker compose down` (without `-v`) and `docker compose up --build`, then reload the browser. Verify the game is still in the list.
- [x] 6.4 Graceful stop: run `docker compose stop api`. Verify the logs show "shutdown complete" and `docker compose ps -a` reports exit code 0.
- [x] 6.5 Trust proxy: send more requests than the mutation limit with two different `X-Forwarded-For` values through nginx. Since nginx appends the real peer address, simulate two clients by running `curl` from the host and from a throwaway container on the compose network. Verify that only one client is limited (429), or confirm that the API log shows distinct `req.ip` values per client.
- [x] 6.6 Host provider, if Ollama is available: with Ollama on the host and `THINKING_PROVIDER=ollama`, verify that `curl localhost:8080/api/health` reports `checks.thinking: "ok"`.

## 7. Docs

- [x] 7.1 Add a README "Docker" section:
  - prerequisites;
  - `cp .env.example .env` plus `COOKIE_SECRET`;
  - `docker compose up --build` and the URL;
  - provider setup (host Ollama/laya-serve, `OLLAMA_HOST=0.0.0.0` on Linux, hosted keys);
  - the production cookie caveat and the `DOCKER_NODE_ENV=development` fake-provider demo;
  - CSRF build arg coupling;
  - data volume reset (`docker compose down -v`);
  - the single-replica limitation.

  Verify by following the section from a clean clone.
- [x] 7.2 Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` at the repo root. Verify that all pass.
