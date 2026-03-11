import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { createHmac, timingSafeEqual } from "crypto";

export interface GitHubAppCredentials {
  appId: number;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
}

/**
 * Create an Octokit instance authenticated as a GitHub App installation.
 * Used by the worker to post review comments.
 */
export function getInstallationOctokit(
  creds: GitHubAppCredentials,
  installationId: number
): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: creds.appId,
      privateKey: creds.privateKey,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      installationId,
    },
  });
}

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 * Throws if the signature is missing or invalid.
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string | null | undefined,
  webhookSecret: string
): void {
  if (!signatureHeader) {
    throw new Error("Missing X-Hub-Signature-256 header");
  }

  const expected = `sha256=${createHmac("sha256", webhookSecret)
    .update(payload, "utf8")
    .digest("hex")}`;

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Invalid webhook signature");
  }
}

/**
 * Create a base Octokit instance (unauthenticated or token-based).
 * Useful for public API calls or testing.
 */
export function createOctokit(token?: string): Octokit {
  return new Octokit({ auth: token });
}
