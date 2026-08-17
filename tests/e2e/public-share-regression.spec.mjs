import { expect, test } from "@playwright/test";
import { createNote } from "../support/jot.mjs";

test("view share stays rendered and capability-limited", async ({ page }) => {
  const note = await createNote(page.request, { markdown: "# Public view\n\n```mermaid\ngraph TD\nA-->B\n```", shareAccess: "view" });
  await page.goto(`/s/${note.shareId}`);
  await expect(page.locator("#previewContent")).toContainText("Public view");
  await expect(page.locator(".ProseMirror")).toHaveCount(0);
  await expect(page.locator("#commentFab")).toHaveCount(0);
});

test("public viewer refreshes after owner update", async ({ page }) => {
  const note = await createNote(page.request, { markdown: "Before update", shareAccess: "view" });
  await page.goto(`/s/${note.shareId}`);
  await page.waitForTimeout(1000);
  await page.request.put(`/api/notes/${note.id}`, { data: { markdown: "After update", shareAccess: "view" } });
  await expect(page.locator("#previewContent")).toContainText("After update");
});
