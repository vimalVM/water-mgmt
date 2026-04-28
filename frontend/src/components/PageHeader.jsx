import { useTheme } from "../context/ThemeContext";

export default function PageHeader({ subtitle = "" }) {
  const { t, dark } = useTheme();

  // Force re-mount on theme change to fix WebkitBackgroundClip bug
  return (
    <div key={dark ? "dark" : "light"} style={{
      display:"flex", alignItems:"center", gap:14,
      marginBottom:24, paddingBottom:18,
      borderBottom:`1px solid ${t.border}`,
    }}>
      <style>{`
        @keyframes ph_bounce {
          0%,100%{ transform:scaleY(1) translateY(0); }
          40%    { transform:scaleY(0.92) translateY(2px); }
          70%    { transform:scaleY(1.05) translateY(-2px); }
        }
        @keyframes ph_ripple {
          0%  { transform:translateX(-50%) scale(0.4); opacity:0.9; }
          100%{ transform:translateX(-50%) scale(2.6); opacity:0; }
        }
      `}</style>

      {/* Animated drop */}
      <div style={{ position:"relative", width:44, height:52, flexShrink:0 }}>
        <div style={{
          position:"absolute", bottom:0, left:"50%",
          width:22, height:7, borderRadius:"50%",
          border:`2px solid ${t.cyan}`,
          animation:"ph_ripple 2.4s ease-out infinite",
        }}/>
        <svg width="44" height="44" viewBox="0 0 44 44"
          style={{ animation:"ph_bounce 3s ease-in-out infinite", display:"block" }}>
          <defs>
            <linearGradient id={`ph_g_${dark?"d":"l"}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={t.cyan}/>
              <stop offset="100%" stopColor={t.blue}/>
            </linearGradient>
          </defs>
          <path d="M22 3 C22 3 8 19 8 27 A14 14 0 0 0 36 27 C36 19 22 3 22 3 Z"
            fill={`url(#ph_g_${dark?"d":"l"})`}/>
          <path d="M16 20 C18 15 20 13 23 11.5"
            stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.4"/>
        </svg>
      </div>

      {/* Brand text — plain colored text, no gradient clip (avoids the blue-bar bug) */}
      <div>
        <div style={{
          fontSize:"clamp(20px, 3vw, 26px)",
          fontWeight:800,
          color: t.cyan,          /* solid color — no WebkitBackgroundClip */
          lineHeight:1.1,
          letterSpacing:0.3,
        }}>
          AquaTrack
        </div>
        {subtitle && (
          <div style={{ color:t.textMuted, fontSize:"clamp(12px, 1.5vw, 14px)", marginTop:3 }}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
