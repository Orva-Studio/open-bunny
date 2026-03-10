import { test as base, expect } from "@playwright/test";

// Extend base test with shared fixtures
export const test = base.extend<{
  // Add typed fixtures here as the app grows
  // e.g. authedPage: Page
}>({});

export { expect };
