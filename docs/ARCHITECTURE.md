# Prototype architecture

## Design invariant

The experimental condition may affect only the fixed reaction returned after the
target joke. `condition` is read by the reaction lookup and by the researcher-only
monitor. It is not used by common dialogue, joke auditing, fallback messages, survey
questions, timing policy, or the canonical model history.

## Two histories

Each session stores:

- `messages`: exactly what the participant saw;
- `modelHistory`: the dialogue-engine context.

The condition reaction is present in `messages`. In `modelHistory`, it is replaced
with `canonicalReaction`, which is identical across conditions. This prevents the
manipulation wording from making later generated dialogue systematically colder or
warmer.

## State machine

```text
created
  -> pre_joke
  -> joke_window
  -> post_joke
  -> survey_ready
  -> completed
```

The treatment-delivery transition is locked by `jokeSeen`, so subsequent jokes cannot
trigger a second experimental reaction.

## Trigger modes

### Study mode

The common joke invitation opens `joke_window`. The first nonempty substantive
message that is not a refusal, clarification, or meta-probe triggers the reaction.
The condition-blind detector produces an audit label but does not decide treatment.

### Automatic demo mode

A condition-blind heuristic can trigger a likely joke. This mode demonstrates the
future automatic detector boundary but is not suitable for formal data collection.
The production backend can replace it with a structured-output LLM classifier without
changing the state machine.

## Static-hosting boundary

The browser application deliberately implements the complete user flow without
secrets or external services. GitHub Pages cannot provide:

- secure condition concealment against developer-tools inspection;
- protected API credentials;
- cross-device session persistence;
- researcher authentication;
- authoritative concurrency and idempotency controls.

The production backend should implement opaque participant tokens, authenticated
researcher routes, a database transaction around message processing, server-side LLM
calls, input/output validation, and anonymous export.

The static prototype remains useful for UI testing, wording pilots, matched
transcript generation, questionnaire revision, and demonstration to assessors.
