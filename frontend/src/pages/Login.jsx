import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { login } from "../api";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const [form, setForm]   = useState({ email:"", password:"" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { loginSave }     = useAuth();
  const navigate          = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const { data } = await login(form);
      loginSave(data);
      navigate("/");
    } catch (err) {
      setError(err.response?.data?.error || "Login failed");
    } finally { setLoading(false); }
  };

  const inp = (field) => ({
    value: form[field],
    onChange: (e) => setForm(p => ({ ...p, [field]: e.target.value })),
    style: inputStyle,
  });

  return (
    <div style={pageStyle}>
      {/* Animated background blobs */}
      <div style={blob(60,10,"#00d4ff20",500)} />
      <div style={blob(10,60,"#0057ff15",400)} />

      <div style={cardStyle}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:48, marginBottom:8 }}>💧</div>
          <h1 style={{ color:"#e2e8f0", fontSize:24, fontWeight:800, margin:0 }}>AquaTrack</h1>
          <p style={{ color:"#4a7fa5", fontSize:13, marginTop:4 }}>Smart Water Management System</p>
        </div>

        <form onSubmit={submit}>
          <div style={fieldWrap}>
            <label style={labelStyle}>Email</label>
            <input type="email" placeholder="your@email.com" required {...inp("email")} />
          </div>
          <div style={fieldWrap}>
            <label style={labelStyle}>Password</label>
            <input type="password" placeholder="••••••••" required {...inp("password")} />
          </div>

          {error && <div style={errorStyle}>{error}</div>}

          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? "Signing in…" : "Sign In →"}
          </button>
        </form>

        <p style={{ color:"#4a7fa5", textAlign:"center", fontSize:13, marginTop:20 }}>
          No account?{" "}
          <Link to="/register" style={{ color:"#00d4ff", textDecoration:"none", fontWeight:600 }}>
            Register here
          </Link>
        </p>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────
const pageStyle = {
  minHeight:"100vh", background:"#0a0e1a",
  display:"flex", alignItems:"center", justifyContent:"center",
  fontFamily:"'DM Sans', sans-serif", position:"relative", overflow:"hidden",
};
const blob = (top, left, bg, size) => ({
  position:"absolute", top:`${top}%`, left:`${left}%`,
  width:size, height:size, borderRadius:"50%",
  background:bg, filter:"blur(80px)", pointerEvents:"none",
});
const cardStyle = {
  width:"100%", maxWidth:400,
  background:"#0d1220", border:"1px solid #1e2a45",
  borderRadius:20, padding:"40px 36px",
  position:"relative", zIndex:1,
  boxShadow:"0 24px 60px #00000080",
};
const fieldWrap = { marginBottom:20 };
const labelStyle = { display:"block", color:"#94a3b8", fontSize:12,
  fontWeight:600, marginBottom:6, letterSpacing:0.8, textTransform:"uppercase" };
const inputStyle = {
  width:"100%", padding:"12px 16px",
  background:"#0a0e1a", border:"1px solid #1e2a45",
  borderRadius:10, color:"#e2e8f0", fontSize:14,
  outline:"none", boxSizing:"border-box",
};
const errorStyle = {
  background:"#ff4d4d18", border:"1px solid #ff4d4d40",
  borderRadius:8, padding:"10px 14px", color:"#ff6b6b",
  fontSize:13, marginBottom:16,
};
const btnStyle = {
  width:"100%", padding:"14px",
  background:"linear-gradient(135deg,#00d4ff,#0057ff)",
  border:"none", borderRadius:10,
  color:"#fff", fontSize:15, fontWeight:700,
  cursor:"pointer", marginTop:4,
};
