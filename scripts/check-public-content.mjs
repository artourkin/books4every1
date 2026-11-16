import { execFileSync } from "node:child_process";

export function privateContent(path, data) {
  const findings = [];
  if (/(^|\/)\.env(?:\.|$)/.test(path) && !/\.(example|sample)$/.test(path))
    findings.push("environment file");
  if (/(^|\/)(?:id_rsa|id_ed25519|[^/]+\.(?:db|sqlite|sqlite3))$/.test(path))
    findings.push("private key or runtime database file");
  if (data.includes(0)) return findings;
  const text = data.toString("utf8");
  const rules = [
    [
      "local network hostname",
      /\b(?:[a-z0-9-]+\.)+(?:home|lan|local|internal)\b/i,
    ],
    [
      "private network address",
      /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/,
    ],
    [
      "personal home directory",
      /\/(?:home|Users)\/(?!runner(?:\/|\b))[a-z][a-z0-9_.-]+/i,
    ],
    [
      "personal email address",
      /\b[a-z0-9._%+-]+@(?:gmail|yahoo|hotmail|outlook|icloud)\.com\b/i,
    ],
    ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
    [
      "access token",
      /\b(?:gh[pousr]_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{50,}|AKIA[A-Z0-9]{16})\b/,
    ],
  ];
  for (const [label, pattern] of rules)
    if (pattern.test(text)) findings.push(label);
  return findings;
}

function check() {
  const git = (args) => execFileSync("git", args);
  const files = git(["ls-files", "-z"]).toString().split("\0").filter(Boolean);
  const seen = new Set();
  const errors = [];
  const inspect = (oid, path) => {
    const key = `${oid}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    const kinds = privateContent(path, git(["cat-file", "blob", oid]));
    for (const kind of kinds) errors.push(`${path}: ${kind}`);
  };
  for (const file of files)
    inspect(
      git(["rev-parse", `HEAD:${file}`])
        .toString()
        .trim(),
      file,
    );
  const base = process.env.BASE_SHA;
  if (base && !/^0+$/.test(base)) {
    if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("Invalid base commit");
    let available = true;
    try {
      execFileSync("git", ["cat-file", "-e", `${base}^{commit}`], {
        stdio: "ignore",
      });
    } catch {
      available = false;
    }
    // A force-push can remove the previous base. In that case scan the full
    // reachable history rather than allowing the missing base to skip checks.
    const objects = git([
      "rev-list",
      "--objects",
      "HEAD",
      ...(available ? ["--not", base] : []),
    ])
      .toString()
      .split("\n");
    for (const object of objects) {
      const space = object.indexOf(" ");
      if (space < 0) continue;
      const oid = object.slice(0, space),
        path = object.slice(space + 1);
      if (git(["cat-file", "-t", oid]).toString().trim() === "blob")
        inspect(oid, path);
    }
  }
  if (errors.length)
    throw new Error(
      `Private configuration found (values withheld):\n${errors.join("\n")}`,
    );
  console.log(`Public-content check passed (${seen.size} source objects).`);
}

if (import.meta.main) {
  try {
    check();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
