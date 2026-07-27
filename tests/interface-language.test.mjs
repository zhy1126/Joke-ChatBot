import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(
  new URL("../site/index.html", import.meta.url),
  "utf8",
);
const remoteApp = await readFile(
  new URL("../site/js/remote-app.js", import.meta.url),
  "utf8",
);

test("researcher form hides the separate Chinese opening-message field", () => {
  assert.doesNotMatch(html, /id="opening-message-zh"/);
  assert.match(html, /id="opening-message"/);
});

test("researcher interface contains no visible Chinese copy", () => {
  const researcherHtml = html.split(
    '<div id="participant-view" class="participant-app hidden">',
  )[0];
  assert.doesNotMatch(researcherHtml, /[\u3400-\u9fff]/u);
  assert.doesNotMatch(
    researcherHtml,
    /<textarea[^>]+id="[^"]+-zh"/u,
  );
});

test("participant preview retains the Chinese language choice", () => {
  assert.match(html, /id="participant-language"/);
  assert.match(html, /<option value="zh-CN">中文<\/option>/u);
});

test("participant task requires a natural joke insertion without a coworker invitation", () => {
  assert.doesNotMatch(html, /Standard joke invitation/);
  assert.doesNotMatch(html, /When your coworker asks for a joke/i);
  assert.match(html, /introduce the prepared joke below when it feels natural/i);
  assert.match(remoteApp, /不要等待同事主动询问/u);
});

test("researcher can create a flagged three-condition QA test pack", () => {
  assert.match(
    html,
    /<option value="qa_triplet">QA test pack · all three conditions<\/option>/,
  );
  assert.match(remoteApp, /selected === "qa_triplet"/);
  assert.match(remoteApp, /for \(const condition of CONDITIONS\)/);
  assert.match(remoteApp, /sessionPurpose: "qa"/);
});

test("formal sessions and participant preview default to blind card choice", () => {
  assert.match(
    html,
    /<option value="participant_blind" selected>Participant blind card choice<\/option>/,
  );
  assert.match(
    remoteApp,
    /preview-button[\s\S]{0,400}assignmentMethod: "participant_blind"/,
  );
});
