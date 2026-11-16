import test from "node:test";
import assert from "node:assert/strict";
import { privateContent } from "./check-public-content.mjs";

test("reserved examples and loopback development addresses remain usable", () => {
  const example =
    "http://reader.example.test:8080 http://192.0.2.10:8080 http://127.0.0.1:8081 person@example.test";
  assert.deepEqual(
    privateContent("docs/deployment.md", Buffer.from(example)),
    [],
  );
  assert.deepEqual(
    privateContent(".env.example", Buffer.from("FOLIO_PASSWORD=replace-me")),
    [],
  );
});
test("deployment details and private files are reported without disclosing values", () => {
  const values = [
    "nas" + ".home",
    [10, 23, 42, 5].join("."),
    ["/home", "someone", "config"].join("/"),
    ["person", "gmail.com"].join("@"),
  ];
  for (const value of values) {
    const findings = privateContent("docs/deployment.md", Buffer.from(value));
    assert.equal(findings.length, 1);
    assert.ok(!findings.join(" ").includes(value));
  }
  assert.deepEqual(privateContent(".env", Buffer.from("configuration")), [
    "environment file",
  ]);
  assert.deepEqual(privateContent("data/library.db", Buffer.from([0, 1])), [
    "private key or runtime database file",
  ]);
});
