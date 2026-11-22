---
name: deploy-bare-metal
description: Configure the docling service's env files (env/.env.docling, env/.env.docling-mcp) and bring the docling stack up on a bare-metal GPU host, from preflight checks through verification. Use when asked to set up, fill in, check, deploy, or start the docling service (Docling Serve and docling-mcp) on a new or existing server.
---

# Deploy the docling service on bare metal

Goal: `docling` (Docling Serve, GPU) and `docling-mcp` (MCP server) are running, their env files are
complete and consistent, and `/api/mcp/docling` answers through nginx.

This skill covers the docling service only. The root stack must already be running or configured
(Keycloak, nginx, certs, agent-service) and the line service must be configured, because `docling-mcp`
sends chat events through it. For the whole host, use the root skill `.claude/skills/deploy-bare-metal/SKILL.md`
and `doc/QUICKSTART.md`.

`doc/QUICKSTART.md` sections 3.2.4 (agent-service MCP values) and 3.2.9 (`env/.env.docling`) are the source of
truth. This skill adds the order of work, the safety rules, and the checks.

## Ground rules

- **Do not read secrets.** Never open `env/.env.docling-mcp`, `env/.env.docling`, `.env`, or any other
  `env/.env.*` file except the `*.example` templates and `env/.env.dev`. Never print a secret value. Write
  values with the helpers in step 3, and show only names, `match`/`mismatch`, or counts.
- **Do not overwrite a filled file.** Create a file from its template only when it is missing. For an
  existing file, edit only the keys that step 4 reports as wrong or empty.
- **Keep shared values equal by copying them by name.** `INTERNAL_API_TOKEN` must match the line service,
  and the MCP JWT values must match agent-service. Never type them again.
- **Do not change the stack's shape.** Do not add `ports:`, services, or literal values to the compose
  files. Config goes in env files. Do not add services without approval.
- **Do not remove the GPU reservation** from `docker-compose.yml` to make the stack start. Ask the user first.
- **Report faithfully.** Show the check output. Do not say the stack is healthy until `docker compose ps`
  says so.

## Step 0: Preflight (read-only)

Run from the repo root. Stop and report the first failure. Do not work around it.

```sh
docker compose version
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader   # GPU present?
docker network ls --format '{{.Name}}' | grep -x private-ai-stack_backend        # root stack running?
test -s certs/ca-bundle.crt && echo "ca-bundle ok" || echo "ca-bundle missing"  # made by nginx/gen-certs.sh
test -s .env && echo ".env present"
test -s services/line/env/.env.line && echo "line env present"
test -s env/.env.agent-service && echo "agent-service env present"
sudo ss -ltnp | grep -E ':(80|443)\s' || echo "80/443 free or owned by nginx"
```

- `nvidia-smi` fails: the docling GPU reservation cannot start. Stop. Do not edit the compose file.
- `private-ai-stack_backend` missing: start the root stack first (`./start.sh prod`).
- `ca-bundle` missing: run the root stack first, so the `certs` service writes it (QUICKSTART section 5).
- A `present` line that is missing means that file has not been configured yet. Configure it first.
- The stack may already be running on this host. Check it, and do not assume it is a fresh install:

  ```sh
  docker ps --format '{{.Names}}\t{{.Status}}' | grep docling
  ```

  If `docling` and `docling-mcp` already run, `./start.sh` only recreates containers whose config changed.
  Step 6 still must pass.

Also check that the GPU is visible to containers. This is the same test as the root skill's step 3:

```sh
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi >/dev/null && echo "container GPU ok"
```

If this fails, follow the root skill's step 3 (NVIDIA Container Toolkit), with the user's approval.

## Step 1: Inventory (names only)

From `services/docling/`:

```sh
ls env/
git status --short
```

| Template | Filled file | Notes |
| --- | --- | --- |
| `env/.env.docling.example` | `env/.env.docling` | Docling Serve settings |
| `env/.env.docling-mcp.example` | `env/.env.docling-mcp` | MCP settings |

Report which filled files exist. Do not print their content.

## Step 2: Create missing files

Only create a file that is missing. Never copy onto an existing file:

```sh
[ -e env/.env.docling ]      || cp env/.env.docling.example env/.env.docling
[ -e env/.env.docling-mcp ]  || cp env/.env.docling-mcp.example env/.env.docling-mcp
chmod 600 env/.env.docling env/.env.docling-mcp
```

## Step 3: Fill the values

Put these helpers in the shell first. They print nothing:

