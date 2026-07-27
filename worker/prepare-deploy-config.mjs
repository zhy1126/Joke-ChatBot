import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATABASE_NAME = "jokechatbot-db";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const workerDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(workerDirectory, "..");
const baseConfig = resolve(workerDirectory, "wrangler.toml");
const deployConfig = resolve(workerDirectory, "wrangler.deploy.toml");

export function parseDatabaseList(output) {
  const plain = String(output).replace(/\u001b\[[0-9;]*m/g, "").trim();
  const starts = [plain.indexOf("["), plain.indexOf("{")].filter(
    (index) => index >= 0,
  );
  if (!starts.length) throw new Error("Wrangler returned no JSON database list.");
  const value = JSON.parse(plain.slice(Math.min(...starts)));
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.databases)) return value.databases;
  throw new Error("Wrangler returned an unrecognized database list.");
}

export function selectDatabase(databases, name = DATABASE_NAME) {
  const database = databases.find((item) => item?.name === name);
  const uuid = database?.uuid || database?.id;
  if (!database || !UUID_PATTERN.test(String(uuid || ""))) return null;
  return { name, uuid: String(uuid) };
}

export function renderDeployConfig(source, database) {
  if (!database || !UUID_PATTERN.test(database.uuid)) {
    throw new Error("A valid D1 database UUID is required.");
  }
  const marker = 'binding = "DB"';
  if (!source.includes(marker)) {
    throw new Error("The base Wrangler config has no DB binding.");
  }
  if (/^\s*database_id\s*=/m.test(source)) {
    throw new Error("The base Wrangler config must not contain a database ID.");
  }
  return source.replace(
    marker,
    `${marker}\ndatabase_name = "${database.name}"\ndatabase_id = "${database.uuid}"`,
  );
}

function runWrangler(argumentsList, allowFailure = false) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(
    executable,
    ["--yes", "wrangler", ...argumentsList],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, CI: "true", NO_COLOR: "1" },
    },
  );
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      result.stderr?.trim() ||
        result.stdout?.trim() ||
        `Wrangler exited with status ${result.status}.`,
    );
  }
  return result;
}

function listDatabases() {
  const result = runWrangler([
    "d1",
    "list",
    "--json",
    "--config",
    "worker/wrangler.toml",
  ]);
  return parseDatabaseList(result.stdout);
}

function prepare() {
  let database = selectDatabase(listDatabases());
  if (!database) {
    runWrangler(
      [
        "d1",
        "create",
        DATABASE_NAME,
        "--config",
        "worker/wrangler.toml",
      ],
      true,
    );
    database = selectDatabase(listDatabases());
  }
  if (!database) {
    throw new Error(`Could not resolve or create D1 database ${DATABASE_NAME}.`);
  }
  const source = readFileSync(baseConfig, "utf8");
  writeFileSync(deployConfig, renderDeployConfig(source, database), "utf8");
  console.log(`Prepared deployment config for existing D1 database ${DATABASE_NAME}.`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  prepare();
}
