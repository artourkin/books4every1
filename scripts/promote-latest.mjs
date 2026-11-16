import { execFileSync } from "node:child_process";
import { versionParts } from "./release.mjs";
const repository = process.env.GITHUB_REPOSITORY;
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
  throw new Error("Invalid repository");
const releases = JSON.parse(
  execFileSync(
    "gh",
    [
      "api",
      `repos/${repository}/releases?per_page=100`,
      "--paginate",
      "--slurp",
    ],
    { encoding: "utf8" },
  ),
).flat();
const stable = releases.filter(
  (release) =>
    !release.draft &&
    !release.prerelease &&
    /^v\d+\.\d+\.\d+$/.test(release.tag_name),
);
stable.sort((a, b) => {
  const left = versionParts(a.tag_name.slice(1)),
    right = versionParts(b.tag_name.slice(1));
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i] ? -1 : 1;
  return 0;
});
if (!stable.length) throw new Error("No published stable release");
const tag = stable[0].tag_name;
const image = `ghcr.io/${repository.toLowerCase()}`;
// Publication can finish out of order. Always promote the highest released
// version, even when this job belongs to an older or retried workflow.
execFileSync(
  "docker",
  [
    "buildx",
    "imagetools",
    "create",
    "--tag",
    `${image}:latest`,
    `${image}:${tag.slice(1)}`,
  ],
  { stdio: "inherit" },
);
execFileSync("gh", ["release", "edit", tag, "--latest"], { stdio: "inherit" });
