import { expect, test } from "@playwright/test";

import { createNote, expectPersistedMarkdown, openOwnerNote } from "../support/jot.mjs";

const cases = [
  "---\ntitle: Example\nnested:\n  enabled: true\ntags:\n  - one\n  - two\nsummary: |\n  multiple\n  lines\n---\n\n# Body",
  "---\r\ntitle: CRLF\r\n...\r\n\r\nBody",
];

for (const [index, markdown] of cases.entries()) {
  test(`preserves opaque frontmatter case ${index + 1}`, async ({ page }) => {
    const note = await createNote(page.request, { markdown });
    await openOwnerNote(page, note.id);
    const block = page.locator("#richEditor [data-frontmatter]");
    await expect(block).toBeVisible();
    await expect(block).toContainText(index ? "title: CRLF" : "nested:");
    await expect(block).toHaveJSProperty("isContentEditable", true);
    await page.locator("#richEditor").getByText(index ? "Body" : "Body", { exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.type("x");
    const normalized = markdown.replaceAll("\r\n", "\n").replace("\n...\n", "\n---\n") + "x\n";
    await expectPersistedMarkdown(page.request, note.id, normalized);
  });
}

test("public rendering escapes frontmatter and unsafe HTML", async ({ page }) => {
  const note = await createNote(page.request, { markdown: "---\ntitle: <img src=x onerror=alert(1)>\n---\n\n<script>alert(1)</script>Body", shareAccess: "view" });
  await page.goto(`/s/${note.shareId}`);
  await expect(page.locator("#previewContent .frontmatter")).toContainText("title: <img src=x onerror=alert(1)>");
  await expect(page.locator("#previewContent script, #previewContent .frontmatter img")).toHaveCount(0);
  await expect(page.locator("#previewContent")).toContainText("Body");
});
