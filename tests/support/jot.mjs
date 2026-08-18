import { expect } from "@playwright/test";

export const TEST_PASSWORD = "jot-test-password";

export async function authenticateOwner(request) {
  const viewer = await request.get("/api/viewer");
  const viewerPayload = await viewer.json();

  let token;
  if (!viewerPayload.authConfigured) {
    const setup = await request.post("/api/auth/setup", {
      data: { password: TEST_PASSWORD, confirmPassword: TEST_PASSWORD },
    });
    expect(setup.ok()).toBeTruthy();
    token = (await setup.json()).token;
  } else {
    const login = await request.post("/api/auth/login", {
      data: { password: TEST_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    token = (await login.json()).token;
  }

  const session = await request.post("/api/auth/token", { data: { token } });
  expect(session.ok()).toBeTruthy();
}

export async function createNote(request, options = {}) {
  await authenticateOwner(request);
  const created = await request.post("/api/notes");
  expect(created.ok()).toBeTruthy();
  const summary = (await created.json()).note;
  const markdown = options.markdown ?? "# Collaborative heading\n\nA directly editable paragraph.";
  const updateData = {
    markdown,
    title: options.title ?? "Rich editor test",
    shareAccess: options.shareAccess ?? "edit",
  };
  let updated;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    updated = await request.put(`/api/notes/${summary.id}`, { data: updateData });
    if (updated.ok()) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  expect(updated.ok()).toBeTruthy();
  const response = await request.get(`/api/notes/${summary.id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).note;
}

export async function openOwnerNote(page, noteId) {
  await authenticateOwner(page.request);
  await page.goto(`/notes/${noteId}`);
  await waitForRichEditor(page);
}

export async function openEditShare(page, shareId, name = "Editor") {
  const identity = await page.request.post(`/api/share/${shareId}/identity`, { data: { name } });
  expect(identity.ok()).toBeTruthy();
  await page.goto(`/s/${shareId}`);
  await waitForRichEditor(page);
}

export async function waitForRichEditor(page) {
  await expect(page.locator("#richEditor .ProseMirror")).toBeVisible();
  await expect(page.locator("#disconnectedBanner")).toHaveClass(/hidden/);
}

export async function expectPersistedMarkdown(request, noteId, expected) {
  await expect.poll(async () => {
    const response = await request.get(`/api/notes/${noteId}`);
    if (!response.ok()) {
      await authenticateOwner(request);
      return null;
    }
    return (await response.json()).note.markdown;
  }).toBe(expected);
}
