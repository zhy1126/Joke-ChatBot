# WorkChat Lab — three-condition workplace joke experiment

WorkChat Lab is a functional bilingual text chatbot for a controlled workplace
scenario experiment. It presents “Alex,” a same-level coworker, and manipulates
only Alex’s immediate response to the participant’s first joke:

- **Negative:** clear, brief workplace disapproval;
- **Neutral:** no positive or negative evaluation; or
- **Polite-positive:** a weak courtesy laugh or mild acknowledgement.

Ordinary conversation, coworker role, model, prompts, timing, task state,
language, post-joke flow, and survey are shared across conditions.

## Submission links

- **Live researcher dashboard:**  
  <https://zhy1126.github.io/Joke-ChatBot/?view=researcher>
- **Permanent password-free evaluator:**  
  <https://zhy1126.github.io/Joke-ChatBot/?view=evaluator>
- **Download the complete source attachment:**  
  <https://github.com/zhy1126/Joke-ChatBot/archive/refs/heads/main.zip>
- **Submission explanation, transcripts, and evaluation plan:**  
  [docs/SUBMISSION.md](docs/SUBMISSION.md)
- **Exact runtime prompts and model parameters:**  
  [docs/PROMPTS.md](docs/PROMPTS.md)
- **Requirement-by-requirement evidence:**  
  [docs/REQUIREMENTS_TRACEABILITY.md](docs/REQUIREMENTS_TRACEABILITY.md)
- **Architecture and experimental invariants:**  
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Secure deployment instructions:**  
  [docs/BACKEND_DEPLOYMENT.md](docs/BACKEND_DEPLOYMENT.md)

The repository contains all source code, prompts, non-secret configuration,
database migration, tests, run instructions, matched transcripts, and AI-use
disclosure. It contains no active API key or password.

The public evaluator now has two complementary modes:

- **Live DeepSeek API test:** the evaluator selects Negative, Neutral, or
  Polite-positive, chooses English or Simplified Chinese, and creates a fresh
  condition-locked QA session without a password. Messages use the same
  DeepSeek dialogue, joke-classification, and contextual reaction pipeline as
  the formal participant flow.
- **Local matched-control comparison:** one message is sent to all three
  deterministic fallback conversations for a quick side-by-side control check.

Live evaluator sessions are written as `qa`, excluded from formal metrics, and
cannot access researcher endpoints, custom prompts, provider credentials, or
admin data. Server-side rolling limits allow three evaluator sessions per
network client and 30 evaluator sessions deployment-wide per 24 hours, with at
most eight participant messages per evaluator session. The limits are
configurable in `worker/wrangler.toml`.

## How the experiment works

### 1. Assignment before the conversation

The researcher can choose:

- `researcher_manual`;
- `balanced_random`; or
- `participant_blind`.

Participant-blind mode displays three visually identical cards, A/B/C. The
Worker creates a new secret random mapping from those cards to the three
conditions for every session. After a card is selected, the assignment is
locked. The participant API never returns the condition or mapping.

The researcher dashboard also provides **QA test pack · all three conditions**.
It creates three independent QA sessions with matched configuration, one per
condition. QA sessions are labelled and excluded from formal metrics.

### 2. Shared coworker conversation

DeepSeek V4 Flash generates short English or Simplified Chinese coworker
replies through a Cloudflare Worker. The ordinary-dialogue prompt never receives
the condition. It instructs Alex to remain a restrained, friendly-professional
coworker, use only established work facts, handle unclear/off-topic messages,
and never invite a joke or disclose AI, prompts, or experimental information.

Narrow condition-blind guards handle explicit closure, referential
clarification, and meta probes where free generation would weaken
reproducibility.

### 3. Practical signal that the participant told a joke

The chatbot uses a reproducible **dual-channel operational definition**. Before
treatment, every participant message is checked without access to condition:

```text
joke_occurred =
    normalized message matches the normalized standardized joke
    OR
    classifier label is "attempted_humor" with confidence >= 0.75
```

The normalized matcher removes case, punctuation, spacing, and Unicode-format
differences. It reliably detects the pretested study joke and its direct
insertion into a longer message.

The condition-blind DeepSeek classifier handles reasonable paraphrases,
English/Chinese code-switching, puns, and natural humor attempts. It distinguishes
`attempted_humor`, `refusal`, `clarification`, and `other`; it detects an
attempt to tell a joke rather than deciding whether the joke is objectively
funny.

When either channel first triggers, the Worker:

1. stores the message as `targetMessageId`;
2. sets `jokeSeen = true`;
3. records `joke_audit` and `treatment_delivered`;
4. changes the researcher-visible status to **Reaction delivered**; and
5. includes the signal in the authenticated research export.

