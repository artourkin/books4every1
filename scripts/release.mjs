import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

export function versionParts(value) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error(
      "VERSION must be a stable semantic version, for example 0.2.1",
    );
  return value.split(".").map(BigInt);
}

export function changelogEntry(changelog, version) {
  const heading = `## ${version}`;
  const lines = changelog.split(/\r?\n/);
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`CHANGELOG.md needs a ${heading} section`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  const entry = lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join("\n")
    .trim();
  if (!entry) throw new Error("The release changelog must not be empty");
  return entry;
}

export function validateVersion({
  version,
  previous,
  packageVersion,
  lockVersion,
  lockRootVersion,
  changelog,
}) {
  const parts = versionParts(version);
  if (previous) {
    const old = versionParts(previous);
    const different = parts.findIndex((part, i) => part !== old[i]);
    if (different < 0 || parts[different] < old[different])
      throw new Error(`Increase VERSION above the base branch's ${previous}`);
  }
  if (
    [packageVersion, lockVersion, lockRootVersion].some(
      (value) => value !== version,
    )
  )
    throw new Error(
      "VERSION and the frontend package/lockfile versions must match",
    );
  return changelogEntry(changelog, version);
}

export function composeForRelease(compose, image) {
  if (
    !compose.includes("    build: .\n") ||
    !compose.includes("${FOLIO_IMAGE:-folio:local}")
  )
    throw new Error(
      "Compose release template changed; update the image-only bundle generator",
    );
  return compose
    .replace(/^    build: \.\n/m, "")
    .replace("${FOLIO_IMAGE:-folio:local}", image);
}

export function releaseIdentity({ version, repository, sha, pr }) {
  versionParts(version);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error("Invalid repository");
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Invalid source commit");
  if (pr !== undefined && (!Number.isSafeInteger(pr) || pr <= 0))
    throw new Error("Invalid PR number");
  const publishedVersion =
    pr === undefined ? version : `${version}-pr.${pr}.g${sha.slice(0, 12)}`;
  if (publishedVersion.length > 120)
    throw new Error("Version is too long for a Docker tag");
  return {
    version: publishedVersion,
    baseVersion: version,
    tag: `v${publishedVersion}`,
    image: `ghcr.io/${repository.toLowerCase()}`,
    revision: sha,
    prerelease: pr !== undefined,
    repository,
  };
}

function previousVersion(ref) {
  if (!ref || /^0+$/.test(ref)) return undefined;
  if (!/^[a-f0-9]{40}$/.test(ref)) throw new Error("Invalid base commit");
  // Missing VERSION is supported for the first release of the existing app.
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:VERSION`], {
      stdio: "ignore",
    });
  } catch {
    return JSON.parse(
      execFileSync("git", ["show", `${ref}:web/package.json`], {
        encoding: "utf8",
      }),
    ).version;
  }
  return execFileSync("git", ["show", `${ref}:VERSION`], {
    encoding: "utf8",
  }).trim();
}

async function plan() {
  const version = readFileSync("VERSION", "utf8").trim();
  const pkg = JSON.parse(readFileSync("web/package.json", "utf8"));
  const lock = JSON.parse(readFileSync("web/package-lock.json", "utf8"));
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
    : {};
  const isPR = process.env.GITHUB_EVENT_NAME === "pull_request";
  const checkBase = isPR || process.env.GITHUB_REF === "refs/heads/main";
  const notes = validateVersion({
    version,
    previous: previousVersion(checkBase ? process.env.BASE_SHA : undefined),
    packageVersion: pkg.version,
    lockVersion: lock.version,
    lockRootVersion: lock.packages[""].version,
    changelog: readFileSync("CHANGELOG.md", "utf8"),
  });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const identity = releaseIdentity({
    version,
    repository: process.env.GITHUB_REPOSITORY || "artourkin/books4every1",
    sha,
    pr: isPR ? event.number : undefined,
  });
  const created = execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], {
    encoding: "utf8",
  }).trim();
  let published = false;
  if (process.env.GITHUB_ACTIONS && process.env.GITHUB_TOKEN) {
    const response = await fetch(
      `${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${identity.repository}/releases/tags/${identity.tag}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (response.ok) published = !(await response.json()).draft;
    else if (response.status !== 404)
      throw new Error(
        `Could not check existing release: HTTP ${response.status}`,
      );
  }
  mkdirSync("/tmp/folio-release-plan", { recursive: true });
  writeFileSync("/tmp/folio-release-plan/notes.md", notes + "\n");
  const output = { ...identity, created, published };
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(output)
        .map(([key, value]) => `${key}=${value}\n`)
        .join(""),
    );
  console.log(JSON.stringify(output, null, 2));
}

