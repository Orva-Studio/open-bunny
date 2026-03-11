import { useEffect, useState } from "react";
import { api, type Repository } from "../api";

const s: Record<string, React.CSSProperties> = {
  heading: { fontSize: 22, fontWeight: 700, marginBottom: 24 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "8px 12px", fontSize: 12, color: "#8b949e", borderBottom: "1px solid #21262d", fontWeight: 500 },
  td: { padding: "12px 12px", borderBottom: "1px solid #21262d", fontSize: 14 },
  toggle: { position: "relative", display: "inline-block", width: 40, height: 22, cursor: "pointer" },
  empty: { color: "#8b949e", textAlign: "center", padding: 48 },
};

const track = (on: boolean): React.CSSProperties => ({ position: "absolute", inset: 0, borderRadius: 11, background: on ? "#238636" : "#21262d", transition: "background 0.2s" });
const thumb = (on: boolean): React.CSSProperties => ({ position: "absolute", top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s" });

export function ReposPage() {
  const [repos, setRepos] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getRepos().then(setRepos).finally(() => setLoading(false));
  }, []);

  async function toggle(repo: Repository) {
    const updated = await api.toggleRepo(repo.id, !repo.enabled);
    setRepos((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <div>
      <div style={s["heading"]}>Repositories</div>
      {loading ? (
        <div style={s["empty"]}>Loading…</div>
      ) : repos.length === 0 ? (
        <div style={s["empty"]}>No repositories found. Install the GitHub App on some repos first.</div>
      ) : (
        <table style={s["table"]}>
          <thead>
            <tr>
              <th style={s["th"]}>Repository</th>
              <th style={s["th"]}>Reviews</th>
              <th style={s["th"]}>Enabled</th>
            </tr>
          </thead>
          <tbody>
            {repos.map((repo) => (
              <tr key={repo.id}>
                <td style={s["td"]}>{repo.fullName}</td>
                <td style={s["td"]}>{repo._count.reviews}</td>
                <td style={s["td"]}>
                  <button
                    data-testid={`toggle-${repo.fullName}`}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    onClick={() => toggle(repo)}
                    aria-label={repo.enabled ? "Disable" : "Enable"}
                  >
                    <div style={s["toggle"]}>
                      <div style={track(repo.enabled)} />
                      <div style={thumb(repo.enabled)} />
                    </div>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