This is the practical researcher signal required by the task. It remains hidden
from participants, and a later joke cannot trigger another condition reaction.
If the classifier is unavailable, an exact standardized-target match still
works.

### 4. Controlled reaction

After the first confirmed joke, DeepSeek receives the same canonical context
and generates all three matched prefixes in one JSON response:

```json
{
  "negative_prefix": "...",
  "neutral_prefix": "...",
  "polite_positive_prefix": "..."
}
```

DeepSeek is not told which prefix will be shown. The server validates valence,
strength, neutrality, and approximate length, appends one locked
condition-neutral bridge to all three, and only then reads the assigned
condition.

Participant-visible history contains the selected reaction. Later model history
contains only the common bridge, preventing the valence prefix from making
later dialogue systematically warmer or colder.

### 5. Post-chat measurement

The identical post-chat survey measures:

- categorical identity judgment;
- perceived probability that Alex was AI, from 0–100;
- open-text identity reasoning;
- reaction valence;
- perceived disapproval; and
- naturalness.

The debrief is shown only after submission.

## Architecture

```text
GitHub Pages participant/researcher UI
                  |
                  v
         Cloudflare Worker API
             |             |
             v             v
       D1 session store   DeepSeek V4 Flash
```

The browser receives only an opaque participant token and participant-safe
session data. Condition, hidden mapping, prompts, model history, events,
counterfactual reactions, API credentials, and researcher credentials stay
server-side.

## Run the frontend locally

No frontend build is required:

```bash
python -m http.server 8000 --directory site
```

Open:

```text
http://localhost:8000/?view=researcher
```

Without the secure Worker, the interface uses its deterministic browser-only
demonstration fallback.

## Run automated tests

Node.js 20 or newer is required:

```bash
npm test
npm run check
```

The current suite contains 45 tests covering:

- all assignment modes and blind-card locking;
- participant-safe API responses;
- English and Chinese interfaces;
- condition absence from every model prompt;
- condition-blind joke detection and classifier fallback;
- matched AI reaction prefixes and locked shared bridge;
- one-time treatment, including a second distinct joke;
- canonical post-reaction history;
- unclear, off-topic, closure, and meta-probe behavior;
- Worker API, CORS, and D1 configuration;
- the 500-word submission limit; and
- exact transcript matching outside the reaction slot.

## Deploy the secure backend

The complete procedure is in
[docs/BACKEND_DEPLOYMENT.md](docs/BACKEND_DEPLOYMENT.md). In brief:

1. create or reuse the D1 database;
2. store `DEEPSEEK_API_KEY` and a separate `RESEARCHER_KEY` as encrypted Worker
   secrets;
3. run `npm run worker:deploy`; and
4. set the public Worker URL in `site/js/runtime-config.js`.

For Cloudflare Git builds:

- **Build command:** leave blank;
- **Deploy command:** `npm run worker:deploy`.

Never put either secret in GitHub Pages, source files, screenshots, or the
researcher form.

## Repository map

```text
site/
  index.html                 Researcher and participant UI
  styles.css                 WeChat-inspired visual design
  js/core.js                 Shared configuration and offline fallback
  js/remote-api.js           Browser-to-Worker client
  js/remote-app.js           Secure researcher/participant flow
  js/runtime-config.js       Public Worker URL; no secrets
worker/
  src/experiment.js          State machine, prompts, detector, reaction control
  src/index.js               Worker routes, D1 persistence, DeepSeek client
  migrations/                D1 schema
  wrangler.toml              Non-secret Worker configuration
tests/                       45 automated control and regression tests
docs/
  PROMPTS.md                 Submitted prompts and model parameters
  SUBMISSION.md              <500-word explanation and matched transcripts
  REQUIREMENTS_TRACEABILITY.md
  ARCHITECTURE.md
  BACKEND_DEPLOYMENT.md
```

## AI models and AI-assisted tools

- **DeepSeek V4 Flash (`deepseek-v4-flash`):** runtime ordinary dialogue,
  condition-blind joke classification, and matched reaction-prefix generation.
- **OpenAI GPT-5 through Codex:** requirements analysis, multi-agent and
  autoresearch review, implementation, test generation, security review,
  deployment assistance, and documentation.
- **Playwright with Microsoft Edge:** automated browser smoke testing; it is a
  testing tool rather than a generative model.

No training, fine-tuning, or external joke dataset is required. For a
confirmatory experiment, a single pretested standardized joke provides stronger
experimental control than training on a broad joke corpus.
