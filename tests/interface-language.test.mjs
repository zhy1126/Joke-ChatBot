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

test("participant preview retains the Chinese language choice", () => {
  assert.match(html, /id="participant-language"/);
  assert.match(html, /<option value="zh-CN">中文<\/option>/);
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
