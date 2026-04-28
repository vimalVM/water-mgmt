import { useState, useEffect } from "react";
import { getUser, updateLimits } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import PageHeader from "../components/PageHeader";

export default function SystemConfig() {
  const { user }          = useAuth();
  const { t }             = useTheme();
  const uid               = user?.user_id;
  const [profile, setProfile] = useState(null);
  const [people,     setPeople]     = useState(1);
  const [baseGreen,  setBaseGreen]  = useState(100);
  const [baseOrange, setBaseOrange] = useState(200);
  const [msg, setMsg] = useState("");

  const calcGreen  = +(baseGreen  * people).toFixed(1);
  const calcOrange = +(baseOrange * people).toFixed(1);

  useEffect(() => {
    getUser(uid).then(r => {
      const d = r.data;
      setProfile(d);
      setPeople(d.people_count || 1);
      setBaseGreen(d.base_green_per_person || 100);
      setBaseOrange(d.base_orange_per_person || 200);
    }).catch(console.error);
  }, [uid]);

  const save = async (e) => {
    e.preventDefault();
    if (baseGreen >= baseOrange) {
      setMsg("❌ Green limit per person must be less than orange"); return;
    }
    try {
      const { data } = await updateLimits(uid, {
        people_count: people,
        base_green_per_person:  baseGreen,
        base_orange_per_person: baseOrange,
      });
      setMsg(`✅ Saved! House limits — 🟢 ${data.green_limit} L  🟠 ${data.orange_limit} L`);
      setProfile(p => ({ ...p,
        people_count:           people,
        base_green_per_person:  baseGreen,
        base_orange_per_person: baseOrange,
        green_limit:            data.green_limit,
        orange_limit:           data.orange_limit,
      }));
    } catch(err) {
      setMsg("❌ " + (err.response?.data?.error || "Failed to save"));
    }
  };

  const card = { background:t.card, border:`1px solid ${t.border}`, borderRadius:16, padding:28 };
  const inp  = { width:"100%", padding:"11px 14px", background:t.inputBg,
    border:`1px solid ${t.border}`, borderRadius:10, color:t.text,
    fontSize:15, outline:"none", boxSizing:"border-box" };
  const lbl  = { display:"block", color:t.textMuted, fontSize:12,
    fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:6 };

  return (
    <div style={{ color:t.text, fontFamily:"'DM Sans',sans-serif" }}>
      <PageHeader subtitle="Household size, usage alert limits, and AI water manager settings" />

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(340px,1fr))",
        gap:24, marginBottom:24 }}>

        {/* ── Household Config ── */}
        <div style={card}>
          <div style={{ fontSize:16, fontWeight:700, color:t.text,
            marginBottom:20, display:"flex", alignItems:"center", gap:8 }}>
            🏠 Household Configuration
          </div>
          <form onSubmit={save}>
            {/* People counter */}
            <div style={{ marginBottom:24 }}>
              <label style={lbl}>Number of People at Home</label>
              <div style={{ display:"flex", alignItems:"stretch",
                borderRadius:10, overflow:"hidden", marginTop:8, border:`1px solid ${t.border}` }}>
                <button type="button" onClick={() => setPeople(p => Math.max(1,p-1))}
                  style={{ width:52, background:`${t.cyan}15`, border:"none",
                    color:t.cyan, fontSize:24, cursor:"pointer", fontWeight:700 }}>−</button>
                <div style={{ flex:1, textAlign:"center", fontSize:34, fontWeight:800,
                  color:t.cyan, background:t.inputBg, padding:"10px 0",
                  borderLeft:`1px solid ${t.border}`, borderRight:`1px solid ${t.border}` }}>
                  {people}
                </div>
                <button type="button" onClick={() => setPeople(p => Math.min(20,p+1))}
                  style={{ width:52, background:`${t.cyan}15`, border:"none",
                    color:t.cyan, fontSize:24, cursor:"pointer", fontWeight:700 }}>+</button>
              </div>
              <div style={{ display:"flex", gap:4, marginTop:10, justifyContent:"center", flexWrap:"wrap" }}>
                {Array.from({length:Math.min(people,12)}).map((_,i)=>(
                  <span key={i} style={{fontSize:20}}>👤</span>
                ))}
                {people > 12 && <span style={{color:t.textMuted,alignSelf:"center"}}>+{people-12}</span>}
              </div>
            </div>

            {/* Per-person limits */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
              <div>
                <label style={{...lbl, color:t.green}}>🟢 Green / Person (L/day)</label>
                <input type="number" min="10" max="500" step="5"
                  value={baseGreen} onChange={e=>setBaseGreen(+e.target.value)}
                  style={inp}/>
                <div style={{color:t.textSub,fontSize:11,marginTop:4}}>Below = safe usage</div>
              </div>
              <div>
                <label style={{...lbl, color:t.orange}}>🟠 Orange / Person (L/day)</label>
                <input type="number" min="10" max="1000" step="5"
                  value={baseOrange} onChange={e=>setBaseOrange(+e.target.value)}
                  style={inp}/>
                <div style={{color:t.textSub,fontSize:11,marginTop:4}}>Above = red alert</div>
              </div>
            </div>

            {/* Live preview */}
            <div style={{ background:t.card2, border:`1px solid ${t.border}`,
              borderRadius:12, padding:16, marginBottom:18 }}>
              <div style={{ color:t.textMuted, fontSize:11, fontWeight:600,
                letterSpacing:0.8, textTransform:"uppercase", marginBottom:12 }}>
                📊 House Total — Auto-Calculated
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                {[
                  {c:t.green,  icon:"🟢", label:"Green",  v:`${baseGreen} × ${people} = ${calcGreen} L`},
                  {c:t.orange, icon:"🟠", label:"Orange", v:`${baseOrange} × ${people} = ${calcOrange} L`},
                  {c:t.red,    icon:"🔴", label:"Red",    v:`> ${calcOrange} L`},
                ].map(({c,icon,label,v}) => (
                  <div key={label} style={{ background:`${c}12`,
                    border:`1px solid ${c}35`, borderRadius:10, padding:"10px 8px",
                    textAlign:"center" }}>
                    <div style={{fontSize:20,marginBottom:4}}>{icon}</div>
                    <div style={{color:c,fontSize:12,fontWeight:700}}>{label}</div>
                    <div style={{color:t.textMuted,fontSize:10,marginTop:4,wordBreak:"break-word"}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Colour band */}
              <div style={{ height:12, borderRadius:6, overflow:"hidden",
                display:"flex", marginTop:14 }}>
                <div style={{flex:calcGreen,       background:t.green,  opacity:0.75}}/>
                <div style={{flex:calcOrange-calcGreen, background:t.orange, opacity:0.75}}/>
                <div style={{flex:calcOrange*0.2,  background:t.red,    opacity:0.75}}/>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between",
                color:t.textSub, fontSize:10, marginTop:6 }}>
                <span>0 L</span>
                <span style={{color:t.green}}>Green &lt; {calcGreen} L</span>
                <span style={{color:t.orange}}>Orange &lt; {calcOrange} L</span>
                <span style={{color:t.red}}>Red ↑</span>
              </div>
            </div>

            {/* AI throttle info */}
            <div style={{ background:`${t.orange}12`, border:`1px solid ${t.orange}35`,
              borderRadius:10, padding:"12px 14px", marginBottom:18 }}>
              <div style={{color:t.orange,fontSize:13,fontWeight:700,marginBottom:4}}>
                🤖 AI Water Manager
              </div>
              <div style={{color:t.textMuted,fontSize:13}}>
                When today's total crosses the <strong style={{color:t.green}}>Green limit</strong>,
                the simulator automatically reduces flow to <strong style={{color:t.orange}}>30%</strong> to conserve water.
                An alert banner appears on the Dashboard.
              </div>
            </div>

            {msg && (
              <div style={{
                padding:"10px 14px", borderRadius:8, fontSize:13, marginBottom:14,
                background: msg.startsWith("✅") ? `${t.green}15` : `${t.red}15`,
                border:`1px solid ${msg.startsWith("✅") ? t.green+"40" : t.red+"40"}`,
                color: msg.startsWith("✅") ? t.green : t.red,
              }}>{msg}</div>
            )}

            <button type="submit" style={{
              width:"100%", padding:"13px",
              background:`linear-gradient(135deg,${t.cyan},${t.blue})`,
              border:"none", borderRadius:10, color:"#fff",
              fontSize:15, fontWeight:700, cursor:"pointer",
            }}>
              💾 Save Configuration
            </button>
          </form>
        </div>

        {/* ── Profile ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
          {profile && (
            <div style={card}>
              <div style={{ fontSize:16, fontWeight:700, color:t.text,
                marginBottom:20, display:"flex", alignItems:"center", gap:8 }}>
                👤 User Profile
              </div>
              {[
                { label:"Name",            val: profile.name },
                { label:"Email",           val: profile.email },
                { label:"User ID",         val: `#${profile.user_id}` },
                { label:"Member Since",    val: profile.created_at?.substring(0,10) },
                { label:"People at Home",  val: <span style={{color:t.cyan,fontWeight:800,fontSize:18}}>{profile.people_count||1} 👤</span> },
                { label:"Green Limit",     val: <span style={{color:t.green,fontWeight:700}}>{profile.green_limit} L/day</span> },
                { label:"Orange Limit",    val: <span style={{color:t.orange,fontWeight:700}}>{profile.orange_limit} L/day</span> },
              ].map(({label,val}) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", padding:"10px 0",
                  borderBottom:`1px solid ${t.border}` }}>
                  <span style={{color:t.textMuted,fontSize:14}}>{label}</span>
                  <span style={{color:t.text,fontSize:14,fontWeight:600}}>{val}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
