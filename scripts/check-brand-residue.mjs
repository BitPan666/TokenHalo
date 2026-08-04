import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const disallowed = [
  ["quota", " float"].join(""),
  ["quota", "-float"].join(""),
  ["quota", "_float"].join(""),
  ["quota", "float"].join(""),
];

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

const violations = [];

for (const file of trackedFiles) {
  if (!existsSync(file)) continue;
  const contents = readFileSync(file);
  if (contents.includes(0)) continue;

  const normalized = contents.toString("utf8").toLowerCase();
  if (disallowed.some((term) => normalized.includes(term))) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  console.error(`Brand consistency check failed:\n${violations.join("\n")}`);
  process.exit(1);
}

console.log(`Brand consistency check passed across ${trackedFiles.length} tracked files.`);
