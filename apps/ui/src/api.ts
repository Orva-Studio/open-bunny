const BASE = "/api";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SetupStatus {
  setupComplete: boolean;
  hasGitHubApp: boolean;
  hasAiKey: boolean;
}

export interface Repository {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  enabled: boolean;
  _count: { reviews: number };
}

export interface Settings {
  aiProvider: string | null;
  aiApiKeyMasked: string | null;
  aiReviewModel: string | null;
  aiLightModel: string | null;
  availableReviewModels: Array<{ id: string; label: string }>;
  availableLightModels: Array<{ id: string; label: string }>;
}

export interface Review {
  id: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  status: string;
  createdAt: string;
  repository: { fullName: string };
}

export const api = {
  getSetupStatus: () => request<SetupStatus>("/setup/status"),

  createAdmin: (email: string, password: string) =>
    request<{ ok: boolean }>("/setup/admin", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  getGitHubManifestUrl: () => `${BASE}/github/manifest`,

  getRepos: () => request<Repository[]>("/repos"),

  toggleRepo: (id: string, enabled: boolean) =>
    request<Repository>(`/repos/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),

  getSettings: () => request<Settings>("/settings"),

  saveSettings: (data: Partial<{ aiApiKey: string; aiReviewModel: string; aiLightModel: string }>) =>
    request<{ ok: boolean }>("/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  signIn: (email: string, password: string) =>
    request<{ token: string }>("/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
};
