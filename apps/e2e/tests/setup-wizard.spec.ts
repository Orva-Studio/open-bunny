import { test, expect } from "../fixtures/base";

test.describe("Setup wizard", () => {
  test("shows step 1 when setup is not complete", async ({ page }) => {
    // Mock the setup status endpoint
    await page.route("/api/setup/status", (route) =>
      route.fulfill({ json: { setupComplete: false, hasGitHubApp: false, hasAiKey: false } })
    );

    await page.goto("/");
    await page.waitForURL("**/setup");

    await expect(page.getByText("Step 1 — Create admin account")).toBeVisible();
    await expect(page.getByTestId("email")).toBeVisible();
    await expect(page.getByTestId("password")).toBeVisible();
  });

  test("advances to step 2 after creating admin account", async ({ page }) => {
    await page.route("/api/setup/status", (route) =>
      route.fulfill({ json: { setupComplete: false, hasGitHubApp: false, hasAiKey: false } })
    );
    await page.route("/api/setup/admin", (route) =>
      route.fulfill({ json: { ok: true } })
    );

    await page.goto("/setup");

    await page.getByTestId("email").fill("admin@example.com");
    await page.getByTestId("password").fill("supersecret123");
    await page.getByTestId("admin-submit").click();

    await expect(page.getByText("Step 2 — Connect GitHub")).toBeVisible();
  });

  test("redirects to repos page after setup complete", async ({ page }) => {
    await page.route("/api/setup/status", (route) =>
      route.fulfill({ json: { setupComplete: true, hasGitHubApp: true, hasAiKey: false } })
    );
    await page.route("/api/reviews", (route) => route.fulfill({ json: [] }));

    await page.goto("/setup");
    await page.waitForURL("**/");

    await expect(page.getByText("Recent Reviews")).toBeVisible();
  });
});
