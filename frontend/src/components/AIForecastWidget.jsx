import { useState, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { useResponsive } from "../hooks/useResponsive";

const BASE = "http://localhost:5000";
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDate(str) {
  if (!str) return "";
  const p = String(str).split("-");
  if (p.length < 3) return str;
  return `${p[2]} ${MONTHS[(parseInt(p[1],10)-1)] || ""}`;
}

export default function AIForecastWidget() {
  const { user } = useAuth();
  const { t } = useTheme();
  const { isMobile } = useResponsive();
  const uid = user?.user_id;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!uid) return;
    const fetchForecast = async () => {
      try {
        const token = localStorage.getItem("token") || "";
        const res = await axios.get(`${BASE}/forecast/${uid}?days=30`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setData(res.data);
      } catch (err) {
        setError(err.response?.data?.error || "Failed to load AI Forecast");
      } finally {
        setLoading(false);
      }
    };
    fetchForecast();
  }, [uid]);

  if (loading) {
    return (
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", marginBottom: 18, textAlign: "center", color: t.textMuted }}>
        Loading AI Forecast...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 14, padding: "16px 18px", marginBottom: 18 }}>
        <div style={{ color: t.red, fontSize: 14, fontWeight: 600 }}>🤖 AI Forecast Unavailable</div>
        <div style={{ color: t.textMuted, fontSize: 13, marginTop: 4 }}>{error}</div>
      </div>
    );
  }

  if (!data) return null;

  // Combine historical and prediction data for Recharts
  const chartData = [];
  const { historical, predictions, warning, green_limit, orange_limit } = data;
  
  // Format data for recharts so we can have two separate lines or one continuous line
  historical.forEach(d => {
    chartData.push({
      label: fmtDate(d.date),
      historyUsage: d.usage,
      predUsage: null,
      fullDate: d.date
    });
  });

  // To make the lines connect, add the last historical point as the start of the prediction
  if (historical.length > 0) {
    const lastHist = historical[historical.length - 1];
    chartData[chartData.length - 1].predUsage = lastHist.usage;
  }

  predictions.forEach(d => {
    chartData.push({
      label: fmtDate(d.date),
      historyUsage: null,
      predUsage: d.usage,
      fullDate: d.date
    });
  });

  const isWarning = warning.includes("WARNING");
  const isCritical = warning.includes("CRITICAL");
  const warnColor = isCritical ? t.red : (isWarning ? t.orange : t.green);

  const tip = { background: t.card2, border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, fontSize: 14, fontWeight: 600 };
  const tipI = { color: t.text };
  const tipL = { color: t.textMuted, fontWeight: 400 };

  return (
    <div style={{ background: t.card, border: `1px solid ${warnColor}40`, borderRadius: 14, padding: "18px 20px", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 24 }}>✨</span>
        <div>
          <div style={{ color: t.text, fontSize: 16, fontWeight: 700 }}>AI Forecast (7 Days)</div>
          <div style={{ color: warnColor, fontSize: 14, fontWeight: 600, marginTop: 2 }}>{warning}</div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={t.border} vertical={false} />
          <XAxis dataKey="label" stroke={t.textMuted} fontSize={12} tickMargin={10} />
          <YAxis stroke={t.textMuted} fontSize={12} />
          <Tooltip contentStyle={tip} itemStyle={tipI} labelStyle={tipL}
            formatter={(value, name) => [`${value} L`, name === 'historyUsage' ? 'Actual Usage' : 'Predicted Usage']} />
          
          <ReferenceLine y={green_limit} stroke={t.green} strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'Green Limit', fill: t.green, fontSize: 12 }} />
          {orange_limit > 0 && <ReferenceLine y={orange_limit} stroke={t.orange} strokeDasharray="3 3" label={{ position: 'insideTopLeft', value: 'Orange Limit', fill: t.orange, fontSize: 12 }} />}

          <Line type="monotone" dataKey="historyUsage" stroke={t.cyan} strokeWidth={3} dot={{ r: 3, fill: t.cyan, strokeWidth: 0 }} activeDot={{ r: 6 }} connectNulls={true} />
          <Line type="monotone" dataKey="predUsage" stroke={t.orange} strokeWidth={3} strokeDasharray="6 4" dot={{ r: 3, fill: t.orange, strokeWidth: 0 }} activeDot={{ r: 6 }} connectNulls={true} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
