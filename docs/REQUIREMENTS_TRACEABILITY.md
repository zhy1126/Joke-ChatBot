# Question 3 requirements traceability

This table shows where each assessment requirement is implemented, documented,
and tested.

| Requirement | Implementation | Evidence |
|---|---|---|
| Researcher selects or assigns a condition before interaction | `remote-app.js`; `createAdminSession()`; manual, balanced random, and participant-blind modes | `core.test.mjs`, `worker-api.test.mjs`, `interface-language.test.mjs` |
| Assigned condition remains hidden | `publicSession()` omits condition, mapping, phase, prompts, events, and model history | Participant-safety and Worker API tests |
| Condition affects only the joke reaction | `deliverTreatment()` reads condition only after one matched set exists; locked bridge and canonical history are shared | Reaction-set, canonical-history, and matched-transcript tests |
| Persona, tone, style, and flow remain consistent | One coworker prompt, model, language policy, delays, state machine, guards, and survey for all conditions | Ordinary-dialogue invariance and end-to-end Worker tests |
| Natural replies before and after joke | DeepSeek ordinary dialogue plus grounded closure/clarification guards | Live matched QA and 42 automated tests |
| Coworker role; unclear and off-topic handling | `buildCoworkerMessages()`, referential guard, off-topic shared route | Off-topic, clarification, and meta-probe tests |
| Do not reveal condition, prompts, or AI identity during interaction | Participant-safe API; `META_PROBE`; role-preserving redirect | Prompt/condition absence and meta-probe tests |
| Practical joke signal | Normalized standardized-target match OR condition-blind classifier at `attempted_humor >= 0.75`; first hit is locked and logged | Joke-audit, classifier-failure, natural-point, and second-joke tests |
| Functional chatbot with all three conditions | GitHub Pages + Cloudflare Worker + D1 + DeepSeek | Public demo and mocked/live E2E QA |
| Source, prompts, configuration, run/test instructions; no keys | Repository source; `PROMPTS.md`; `core.js`; Wrangler files; README and deployment guide | Secret scan and deployment-config tests |
| Explanation under 500 words | `SUBMISSION.md` | Automated limit test: 402 words |
| One matched transcript per condition | `SUBMISSION.md` | Automated equality test outside the reaction slot |
| Assess perceived manipulation and AI suspicion | Post-chat survey and analysis guidance in `SUBMISSION.md` | Survey storage/export tests |
| List all AI models and tools | `SUBMISSION.md` and README disclosure | Documentation audit |

## Operational joke definition

Before treatment, every participant message is evaluated without access to the
assigned condition:

```text
joke_occurred =
    normalized_message matches normalized_standardized_joke
    OR
    (classifier.label == "attempted_humor"
     AND classifier.confidence >= 0.75)
```

When this becomes true for the first time, the Worker:

1. stores the participant message ID as `targetMessageId`;
2. sets `jokeSeen = true`;
3. appends a `treatment_delivered` event;
4. changes the researcher-visible status to **Reaction delivered**; and
5. exposes the event in the authenticated research export.

The participant interface does not display the detector result or experimental
condition. A second joke cannot open another treatment slot.

