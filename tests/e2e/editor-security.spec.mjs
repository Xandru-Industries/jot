import { expect, test } from "@playwright/test";
import { createNote, openOwnerNote } from "../support/jot.mjs";

test("editor keeps raw HTML inert and widgets outside Markdown", async ({ page }) => {
  const markdown = "# Safe\n\n<script>window.__owned = true</script>\n\n[bad](javascript:alert(1))";
  const note = await createNote(page.request, { markdown, shareAccess: "view" });
  await openOwnerNote(page, note.id);
  expect(await page.evaluate(() => window.__owned)).toBeUndefined();
  await expect(page.locator(".ProseMirror script")).toHaveCount(0);
  await page.goto(`/s/${note.shareId}`);
  await expect(page.locator("#previewContent script")).toHaveCount(0);
  await expect(page.locator('#previewContent a[href^="javascript:"]')).toHaveCount(0);
});
