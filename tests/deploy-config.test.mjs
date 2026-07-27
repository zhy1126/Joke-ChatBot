import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDatabaseList,
  renderDeployConfig,
  selectDatabase,
} from "../worker/prepare-deploy-config.mjs";

const database = {
  name: "jokechatbot-db",
  uuid: "01234567-89ab-4cde-8fab-0123456789ab",
};

test("deployment config reuses the existing named D1 database", () => {
  const parsed = parseDatabaseList(JSON.stringify([database]));
  assert.deepEqual(selectDatabase(parsed), database);

  const config = renderDeployConfig(
    'name = "jokechatbot"\n[[d1_databases]]\nbinding = "DB"\nmigrations_dir = "migrations"\n',
    database,
  );
  assert.match(config, /database_name = "jokechatbot-db"/);
  assert.match(config, new RegExp(`database_id = "${database.uuid}"`));
});

test("deployment config parser supports Cloudflare API-shaped JSON", () => {
  const parsed = parseDatabaseList(
    `telemetry notice\n${JSON.stringify({ result: [database] })}`,
  );
  assert.deepEqual(selectDatabase(parsed), database);
});

test("deployment config rejects missing or malformed D1 identifiers", () => {
  assert.equal(selectDatabase([{ name: "jokechatbot-db", uuid: "bad" }]), null);
  assert.throws(
    () =>
      renderDeployConfig(
        '[[d1_databases]]\nbinding = "DB"\n',
        { name: "jokechatbot-db", uuid: "bad" },
      ),
    /valid D1 database UUID/,
  );
});
