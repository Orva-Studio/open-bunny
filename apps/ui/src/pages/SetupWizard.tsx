import { useState } from "react";
import { api } from "../api";

const s: Record<string, React.CSSProperties> = {
  page: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24 },
  card: { background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 40, width: "100%", maxWidth: 480 },
  title: { fontSize: 24, fontWeight: 700, marginBottom: 8, color: "#e6edf3" },
  sub: { color: "#8b949e", fontSize: 14, marginBottom: 32 },
  steps: { display: "flex", gap: 8, marginBottom: 32 },
  step: { flex: 1, height: 4, borderRadius: 2, background: "#21262d" },
  stepDone: { flex: 1, height: 4, borderRadius: 2, background: "#58a6ff" },
  label: { display: "block", fontSize: 13, color: "#8b949e", marginBottom: 6, marginTop: 16 },
  input: { width: "100%", padding: "8px 12px", background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", fontSize: 14, outline: "none" },
  btn: { marginTop: 24, width: "100%", padding: "10px 0", background: "#238636", border: "none", borderRadius: 6, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  error: { marginTop: 12, color: "#f85149", fontSize: 13 },
};

export function SetupWizard() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.createAdmin(email, password);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s["page"]}>
      <div style={s["card"]}>
        <div style={s["title"]}>🐇 OpenBunny Setup</div>
        <div style={s["sub"]}>Get started in 3 steps</div>

        <div style={s["steps"]}>
          {[1, 2, 3].map((n) => (
            <div key={n} style={step >= n ? s["stepDone"] : s["step"]} />
          ))}
        </div>

        {step === 1 && (
          <form onSubmit={handleAdminSubmit}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Step 1 — Create admin account</div>
            <div style={s["sub"]}>This will be your login for the OpenBunny dashboard.</div>
            <label style={s["label"]}>Email</label>
            <input data-testid="email" style={s["input"]} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label style={s["label"]}>Password</label>
            <input data-testid="password" style={s["input"]} type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            {error && <div style={s["error"]}>{error}</div>}
            <button data-testid="admin-submit" style={s["btn"]} type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create account →"}
            </button>
          </form>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Step 2 — Connect GitHub</div>
            <div style={s["sub"]}>OpenBunny will create a GitHub App on your account with one click.</div>
            <form method="post" action="https://github.com/settings/apps/new">
              <input type="hidden" name="manifest" id="manifest" />
              <button
                data-testid="github-connect"
                style={s["btn"]}
                type="button"
                onClick={async () => {
                  const res = await fetch("/api/github/manifest");
                  const manifest = await res.json();
                  const form = document.querySelector("form[action]") as HTMLFormElement;
                  const input = document.getElementById("manifest") as HTMLInputElement;
                  input.value = JSON.stringify(manifest);
                  form.submit();
                }}
              >
                Connect GitHub →
              </button>
            </form>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Step 3 — Select repositories</div>
            <div style={s["sub"]}>Install the GitHub App on the repositories you want OpenBunny to review.</div>
            <button data-testid="install-app" style={s["btn"]} onClick={() => window.location.href = "/"}>
              Go to dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
