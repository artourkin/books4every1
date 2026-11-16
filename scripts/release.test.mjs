import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  releaseIdentity,
  validateVersion,
  composeForRelease,
} from "./release.mjs";

const valid = {
  version: "0.2.0",
  previous: "0.1.9",
  packageVersion: "0.2.0",
  lockVersion: "0.2.0",
  lockRootVersion: "0.2.0",
  changelog:
    "# Changelog\n\n## 0.2.0\n\n- A release.\n\n## 0.1.9\n\n- Old release.",
};
test("downloaded Compose files pin the image without a source build and retain the data volume and binding", () => {
  const source = readFileSync(
    new URL("../compose.yaml", import.meta.url),
    "utf8",
  );
  const image = "ghcr.io/artourkin/books4every1:0.2.0-pr.7.gaaaaaaaaaaaa";
  const compose = composeForRelease(source, image);
  assert.ok(compose.includes(`image: ${image}`));
  assert.ok(!compose.includes("FOLIO_IMAGE"));
  assert.ok(!compose.includes("build:"));
  assert.ok(compose.includes("folio-data:/data"));
  assert.ok(compose.includes("${FOLIO_BIND_ADDR:-127.0.0.1}"));
  assert.throws(
    () => composeForRelease("services: {}", image),
    /template changed/,
  );
});
test("versions increase numerically and cannot reuse or downgrade a base version", () => {
  assert.equal(validateVersion(valid), "- A release.");
  assert.doesNotThrow(() => validateVersion({ ...valid, previous: "0.1.99" }));
  for (const previous of ["0.2.0", "0.2.1", "1.0.0"])
    assert.throws(
      () => validateVersion({ ...valid, previous }),
      /Increase VERSION/,
    );
});
test("release preparation requires synchronized manifests and nonempty notes", () => {
  assert.throws(
    () => validateVersion({ ...valid, lockRootVersion: "0.1.0" }),
    /must match/,
  );
  assert.throws(
    () =>
      validateVersion({
        ...valid,
        changelog: "## 0.2.0\n\n## 0.1.9\nOld notes",
      }),
    /not be empty/,
  );
  assert.throws(
    () => validateVersion({ ...valid, changelog: "## 0.1.9\nOld notes" }),
    /needs a/,
  );
  for (const version of ["v0.2.0", "0.02.0", "0.2.0-dev", "0.2.0\nimage=other"])
    assert.throws(
      () => validateVersion({ ...valid, version }),
      /semantic version/,
    );
});
test("PR image versions identify their exact source and never use the stable tag", () => {
  const source = {
    version: "0.2.0",
    repository: "Artourkin/Books4Every1",
    sha: "a".repeat(40),
  };
  const preview = releaseIdentity({ ...source, pr: 7 });
  assert.equal(preview.version, "0.2.0-pr.7.gaaaaaaaaaaaa");
  assert.equal(preview.image, "ghcr.io/artourkin/books4every1");
  assert.equal(preview.prerelease, true);
  assert.notEqual(preview.tag, releaseIdentity(source).tag);
  assert.notEqual(
    preview.tag,
    releaseIdentity({ ...source, sha: "b".repeat(40), pr: 7 }).tag,
  );
  assert.throws(
    () => releaseIdentity({ ...source, sha: "main; echo bad", pr: 7 }),
    /Invalid source/,
  );
  assert.throws(() => releaseIdentity({ ...source, pr: 0 }), /Invalid PR/);
});
