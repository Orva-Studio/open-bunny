import { test, expect } from "../fixtures/base";

test.describe("Dashboard page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("/api/setup/status", (route) =>
      route.fulfill({ json: { setupComplete: true, hasGitHubApp: true, hasAiKey: true } })
    );
    await page.route("/api/settings", (route) =>
      route.fulfill({ json: { aiProvider: null, aiApiKeyMasked: null, aiReviewModel: null, aiLightModel: null, availableReviewModels: [], availableLightModels: [] } })
    );
  });

  test("renders without errors when no reviews exist", async ({ page }) => {
    await page.route("/api/reviews", (route) => route.fulfill({ json: [] }));

    await page.goto("/");
    await expect(page.getByTestId("empty-dashboard")).toBeVisible();
    await expect(page.getByText("No reviews yet")).toBeVisible();
  });

  test("renders review list when reviews exist", async ({ page }) => {
    await page.route("/api/reviews", (route) =>
      route.fulfill({
        json: [
          {
            id: "rev1",
            prNumber: 42,
            prTitle: "Fix login bug",
            prUrl: "https://github.com/acme/api/pull/42",
            status: "COMPLETED",
            createdAt: new Date().toISOString(),
            repository: { fullName: "acme/api" },
          },
        ],
      })
    );

    await page.goto("/");
    await expect(page.getByText("acme/api")).toBeVisible();
    await expect(page.getByText("#42 Fix login bug")).toBeVisible();
    await expect(page.getByText("COMPLETED")).toBeVisible();
  });
});
