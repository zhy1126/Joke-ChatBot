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

The D1 binding in `worker/wrangler.toml` intentionally contains no account ID.
Before every deployment, `worker/prepare-deploy-config.mjs` lists the account's
D1 databases, reuses `jokechatbot-db` when it exists, or creates it when absent.
It writes the resolved UUID to the ignored
`worker/wrangler.deploy.toml`. The generated file is used for both deployment
and migrations, so no account-specific database ID is committed.

## 2. Add encrypted Worker secrets

After the first Worker deployment, open **Workers & Pages → jokechatbot →
Settings → Variables and Secrets**. Add both entries with type **Secret**:

- `DEEPSEEK_API_KEY`: a newly rotated DeepSeek key;
- `RESEARCHER_KEY`: a different long random value used only to unlock
  researcher routes.

Alternatively, both commands below prompt interactively:

```bash
npx wrangler secret put DEEPSEEK_API_KEY --config worker/wrangler.toml
npx wrangler secret put RESEARCHER_KEY --config worker/wrangler.toml
```

Do not reuse a DeepSeek key that has appeared in chat, source code, logs, or
screenshots. Neither value is written to this repository.

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
- Confirm the researcher export contains all three generated prefixes and one
  locked shared canonical bridge for audit.
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

