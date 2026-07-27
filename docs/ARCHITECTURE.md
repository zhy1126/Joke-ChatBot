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
- a short polite-positive prefix.

The reaction prompt generates all three candidates together and does not receive
the assigned condition. The server validates valence, weak-versus-strong
positivity, neutral contamination, and approximate length balance. A
condition-blind state rule then selects one locked neutral bridge: either a
generic return to the work at hand or a brief closure when the participant has
already closed the task. The same bridge is appended verbatim to every prefix.
Only after this matched set exists does the server read the condition and
select one candidate. Researcher-editable templates supply prefix wording only
when generation or validation fails.

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
history stores only the locked shared bridge. When older stored sessions are
loaded, any condition-reaction turn is canonicalized to the current shared
bridge before the next model call. This prevents the manipulation prefix from
causing systematically colder or warmer later messages. High-confidence
referential clarifications and explicit task closures use narrow,
condition-blind shared guards, avoiding unsupported details and LLM sampling
differences in these experimentally important transitions.

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

