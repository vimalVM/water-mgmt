import { useState, useEffect, useRef } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { getDailyUsage, getUsageByTap, getHourlyPattern, getExportUrl } from "../api";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useResponsive } from "../hooks/useResponsive";
import PageHeader from "../components/PageHeader";

const PIE_COLORS = ["#00C4FF","#FF6B35","#00D97E","#A855F7","#FFD700","#FF4D6D"];
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

// No hover background highlight on bar charts

// SVG hatching pattern for week-on-week second bar
const HatchPattern = ({ id, color }) => (
  <defs>
    <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6"
      patternTransform="rotate(45)">
      <line x1="0" y1="0" x2="0" y2="6"
        stroke={color} strokeWidth="3" strokeOpacity="0.7"/>
    </pattern>
  </defs>
);

export default function Reports() {
  const { user }     = useAuth();
  const { t }        = useTheme();
  const { isMobile } = useResponsive();
  const uid          = user?.user_id;

  const [days,    setDays]    = useState(30);
  const [daily,   setDaily]   = useState([]);
  const [byTap,   setByTap]   = useState([]);
  const [hourly,  setHourly]  = useState([]);
  const [loading, setLoading] = useState(true);
  const lock = useRef(false);

  const safe = async (fn) => { try { return await fn(); } catch { return null; } };

  const load = async () => {
    if (lock.current) return;
    lock.current = true;
    try {
      const [d, bt, hp] = await Promise.all([
        safe(() => getDailyUsage(uid, days)),
        safe(() => getUsageByTap(uid, days)),
        safe(() => getHourlyPattern(uid, days)),
      ]);
      if (d?.data) setDaily((Array.isArray(d.data)?d.data:[]).map(r => ({
        date:   r.date || r.usage_date || "",
        label:  fmtDate(r.date || r.usage_date || ""),
        usage:  +(r.total_usage || 0).toFixed(1),
        color:  r.color_status || "green",
        isLive: r.is_live || false,
      })));
      if (bt?.data) setByTap(Array.isArray(bt.data)?bt.data:[]);
      if (hp?.data) setHourly(Array.isArray(hp.data)?hp.data:[]);
      setLoading(false);
    } finally { lock.current = false; }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 600000);
    return () => clearInterval(id);
  }, [uid, days]);

  const totalUsage = daily.reduce((a,r)=>a+r.usage, 0).toFixed(1);
  const avgPerDay  = daily.length>0 ? (totalUsage/daily.length).toFixed(1) : 0;
  const peakDay    = daily.reduce((a,r)=>r.usage>(a?.usage||0)?r:a, null);
  const peakHour   = hourly.reduce((a,r)=>r.avg_liters>(a?.avg_liters||0)?r:a, null);
  const maxAvg     = Math.max(...hourly.map(h=>h.avg_liters), 1);
  const colorMap   = { green:t.green, orange:t.orange, red:t.red };

  // Week-on-week
  const weeklyData = (() => {
    const weeks = {};
    daily.forEach((d, idx) => {
      const wk = `W${Math.floor(idx/7)+1}`;
      if (!weeks[wk]) weeks[wk] = { week:wk, total:0, days:0 };
      weeks[wk].total += d.usage;
      weeks[wk].days  += 1;
    });
    return Object.values(weeks).map(w => ({
      week: w.week,
      total: +w.total.toFixed(1),
      avg:   +(w.total/w.days).toFixed(1),
    }));
  })();

  const tip  = { background:t.card2, border:`1px solid ${t.border}`,
    borderRadius:8, color:t.text, fontSize:14, fontWeight:600, padding:"8px 14px" };
  const tipI = { color:t.text };
  const tipL = { color:t.textMuted, fontWeight:400 };

  return (
    <div style={{ color:t.text, fontFamily:"'DM Sans',sans-serif" }}>
      <PageHeader subtitle="Historical water usage insights and exports" />

      <div style={{ display:"flex", justifyContent:"space-between",
        alignItems:"center", marginBottom:20, flexWrap:"wrap", gap:12 }}>
        <h2 style={{ fontSize:"clamp(18px,2.5vw,22px)", fontWeight:700,
          color:t.text, margin:0 }}>Reports & Analytics</h2>
        <button onClick={()=>{
          const a=document.createElement("a");
          a.href=getExportUrl(uid,days);
          a.download=`aquatrack_${days}d.csv`;
          a.click();
        }} style={{ padding:"10px 18px",
          background:`linear-gradient(135deg,${t.green},#059669)`,
          border:"none",borderRadius:10,color:"#fff",
          fontSize:14,fontWeight:700,cursor:"pointer" }}>
          📥 Export CSV ({days}d)
        </button>
      </div>

      {/* Filter */}
      <div style={{marginBottom:20}}>
        <FilterGroup t={t} label="Date Range (Days)"
          value={days} onChange={v=>{setDays(v);setLoading(true);}}
          options={[7,14,30,60,90]}/>
      </div>

      {/* KPI */}
      <div style={{ display:"grid",
        gridTemplateColumns:isMobile?"1fr 1fr":"repeat(4,1fr)",
        gap:12, marginBottom:20 }}>
        {[
          {icon:"💧",label:`Total — Last ${days} Days`,val:`${totalUsage} L`,c:t.cyan},
          {icon:"📊",label:"Average per Day",val:`${avgPerDay} L`,c:t.green},
          {icon:"📈",label:"Highest Day",
            val:peakDay?`${peakDay.usage} L`:"–",
            sub:peakDay?.label||"",c:t.orange},
          {icon:"⏰",label:"Peak Usage Hour",
            val:peakHour?fmtHour(peakHour.hour):"–",
            sub:peakHour?`avg ${peakHour.avg_liters} L/hr`:"",
            c:"#a855f7"},
        ].map(({icon,label,val,sub,c})=>(
          <div key={label} style={{background:t.card,border:`1px solid ${c}25`,
            borderRadius:14,padding:isMobile?"14px":"18px 20px"}}>
            <div style={{fontSize:24,marginBottom:7}}>{icon}</div>
            <div style={{color:t.textMuted,fontSize:13,fontWeight:600,
              marginBottom:5}}>{label}</div>
            <div style={{color:c,fontSize:isMobile?18:24,fontWeight:800}}>{val}</div>
            {sub&&<div style={{color:t.textSub,fontSize:13,marginTop:4}}>{sub}</div>}
          </div>
        ))}
      </div>

      {loading?(
        <div style={{color:t.textMuted,textAlign:"center",padding:60}}>Loading charts…</div>
      ):(<>

        {/* Daily bar — no hover highlight */}
        <ChartCard t={t} title={`Daily Totals — Last ${days} Days`}
          sub="Green = safe usage · Orange = near limit · Red = exceeded">
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={daily} margin={{top:8,right:16,left:12,bottom:32}}>
              <CartesianGrid strokeDasharray="3 3" stroke={t.border}/>
              <XAxis dataKey="label" stroke={t.textMuted} fontSize={12}
                type="category"
                interval={days>30?"preserveStartEnd":"preserveStart"}
                label={{value:"Date",position:"insideBottom",offset:-20,
                  fill:t.textMuted,fontSize:13}}/>
              <YAxis stroke={t.textMuted} fontSize={13}
                label={{value:"Litres (L)",angle:-90,position:"insideLeft",offset:12,
                  fill:t.textMuted,fontSize:13}}/>
              <Tooltip contentStyle={tip} itemStyle={tipI} labelStyle={tipL}
                cursor={false}
                formatter={(v,n,p)=>[
                  `${v} L${p.payload?.isLive?" (live)":""}`, "Usage"
                ]}/>
              <Bar dataKey="usage" radius={[5,5,0,0]}>
                {daily.map((e,i)=>(
                  <Cell key={i}
                    fill={e.isLive?t.cyan:(colorMap[e.color]||t.cyan)}
                    opacity={e.isLive?1:0.82}/>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {daily.some(r=>r.isLive)&&(
            <div style={{display:"flex",alignItems:"center",gap:6,
              marginTop:8,color:t.cyan,fontSize:13}}>
              <div style={{width:10,height:10,borderRadius:2,background:t.cyan}}/>
              Today (live)
            </div>
          )}
        </ChartCard>

        {/* Week-on-week — solid + hatched bars */}
        {weeklyData.length>1&&(
          <ChartCard t={t} title="Week-on-Week Comparison"
            sub="Total vs average daily usage per week">
            <svg width="0" height="0">
              <HatchPattern id="hatch_avg" color={t.blue}/>
            </svg>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={weeklyData} margin={{top:8,right:16,left:12,bottom:24}}>
                <CartesianGrid strokeDasharray="3 3" stroke={t.border}/>
                <XAxis dataKey="week" stroke={t.textMuted} fontSize={14}/>
                <YAxis stroke={t.textMuted} fontSize={13}
                  label={{value:"Litres",angle:-90,position:"insideLeft",offset:12,
                    fill:t.textMuted,fontSize:13}}/>
                <Tooltip contentStyle={tip} itemStyle={tipI} labelStyle={tipL}
                  cursor={false} formatter={v=>[`${v} L`]}/>
                <Legend wrapperStyle={{color:t.textMuted,fontSize:13,paddingTop:6}}/>
                {/* Solid bar = Total */}
                <Bar dataKey="total" name="Total (L)"
                  fill={t.cyan} radius={[5,5,0,0]} opacity={0.88}/>
                {/* Hatched bar = Avg/day */}
                <Bar dataKey="avg" name="Avg/Day (L)"
                  fill="url(#hatch_avg)" stroke={t.blue} strokeWidth={1}
                  radius={[5,5,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* Hourly heatmap — ONLY colour boxes with x-axis labels, no bar chart */}
        <ChartCard t={t}
          title={`Hourly Usage Pattern — Last ${days} Days`}
          sub="Average litres per hour · darker = more usage">
          {hourly.every(h=>h.avg_liters===0)?(
            <div style={{color:t.textMuted,textAlign:"center",padding:32,fontSize:15}}>
              No hourly data yet — keep simulator running.
            </div>
          ):(
            <>
              {/* Colour grid boxes */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(24,1fr)",
                gap:4, marginBottom:6 }}>
                {hourly.map(h => {
                  const intensity = maxAvg>0 ? h.avg_liters/maxAvg : 0;
                  const bg = intensity>0.75 ? t.red
                           : intensity>0.45 ? t.orange
                           : intensity>0.12 ? t.green
                           : t.border;
                  const opacity = 0.15 + intensity * 0.85;
                  return (
                    <div key={h.hour}
                      title={`${fmtHour(h.hour)} — avg ${h.avg_liters} L`}
                      style={{ height:52, background:bg,
                        borderRadius:6, opacity, cursor:"pointer",
                        transition:"opacity 0.2s",
                        // extra glow on peak
                        boxShadow: intensity>0.75
                          ? `0 0 8px ${t.red}60` : "none",
                      }}/>
                  );
                })}
              </div>

              {/* X-axis labels every 3 hours */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(24,1fr)",
                gap:4, marginBottom:16 }}>
                {hourly.map(h => (
                  <div key={h.hour} style={{ textAlign:"center",
                    color: h.hour%3===0 ? t.textMuted : "transparent",
                    fontSize:11, fontWeight: h.hour%6===0 ? 700 : 400,
                    lineHeight:1.2 }}>
                    {h.hour%3===0 ? fmtHour(h.hour) : ""}
                  </div>
                ))}
              </div>

              {/* Tooltip on hover — values row */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(24,1fr)",
                gap:4, marginBottom:12 }}>
                {hourly.map(h => {
                  const intensity = maxAvg>0?h.avg_liters/maxAvg:0;
                  const c = intensity>0.75?t.red:intensity>0.45?t.orange:t.green;
                  return (
                    <div key={h.hour} style={{ textAlign:"center",
                      color: intensity>0.12?c:"transparent",
                      fontSize:10, fontWeight:600 }}>
                      {intensity>0.12?`${h.avg_liters}L`:""}
                    </div>
                  );
                })}
              </div>

              {/* Legend */}
              <div style={{display:"flex",gap:16,marginTop:4,flexWrap:"wrap"}}>
                {[
                  {c:t.border,  l:"No usage"},
                  {c:t.green,   l:"Low"},
                  {c:t.orange,  l:"Medium"},
                  {c:t.red,     l:"High (peak)"},
                ].map(({c,l})=>(
                  <div key={l} style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{width:14,height:14,borderRadius:3,background:c,opacity:0.85}}/>
                    <span style={{color:t.textSub,fontSize:13}}>{l}</span>
                  </div>
                ))}
                {peakHour&&(
                  <div style={{marginLeft:"auto",color:t.red,fontSize:13,fontWeight:600}}>
                    Peak: {fmtHour(peakHour.hour)} ({peakHour.avg_liters} L avg)
                  </div>
                )}
              </div>
            </>
          )}
        </ChartCard>

        {/* Pie + Table */}
        <div style={{display:"grid",
          gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14}}>

          <ChartCard t={t} title={`Usage by Tap — Last ${days} Days`}
            sub="Includes today's live running totals">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart margin={{top:16,right:50,left:50,bottom:8}}>
                <Pie data={byTap} dataKey="total_usage" nameKey="tap_name"
                  cx="50%" cy="50%" innerRadius={45} outerRadius={80}
                  labelLine={{stroke:t.textMuted,strokeWidth:1.2}}
                  label={({name,percent,x,y,midAngle})=>{
                    const anchor=(midAngle>90&&midAngle<270)?"end":"start";
                    const ox=(midAngle>90&&midAngle<270)?-5:5;
                    return(
                      <text x={x+ox} y={y} fill={t.text} fontSize={12} fontWeight={600}
                        textAnchor={anchor} dominantBaseline="central">
                        {name} {(percent*100).toFixed(0)}%
                      </text>
                    );
                  }}>
                  {byTap.map((_,i)=>(
                    <Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}
                      stroke={t.card} strokeWidth={2}/>
                  ))}
                </Pie>
                <Tooltip contentStyle={tip} itemStyle={tipI} labelStyle={tipL}
                  formatter={v=>[`${(+v).toFixed(2)} L`,"Usage"]}/>
                <Legend iconType="circle" iconSize={11}
                  wrapperStyle={{color:t.textMuted,fontSize:13}}/>
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard t={t} title="Tap Usage Table">
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:14}}>
                <thead>
                  <tr>
                    {["Tap","Location","Total (L)","Share %"].map(h=>(
                      <th key={h} style={{color:t.textMuted,textAlign:"left",
                        padding:"9px 10px",borderBottom:`1px solid ${t.border}`,
                        fontSize:13,fontWeight:600,letterSpacing:0.5}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byTap.map((tap,i)=>{
                    const share=totalUsage>0
                      ?((tap.total_usage/totalUsage)*100).toFixed(1):0;
                    return(
                      <tr key={i}>
                        <td style={{padding:"10px 10px",color:t.text,fontWeight:600,
                          borderBottom:`1px solid ${t.border}`,fontSize:14}}>{tap.tap_name}</td>
                        <td style={{padding:"10px 10px",color:t.textMuted,
                          borderBottom:`1px solid ${t.border}`,fontSize:14}}>{tap.location}</td>
                        <td style={{padding:"10px 10px",fontWeight:700,
                          color:PIE_COLORS[i%PIE_COLORS.length],
                          borderBottom:`1px solid ${t.border}`,fontSize:14}}>
                          {(tap.total_usage||0).toFixed(2)}
                        </td>
                        <td style={{padding:"10px 10px",color:t.text,
                          borderBottom:`1px solid ${t.border}`,fontSize:14}}>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{width:`${Math.min(50,+share)}px`,height:7,
                              background:PIE_COLORS[i%PIE_COLORS.length],
                              borderRadius:3,opacity:0.75}}/>
                            {share}%
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>

      </>)}
    </div>
  );
}

function FilterGroup({ t, label, value, onChange, options }) {
  return (
    <div>
      <div style={{color:t.textMuted,fontSize:13,marginBottom:7,
        fontWeight:600,letterSpacing:0.7,textTransform:"uppercase"}}>{label}</div>
      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
        {options.map(o=>(
          <button key={o} onClick={()=>onChange(o)} style={{
            padding:"8px 18px",borderRadius:9,fontSize:14,fontWeight:600,
            background:value===o?`${t.cyan}20`:t.card,
            border:`1px solid ${value===o?t.cyan:t.border}`,
            color:value===o?t.cyan:t.textMuted,cursor:"pointer",
          }}>{o} days</button>
        ))}
      </div>
    </div>
  );
}

function ChartCard({ t, title, sub, children }) {
  return (
    <div style={{background:t.card,border:`1px solid ${t.border}`,
      borderRadius:14,padding:"18px 20px",marginBottom:16}}>
      <div style={{marginBottom:14}}>
        <div style={{color:t.text,fontSize:16,fontWeight:700}}>{title}</div>
        {sub&&<div style={{color:t.textMuted,fontSize:13,marginTop:3}}>{sub}</div>}
      </div>
      {children}
    </div>
  );
}
