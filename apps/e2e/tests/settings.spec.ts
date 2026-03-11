import { test, expect } from "../fixtures/base";

const SETTINGS = {
  aiProvider: "openai",
  aiApiKeyMasked: "••••••••abcd",
  aiReviewModel: "gpt-4o",
  aiLightModel: "gpt-4o-mini",
  availableReviewModels: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  availableLightModels: [
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
  ],
};

test.describe("Settings page", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("/api/setup/status", (route) =>
      route.fulfill({ json: { setupComplete: true, hasGitHubApp: true, hasAiKey: true } })
    );
    await page.route("/api/reviews", (route) => route.fulfill({ json: [] }));
    await page.route("/api/settings", (route) => route.fulfill({ json: SETTINGS }));
  });

  test("shows masked API key", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("••••••••abcd")).toBeVisible();
  });

  test("shows model dropdowns with current selections", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByTestId("review-model")).toHaveValue("gpt-4o");
    await expect(page.getByTestId("light-model")).toHaveValue("gpt-4o-mini");
  });

  test("saves settings and shows confirmation", async ({ page }) => {
    await page.route("/api/settings", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ json: { ok: true, aiReviewModel: "gpt-4.1", aiLightModel: "gpt-4o-mini" } });
      } else {
        await route.fulfill({ json: { ...SETTINGS, aiApiKeyMasked: "••••••••efgh" } });
      }
    });

    await page.goto("/settings");

    await page.getByTestId("api-key").fill("sk-test-new-key");
    await page.getByTestId("review-model").selectOption("gpt-4.1");
    await page.getByTestId("save-settings").click();

    await expect(page.getByText("✓ Saved")).toBeVisible();
  });
});
