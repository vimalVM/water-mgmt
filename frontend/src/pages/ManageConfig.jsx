import { useState, useEffect } from "react";
import { getTaps, addTap, deleteTap, getUser, updateLimits, getTapLimits } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import PageHeader from "../components/PageHeader";

const LOCATIONS = ["Bathroom","Kitchen","Toilet","Garden","Living Room","Balcony","Laundry","General"];

export default function ManageConfig() {
  const { user } = useAuth();
  const { t }    = useTheme();
  const uid      = user?.user_id;

  const [taps,       setTaps]       = useState([]);
  const [profile,    setProfile]    = useState(null);
  const [form,       setForm]       = useState({ tap_name:"", location:"Bathroom" });
  const [people,     setPeople]     = useState(1);
  const [baseGreen,  setBaseGreen]  = useState(100);
  const [baseOrange, setBaseOrange] = useState(200);
  const [tapMsg,     setTapMsg]     = useState("");
  const [limMsg,     setLimMsg]     = useState("");
  const [adding,     setAdding]     = useState(false);
  const [aiLimits,   setAiLimits]   = useState(null);
  const [aiLoading,  setAiLoading]  = useState(true);

  const calcGreen  = +(baseGreen  * people).toFixed(1);
  const calcOrange = +(baseOrange * people).toFixed(1);

  const load = async () => {
    try {
      const [u, tp] = await Promise.all([
        getUser(uid).catch(()=>null),
        getTaps(uid).catch(()=>null),
      ]);
      if (u?.data) {
        setProfile(u.data);
        setPeople(u.data.people_count || 1);
        setBaseGreen(u.data.base_green_per_person || 100);
        setBaseOrange(u.data.base_orange_per_person || 200);
      }
      setTaps(Array.isArray(tp?.data) ? tp.data : []);
    } catch(e) { console.error(e); }
  };

  useEffect(() => { load(); }, [uid]);

  // Load AI per-tap limits
  useEffect(() => {
    if (!uid) return;
    setAiLoading(true);
    getTapLimits(uid)
      .then(res => setAiLimits(res.data))
      .catch(() => setAiLimits(null))
      .finally(() => setAiLoading(false));
  }, [uid, taps.length]);

  const addTapSubmit = async (e) => {
    e.preventDefault();
    if (!form.tap_name.trim()) return;
    setAdding(true);
    try {
      await addTap({ user_id:uid, tap_name:form.tap_name.trim(), location:form.location });
      setTapMsg("✅ Tap added!");
      setForm({ tap_name:"", location:"Bathroom" });
      await load();
    } catch(err) {
      setTapMsg("❌ " + (err.response?.data?.error||"Failed to add tap"));
    } finally { setAdding(false); }
  };

  const removeTap = async (id) => {
    if (!window.confirm("Delete this tap and all its data?")) return;
    await deleteTap(id);
    await load();
  };

  const saveLimits = async (e) => {
    e.preventDefault();
    if (baseGreen >= baseOrange) {
      setLimMsg("❌ Green limit must be less than orange"); return;
    }
    try {
      const { data } = await updateLimits(uid, {
        people_count: people,
        base_green_per_person:  baseGreen,
        base_orange_per_person: baseOrange,
      });
      setLimMsg(`✅ Saved — 🟢 ${data.green_limit} L / 🟠 ${data.orange_limit} L`);
      setProfile(p => ({ ...p,
        people_count: people,
        base_green_per_person:  baseGreen,
        base_orange_per_person: baseOrange,
        green_limit:  data.green_limit,
        orange_limit: data.orange_limit,
      }));
    } catch(err) {
      setLimMsg("❌ " + (err.response?.data?.error||"Failed to save"));
    }
  };

  const card = { background:t.card, border:`1px solid ${t.border}`,
    borderRadius:14, padding:24 };
  const inp  = { width:"100%", padding:"11px 14px", background:t.inputBg,
    border:`1px solid ${t.border}`, borderRadius:10, color:t.text,
    fontSize:14, outline:"none", boxSizing:"border-box" };
  const lbl  = (clr) => ({ display:"block", color: clr||t.textMuted,
    fontSize:11, fontWeight:600, letterSpacing:0.8,
    textTransform:"uppercase", marginBottom:6 });

  return (
    <div style={{ color:t.text, fontFamily:"'DM Sans',sans-serif" }}>
      <PageHeader subtitle="Manage taps · configure household size and usage limits" />

      <div style={{ display:"grid",
        gridTemplateColumns:"repeat(auto-fit,minmax(320px,1fr))",
        gap:20, marginBottom:20 }}>

        {/* ── ADD TAP ── */}
        <div style={card}>
          <SectionTitle t={t} icon="➕" text="Add New Tap" />
          <form onSubmit={addTapSubmit}>
            <div style={{ marginBottom:14 }}>
              <label style={lbl()}>Tap Name</label>
              <input value={form.tap_name}
                onChange={e=>setForm(p=>({...p,tap_name:e.target.value}))}
                placeholder="e.g. Main Bathroom Shower" required style={inp}/>
            </div>
            <div style={{ marginBottom:18 }}>
              <label style={lbl()}>Location</label>
              <select value={form.location}
                onChange={e=>setForm(p=>({...p,location:e.target.value}))}
                style={{...inp,cursor:"pointer"}}>
                {LOCATIONS.map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
            {tapMsg && <Msg msg={tapMsg} t={t}/>}
            <button type="submit" disabled={adding} style={btnPrimary(t)}>
              {adding?"Adding…":"Add Tap"}
            </button>
          </form>
        </div>

        {/* ── HOUSEHOLD LIMITS ── */}
        <div style={card}>
          <SectionTitle t={t} icon="🏠" text="Household Configuration" />
          <form onSubmit={saveLimits}>
            {/* People counter */}
            <div style={{ marginBottom:20 }}>
              <label style={lbl()}>Number of People at Home</label>
              <div style={{ display:"flex", borderRadius:10, overflow:"hidden",
                border:`1px solid ${t.border}`, marginTop:8 }}>
                <button type="button" onClick={()=>setPeople(p=>Math.max(1,p-1))}
                  style={{ width:50, background:`${t.cyan}15`, border:"none",
                    color:t.cyan, fontSize:22, cursor:"pointer", fontWeight:700 }}>−</button>
                <div style={{ flex:1, textAlign:"center", fontSize:30, fontWeight:800,
                  color:t.cyan, background:t.inputBg, padding:"9px 0",
                  borderLeft:`1px solid ${t.border}`,
                  borderRight:`1px solid ${t.border}` }}>{people}</div>
                <button type="button" onClick={()=>setPeople(p=>Math.min(20,p+1))}
                  style={{ width:50, background:`${t.cyan}15`, border:"none",
                    color:t.cyan, fontSize:22, cursor:"pointer", fontWeight:700 }}>+</button>
              </div>
              <div style={{ display:"flex", gap:4, marginTop:8,
                justifyContent:"center", flexWrap:"wrap" }}>
                {Array.from({length:Math.min(people,10)}).map((_,i)=>(
                  <span key={i} style={{fontSize:18}}>👤</span>
                ))}
                {people>10&&<span style={{color:t.textMuted,alignSelf:"center",fontSize:13}}>
                  +{people-10} more</span>}
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr",
              gap:12, marginBottom:14 }}>
              <div>
                <label style={lbl(t.green)}>🟢 Green / Person (L)</label>
                <input type="number" min="10" max="500" step="5"
                  value={baseGreen} onChange={e=>setBaseGreen(+e.target.value)}
                  style={inp}/>
              </div>
              <div>
                <label style={lbl(t.orange)}>🟠 Orange / Person (L)</label>
                <input type="number" min="10" max="1000" step="5"
                  value={baseOrange} onChange={e=>setBaseOrange(+e.target.value)}
                  style={inp}/>
              </div>
            </div>

            {/* Live preview band */}
            <div style={{ background:t.card2, border:`1px solid ${t.border}`,
              borderRadius:10, padding:14, marginBottom:14 }}>
              <div style={{ color:t.textMuted, fontSize:10, fontWeight:600,
                letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>
                House Total (auto-calculated)
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                {[
                  {c:t.green, icon:"🟢",label:"Green",  v:`${baseGreen}×${people}=${calcGreen}L`},
                  {c:t.orange,icon:"🟠",label:"Orange", v:`${baseOrange}×${people}=${calcOrange}L`},
                  {c:t.red,   icon:"🔴",label:"Red",    v:`>${calcOrange}L`},
                ].map(({c,icon,label,v})=>(
                  <div key={label} style={{ background:`${c}12`,
                    border:`1px solid ${c}35`, borderRadius:8,
                    padding:"8px 6px", textAlign:"center" }}>
                    <div style={{fontSize:16}}>{icon}</div>
                    <div style={{color:c,fontSize:11,fontWeight:700}}>{label}</div>
                    <div style={{color:t.textMuted,fontSize:9,marginTop:3,
                      wordBreak:"break-all"}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ height:8, borderRadius:4, overflow:"hidden",
                display:"flex", marginTop:10 }}>
                <div style={{flex:calcGreen,background:t.green,opacity:0.75}}/>
                <div style={{flex:calcOrange-calcGreen,background:t.orange,opacity:0.75}}/>
                <div style={{flex:calcOrange*0.2,background:t.red,opacity:0.75}}/>
              </div>
            </div>

            {/* AI note */}
            <div style={{ background:`${t.orange}12`, border:`1px solid ${t.orange}35`,
              borderRadius:8, padding:"10px 12px", marginBottom:14 }}>
              <div style={{color:t.orange,fontSize:12,fontWeight:700,marginBottom:3}}>
                🤖 Water Manager
              </div>
              <div style={{color:t.textMuted,fontSize:12}}>
                When usage crosses the green limit, simulator
                automatically reduces flow to <strong style={{color:t.orange}}>30%</strong>.
              </div>
            </div>

            {limMsg && <Msg msg={limMsg} t={t}/>}
            <button type="submit" style={btnPrimary(t)}>💾 Save Settings</button>
          </form>
        </div>

        {/* ── PROFILE ── */}
        {profile && (
          <div style={card}>
            <SectionTitle t={t} icon="👤" text="User Profile" />
            {[
              {label:"Name",         val:profile.name},
              {label:"Email",        val:profile.email},
              {label:"User ID",      val:`#${profile.user_id}`},
              {label:"Member Since", val:profile.created_at?.substring(0,10)},
              {label:"People",       val:<span style={{color:t.cyan,fontWeight:800,fontSize:16}}>{profile.people_count||1} 👤</span>},
              {label:"Green Limit",  val:<span style={{color:t.green,fontWeight:700}}>{profile.green_limit} L/day</span>},
              {label:"Orange Limit", val:<span style={{color:t.orange,fontWeight:700}}>{profile.orange_limit} L/day</span>},
            ].map(({label,val})=>(
              <div key={label} style={{ display:"flex", justifyContent:"space-between",
                alignItems:"center", padding:"9px 0",
                borderBottom:`1px solid ${t.border}` }}>
                <span style={{color:t.textMuted,fontSize:14}}>{label}</span>
                <span style={{color:t.text,fontSize:14,fontWeight:600}}>{val}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── TAP LIST ── */}
      <div style={card}>
        <SectionTitle t={t} icon="📋"
          text={`Registered Taps (${taps.length})`} />
        {taps.length===0 ? (
          <p style={{color:t.textMuted,fontSize:14}}>
            No taps yet. Add your first tap above.
          </p>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
              <thead>
                <tr>
                  {["ID","Tap Name","Location","Status","Usage Today","Action"].map(h=>(
                    <th key={h} style={{color:t.textMuted,textAlign:"left",
                      padding:"9px 12px",borderBottom:`1px solid ${t.border}`,
                      fontSize:11,fontWeight:600,letterSpacing:0.6}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {taps.map((tap, index)=>(
                  <tr key={tap.tap_id}>
                    <td style={td(t)}>#{index + 1}</td>
                    <td style={{...td(t),color:t.text,fontWeight:600}}>{tap.tap_name}</td>
                    <td style={td(t)}>{tap.location}</td>
                    <td style={td(t)}>
                      <span style={{ padding:"2px 9px", borderRadius:20,
                        fontSize:11, fontWeight:700,
                        background:tap.tap_status==="ON"?`${t.green}20`:`${t.textMuted}15`,
                        color:tap.tap_status==="ON"?t.green:t.textMuted }}>
                        {tap.tap_status}
                      </span>
                    </td>
                    <td style={{...td(t),color:t.cyan,fontWeight:700}}>
                      {(tap.current_usage||0).toFixed(2)} L
                    </td>
                    <td style={td(t)}>
                      <button onClick={()=>removeTap(tap.tap_id)} style={{
                        padding:"5px 12px",background:`${t.red}15`,
                        border:`1px solid ${t.red}35`,borderRadius:7,
                        color:t.red,cursor:"pointer",fontSize:12 }}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── AI PER-TAP LIMITS ── */}
      <div style={card}>
        <SectionTitle t={t} icon="🤖" text="AI-Recommended Tap Limits" />
        {aiLoading ? (
          <div style={{color:t.textMuted,fontSize:14,padding:"20px 0",textAlign:"center"}}>
            Analyzing tap usage patterns…
          </div>
        ) : !aiLimits || !aiLimits.tap_limits || aiLimits.tap_limits.length === 0 ? (
          <div style={{color:t.textMuted,fontSize:14,padding:"20px 0",textAlign:"center"}}>
            <div style={{fontSize:28,marginBottom:8}}>📊</div>
            No tap data available yet. Add taps and let the simulator run to generate AI recommendations.
          </div>
        ) : (
          <>
            <div style={{
              display:"flex", alignItems:"center", gap:8, marginBottom:14,
              padding:"8px 12px", borderRadius:8,
              background: aiLimits.model_type === "lightgbm" ? "#a855f715" : `${t.cyan}12`,
              border: `1px solid ${aiLimits.model_type === "lightgbm" ? "#a855f740" : `${t.cyan}35`}`,
            }}>
              <span style={{
                padding:"3px 9px", borderRadius:16, fontSize:11, fontWeight:700,
                background: aiLimits.model_type === "lightgbm" ? "#a855f720" : `${t.cyan}20`,
                color: aiLimits.model_type === "lightgbm" ? "#a855f7" : t.cyan,
              }}>
                {aiLimits.model_type === "lightgbm" ? "🧠 LightGBM" : "📊 Proportional"}
              </span>
              <span style={{color:t.textMuted,fontSize:12}}>
                Based on last 30 days of usage data · household limits: 🟢 {aiLimits.household_green}L / 🟠 {aiLimits.household_orange}L
              </span>
            </div>

            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
                <thead>
                  <tr>
                    {["Tap","Location","Avg Daily (L)","Share","🟢 Green","🟠 Orange"].map(h=>(
                      <th key={h} style={{color:t.textMuted,textAlign:"left",
                        padding:"9px 10px",borderBottom:`1px solid ${t.border}`,
                        fontSize:11,fontWeight:600,letterSpacing:0.6}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aiLimits.tap_limits.map((tap, i) => {
                    const sharePct = tap.usage_share_pct || 0;
                    const barColors = ["#00C4FF","#FF6B35","#00D97E","#A855F7","#FFD700","#FF4D6D"];
                    const barColor = barColors[i % barColors.length];
                    return (
                      <tr key={tap.tap_id || i}>
                        <td style={{...td(t),color:t.text,fontWeight:600}}>{tap.tap_name}</td>
                        <td style={td(t)}>{tap.location}</td>
                        <td style={{...td(t),color:t.cyan,fontWeight:700}}>{tap.avg_daily_usage} L</td>
                        <td style={td(t)}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{width:60,height:7,background:t.border,borderRadius:3,overflow:"hidden"}}>
                              <div style={{width:`${Math.min(100,sharePct)}%`,height:"100%",
                                background:barColor,borderRadius:3,
                                transition:"width 0.5s ease"}} />
                            </div>
                            <span style={{fontSize:13,fontWeight:600,color:barColor}}>{sharePct}%</span>
                          </div>
                        </td>
                        <td style={{...td(t),color:t.green,fontWeight:700}}>{tap.recommended_green} L</td>
                        <td style={{...td(t),color:t.orange,fontWeight:700}}>{tap.recommended_orange} L</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{marginTop:12,padding:"8px 12px",borderRadius:8,
              background:`${t.cyan}08`,border:`1px solid ${t.border}`,
              color:t.textMuted,fontSize:12,lineHeight:1.5}}>
              💡 These are <strong style={{color:t.text}}>AI recommendations</strong> based on your
              historical usage patterns. Limits shown are proportional shares of your household
              total ({aiLimits.household_green}L green / {aiLimits.household_orange}L orange).
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ t, icon, text }) {
  return (
    <div style={{ color:t.text, fontSize:15, fontWeight:700, marginBottom:18,
      display:"flex", alignItems:"center", gap:8 }}>
      {icon} {text}
    </div>
  );
}

function Msg({ msg, t }) {
  const ok = msg.startsWith("✅");
  return (
    <div style={{ padding:"9px 13px", borderRadius:8, fontSize:13, marginBottom:12,
      background: ok?`${t.green}15`:`${t.red}15`,
      border:`1px solid ${ok?t.green+"40":t.red+"40"}`,
      color: ok?t.green:t.red }}>
      {msg}
    </div>
  );
}

const btnPrimary = (t) => ({
  width:"100%", padding:"12px",
  background:`linear-gradient(135deg,${t.cyan},${t.blue})`,
  border:"none", borderRadius:10, color:"#fff",
  fontSize:14, fontWeight:700, cursor:"pointer",
});

const td = (t) => ({
  padding:"10px 12px", color:t.textMuted,
  borderBottom:`1px solid ${t.border}`,
});
