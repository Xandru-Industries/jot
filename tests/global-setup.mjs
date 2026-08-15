import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

export default async function globalSetup() {
  const testDataDir = path.resolve(".tmp/playwright-data");
  await rm(testDataDir, { recursive: true, force: true });
  await mkdir(path.join(testDataDir, "notes"), { recursive: true });
}
