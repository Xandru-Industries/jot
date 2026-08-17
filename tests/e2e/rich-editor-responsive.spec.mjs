import { expect, test } from "@playwright/test";
import { createNote, openOwnerNote } from "../support/jot.mjs";

test("owner uses one continuous surface on desktop and phone", async ({ page }) => {
  const note = await createNote(page.request, { markdown: "# Responsive\n\nSelect this text." });
  await openOwnerNote(page, note.id);
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator("#previewFab, #previewCloseButton")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator("#previewStage")).toHaveCSS("position", "static");
});

test("mobile comment action remains available", async ({ page }) => {
  const note = await createNote(page.request, { markdown: "Mobile comment target", shareAccess: "comment" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/s/${note.shareId}`);
  await expect(page.locator("#previewContent")).toContainText("Mobile comment target");
  await expect(page.locator("#commentFab")).toHaveCount(1);
});
