import { expect, test } from "@playwright/test";

test("sanitizes active SVG content while retaining safe diagram structure", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { sanitizeMermaidSvg } = await import("/static/generated/rich-editor.js");
    return sanitizeMermaidSvg(`<svg viewBox="0 0 10 10" onload="alert(1)">
      <script>alert(1)</script><foreignObject><div>active</div></foreignObject>
      <iframe src="https://evil.test"></iframe><use href="javascript:alert(1)" />
      <animate attributeName="href" values="safe;javascript:alert(1)" />
      <set attributeName="onclick" to="alert(1)" />
      <a href="javascript:alert(1)"><text>unsafe</text></a>
      <g class="node" style="fill:url(javascript:alert(1))"><rect width="10" height="10"/><text>Safe</text></g>
    </svg>`);
  });
  expect(result).toContain("<svg");
  expect(result).toContain("class=\"node\"");
  expect(result).toContain("<rect");
  expect(result).toContain("Safe");
  expect(result).not.toMatch(/script|foreignObject|iframe|animate|<set|onload|javascript:/i);
});

test("retains safe HTTP links and strips unsafe external references", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { sanitizeMermaidSvg } = await import("/static/generated/rich-editor.js");
    return sanitizeMermaidSvg('<svg><a href="https://example.com"><text>safe</text></a><image href="data:image/svg+xml,bad" /></svg>');
  });
  expect(result).toContain("https://example.com");
  expect(result).not.toContain("data:image");
  expect(result).not.toContain("<image");
});

test("rejects malformed and non-SVG output", async ({ page }) => {
  await page.goto("/login");
  const result = await page.evaluate(async () => {
    const { sanitizeMermaidSvg } = await import("/static/generated/rich-editor.js");
    return [sanitizeMermaidSvg("<div>not svg</div>"), sanitizeMermaidSvg("<svg><g></svg>")];
  });
  expect(result).toEqual(["", ""]);
});
