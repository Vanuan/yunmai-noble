import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findConfigFile,
  loadConfigFile,
  parseConfigArg,
} from "../src/config-file";

function withTemp(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "yunmai-config-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const EXAMPLE = `
[historian]
port = 4100
database_path = "./db.sqlite"
upstream_urls = ["ws://127.0.0.1:9000", "ws://127.0.0.1:9001"]

[drivers]
initial = ["simulator", "dbus"]
restart_ms = 0

[simulator]
weight_kg = 80.5
steps = 6
repeat = false
auto_start = false
`;

test("loads a local TOML file into environment overrides", () => {
  withTemp((dir) => {
    writeFileSync(join(dir, "yunmai-noble.toml"), EXAMPLE);

    const result = loadConfigFile({ XDG_CONFIG_HOME: dir }, dir);

    assert.equal(result.path, join(dir, "yunmai-noble.toml"));
    assert.equal(result.env.HISTORIAN_PORT, "4100");
    assert.equal(result.env.DATABASE_PATH, "./db.sqlite");
    assert.equal(
      result.env.YUNMAI_WS_URLS,
      "ws://127.0.0.1:9000,ws://127.0.0.1:9001"
    );
    assert.equal(result.env.SUITE_SCALES, "simulator,dbus");
    assert.equal(result.env.SUITE_DRIVER_RESTART_MS, "0");
    assert.equal(result.env.SIMULATOR_WEIGHT_KG, "80.5");
    assert.equal(result.env.SIMULATOR_STEPS, "6");
    assert.equal(result.env.SIMULATOR_AUTO_START, "false");
    assert.equal(result.env.SIMULATOR_REPEAT, "false");
  });
});

test("environment variables override the file", () => {
  withTemp((dir) => {
    writeFileSync(join(dir, "yunmai-noble.toml"), EXAMPLE);

    const result = loadConfigFile(
      { HISTORIAN_PORT: "5000", SUITE_SCALES: "noble", XDG_CONFIG_HOME: dir },
      dir
    );

    assert.equal(result.env.HISTORIAN_PORT, "5000");
    assert.equal(result.env.SUITE_SCALES, "noble");
    assert.equal(result.env.DATABASE_PATH, "./db.sqlite");
  });
});

test("resolves an explicit config path", () => {
  withTemp((dir) => {
    const path = join(dir, "custom.toml");
    writeFileSync(path, '[drivers]\ninitial = ["noble"]\n');

    assert.equal(findConfigFile({ YUNMAI_CONFIG: path }, dir), path);
    assert.equal(
      loadConfigFile({ YUNMAI_CONFIG: path }, dir).env.SUITE_SCALES,
      "noble"
    );

    assert.throws(
      () => loadConfigFile({ YUNMAI_CONFIG: join(dir, "missing.toml") }, dir),
      /does not exist/
    );
  });
});

test("falls back to the XDG config path", () => {
  withTemp((dir) => {
    const path = join(dir, "yunmai-noble", "config.toml");
    mkdirSync(join(dir, "yunmai-noble"), { recursive: true });
    writeFileSync(path, "[drivers]\nnode_id_prefix = \"home\"\n");

    const result = loadConfigFile({ XDG_CONFIG_HOME: dir }, dir);
    assert.equal(result.path, path);
    assert.equal(result.env.SUITE_NODE_ID_PREFIX, "home");
  });
});

test("returns defaults when no config file exists", () => {
  withTemp((dir) => {
    const result = loadConfigFile({ XDG_CONFIG_HOME: dir }, dir);
    assert.equal(result.path, null);
    assert.equal(result.env.SUITE_SCALES, undefined);
  });
});

test("rejects unknown keys, invalid types, and bad TOML", () => {
  withTemp((dir) => {
    const path = join(dir, "bad.toml");

    writeFileSync(path, "[drivers]\ninitial = [\"dbus\"]\nbogus = 1\n");
    assert.throws(
      () => loadConfigFile({ YUNMAI_CONFIG: path }, dir),
      /unknown key drivers\.bogus/
    );

    writeFileSync(path, "[historian]\nport = \"many\"\n");
    assert.throws(
      () => loadConfigFile({ YUNMAI_CONFIG: path }, dir),
      /historian\.port must be a number/
    );

    writeFileSync(path, "[historian]\nport = 3000.5\n");
    assert.throws(
      () => loadConfigFile({ YUNMAI_CONFIG: path }, dir),
      /historian\.port must be an integer/
    );

    writeFileSync(path, "[unknown]\nkey = true\n");
    assert.throws(
      () => loadConfigFile({ YUNMAI_CONFIG: path }, dir),
      /unknown table \[unknown\]/
    );

    writeFileSync(path, "this is not toml = [");
    assert.throws(
      () => loadConfigFile({ YUNMAI_CONFIG: path }, dir),
      /Invalid config file/
    );
  });
});

test("parses --config arguments", () => {
  assert.equal(parseConfigArg([]), null);
  assert.equal(parseConfigArg(["--config", "a.toml"]), "a.toml");
  assert.equal(parseConfigArg(["--config=b.toml"]), "b.toml");
  assert.throws(() => parseConfigArg(["--config"]), /requires a file path/);
});
