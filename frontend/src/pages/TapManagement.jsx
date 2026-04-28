import { useState, useEffect } from "react";
import { getTaps, addTap, deleteTap, getUser, updateLimits } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import PageHeader from "../components/PageHeader";

const LOCATIONS = ["Bathroom","Kitchen","Toilet","Garden","Living Room","Balcony","Laundry","General"];

export default function ManagePage() {
  const { user }          = useAuth();
  const { t }             = useTheme();
  const uid               = user?.user_id;
  const [taps, setTaps]   = useState([]);
  const [profile, setProfile] = useState(null);
  const [form, setForm]   = useState({ tap_name:"", location:"Bathroom" });
  const [people, setPeople]     = useState(1);
  const [baseGreen, setBaseGreen]   = useState(100);
  const [baseOrange, setBaseOrange] = useState(200);
  const [msg, setMsg]     = useState({ tap:"", limits:"" });
  const [loading, setLoading] = useState(false);

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
      // axios: tp.data is the array from Flask
      const tapList = Array.isArray(tp?.data) ? tp.data : [];
      setTaps(tapList);
    } catch(e) { console.error(e); }
  };

  useEffect(() => { load(); }, [uid]);

  const addNewTap = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await addTap({ user_id:uid, tap_name:form.tap_name, location:form.location });
      setMsg(p => ({ ...p, tap:"✅ Tap added!" }));
      setForm({ tap_name:"", location:"Bathroom" });
      await load();
    } catch(err) {
      setMsg(p => ({ ...p, tap:"❌ " + (err.response?.data?.error||"Failed") }));
    } finally { setLoading(false); }
  };

  const removeTap = async (id) => {
    if (!window.confirm("Delete this tap?")) return;
    await deleteTap(id);
    await load();
  };

  const saveLimits = async (e) => {
    e.preventDefault();
    if (baseGreen >= baseOrange) {
      setMsg(p => ({ ...p, limits:"❌ Green must be less than orange" }));
      return;
    }
    try {
      const { data } = await updateLimits(uid, {
        people_count: people,
        base_green_per_person:  baseGreen,
        base_orange_per_person: baseOrange,
      });
      setMsg(p => ({ ...p, limits:`✅ Saved! 🟢${data.green_limit}L 🟠${data.orange_limit}L` }));
      setProfile(prev => ({ ...prev,
        people_count:           people,
        base_green_per_person:  baseGreen,
        base_orange_per_person: baseOrange,
        green_limit:            data.green_limit,
        orange_limit:           data.orange_limit,
      }));
    } catch(err) {
      setMsg(p => ({ ...p, limits:"❌ " + (err.response?.data?.error||"Failed") }));
    }
  };

  const card = { background:t.card, border:`1px solid ${t.border}`,
    borderRadius:16, padding:28 };
  const inp  = { width:"100%", padding:"11px 14px", background:t.inputBg,
    border:`1px solid ${t.border}`, borderRadius:10, color:t.text,
    fontSize:15, outline:"none", boxSizing:"border-box" };
  const lbl  = { display:"block", color:t.textMuted, fontSize:12,
    fontWeight:600, letterSpacing:0.8, textTransform:"uppercase", marginBottom:6 };

  return (
    <div style={{ color:t.text, fontFamily:"'DM Sans',sans-serif" }}>
      <PageHeader subtitle="Add and manage taps · configure household size and limits" />

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(340px,1fr))",
        gap:24, marginBottom:24 }}>

        {/* ── Add Tap ── */}
        <div style={card}>
          <SectionHeader t={t} icon="🚿" title="Add New Tap" />
          <form onSubmit={addNewTap}>
            <div style={{ marginBottom:16 }}>
              <label style={lbl}>Tap Name</label>
              <input value={form.tap_name}
                onChange={e=>setForm(p=>({...p,tap_name:e.target.value}))}
                placeholder="e.g. Main Bathroom Shower" required style={inp}/>
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={lbl}>Location</label>
              <select value={form.location}
                onChange={e=>setForm(p=>({...p,location:e.target.value}))}
                style={{...inp,cursor:"pointer"}}>
                {LOCATIONS.map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
            {msg.tap && <MsgBox msg={msg.tap} t={t}/>}
            <button type="submit" disabled={loading} style={{
              width:"100%", padding:"12px",
              background:`linear-gradient(135deg,${t.cyan},${t.blue})`,
              border:"none", borderRadius:10, color:"#fff",
              fontSize:15, fontWeight:700, cursor:"pointer",
            }}>
              {loading ? "Adding…" : "Add Tap"}
            </button>
          </form>
        </div>

        {/* ── Household Config ── */}
        <div style={card}>
          <SectionHeader t={t} icon="🏠" title="Household Configuration" />
          <form onSubmit={saveLimits}>
            <div style={{ marginBottom:22 }}>
              <label style={lbl}>Number of People at Home</label>
              <div style={{ display:"flex", alignItems:"stretch",
                borderRadius:10, overflow:"hidden", marginTop:8 }}>
                <button type="button" onClick={()=>setPeople(p=>Math.max(1,p-1))}
                  style={{ width:52, background:`${t.cyan}18`, border:`1px solid ${t.border}`,
                    borderRight:"none", color:t.cyan, fontSize:24,
                    cursor:"pointer", fontWeight:700 }}>−</button>
                <div style={{ flex:1, textAlign:"center", fontSize:32, fontWeight:800,
                  color:t.cyan, background:t.inputBg,
                  border:`1px solid ${t.border}`, borderLeft:"none", borderRight:"none",
                  padding:"8px 0" }}>{people}</div>
                <button type="button" onClick={()=>setPeople(p=>Math.min(20,p+1))}
                  style={{ width:52, background:`${t.cyan}18`, border:`1px solid ${t.border}`,
                    borderLeft:"none", color:t.cyan, fontSize:24,
                    cursor:"pointer", fontWeight:700 }}>+</button>
              </div>
              <div style={{ display:"flex", gap:6, marginTop:10, justifyContent:"center" }}>
                {Array.from({length:Math.min(people,10)}).map((_,i)=>(
                  <span key={i} style={{fontSize:18}}>👤</span>
                ))}
                {people>10 && <span style={{color:t.textMuted,fontSize:13}}>+{people-10}</span>}
              </div>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
              <div>
                <label style={{...lbl,color:t.green}}>🟢 Green / Person (L)</label>
                <input type="number" min="10" max="500" step="5"
                  value={baseGreen} onChange={e=>setBaseGreen(+e.target.value)}
                  style={inp}/>
              </div>
              <div>
                <label style={{...lbl,color:t.orange}}>🟠 Orange / Person (L)</label>
                <input type="number" min="10" max="1000" step="5"
                  value={baseOrange} onChange={e=>setBaseOrange(+e.target.value)}
                  style={inp}/>
              </div>
            </div>

            {/* Live preview */}
            <div style={{ background:t.card2, border:`1px solid ${t.border}`,
              borderRadius:10, padding:14, marginBottom:16 }}>
              <div style={{ color:t.textMuted, fontSize:11, fontWeight:600,
                letterSpacing:0.8, textTransform:"uppercase", marginBottom:10 }}>
                House Total (auto-calculated)
              </div>
              <div style={{ display:"flex", gap:12 }}>
                {[
                  {c:t.green, icon:"🟢",label:"Green",v:`${baseGreen}×${people} = ${calcGreen} L`},
                  {c:t.orange,icon:"🟠",label:"Orange",v:`${baseOrange}×${people} = ${calcOrange} L`},
                  {c:t.red,   icon:"🔴",label:"Red",   v:`>${calcOrange} L`},
                ].map(({c,icon,label,v})=>(
                  <div key={label} style={{ flex:1, background:`${c}12`,
                    border:`1px solid ${c}35`, borderRadius:8, padding:"8px 10px",
                    textAlign:"center" }}>
                    <div style={{fontSize:18}}>{icon}</div>
                    <div style={{color:c,fontSize:11,fontWeight:700}}>{label}</div>
                    <div style={{color:t.textMuted,fontSize:10,marginTop:2}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ height:10, borderRadius:5, overflow:"hidden",
                display:"flex", marginTop:12 }}>
                <div style={{flex:calcGreen, background:t.green, opacity:0.7}}/>
                <div style={{flex:calcOrange-calcGreen, background:t.orange, opacity:0.7}}/>
                <div style={{flex:calcOrange*0.2, background:t.red, opacity:0.7}}/>
              </div>
            </div>

            {msg.limits && <MsgBox msg={msg.limits} t={t}/>}
            <button type="submit" style={{
              width:"100%", padding:"12px",
              background:`linear-gradient(135deg,${t.cyan},${t.blue})`,
              border:"none", borderRadius:10, color:"#fff",
              fontSize:15, fontWeight:700, cursor:"pointer",
            }}>
              💾 Save Settings
            </button>
          </form>
        </div>

        {/* ── Profile ── */}
        {profile && (
          <div style={card}>
            <SectionHeader t={t} icon="👤" title="User Profile" />
            {[
              { label:"Name",           val:profile.name },
              { label:"Email",          val:profile.email },
              { label:"User ID",        val:`#${profile.user_id}` },
              { label:"People at Home", val:<span style={{color:t.cyan,fontWeight:800,fontSize:18}}>{profile.people_count||1} 👤</span>},
              { label:"Green Limit",    val:<span style={{color:t.green,fontWeight:700}}>{profile.green_limit} L/day</span>},
              { label:"Orange Limit",   val:<span style={{color:t.orange,fontWeight:700}}>{profile.orange_limit} L/day</span>},
            ].map(({label,val})=>(
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

      {/* ── Tap list ── */}
      <div style={card}>
        <SectionHeader t={t} icon="📋" title={`Registered Taps (${taps.length})`}/>
        {taps.length===0 ? (
          <p style={{color:t.textMuted,fontSize:14}}>No taps yet. Add your first tap above.</p>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
              <thead>
                <tr>
                  {["ID","Tap Name","Location","Status","Usage Today","Action"].map(h=>(
                    <th key={h} style={{color:t.textMuted,textAlign:"left",
                      padding:"10px 12px",borderBottom:`1px solid ${t.border}`,
                      fontSize:12,fontWeight:600,letterSpacing:0.6}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {taps.map(tap=>(
                  <tr key={tap.tap_id}>
                    <td style={tdS(t)}>#{tap.tap_id}</td>
                    <td style={{...tdS(t),color:t.text,fontWeight:600}}>{tap.tap_name}</td>
                    <td style={tdS(t)}>{tap.location}</td>
                    <td style={tdS(t)}>
                      <span style={{
                        padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700,
                        background:tap.tap_status==="ON"?`${t.green}20`:`${t.textMuted}15`,
                        color:tap.tap_status==="ON"?t.green:t.textMuted,
                      }}>{tap.tap_status}</span>
                    </td>
                    <td style={{...tdS(t),color:t.cyan,fontWeight:700}}>
                      {(tap.current_usage||0).toFixed(2)} L
                    </td>
                    <td style={tdS(t)}>
                      <button onClick={()=>removeTap(tap.tap_id)} style={{
                        padding:"5px 12px",background:`${t.red}15`,
                        border:`1px solid ${t.red}35`,borderRadius:7,
                        color:t.red,cursor:"pointer",fontSize:12,
                      }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ t, icon, title }) {
  return (
    <div style={{ color:t.text, fontSize:16, fontWeight:700, marginBottom:20,
      display:"flex", alignItems:"center", gap:8 }}>
      <span>{icon}</span> {title}
    </div>
  );
}

function MsgBox({ msg, t }) {
  const ok = msg.startsWith("✅");
  return (
    <div style={{
      padding:"10px 14px", borderRadius:8, fontSize:13, marginBottom:14,
      background: ok ? `${t.green}15` : `${t.red}15`,
      border:`1px solid ${ok ? t.green+"40" : t.red+"40"}`,
      color: ok ? t.green : t.red,
    }}>{msg}</div>
  );
}

const tdS = (t) => ({
  padding:"10px 12px", color:t.textMuted,
  borderBottom:`1px solid ${t.border}`,
});
