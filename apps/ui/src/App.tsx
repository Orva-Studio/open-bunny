import { useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { useSetupStatus } from "./hooks/useSetupStatus";
import { Layout } from "./components/Layout";
import { SetupWizard } from "./pages/SetupWizard";
import { DashboardPage } from "./pages/DashboardPage";
import { ReposPage } from "./pages/ReposPage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  const { status, loading } = useSetupStatus();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!status?.setupComplete && location.pathname !== "/setup") {
      navigate("/setup", { replace: true });
    } else if (status?.setupComplete && location.pathname === "/setup") {
      navigate("/", { replace: true });
    }
  }, [status, loading, location.pathname, navigate]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "#8b949e" }}>
        Loading…
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupWizard />} />
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/repos" element={<ReposPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
