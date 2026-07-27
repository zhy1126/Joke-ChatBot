# Architecture and experimental-control invariants

## Production path

```text
Participant or researcher browser
        |
        v
GitHub Pages frontend
        |
        v
Cloudflare Worker API
   |                 |
   v                 v
D1 session store   DeepSeek V4 Flash
```

The browser receives an opaque participant token. D1 stores the real condition,
blind-card mapping, prompts, messages, events, and survey record. DeepSeek
credentials and the researcher access credential are encrypted Worker Secrets.

## Condition isolation

At the joke slot, DeepSeek receives the language, joke, scenario, and recent
canonical conversation, then generates a matched counterfactual set containing:

- a short negative prefix;
- a short neutral prefix;
- a short polite-positive prefix; and
- one context-specific, condition-neutral work follow-up.

The reaction prompt generates all three candidates together and does not receive
the assigned condition. The server validates valence, weak-versus-strong
positivity, neutral contamination, shared-follow-up neutrality, and approximate
length balance. Only after validation does the server read the condition and
select one candidate. Fixed researcher-editable templates are emergency
fallbacks, not the normal response path.

Every nonmanipulated component is shared:

- coworker persona and role;
- English/Chinese language policy;
- system prompt and generation parameters;
- joke classifier;
- pre-treatment monitoring and post-joke state transitions;
- response delays;
- survey;
- maximum message count; and
- error handling.

Participant-visible history stores the selected contextual reaction. DeepSeek
history stores only the dynamically generated shared follow-up, which is
identical across the three counterfactual candidates for that session. This
prevents the manipulation prefix from causing systematically colder or warmer
later messages.

## Assignment

The server supports:

- `researcher_manual`;
- `balanced_random`; and
- `participant_blind`.

For blind choice, the Worker creates a fresh random permutation from A/B/C to
the three conditions. The participant chooses one visually identical card. The
server resolves and locks the condition; neither the mapping nor the result is
returned through participant APIs.

Balanced random assignment remains the preferred formal-study default because
literal participant choice can introduce selection effects. The per-session
secret permutation prevents a general preference for A, B, or C from
systematically selecting a reaction condition.

The researcher console also offers `QA test pack · all three conditions`. This
is not an experimental assignment method. It creates three separate manual
sessions with the same configuration and `sessionPurpose: "qa"`, one for each
condition. Keeping them separate prevents earlier reactions from contaminating
later comparisons. QA sessions are labelled, excluded from formal dashboard
metrics, and remain flagged in exports.

## Joke signal

The coworker never requests a joke. Before the conversation, the participant
interface instructs everyone to introduce the same prepared joke after at least
one work-related exchange, at a moment that feels natural. The server remains
in `monitoring_joke` and sends every untreated participant message to the same
condition-blind classifier.

The primary reproducible signal is a normalized match to the standardized joke.
The multilingual classifier provides a second signal for paraphrases, puns, and
other clear humor attempts. It labels attempted humor, refusal, clarification,
or other without seeing the condition and without judging funniness. Ordinary
messages continue through the shared coworker model; only a confirmed first
joke opens the one-time reaction slot. If classification fails, an exact target
match can still trigger, while all other messages receive the same ordinary
reply path and the technical event is logged.

Open-humor mode is useful for exploratory demonstrations. Confirmatory studies
should retain one pretested standardized joke so joke content, offensiveness,
length, and cultural familiarity do not become additional manipulations.
