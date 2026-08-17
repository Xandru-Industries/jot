import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const suites = ["tests/browser", ...readdirSync("tests/e2e")
  .filter((name) => name.endsWith(".spec.mjs"))
  .sort()
  .map((name) => `tests/e2e/${name}`)];

for (const suite of suites) {
  const result = spawnSync("npx", ["playwright", "test", suite], { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
