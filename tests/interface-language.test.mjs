import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const html = await readFile(
  new URL("../site/index.html", import.meta.url),
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
