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
- pre-joke and post-joke state transitions;
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

## Joke signal

Formal study mode opens a `joke_window` after the same number of participant
turns and the same invitation. DeepSeek classifies the next message as attempted
humor, refusal, clarification, or other without seeing the condition.

The classifier is an audit and protocol-deviation check, not a funniness judge.
A refusal or clarification keeps the window open. The next substantive message
triggers generation and selection of the matched reaction set, reducing
differential misclassification of Chinese puns, English jokes, and culturally
specific humor.

Automatic demo mode may use high-confidence `attempted_humor` classification as
the trigger, but should not replace the staged protocol in confirmatory data
collection without a separately validated bilingual classifier benchmark.
