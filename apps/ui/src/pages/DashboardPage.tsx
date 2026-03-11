import { useEffect, useState } from "react";
import { api, type Review } from "../api";

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "#3fb950",
  IN_PROGRESS: "#58a6ff",
  PENDING: "#8b949e",
  FAILED: "#f85149",
  SKIPPED: "#8b949e",
};

const s: Record<string, React.CSSProperties> = {
  heading: { fontSize: 22, fontWeight: 700, marginBottom: 24 },
  empty: { color: "#8b949e", textAlign: "center", padding: 64, background: "#161b22", borderRadius: 8, border: "1px solid #30363d" },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "8px 12px", fontSize: 12, color: "#8b949e", borderBottom: "1px solid #21262d", fontWeight: 500 },
  td: { padding: "12px 12px", borderBottom: "1px solid #21262d", fontSize: 14 },
};

export function DashboardPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/reviews")
      .then((r) => r.ok ? r.json() : Promise.resolve([]))
      .then((data: Review[]) => setReviews(data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div style={s["heading"]}>Recent Reviews</div>
      {loading ? (
        <div style={s["empty"]}>Loading…</div>
      ) : reviews.length === 0 ? (
        <div data-testid="empty-dashboard" style={s["empty"]}>
          No reviews yet. Enable a repository and open a pull request to get started.
        </div>
      ) : (
        <table style={s["table"]}>
          <thead>
            <tr>
              <th style={s["th"]}>Repository</th>
              <th style={s["th"]}>PR</th>
              <th style={s["th"]}>Status</th>
              <th style={s["th"]}>Date</th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((r) => (
              <tr key={r.id}>
                <td style={s["td"]}>{r.repository.fullName}</td>
                <td style={s["td"]}>
                  <a href={r.prUrl} target="_blank" rel="noreferrer" style={{ color: "#58a6ff", textDecoration: "none" }}>
                    #{r.prNumber} {r.prTitle}
                  </a>
                </td>
                <td style={s["td"]}>
                  <span style={{ color: STATUS_COLOR[r.status] ?? "#8b949e", fontWeight: 500 }}>
                    {r.status}
                  </span>
                </td>
                <td style={{ ...s["td"], color: "#8b949e" }}>
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
