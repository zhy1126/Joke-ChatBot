import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const submission = readFileSync(
  new URL("../docs/SUBMISSION.md", import.meta.url),
  "utf8",
);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const prompts = readFileSync(
  new URL("../docs/PROMPTS.md", import.meta.url),
  "utf8",
);
const traceability = readFileSync(
  new URL("../docs/REQUIREMENTS_TRACEABILITY.md", import.meta.url),
  "utf8",
);

test("submission design explanation remains below 500 words", () => {
  const section = submission.match(
    /## Design explanation \(under 500 words\)\s*([\s\S]*?)\s*## Matched sample transcripts/,
  )?.[1];
  assert.ok(section);
  const words = section.match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || [];
  assert.equal(words.length <= 500, true);
  assert.match(readme, /archive\/refs\/heads\/main\.zip/);
  assert.match(readme, /docs\/PROMPTS\.md/);
  assert.match(readme, /confidence >= 0\.75/);
  assert.match(prompts, /negative_prefix, neutral_prefix, polite_positive_prefix/);
  assert.match(traceability, /targetMessageId/);
  assert.doesNotMatch(
    `${readme}\n${prompts}\n${traceability}`,
    /sk-[A-Za-z0-9]{12,}/,
  );
});

test("sample transcripts match outside the immediate reaction slot", () => {
  const blocks = [...submission.matchAll(
    /### (Negative|Neutral|Polite-positive)\s*([\s\S]*?)(?=\s*### |\s*## Manipulation)/g,
  )];
  assert.equal(blocks.length, 3);
  const parsed = blocks.map(([, condition, content]) => ({
    condition,
    participants: [...content.matchAll(/\*\*Participant:\*\* (.*)/g)].map(
      (match) => match[1].trim(),
    ),
    alex: [...content.matchAll(/\*\*Alex:\*\* (.*)/g)].map(
      (match) => match[1].trim(),
    ),
  }));
  assert.deepEqual(parsed[0].participants, parsed[1].participants);
  assert.deepEqual(parsed[1].participants, parsed[2].participants);
  for (const index of [0, 1, 2, 4]) {
    assert.equal(parsed[0].alex[index], parsed[1].alex[index]);
    assert.equal(parsed[1].alex[index], parsed[2].alex[index]);
  }
  assert.match(parsed[0].alex[3], /not really suitable for work/i);
  assert.match(parsed[1].alex[3], /^\.\.\./);
  assert.match(parsed[2].alex[3], /^Heh/);
  const commonBridge = "Let’s get back to the work at hand.";
  assert.equal(parsed.every((item) => item.alex[3].endsWith(commonBridge)), true);
});

