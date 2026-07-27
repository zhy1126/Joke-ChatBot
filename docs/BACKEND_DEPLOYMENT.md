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

## 1. Create D1

From the repository root:

```bash
npx wrangler d1 create joke-chatbot
```

Copy the returned database ID into `worker/wrangler.toml`, replacing
`REPLACE_WITH_D1_DATABASE_ID`.

Apply the schema:

```bash
npm run worker:migrate:remote
```

## 2. Add encrypted secrets

Both commands prompt interactively. Values are not written to the repository:

```bash
npx wrangler secret put DEEPSEEK_API_KEY --config worker/wrangler.toml
npx wrangler secret put RESEARCHER_KEY --config worker/wrangler.toml
```

Use a newly rotated DeepSeek key for the first secret. Use a different long,
random value for `RESEARCHER_KEY`.

## 3. Deploy the Worker

```bash
npx wrangler deploy --config worker/wrangler.toml
```

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

## Validation checklist

- Create a `Participant blind card choice` session.
- Open its participant link in a separate browser profile.
- Confirm the participant sees A/B/C but no condition terminology.
- Choose Chinese and verify the opening and ordinary responses are Chinese.
- Reach the joke stage and verify exactly one fixed reaction is delivered.
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
