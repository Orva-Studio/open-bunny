/**
 * E2E test seed script.
 * Run before E2E tests to populate a clean DB with known state.
 *
 * Usage: bun run apps/e2e/seed.ts
 */

const API_URL = process.env["BASE_URL"] ?? "http://localhost:3000";

async function seed() {
  console.log(`Seeding against ${API_URL}...`);

  // Phase 6: add seed calls here (create admin, configure app, etc.)
  // For now, just verify the API is reachable
  const res = await fetch(`${API_URL}/api/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);

  console.log("Seed complete.");
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
