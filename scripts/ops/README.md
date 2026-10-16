# Operations scripts

PowerShell helpers for running SpineFind. Run them from anywhere; each one moves to the repo root itself.
They read settings and secrets from `.env.local` and never print a secret.

| Script | What it does |
|---|---|
| `deploy.ps1` | Waits for the GitHub Actions image of the current `HEAD` on GHCR, switches the Azure container app to it, and waits until the new revision is healthy. Push to `main` first. |
| `run-enrich.ps1` | Runs `scripts/enrich.ts` (TMDB matching and enrichment) against the **dev** Neon branch; refuses production. Extra arguments pass through, e.g. `-Rest --dry-run`. |
| `run-enrich-prod.ps1` | The same against **production**, with `--production`. Only with intent: it writes to live data. |
| `run-import-imdb.ps1` | Imports the IMDb watch history as films seen (`scripts/import-imdb.ts`). Dev by default; `-Production` for live; `-Rest --dry-run` to preview. |
| `run-ask.ps1` | Asks the assistant one question against the dev branch: `.\scripts\ops\run-ask.ps1 "Which films have I watched the most?"` (a few pence a question). |
| `set-assistant-secrets.ps1` | Sets the assistant's secrets (`foundry-api-key`, `assistant-database-url`) and settings on the container app. Checks the database URL is production's read-only `spinefind_assistant` login. |
| `create-foundry.ps1` | One-off record of how the Foundry account `spinefind-ai` and the `claude-sonnet-5-5` deployment were created (Sweden Central, GlobalStandard). Re-running is idempotent. |

They call the 32-bit Azure CLI's Python directly (`C:\Program Files (x86)\Microsoft SDKs\Azure\CLI2\python.exe -IBm azure.cli`)
so values containing `&` (Neon connection strings) aren't cut short by `az.cmd`. Sign in with `az login` first.
