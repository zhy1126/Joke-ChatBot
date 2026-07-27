# Secure DeepSeek backend deployment

The GitHub Pages site cannot safely call DeepSeek directly: any key placed in
browser JavaScript can be copied and abused. The supported architecture is:

```text
GitHub Pages -> Cloudflare Worker -> DeepSeek API
                         |
                         +-> D1 experiment database
```

## Before deployment

If an API key has ever been pasted into a chat, issue, screenshot, log, or
frontend field, revoke it in the DeepSeek console and create a new one. Do not
reuse the exposed value.

Install Node.js and sign in to a Cloudflare account:

```bash
npx wrangler login
```

## 1. Provision D1

The D1 binding in `worker/wrangler.toml` intentionally contains only
`binding = "DB"`. Wrangler 4.45 or newer automatically provisions and binds the
database on the first deployment. After deployment, the migration command uses
the binding name `DB`, so no account-specific database ID needs to be committed.

## 2. Bind the encrypted DeepSeek secret

This repository is configured for the account-level Cloudflare Secrets Store
shown in `worker/wrangler.toml`:

- binding variable: `DEEPSEEK_API_KEY`;
- store resource ID: the non-secret ID copied from the Cloudflare URL; and
- account secret name: `API-Key`.

In Cloudflare, confirm that `API-Key` has the **Workers** permission scope and
contains a newly rotated DeepSeek key. The Worker reads the value asynchronously
through the binding; the value is never written to this repository.

Create the separate researcher credential as a per-Worker encrypted secret.
This command prompts interactively:

```bash
npx wrangler secret put RESEARCHER_KEY --config worker/wrangler.toml
```

Use a different long, random value for `RESEARCHER_KEY`. If the account-level
store binding is not desired, remove `[[secrets_store_secrets]]` and create
`DEEPSEEK_API_KEY` with `wrangler secret put` instead; the Worker supports both
forms.

## 3. Deploy the Worker

```bash
npm run worker:deploy
```

For Cloudflare Workers Builds connected to this GitHub repository, leave the
optional build command blank and use `npm run worker:deploy` as the deploy
command. The script deploys first so D1 can be provisioned, then applies the
tracked schema migration.

Copy the resulting HTTPS Worker URL and verify:

```text
https://YOUR-WORKER.workers.dev/api/health
```

The response should name `deepseek-v4-flash` and show both API and database
configuration as available. It never returns either secret.

## 4. Connect GitHub Pages

Edit `site/js/runtime-config.js`:

```js
globalThis.WORKCHAT_RUNTIME = Object.freeze({
  apiBaseUrl: "https://YOUR-WORKER.workers.dev",
  modelLabel: "DeepSeek V4 Flash",
});
```

Commit and push the change. GitHub Actions will redeploy the existing GitHub
Pages site.

Open the researcher dashboard, enter the separate `RESEARCHER_KEY`, and select
**Connect secure backend**. Do not enter the DeepSeek API key in the webpage.
The Worker URL is read-only in the dashboard and can be changed only through a
reviewed update to `runtime-config.js`.

## Validation checklist

- Create a `Participant blind card choice` session.
- Open its participant link in a separate browser profile.
- Confirm the participant sees A/B/C but no condition terminology.
- Choose Chinese and verify the opening and ordinary responses are Chinese.
- Reach the joke stage and verify exactly one context-aware reaction is
  delivered.
- Confirm the researcher export contains all three generated candidates and one
  shared canonical follow-up for audit.
- Verify the researcher export contains the condition and chosen card.
- Inspect the participant network responses and confirm no condition or mapping
  appears.
- Test an unapproved origin and confirm it receives HTTP 403.

## Cost and abuse controls

Only an authenticated researcher can create participant sessions. Each session
has a configurable hard message limit (24 by default), output is capped at 180
tokens per model call, requests time out after 20 seconds, and the Worker accepts
browser calls only from the configured GitHub Pages and local-development
origins.