```sh
# set_val <file> <KEY> <value>: writes the value and prints nothing.
set_val() { sed -i "s|^$2=.*|$2=$3|" "$1"; }

# copy_val <src-file> <SRC_KEY> <dst-file> <DST_KEY>: copies one value by name, prints nothing.
copy_val() { v=$(grep -h "^$2=" "$1" | head -1 | cut -d= -f2-); set_val "$3" "$4" "$v"; }
```

Values must not contain `|` or `&`, because `sed` treats `&` as "the matched text". Check a source
value first with `grep -c '&' <file>`, printing only the count.

### `env/.env.docling`

| Key | Value | How |
| --- | --- | --- |
| `DOCLING_SERVE_ENABLE_UI` | `false` | `set_val`. Use `true` only when the user wants the Docling web UI and accepts the caveat below. |

**UI on `/docling/`.** nginx serves Docling Serve at `${APP_HOST}/docling/` with the prefix stripped.
Checked live: `/docling/` redirects (307) to `/docling/ui/`, and `/docling/ui/` returns 200 through
nginx, so the UI works under the prefix. `true` is safe when the user wants the UI. The root
`.env.example` still lists `DOCLING_HOST` and `DOCLING_PUBLIC_URL`, but the current nginx template does
not use `DOCLING_HOST`, so do not rely on it. QUICKSTART section 3.2.9 still says to use `DOCLING_HOST`
for the UI, and that text is out of date.

### `env/.env.docling-mcp`

Copy the JWT and auth values from agent-service, so both services check the same tokens:

```sh
copy_val env/.env.agent-service MCP_JWKS_URL      env/.env.docling-mcp MCP_JWKS_URL
copy_val env/.env.agent-service MCP_JWT_ISSUER    env/.env.docling-mcp MCP_JWT_ISSUER
copy_val env/.env.agent-service MCP_JWT_AUDIENCE  env/.env.docling-mcp MCP_JWT_AUDIENCE
copy_val env/.env.agent-service OIDC_ISSUER       env/.env.docling-mcp OIDC_ISSUER
copy_val .env                   APP_PUBLIC_URL    env/.env.docling-mcp APP_PUBLIC_URL
copy_val services/line/env/.env.line INTERNAL_API_TOKEN env/.env.docling-mcp INTERNAL_API_TOKEN
```

`MCP_JWT_AUDIENCE` may be empty, as QUICKSTART says. The copy keeps it the same as agent-service, which is
correct. If the source is empty, the copy is empty too.

Fixed values:

```sh
set_val env/.env.docling-mcp DOCLING_API_URL http://docling:5001
set_val env/.env.docling-mcp LINE_SERVICE_URL http://line:3000
set_val env/.env.docling-mcp DOCLING_TIMEOUT_SECONDS 300   # code default (mcp/lib/docling/client.ts)
```

Do not set `DOCLING_HOST` for the MCP. The MCP talks to `docling` on the backend network.

**`INTERNAL_API_TOKEN` is a blocker if the line file has no value.** The copy above only copies. If
`services/line/env/.env.line` has an empty `INTERNAL_API_TOKEN`, stop this step and tell the user. The line
service must be configured first, and the token is shared between the line service and docling-mcp. Do not
generate a token here without the user's approval, because a new token in one file breaks the other.
Also note that `env/.env.agent-service` does not define `INTERNAL_API_TOKEN`. Do not copy it from there.

**Empty MCP keys cause a 500.** If `MCP_JWT_ISSUER` or `MCP_JWKS_URL` is empty, docling-mcp returns
`500 MCP authentication is not configured` for every request. It fails closed. Step 6 checks for this.

## Step 4: Verify by name and shape, not by value

1. **Empty values.** Print only names:

   ```sh
   grep -HE '^[A-Z_0-9]+=$' env/.env.docling env/.env.docling-mcp
   ```

   The only allowed empty key is `MCP_JWT_AUDIENCE`, when agent-service also leaves it empty. Anything
   else is a failure to fix.

2. **Shared-value matches.** Print `match` or `mismatch` only:

   ```sh
   a=$(grep -h '^INTERNAL_API_TOKEN=' env/.env.docling-mcp | cut -d= -f2-)
   b=$(grep -h '^INTERNAL_API_TOKEN=' services/line/env/.env.line | cut -d= -f2-)
   [ -n "$a" ] && [ "$a" = "$b" ] && echo "INTERNAL_API_TOKEN match" || echo "INTERNAL_API_TOKEN mismatch"
   unset a b
   ```

   Repeat for `MCP_JWKS_URL` and `OIDC_ISSUER` against `env/.env.agent-service`. Use `match` only when both
   values are non-empty.