function bundle() {
  const directory = process.argv[3];
  if (!directory) throw new Error("Pass the release asset directory");
  const identity = releaseIdentity({
    version: readFileSync("VERSION", "utf8").trim(),
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.SOURCE_SHA,
    pr: process.env.PR_NUMBER ? Number(process.env.PR_NUMBER) : undefined,
  });
  const image = `${identity.image}:${identity.version}`;
  const changelog = changelogEntry(
    readFileSync("CHANGELOG.md", "utf8"),
    identity.baseVersion,
  );
  const compose = composeForRelease(
    readFileSync("compose.yaml", "utf8"),
    image,
  );
  writeFileSync(path.join(directory, "compose.yaml"), compose);
  writeFileSync(
    path.join(directory, "folio.env.example"),
    readFileSync(".env.example", "utf8").replace(
      /\n# Optional: pin a prebuilt image[^\n]*\n# FOLIO_IMAGE=[^\n]*\n?/,
      "\n# The release Compose file pins the Docker image version.\n",
    ),
  );
  writeFileSync(
    path.join(directory, "release.json"),
    JSON.stringify(
      {
        ...identity,
        digest: process.env.IMAGE_DIGEST,
        platforms: ["linux/amd64", "linux/arm64"],
      },
      null,
      2,
    ) + "\n",
  );
  const url = `https://github.com/${identity.repository}/releases/download/${identity.tag}`;
  const notes = `${changelog}

Image: \`${image}\`

Digest: \`${process.env.IMAGE_DIGEST}\` (Linux amd64 and arm64). Source: [\`${identity.revision.slice(0, 12)}\`](https://github.com/${identity.repository}/commit/${identity.revision}).

### Upgrade an existing Compose installation

Run these commands from your existing installation directory, using the same Compose project name and data volume. Back up first; changing the image back does not reverse database migrations. The downloaded file pins this exact version and keeps your existing \`.env\`, LAN binding, port (8080), password, and volume.

\`\`\`sh
curl -fL ${url}/compose.yaml -o compose.release.yaml
docker compose -f compose.release.yaml pull folio
docker compose -f compose.release.yaml up -d folio
\`\`\`

For later maintenance, continue using \`-f compose.release.yaml\`. This file is separate from an existing source checkout's Compose file, so no branch switch or rebuild is needed.

### Download the built image

The Docker archives work without registry access. Choose \`amd64\` for Intel/AMD hosts or \`arm64\` for ARM hosts. For example, from the same installation directory:

\`\`\`sh
curl -fL ${url}/compose.yaml -o compose.release.yaml
curl -fLO ${url}/folio-${identity.version}-linux-amd64.tar.gz
curl -fLO ${url}/SHA256SUMS
sha256sum --ignore-missing -c SHA256SUMS
docker load -i folio-${identity.version}-linux-amd64.tar.gz
docker compose -f compose.release.yaml up -d --pull never folio
\`\`\`

For a fresh installation, download this release's \`compose.yaml\` and \`folio.env.example\`, copy the latter to \`.env\`, set a unique password, and start with \`docker compose up -d\`. The Compose asset pins this version and retains the usual named data volume.
`;

  writeFileSync(path.join(directory, "release-notes.md"), notes);
}

if (import.meta.main) {
  try {
    if (process.argv[2] === "bundle") bundle();
    else await plan();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
