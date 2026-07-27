# Joke-ChatBot · WorkChat Lab Prototype

A public, WeChat-inspired prototype for a researcher-controlled workplace joke
reaction experiment. The interface contains all three experimental conditions:

- negative reaction;
- neutral reaction; and
- polite-positive reaction.

The researcher console can change scenario text, conversation prompts, target joke,
condition wording, trigger mode, response timing, and session length without editing
code. It also creates participant sessions, monitors treatment delivery, collects a
short post-conversation survey, and exports configuration or anonymous records.

## Open the prototype

After GitHub Pages is enabled, the public URL is:

`https://zhy1126.github.io/Joke-ChatBot/`

The default page is the researcher console. Create a session and use the launch
button to open its participant chat. Browser-local storage is shared between tabs on
the same browser.

## Run locally

No package installation is needed for the site.

```bash
python -m http.server 8000 --directory site
```

Then open `http://localhost:8000/?view=researcher`.

Node.js 20 or newer is required only for tests:

```bash
npm test
npm run check
```

## Prototype experiment flow

1. The researcher saves a configuration and creates a manually assigned or balanced
   random session.
2. The participant receives the same workplace scenario and common coworker persona.
3. After a configured number of shared dialogue turns, the coworker gives the same
   standardized joke invitation.
4. The first eligible participant message in the joke window triggers a fixed
   condition reaction exactly once.
5. The participant sees the real reaction, while the model-history record stores the
   same canonical post-reaction text in all conditions.
6. After common post-joke dialogue, the participant completes AI-suspicion and
   manipulation-check questions and sees a debrief.

## Important prototype limitation

GitHub Pages is static hosting. This version stores configuration, assigned
conditions, sessions, and survey responses in browser `localStorage`. The condition
is hidden from the normal participant interface but **is not server-secret against a
technically skilled participant using developer tools**. A participant link also
works only in the browser profile where the researcher created it.

Before real data collection, replace the browser storage and offline dialogue engine
with an authenticated server backend. The backend must store condition assignments,
LLM credentials, sessions, and records; expose only a condition-free participant
API; and preserve the same experiment state-machine contract.

No API keys or passwords are included in this repository.

## Repository map

```text
site/                    Static GitHub Pages application
  index.html             Researcher and participant interfaces
  styles.css             Responsive WeChat-inspired presentation
  js/core.js             Experiment state machine and condition isolation
  js/app.js              Browser UI, storage, exports, and survey
tests/core.test.mjs      Experiment-control regression tests
docs/ARCHITECTURE.md     Architecture and production migration notes
.github/workflows/       Test and GitHub Pages deployment workflow
```

## AI use disclosure

OpenAI Codex was used for requirements analysis, experimental design discussion,
prototype implementation, test generation, and documentation. The deployed GitHub
Pages prototype uses a deterministic offline dialogue engine and does not call an
LLM. A production LLM backend remains the next implementation stage and must be
reported with its exact provider, model identifier, snapshot/version, and use.
