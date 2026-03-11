import { useEffect, useState } from "react";
import { api, type Settings } from "../api";

const s: Record<string, React.CSSProperties> = {
  heading: { fontSize: 22, fontWeight: 700, marginBottom: 24 },
  section: { background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: 24, marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: 600, marginBottom: 16 },
  label: { display: "block", fontSize: 13, color: "#8b949e", marginBottom: 6, marginTop: 14 },
  input: { width: "100%", padding: "8px 12px", background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", fontSize: 14, outline: "none" },
  select: { width: "100%", padding: "8px 12px", background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", fontSize: 14 },
  btn: { marginTop: 20, padding: "8px 20px", background: "#238636", border: "none", borderRadius: 6, color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  saved: { marginTop: 10, color: "#3fb950", fontSize: 13 },
  masked: { fontSize: 13, color: "#8b949e", marginTop: 6 },
};

export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [reviewModel, setReviewModel] = useState("");
  const [lightModel, setLightModel] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setReviewModel(s.aiReviewModel ?? "");
      setLightModel(s.aiLightModel ?? "");
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await api.saveSettings({
        ...(apiKey ? { aiApiKey: apiKey } : {}),
        ...(reviewModel ? { aiReviewModel: reviewModel } : {}),
        ...(lightModel ? { aiLightModel: lightModel } : {}),
      });
      setSaved(true);
      setApiKey("");
      // Refresh to show updated masked key
      const updated = await api.getSettings();
      setSettings(updated);
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <div style={{ color: "#8b949e" }}>Loading…</div>;

  return (
    <div>
      <div style={s["heading"]}>Settings</div>
      <form onSubmit={handleSave}>
        <div style={s["section"]}>
          <div style={s["sectionTitle"]}>AI Provider</div>

          <label style={s["label"]}>OpenAI API Key</label>
          <input
            data-testid="api-key"
            style={s["input"]}
            type="password"
            placeholder={settings.aiApiKeyMasked ?? "sk-…"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          {settings.aiApiKeyMasked && (
            <div style={s["masked"]}>Current key: {settings.aiApiKeyMasked}</div>
          )}

          <label style={s["label"]}>Review model (full reviews)</label>
          <select
            data-testid="review-model"
            style={s["select"]}
            value={reviewModel}
            onChange={(e) => setReviewModel(e.target.value)}
          >
            <option value="">— select —</option>
            {settings.availableReviewModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>

          <label style={s["label"]}>Light model (summaries &amp; chat)</label>
          <select
            data-testid="light-model"
            style={s["select"]}
            value={lightModel}
            onChange={(e) => setLightModel(e.target.value)}
          >
            <option value="">— select —</option>
            {settings.availableLightModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>

        <button data-testid="save-settings" style={s["btn"]} type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved && <div style={s["saved"]}>✓ Saved</div>}
      </form>
    </div>
  );
}
