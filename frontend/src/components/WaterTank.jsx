import { useEffect, useRef } from "react";

/**
 * WaterTank – 3D animated beaker using CSS keyframes.
 * Props:
 *   pct   0–100   fill percentage (>100 triggers overflow)
 *   color "green" | "orange" | "red"
 *   total string  e.g. "48.9"
 *   limit string  e.g. "400"
 */
export default function WaterTank({ pct = 0, color = "green", total = "", limit = "" }) {
  const clamp    = Math.min(105, Math.max(0, pct));
  const overflow = clamp >= 100;
  const fillPct  = Math.min(100, clamp);

  const C = {
    green:  { a: "#00d97e", b: "#00b865", glow: "#00d97e50", text: "#00d97e" },
    orange: { a: "#ff9d00", b: "#e08000", glow: "#ff9d0050", text: "#ff9d00" },
    red:    { a: "#ff4d6d", b: "#d4003c", glow: "#ff4d6d50", text: "#ff4d6d" },
  }[color] || { a:"#00d97e", b:"#00b865", glow:"#00d97e50", text:"#00d97e" };

  const id = `wt_${color}`;

  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", width:"100%" }}>
      <style>{`
        @keyframes ${id}_wave {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes ${id}_rise {
          from { height: 0%; }
          to   { height: ${fillPct}%; }
        }
        @keyframes ${id}_pulse {
          0%, 100% { opacity: 0.7; transform: scaleX(1); }
          50%       { opacity: 1;   transform: scaleX(1.02); }
        }
        @keyframes ${id}_drip {
          0%   { top: -4px; opacity: 1; }
          100% { top: 10px; opacity: 0; }
        }
        @keyframes ${id}_warn {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1; }
        }
      `}</style>

      <div style={{
        position: "relative",
        width: 140, height: 220,
        marginBottom: 12,
      }}>
        {/* Glow base */}
        <div style={{
          position:"absolute", bottom:-10, left:"50%",
          transform:"translateX(-50%)",
          width:100, height:16, borderRadius:"50%",
          background: C.glow,
          filter:"blur(8px)",
        }}/>

        {/* Tank outer shell — 3D effect with border gradient */}
        <div style={{
          position:"absolute", inset:0,
          borderRadius:16,
          background:"linear-gradient(160deg, #111827 0%, #0a0e1a 100%)",
          border:`2px solid ${overflow ? C.a : "#1e2a45"}`,
          boxShadow: overflow
            ? `0 0 24px ${C.glow}, inset 0 0 12px ${C.glow}`
            : `inset 2px 0 6px #00000040, inset -2px 0 6px #ffffff08`,
          overflow:"hidden",
          transition:"border-color 0.4s, box-shadow 0.4s",
        }}>

          {/* Water fill container — sits at bottom, height = fillPct% */}
          <div style={{
            position:"absolute", bottom:0, left:0, right:0,
            height:`${fillPct}%`,
            transition:"height 1.2s cubic-bezier(0.4,0,0.2,1)",
            overflow:"hidden",
          }}>
            {/* Wave SVG — 200% wide, animated translate to create wave motion */}
            <div style={{
              position:"absolute", top:-18, left:0,
              width:"200%", height:36,
              animation:`${id}_wave 2.2s linear infinite`,
            }}>
              <svg viewBox="0 0 200 36" width="100%" height="36"
                preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M0,18 C25,4 50,32 75,18 C100,4 125,32 150,18 C175,4 200,32 200,18 L200,36 L0,36 Z"
                  fill={C.a} opacity="0.9"
                />
                <path
                  d="M0,22 C30,10 60,34 90,22 C120,10 150,34 200,22 L200,36 L0,36 Z"
                  fill={C.b} opacity="0.6"
                />
              </svg>
            </div>

            {/* Water body below wave */}
            <div style={{
              position:"absolute", top:16, left:0, right:0, bottom:0,
              background:`linear-gradient(180deg, ${C.a}cc 0%, ${C.b}aa 100%)`,
            }}/>

            {/* 3D sheen on water surface left side */}
            <div style={{
              position:"absolute", top:0, left:8, bottom:0, width:14,
              background:"linear-gradient(90deg, rgba(255,255,255,0.12), transparent)",
              borderRadius:4,
            }}/>
          </div>

          {/* Tick marks */}
          {[25, 50, 75].map(t => (
            <div key={t} style={{
              position:"absolute",
              bottom:`${t}%`, right:0,
              display:"flex", alignItems:"center",
            }}>
              <div style={{
                width:18, height:1,
                background:"#2a3a55",
                marginRight:0,
              }}/>
              <span style={{
                position:"absolute", right:22,
                color:"#2a3a55", fontSize:9,
                fontFamily:"'DM Sans',sans-serif", fontWeight:600,
              }}>{t}%</span>
            </div>
          ))}

          {/* Percentage label — always visible, above water when fill is low */}
          {fillPct > 30 ? (
            <div style={{
              position:"absolute", inset:0,
              display:"flex", alignItems:"center", justifyContent:"center",
              pointerEvents:"none",
            }}>
              <span style={{
                color:"#ffffff", fontSize:22, fontWeight:800,
                fontFamily:"'DM Sans',sans-serif",
                textShadow:`0 2px 8px #00000060`,
              }}>
                {Math.round(fillPct)}%
              </span>
            </div>
          ) : (
            <div style={{
              position:"absolute",
              bottom:`calc(${fillPct}% + 6px)`,
              left:0, right:0,
              display:"flex", justifyContent:"center",
              pointerEvents:"none",
            }}>
              <span style={{
                color: C.text, fontSize:13, fontWeight:800,
                fontFamily:"'DM Sans',sans-serif",
                textShadow:`0 0 8px ${C.glow}`,
              }}>
                {Math.round(fillPct)}%
              </span>
            </div>
          )}

          {/* Overflow warning strip at top */}
          {overflow && (
            <div style={{
              position:"absolute", top:0, left:0, right:0, height:6,
              background: C.a,
              animation:`${id}_warn 0.8s ease-in-out infinite`,
            }}/>
          )}
        </div>

        {/* Glass sheen overlay — always on top */}
        <div style={{
          position:"absolute", inset:0,
          borderRadius:16,
          background:"linear-gradient(120deg, rgba(255,255,255,0.07) 0%, transparent 50%)",
          pointerEvents:"none",
        }}/>

        {/* Overflow drip drops */}
        {overflow && [0, 1, 2].map(i => (
          <div key={i} style={{
            position:"absolute", top:-4,
            left:`${30 + i * 20}%`,
            width:6, height:6, borderRadius:"50%",
            background: C.a,
            animation:`${id}_drip ${0.7 + i * 0.3}s ease-in infinite`,
            animationDelay:`${i * 0.2}s`,
          }}/>
        ))}
      </div>

      {/* Usage text */}
      <div style={{ textAlign:"center" }}>
        <div style={{ color:"#4a7fa5", fontSize:11, marginBottom:4, letterSpacing:0.5 }}>
          Daily Usage
        </div>
        {total && limit && (
          <div style={{
            color: C.text, fontSize:16, fontWeight:800,
            textShadow:`0 0 16px ${C.glow}`,
            letterSpacing:0.5,
          }}>
            {total} / {limit} L
          </div>
        )}
        {overflow && (
          <div style={{
            color: C.text, fontSize:11, fontWeight:700,
            marginTop:6, letterSpacing:0.5,
            animation:`${id}_warn 1s ease-in-out infinite`,
          }}>
            ⚠️ LIMIT EXCEEDED
          </div>
        )}
      </div>
    </div>
  );
}
