import { test, expect } from "../fixtures/base";

const REPOS = [
  { id: "r1", owner: "acme", name: "api", fullName: "acme/api", enabled: false, _count: { reviews: 3 } },
  { id: "r2", owner: "acme", name: "ui", fullName: "acme/ui", enabled: true, _count: { reviews: 1 } },
];

test.describe("Repos page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("/api/setup/status", (route) =>
      route.fulfill({ json: { setupComplete: true, hasGitHubApp: true, hasAiKey: true } })
    );
    await page.route("/api/reviews", (route) => route.fulfill({ json: [] }));
  });

  test("lists repositories", async ({ page }) => {
    await page.route("/api/repos", (route) => route.fulfill({ json: REPOS }));

    await page.goto("/repos");
    await expect(page.getByText("acme/api")).toBeVisible();
    await expect(page.getByText("acme/ui")).toBeVisible();
  });

  test("toggling a repo changes its state", async ({ page }) => {
    let repos = REPOS.map((r) => ({ ...r }));

    await page.route("/api/repos", (route) => route.fulfill({ json: repos }));
    await page.route("/api/repos/r1", async (route) => {
      const body = await route.request().postDataJSON() as { enabled: boolean };
      repos = repos.map((r) => r.id === "r1" ? { ...r, enabled: body.enabled } : r);
      route.fulfill({ json: repos.find((r) => r.id === "r1") });
    });

    await page.goto("/repos");

    // Toggle acme/api (currently disabled)
    await page.getByTestId("toggle-acme/api").click();

    // Re-fetch to confirm state persisted in mock
    await page.route("/api/repos", (route) => route.fulfill({ json: repos }));
    await page.reload();

    // The toggle state should reflect the updated value
    const updatedRepo = repos.find((r) => r.id === "r1");
    expect(updatedRepo?.enabled).toBe(true);
  });

  test("shows empty state when no repos", async ({ page }) => {
    await page.route("/api/repos", (route) => route.fulfill({ json: [] }));
    await page.goto("/repos");
    await expect(page.getByText(/No repositories found/)).toBeVisible();
  });
});
