import { useState, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { getDashboard, getDailyUsage, tapOn, tapOff, getTaps } from "../api";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useResponsive } from "../hooks/useResponsive";
import WaterTank from "../components/WaterTank";
import PageHeader from "../components/PageHeader";
import AIForecastWidget from "../components/AIForecastWidget";

// Distinct, well-separated pie colors
const PIE_COLORS = ["#00C4FF","#FF6B35","#00D97E","#A855F7","#FFD700","#FF4D6D"];
const BASE = "http://localhost:5000";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(str) {
  if (!str) return "";
  const p = String(str).split("-");
  if (p.length < 3) return str;
  return `${p[2]} ${MONTHS[(parseInt(p[1],10)-1)] || ""}`;
}

function fmtHour(h) {
  const n = ((h % 24) + 24) % 24;
  if (n === 0)  return "12 AM";
  if (n < 12)   return `${n} AM`;
  if (n === 12) return "12 PM";
  return `${n - 12} PM`;
}

async function fetchTodayHourly(uid) {
  const token = localStorage.getItem("token") || "";
  const r = await axios.get(`${BASE}/today-hourly/${uid}`,
    { headers: { Authorization: `Bearer ${token}` } });
  return r.data;
}


export default function Dashboard() {
  const { user }           = useAuth();
  const { t }              = useTheme();
  const { isMobile }       = useResponsive();
  const uid                = user?.user_id;

  const [dash,      setDash]      = useState(null);
  const [taps,      setTaps]      = useState([]);
  const [todayHr,   setTodayHr]   = useState([]);
  const [byTap,     setByTap]     = useState([]);
  const [daily,     setDaily]     = useState([]);
  const [toggling,  setToggling]  = useState({});
  const [loading,   setLoading]   = useState(true);
  const [throttled, setThrottled] = useState(false);
  const [hrWindow,  setHrWindow]  = useState(0);

  const fL = useRef(false);
  const mL = useRef(false);
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };

  const loadFast = useCallback(async () => {
    if (fL.current) return;
    fL.current = true;
    try {
      const [d, tp] = await Promise.all([
        safe(() => getDashboard(uid)),
        safe(() => getTaps(uid)),
      ]);
      if (d?.data) {
        setDash(d.data);
        const tot = d.data.today_total || 0;
        const gl  = d.data.green_limit || 9999;
        setThrottled(tot >= gl && gl < 9999);
      }
      if (tp?.data) setTaps(Array.isArray(tp.data) ? tp.data : []);
      setLoading(false);
    } finally { fL.current = false; }
  }, [uid]);

  const loadMedium = useCallback(async () => {
    if (mL.current) return;
    mL.current = true;
    try {
      const [hr, dl, tp2] = await Promise.all([
        safe(() => fetchTodayHourly(uid)),
        safe(() => getDailyUsage(uid, 14)),
        safe(() => getTaps(uid)),
      ]);
      if (hr) setTodayHr((Array.isArray(hr) ? hr : []).map(r => ({
        ...r, label: fmtHour(r.hour)
      })));
      if (dl?.data) setDaily((Array.isArray(dl.data) ? dl.data : []).map(r => ({
        date:   r.date || r.usage_date || "",
        label:  fmtDate(r.date || r.usage_date || ""),
        usage:  +(r.total_usage || 0).toFixed(1),
        color:  r.color_status || "green",
        isLive: r.is_live || false,
      })));
      if (tp2?.data) {
        const rows = Array.isArray(tp2.data) ? tp2.data : [];
        setByTap(rows.filter(x => (x.current_usage || 0) > 0)
          .map(x => ({ tap_name: x.tap_name, total_usage: +(x.current_usage || 0) })));
      }
    } finally { mL.current = false; }
  }, [uid]);

  useEffect(() => {
    loadFast(); loadMedium();
    const fi = setInterval(loadFast,   2000);
    const mi = setInterval(loadMedium, 10000);
    return () => { clearInterval(fi); clearInterval(mi); };
  }, [loadFast, loadMedium]);

  const toggleTap = async (tap) => {
    const newStatus = tap.tap_status === "ON" ? "OFF" : "ON";

    // 1. Optimistic update — flip state immediately so UI is instant
    setTaps(prev => prev.map(t =>
      t.tap_id === tap.tap_id ? { ...t, tap_status: newStatus } : t
    ));
    setToggling(p => ({ ...p, [tap.tap_id]: true }));

    // 2. Pause the fast poll so it doesn't overwrite our optimistic state
    fL.current = true;

    try {
      tap.tap_status === "ON" ? await tapOff(tap.tap_id) : await tapOn(tap.tap_id);
      // Small delay so DB write is committed before we re-fetch
      await new Promise(r => setTimeout(r, 400));
    } finally {
      fL.current = false;
      setToggling(p => ({ ...p, [tap.tap_id]: false }));
      loadFast();   // one confirmed refresh after DB is settled
    }
  };

  if (loading) return (
    <div style={{ textAlign:"center", paddingTop:80, color:t.cyan }}>
      <div style={{ fontSize:48 }}>💧</div>
      <p style={{ fontSize:17, marginTop:12 }}>Loading dashboard…</p>
    </div>
  );

  const d      = dash || {};
  const cMap   = { green:t.green, orange:t.orange, red:t.red };
  const color  = d.color_status || "green";
  const accent = cMap[color] || t.green;
  const pct    = d.orange_limit > 0 ? (d.today_total / d.orange_limit) * 100 : 0;
  const total  = d.today_total || 0;
  const yest   = d.yesterday_total || 0;
  const chg    = d.change_pct || 0;
  const diff   = total - yest;

  const winStart = hrWindow * 4;
  const winEnd   = Math.min(24, winStart + 4);
  const hrSlice  = todayHr.slice(winStart, winEnd);
  const winTitle = `${fmtHour(winStart)} – ${fmtHour(winEnd === 24 ? 0 : winEnd)}${winEnd===24?" (midnight)":""}`;

  const tip  = { background:t.card2, border:`1px solid ${t.border}`,
    borderRadius:8, color:t.text, fontSize:14, fontWeight:600 };
  const tipI = { color:t.text };
  const tipL = { color:t.textMuted, fontWeight:400 };

  const hasYestData = yest > 0;

  const kpis = [
    {
      icon:"💧", label:"Today's Water Use",
      val:`${total.toFixed(1)} L`,
      sub: d.orange_limit
        ? `${(d.orange_limit-total).toFixed(1)} L remaining before limit`
        : "Configure limits in Settings",
      a:accent,
    },
    {
      icon:"📅", label:"Yesterday's Total",
      val: hasYestData ? `${yest.toFixed(1)} L` : "0.0 L",
      sub: !hasYestData
        ? "Archive runs at midnight — check back tomorrow"
        : chg===0 ? "Same usage as today"
        : chg>0   ? `Today used ${Math.abs(chg)}% more (+${Math.abs(diff).toFixed(1)} L)`
                  : `Today used ${Math.abs(chg)}% less (−${Math.abs(diff).toFixed(1)} L)`,
      a: hasYestData ? t.textMuted : t.textSub,
    },
    {
      icon: !hasYestData ? "➖" : chg>0 ? "📈" : chg<0 ? "📉" : "➡️",
      label: !hasYestData ? "Change vs Yesterday"
           : chg>0 ? "Usage Up vs Yesterday"
           : chg<0 ? "Usage Down vs Yesterday"
           : "Same as Yesterday",
      val: !hasYestData ? "–" : `${chg>=0?"+":""}${chg}%`,
      sub: !hasYestData
        ? "No yesterday data to compare yet"
        : chg===0 ? "No change from yesterday"
        : chg>0   ? `${Math.abs(diff).toFixed(1)} L more than yesterday`
                  : `${Math.abs(diff).toFixed(1)} L less than yesterday`,
      a: !hasYestData ? t.textSub : chg>0?t.orange:chg<0?t.green:t.textMuted,
    },
    {
      icon: color==="green" ? "🟢" : color==="orange" ? "🟠" : "🔴",
      label: "Alert Status",
      val: color==="green" ? "Green"
         : color==="orange" ? "Orange"
         : "Red",
      sub: color==="green"
        ? `Below green limit (${d.green_limit} L/day)`
        : color==="orange"
        ? `Between ${d.green_limit}–${d.orange_limit} L`
        : `Above orange limit (${d.orange_limit} L)`,
      a: accent,
    },
  ];

  return (
    <div style={{ color:t.text, fontFamily:"'DM Sans',sans-serif" }}>
      <PageHeader subtitle="Live · KPIs every 2s · charts every 10s" />

      {throttled && (
        <div style={{ background:`${t.orange}18`, border:`1px solid ${t.orange}50`,
          borderRadius:12, padding:"12px 16px", marginBottom:18,
          display:"flex", alignItems:"center", gap:12 }}>
          <span style={{ fontSize:24 }}>🤖</span>
          <div>
            <div style={{ color:t.orange, fontSize:15, fontWeight:700 }}>
              Water Manager: Green limit exceeded
            </div>
            <div style={{ color:t.textMuted, fontSize:14 }}>
              Flow reduced to 30% · {total.toFixed(1)} L used / {d.green_limit} L green limit
            </div>
          </div>
        </div>
      )}

      {/* AI Forecast */}
      <AIForecastWidget />

      {/* KPI */}
      <div style={{ display:"grid",
        gridTemplateColumns: isMobile?"1fr 1fr":"repeat(4,1fr)",
        gap:12, marginBottom:18 }}>
        {kpis.map(({ icon, label, val, sub, a }) => (
          <div key={label} style={{ background:t.card, border:`1px solid ${a}25`,
            borderRadius:14, padding:isMobile?"14px":"18px 20px" }}>
            <div style={{ fontSize:26, marginBottom:8 }}>{icon}</div>
            <div style={{ color:t.textMuted, fontSize:13, fontWeight:600,
              marginBottom:5 }}>{label}</div>
            <div style={{ color:a, fontSize:isMobile?20:26, fontWeight:800 }}>{val}</div>
            {sub && <div style={{ color:t.textSub, fontSize:13, marginTop:5,
              lineHeight:1.4 }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Tank + Taps */}
      <div style={{ display:"grid",
        gridTemplateColumns: isMobile?"1fr":"180px 1fr",
        gap:12, marginBottom:18 }}>
        <div style={{ background:t.card, border:`1px solid ${t.border}`,
          borderRadius:14, padding:"16px 10px",
          display:"flex", flexDirection:"column",
          alignItems:"center", justifyContent:"center" }}>
          <WaterTank pct={pct} color={color}
            total={total.toFixed(1)} limit={d.orange_limit||"–"}
            throttled={throttled} />
        </div>

        <div style={{ background:t.card, border:`1px solid ${t.border}`,
          borderRadius:14, padding:"16px 20px" }}>
          <div style={{ color:t.textMuted, fontSize:13, fontWeight:600,
            letterSpacing:0.7, textTransform:"uppercase", marginBottom:14 }}>
            Tap Control & Today's Usage
          </div>
          {taps.length===0 && (
            <p style={{ color:t.textMuted, fontSize:15 }}>No taps yet — go to Manage & Config.</p>
          )}
          {taps.map(tap => {
            const isOn  = tap.tap_status === "ON";
            const usage = tap.current_usage || 0;
            const pBar  = d.orange_limit>0 ? Math.min(100,(usage/d.orange_limit)*100) : 0;
            return (
              <div key={tap.tap_id} style={{
                marginBottom:14,
                opacity: isOn ? 1 : 0.5,
                borderLeft: `3px solid ${isOn ? t.green : t.border}`,
                paddingLeft:10,
                transition:"all 0.3s",
              }}>
                <div style={{ display:"flex", alignItems:"center",
                  justifyContent:"space-between", marginBottom:5,
                  flexWrap:"wrap", gap:6 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:18, filter:isOn?"none":"grayscale(1)" }}>
                      {locIcon(tap.location)}
                    </span>
                    <span style={{ color:t.text, fontSize:15, fontWeight:600 }}>
                      {tap.tap_name}
                    </span>
                    <span style={{ color:t.textMuted, fontSize:13 }}>({tap.location})</span>
                    <span style={{ padding:"2px 8px", borderRadius:20,
                      fontSize:12, fontWeight:700,
                      background:isOn?`${t.green}20`:`${t.textMuted}12`,
                      color:isOn?t.green:t.textMuted,
                      border:isOn?`1px solid ${t.green}40`:`1px dashed ${t.textMuted}40` }}>
                      {tap.tap_status}
                    </span>
                    {isOn&&throttled&&<span style={{fontSize:12,color:t.orange}}>⚡ slow</span>}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ color:isOn?accent:t.textSub, fontSize:15, fontWeight:700 }}>
                      {usage.toFixed(1)} L
                    </span>
                    <button onClick={()=>toggleTap(tap)}
                      disabled={toggling[tap.tap_id]}
                      style={{ padding:"6px 14px", borderRadius:8,
                        fontSize:13, fontWeight:700, cursor:"pointer", border:"none",
                        background:isOn?`${t.red}20`:`${t.green}20`,
                        color:isOn?t.red:t.green }}>
                      {toggling[tap.tap_id]?"…":isOn?"Turn OFF":"Turn ON"}
                    </button>
                  </div>
                </div>
                <div style={{ height:6, background:t.border, borderRadius:3 }}>
                  <div style={{ height:"100%", width:`${pBar}%`,
                    background:isOn?`linear-gradient(90deg,${accent}70,${accent})`:t.textSub,
                    opacity:isOn?1:0.35, borderRadius:3,
                    transition:"width 0.5s ease" }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Charts */}
      <div style={{ display:"grid",
        gridTemplateColumns: isMobile?"1fr":"1fr 1fr",
        gap:12, marginBottom:12 }}>

        {/* Hourly line */}
        <div style={{ background:t.card, border:`1px solid ${t.border}`,
          borderRadius:14, padding:"16px 18px" }}>
          <div style={{ display:"flex", justifyContent:"space-between",
            alignItems:"center", marginBottom:8 }}>
            <div>
              <div style={{ color:t.text, fontSize:15, fontWeight:700 }}>
                Today — {winTitle}
              </div>
              <div style={{ color:t.textMuted, fontSize:13, marginTop:2 }}>
                Hourly · use arrows to scroll
              </div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <NavBtn t={t} disabled={hrWindow===0}
                onClick={()=>setHrWindow(w=>Math.max(0,w-1))}>‹</NavBtn>
              <NavBtn t={t} disabled={hrWindow>=5}
                onClick={()=>setHrWindow(w=>Math.min(5,w+1))}>›</NavBtn>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={hrSlice} margin={{top:8,right:12,left:8,bottom:28}}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.border}/>
              <XAxis dataKey="label" stroke={t.textMuted} fontSize={13}
                label={{value:winTitle,position:"insideBottom",offset:-16,
                  fill:t.textMuted,fontSize:12}}/>
              <YAxis stroke={t.textMuted} fontSize={13}
                label={{value:"Litres",angle:-90,position:"insideLeft",offset:8,
                  fill:t.textMuted,fontSize:12}}/>
              <Tooltip contentStyle={tip} itemStyle={tipI} labelStyle={tipL}
                cursor={{stroke:t.cyan,strokeWidth:1.5,strokeDasharray:"4 2"}}
                formatter={v=>[`${v} L`,"Usage"]}/>
              <Line type="monotone" dataKey="liters" stroke={t.cyan}
                strokeWidth={2.5} dot={{r:5,fill:t.cyan,strokeWidth:0}}
                activeDot={{r:7}} connectNulls/>
            </LineChart>
          </ResponsiveContainer>
          <div style={{display:"flex",justifyContent:"center",gap:6,marginTop:6}}>
            {Array.from({length:6}).map((_,i)=>(
              <button key={i} onClick={()=>setHrWindow(i)}
                style={{width:9,height:9,borderRadius:"50%",border:"none",
                  cursor:"pointer",padding:0,
                  background:i===hrWindow?t.cyan:t.border,transition:"background 0.2s"}}/>
            ))}
          </div>
        </div>

        {/* Daily bar — no hover highlight */}
        <div style={{ background:t.card, border:`1px solid ${t.border}`,
          borderRadius:14, padding:"16px 18px" }}>
          <div style={{ color:t.text, fontSize:15, fontWeight:700, marginBottom:4 }}>
            Daily Totals (14 days)
          </div>
          <div style={{ color:t.textMuted, fontSize:13, marginBottom:10 }}>
            Cyan = today live · green/orange/red = status
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={daily} margin={{top:8,right:12,left:8,bottom:28}}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.border}/>
              <XAxis dataKey="label" stroke={t.textMuted} fontSize={12}
                type="category"
                label={{value:"Date",position:"insideBottom",offset:-16,
                  fill:t.textMuted,fontSize:12}}/>
              <YAxis stroke={t.textMuted} fontSize={13}
                label={{value:"Litres",angle:-90,position:"insideLeft",offset:8,
                  fill:t.textMuted,fontSize:12}}/>
              <Tooltip contentStyle={tip} itemStyle={tipI} labelStyle={tipL}
                cursor={false}
                formatter={(v,n,p)=>[
                  `${v} L${p.payload?.isLive?" (live)":""}`, "Usage"
                ]}/>
              <Bar dataKey="usage" radius={[4,4,0,0]}>
                {daily.map((e,i)=>(
                  <Cell key={i}
                    fill={e.isLive?t.cyan:(cMap[e.color]||t.cyan)}
                    opacity={e.isLive?1:0.82}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Today pie */}
      <div style={{ background:t.card, border:`1px solid ${t.border}`,
        borderRadius:14, padding:"16px 18px" }}>
        <div style={{ color:t.text, fontSize:15, fontWeight:700, marginBottom:4 }}>
          Today's Usage by Tap
        </div>
        <div style={{ color:t.textMuted, fontSize:13, marginBottom:10 }}>Live running totals</div>
        {byTap.length===0 ? (
          <div style={{textAlign:"center",padding:"28px 0",color:t.textMuted}}>
            <div style={{fontSize:30,marginBottom:8}}>💧</div>
            <div style={{fontSize:15,color:t.text}}>No usage yet today</div>
            <div style={{fontSize:13,marginTop:4}}>Turn taps ON to start tracking</div>
          </div>
        ) : (
          <div style={{ display:"grid",
            gridTemplateColumns: isMobile?"1fr":"1fr 1fr",
            gap:16, alignItems:"center" }}>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={byTap} dataKey="total_usage" nameKey="tap_name"
                  cx="50%" cy="50%" innerRadius={45} outerRadius={80}
                  labelLine={false} label={false}>
                  {byTap.map((_,i)=>(
                    <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}
                      stroke={t.card} strokeWidth={2}/>
                  ))}
                </Pie>
                <Tooltip contentStyle={tip} itemStyle={tipI} labelStyle={tipL}
                  formatter={v=>[`${(+v).toFixed(2)} L`,"Usage"]}/>
              </PieChart>
            </ResponsiveContainer>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {byTap.map((tap,i)=>{
                const t2  = byTap.reduce((a,x)=>a+(+x.total_usage||0),0);
                const p2  = t2>0?((tap.total_usage/t2)*100).toFixed(1):0;
                return (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{width:13,height:13,borderRadius:3,flexShrink:0,
                      background:PIE_COLORS[i%PIE_COLORS.length]}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:t.text,fontSize:14,fontWeight:600,
                        overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {tap.tap_name}
                      </div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      <div style={{color:PIE_COLORS[i%PIE_COLORS.length],
                        fontSize:14,fontWeight:700}}>
                        {(+tap.total_usage).toFixed(1)} L
                      </div>
                      <div style={{color:t.textSub,fontSize:12}}>{p2}%</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NavBtn({ t, onClick, disabled, children }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width:34,height:34,borderRadius:8,
      background:disabled?t.border:`${t.cyan}20`,
      border:`1px solid ${disabled?t.border:t.cyan}`,
      color:disabled?t.textSub:t.cyan,
      cursor:disabled?"not-allowed":"pointer",
      fontSize:18,fontWeight:700,
      display:"flex",alignItems:"center",justifyContent:"center",
    }}>{children}</button>
  );
}

function locIcon(loc="") {
  const l = loc.toLowerCase();
  if (l.includes("bath"))    return "🚿";
  if (l.includes("kitchen")) return "🍳";
  if (l.includes("toilet"))  return "🚽";
  if (l.includes("garden"))  return "🌱";
  return "💧";
}
