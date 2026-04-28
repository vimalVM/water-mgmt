import { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useResponsive } from "../hooks/useResponsive";

const NAV = [
  { to:"/",        icon:"📊", label:"Dashboard"    },
  { to:"/reports", icon:"📈", label:"Reports"      },
  { to:"/manage",  icon:"⚙️", label:"Manage"       },
];

export default function Layout() {
  const { user, logout }    = useAuth();
  const { dark, toggle, t } = useTheme();
  const { isMobile }        = useResponsive();
  const navigate            = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const sideW = collapsed ? 64 : 220;

  // ── Mobile: bottom nav ───────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display:"flex", flexDirection:"column",
        minHeight:"100vh", background:t.bg,
        fontFamily:"'DM Sans',sans-serif", paddingBottom:64 }}>
        <style>{`
          @keyframes drop_b { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        `}</style>

        {/* Mobile top bar */}
        <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:200,
          background:t.sidebar, borderBottom:`1px solid ${t.border}`,
          padding:"10px 16px", display:"flex", alignItems:"center",
          justifyContent:"space-between", height:52 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <svg width="28" height="28" viewBox="0 0 44 44"
              style={{ animation:"drop_b 3s ease-in-out infinite" }}>
              <defs>
                <linearGradient id="mb_g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.cyan}/>
                  <stop offset="100%" stopColor={t.blue}/>
                </linearGradient>
              </defs>
              <path d="M22 3 C22 3 8 19 8 27 A14 14 0 0 0 36 27 C36 19 22 3 22 3 Z"
                fill="url(#mb_g)"/>
            </svg>
            <span style={{ fontSize:17, fontWeight:800, color:t.cyan }}>AquaTrack</span>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={toggle} style={{ background:"none", border:"none",
              fontSize:20, cursor:"pointer" }}>
              {dark ? "☀️" : "🌙"}
            </button>
            <button onClick={()=>{logout();navigate("/login");}}
              style={{ background:`${t.red}20`, border:`1px solid ${t.red}40`,
                borderRadius:8, padding:"4px 10px", color:t.red,
                fontSize:12, fontWeight:700, cursor:"pointer" }}>
              Exit
            </button>
          </div>
        </div>

        {/* Content */}
        <main style={{ flex:1, padding:"68px 12px 16px",
          overflowY:"auto", background:t.bg }}>
          <Outlet />
        </main>

        {/* Bottom nav */}
        <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:200,
          background:t.sidebar, borderTop:`1px solid ${t.border}`,
          display:"flex", height:58 }}>
          {NAV.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to==="/"} style={({ isActive }) => ({
              flex:1, display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center",
              textDecoration:"none", gap:3,
              color: isActive ? t.cyan : t.textMuted,
              borderTop: isActive ? `2px solid ${t.cyan}` : "2px solid transparent",
              background: isActive ? `${t.cyan}08` : "transparent",
              transition:"all 0.15s",
            })}>
              <span style={{ fontSize:22 }}>{icon}</span>
              <span style={{ fontSize:11, fontWeight:600 }}>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    );
  }

  // ── Desktop: sidebar ─────────────────────────────────────────
  return (
    <div style={{ display:"flex", minHeight:"100vh",
      background:t.bg, fontFamily:"'DM Sans',sans-serif",
      transition:"background 0.3s" }}>
      <style>{`
        @keyframes drop_s { 0%,100%{transform:scaleY(1) translateY(0)} 40%{transform:scaleY(0.92) translateY(2px)} 70%{transform:scaleY(1.05) translateY(-2px)} }
        @keyframes rpl { 0%{transform:translateX(-50%) scale(0.4);opacity:0.9} 100%{transform:translateX(-50%) scale(2.4);opacity:0} }
      `}</style>

      <aside style={{ width:sideW, flexShrink:0,
        background:t.sidebar, borderRight:`1px solid ${t.border}`,
        display:"flex", flexDirection:"column",
        position:"fixed", top:0, left:0, bottom:0, zIndex:100,
        transition:"width 0.25s ease", overflow:"hidden",
        boxShadow: dark?"4px 0 20px #00000040":"4px 0 16px #0000000a" }}>

        {/* Logo */}
        <div style={{ padding: collapsed?"16px 12px":"16px 18px",
          borderBottom:`1px solid ${t.border}`,
          display:"flex", alignItems:"center", gap:10, minHeight:68 }}>
          <div style={{ width:36, height:42, flexShrink:0, position:"relative" }}>
            <div style={{ position:"absolute", bottom:0, left:"50%",
              width:20, height:6, borderRadius:"50%",
              border:`1.5px solid ${t.cyan}`,
              animation:"rpl 2.5s ease-out infinite" }}/>
            <svg width="36" height="36" viewBox="0 0 44 44"
              style={{ animation:"drop_s 3s ease-in-out infinite", display:"block" }}>
              <defs>
                <linearGradient id="sb_g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={t.cyan}/>
                  <stop offset="100%" stopColor={t.blue}/>
                </linearGradient>
              </defs>
              <path d="M22 3 C22 3 8 19 8 27 A14 14 0 0 0 36 27 C36 19 22 3 22 3 Z"
                fill="url(#sb_g)"/>
              <path d="M16 20 C18 15 20 13 23 11.5" stroke="white"
                strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4"/>
            </svg>
          </div>
          {!collapsed && (
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:16, fontWeight:800, color:t.cyan }}>AquaTrack</div>
              <div style={{ fontSize:9, color:t.textMuted, letterSpacing:1, marginTop:1 }}>
                SMART WATER MONITOR
              </div>
            </div>
          )}
          <button onClick={()=>setCollapsed(c=>!c)}
            style={{ background:"none", border:"none",
              color:t.textMuted, cursor:"pointer", fontSize:18, padding:2, flexShrink:0 }}>
            {collapsed?"›":"‹"}
          </button>
        </div>

        {/* User */}
        {!collapsed && (
          <div style={{ padding:"10px 18px", borderBottom:`1px solid ${t.border}` }}>
            <div style={{ fontSize:10, color:t.textMuted, letterSpacing:0.8, marginBottom:2 }}>
              LOGGED IN AS
            </div>
            <div style={{ fontSize:15, fontWeight:700, color:t.cyan }}>{user?.name}</div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex:1, padding:"12px 8px",
          display:"flex", flexDirection:"column", gap:4 }}>
          {NAV.map(({ to, icon, label }) => (
            <NavLink key={to} to={to} end={to==="/"} style={({ isActive }) => ({
              display:"flex", alignItems:"center",
              gap: collapsed?0:12,
              justifyContent: collapsed?"center":"flex-start",
              padding: collapsed?"13px 0":"11px 14px",
              borderRadius:10, textDecoration:"none",
              background: isActive?`${t.cyan}18`:"transparent",
              borderLeft: isActive?`3px solid ${t.cyan}`:"3px solid transparent",
              color: isActive?t.cyan:t.textMuted,
              fontSize:15, fontWeight: isActive?700:500,
              transition:"all 0.18s",
            })}>
              <span style={{ fontSize:20 }}>{icon}</span>
              {!collapsed && label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom controls */}
        <div style={{ padding:"10px 8px", borderTop:`1px solid ${t.border}`,
          display:"flex", flexDirection:"column", gap:6 }}>
          <button onClick={toggle} style={{
            display:"flex", alignItems:"center",
            gap:collapsed?0:8, justifyContent:collapsed?"center":"flex-start",
            padding:collapsed?"11px 0":"10px 14px",
            borderRadius:10, background:"none",
            border:`1px solid ${t.border}`,
            color:t.textMuted, cursor:"pointer", fontSize:14 }}>
            <span style={{ fontSize:20 }}>{dark?"☀️":"🌙"}</span>
            {!collapsed && <span>{dark?"Light Mode":"Dark Mode"}</span>}
          </button>
          <button onClick={()=>{logout();navigate("/login");}} style={{
            display:"flex", alignItems:"center",
            gap:collapsed?0:8, justifyContent:collapsed?"center":"flex-start",
            padding:collapsed?"11px 0":"10px 14px",
            borderRadius:10, background:`${t.red}15`,
            border:`1px solid ${t.red}35`,
            color:t.red, cursor:"pointer", fontSize:14, fontWeight:600 }}>
            <span style={{ fontSize:20 }}>🚪</span>
            {!collapsed && "Logout"}
          </button>
        </div>
      </aside>

      <main style={{ flex:1, marginLeft:sideW, padding:"24px clamp(12px,3vw,36px)",
        transition:"margin-left 0.25s ease", minHeight:"100vh" }}>
        <Outlet />
      </main>
    </div>
  );
}
