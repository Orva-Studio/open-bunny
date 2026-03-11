import { NavLink, Outlet } from "react-router-dom";

const s: Record<string, React.CSSProperties> = {
  shell: { display: "flex", minHeight: "100vh" },
  sidebar: { width: 220, background: "#161b22", borderRight: "1px solid #30363d", padding: "24px 0", display: "flex", flexDirection: "column", gap: 4 },
  logo: { padding: "0 20px 24px", fontSize: 18, fontWeight: 700, color: "#58a6ff", letterSpacing: -0.5 },
  link: { display: "block", padding: "8px 20px", color: "#8b949e", textDecoration: "none", borderRadius: 6, margin: "0 8px", fontSize: 14 },
  main: { flex: 1, padding: 32, maxWidth: 900 },
};

const activeStyle: React.CSSProperties = { color: "#e6edf3", background: "#21262d" };

export function Layout() {
  return (
    <div style={s["shell"]}>
      <nav style={s["sidebar"]}>
        <div style={s["logo"]}>🐇 OpenBunny</div>
        <NavLink to="/" end style={({ isActive }) => ({ ...s["link"], ...(isActive ? activeStyle : {}) })}>Dashboard</NavLink>
        <NavLink to="/repos" style={({ isActive }) => ({ ...s["link"], ...(isActive ? activeStyle : {}) })}>Repositories</NavLink>
        <NavLink to="/settings" style={({ isActive }) => ({ ...s["link"], ...(isActive ? activeStyle : {}) })}>Settings</NavLink>
      </nav>
      <main style={s["main"]}>
        <Outlet />
      </main>
    </div>
  );
}