3. **Timezone.** Docling has no timezone setting in this stack. Skip this check.

4. **No published ports.** The compose files must not publish ports for docling:

   ```sh
   grep -n 'ports:' docker-compose.yml docker-compose.dev.yml && echo "FAIL: ports found" || echo "no ports"
   ```

5. **Compose reads the files.** Run from `services/docling/`. Do not paste the output, because it shows the
   secrets:

   ```sh
   docker compose -f docker-compose.yml config --quiet && echo "compose config ok"
   ```

## Step 5: Start the service

From the repo root, after the root stack is up:

```sh
./start.sh prod docling          # or: ./start.sh dev docling (docling-mcp with hot reload)
docker compose --env-file .env -f services/docling/docker-compose.yml ps
```

The first start pulls the `docling-serve-cu130` image, which is large, and builds `docling-mcp`. This can
take a long time. Watch the logs:

```sh
docker compose -f services/docling/docker-compose.yml logs --tail=100 docling
docker compose -f services/docling/docker-compose.yml logs --tail=100 docling-mcp
```

Fix the cause in the env file or the host, then run `./start.sh prod docling` again.

## Step 6: Verify

1. **Containers.** `docling` must be `running`. `docling-mcp` must be `healthy`:

   ```sh
   docker compose --env-file .env -f services/docling/docker-compose.yml ps
   ```

2. **MCP health, inside the network:**

   ```sh
   docker compose --env-file .env -f services/docling/docker-compose.yml exec docling-mcp wget -qO- http://127.0.0.1:3000/healthz
   ```

3. **Docling Serve reachable from the MCP container.** The health path is `/health` (checked: 200).
   `/healthz` returns 404 on Docling Serve, so do not use it:

   ```sh
   docker compose --env-file .env -f services/docling/docker-compose.yml exec docling-mcp wget -qO- http://docling:5001/health
   ```

4. **Through nginx.** Read the hostname by name into a variable, then send requests. The MCP route
   takes POST (a GET returns 405). The expected results are:

   - `401` with no bearer token: auth is configured and the route works.
   - `500` with `MCP authentication is not configured`: `MCP_JWT_ISSUER` or `MCP_JWKS_URL` is empty.
     Go back to step 3. Do not continue.

   ```sh
   APP_HOST=$(grep -h '^APP_HOST=' .env | cut -d= -f2-)
   curl -sk -o /dev/null -w 'mcp POST (no token): %{http_code}\n' -X POST \
     -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' "https://$APP_HOST/api/mcp/docling"
   curl -skL -o /dev/null -w 'docling UI (follows redirect): %{http_code}\n' "https://$APP_HOST/docling/"
   unset APP_HOST
   ```

   Expect `401` for the first line and `200` for the second. Report the actual codes, and do not assume them.
   The `APP_HOST` value is set in the shell only, and it is never printed.

5. **Conversion (handoff).** A real conversion needs a signed-in user. Tell the user to call
   `convert_document_url` on a small PDF from an MCP client (Open WebUI) and confirm the Markdown comes back.
   The first conversion can be slow while Docling loads its models.

## Step 7: Operations

- **Restart policy.** Both containers use `restart: unless-stopped`, so the service comes back after a reboot.
- **Data.** `docling` has no volume in this stack, so it holds no state. Back up only `env/.env.docling` and
  `env/.env.docling-mcp`, and `certs/`. Losing them means re-entering the values. Losing `certs/` means the
  stack CA changes.
- **GPU.** `docling` reserves all NVIDIA GPUs. Ollama and Whisper need GPUs too. If they compete, stop
  and tell the user. Do not change the reservation without approval.

## Done when

- `env/.env.docling` and `env/.env.docling-mcp` exist with `chmod 600`. Their only empty keys are the ones
  allowed in step 4.
- The shared-value checks print `match`, and the compose config check passes.
- `docker compose ps` shows `docling` running and `docling-mcp` healthy.
- The health checks in step 6 return the expected codes, and the actual codes are reported. The MCP route
  returns `401` with no token, not `500`.
- The user knows the remaining manual step: a sign-in and one test conversion.

End with a short report: which files were created or edited, which values the user still has to set,
the actual check results from step 4 and step 6, and any caveat that applies (UI prefix, missing health
path). Do not include any secret value.
