# Deploying to Hugging Face Spaces

The Space is a Docker Space built from `Dockerfile.space`. Hugging Face expects a
`Dockerfile` and a `README.md` with YAML front-matter at the root of the Space repo, so
the deploy copies:

| From this repo                 | To the Space repo |
| ------------------------------ | ----------------- |
| `Dockerfile.space`             | `Dockerfile`      |
| `deploy/huggingface/README.md` | `README.md`       |
| `backend/`, `frontend/`        | same paths        |

```bash
git clone https://huggingface.co/spaces/<user>/multiverse space && cd space
rsync -a --delete --exclude .git --exclude node_modules --exclude .venv --exclude dist \
  ../multiverse/backend ../multiverse/frontend ./
cp ../multiverse/Dockerfile.space Dockerfile
cp ../multiverse/.dockerignore ../multiverse/LICENSE ./
cp ../multiverse/deploy/huggingface/README.md README.md
git add -A && git commit -m "Deploy multiverse" && git push
```

## Space settings

**Secrets** (never commit these):

- None needed for demo mode. The public demo runs this way (`MULTIVERSE_PROVIDER=mock`),
  and visitors can add their own OpenAI key in the UI.
- Optional: `OPENAI_API_KEY` for a server-side key. A Gemini key only works if it can
  still use 2.x models, because newer Gemini models don't return logprobs.

**Variables** (optional; the defaults are baked into `Dockerfile.space`):

| Variable                        | Default | Meaning                                       |
| ------------------------------- | ------- | --------------------------------------------- |
| `MULTIVERSE_RATE_LIMIT_CALLS`   | `10`    | model calls per visitor (IP) per window       |
| `MULTIVERSE_RATE_LIMIT_WINDOW`  | `600`   | window length in seconds                      |
| `MULTIVERSE_DAILY_CALL_CAP`     | `500`   | global model calls per UTC day (server key)   |
| `MULTIVERSE_MAX_EXPLORE_NODES`  | `6`     | branches per auto-explore run                 |
| `MULTIVERSE_MAX_TOKENS_LIMIT`   | `120`   | server-side `max_tokens` cap                  |
| `MULTIVERSE_MAX_TOP_LOGPROBS`   | `10`    | server-side `top_logprobs` cap                |
| `MULTIVERSE_ALLOW_BYOK`         | `true`  | allow visitors to use their own keys          |
| `MULTIVERSE_BYOK_PROVIDERS`     | both    | e.g. `["openai"]` to hide Gemini              |
| `MULTIVERSE_TRUSTED_PROXY_HOPS` | `1`     | proxies in front of the app (for visitor IPs) |

Rate-limit state is in memory, which fits a single Space container. It resets when the
Space restarts.
