import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { register } from "../api";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const [form, setForm]     = useState({ name:"", email:"", password:"" });
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const { loginSave }       = useAuth();
  const navigate            = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const { data } = await register(form);
      loginSave(data);
      navigate("/setup");
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed");
    } finally { setLoading(false); }
  };

  const inp = (field) => ({
    value: form[field],
    onChange: (e) => setForm(p => ({ ...p, [field]: e.target.value })),
    style: inputStyle,
  });

  return (
    <div style={pageStyle}>
      <div style={{ position:"absolute", top:"20%", right:"15%", width:400, height:400,
        borderRadius:"50%", background:"#00d4ff10", filter:"blur(100px)" }} />

      <div style={cardStyle}>
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ fontSize:48, marginBottom:8 }}>🌊</div>
          <h1 style={{ color:"#e2e8f0", fontSize:24, fontWeight:800, margin:0 }}>Create Account</h1>
          <p style={{ color:"#4a7fa5", fontSize:13, marginTop:4 }}>Start monitoring your water usage</p>
        </div>

        <form onSubmit={submit}>
          {[
            { field:"name",     label:"Full Name",  type:"text",     placeholder:"Your name" },
            { field:"email",    label:"Email",      type:"email",    placeholder:"your@email.com" },
            { field:"password", label:"Password",   type:"password", placeholder:"Min 6 characters" },
          ].map(({ field, label, type, placeholder }) => (
            <div key={field} style={{ marginBottom:20 }}>
              <label style={labelStyle}>{label}</label>
              <input type={type} placeholder={placeholder} required {...inp(field)} />
            </div>
          ))}

          {error && (
            <div style={{ background:"#ff4d4d18", border:"1px solid #ff4d4d40",
              borderRadius:8, padding:"10px 14px", color:"#ff6b6b",
              fontSize:13, marginBottom:16 }}>{error}</div>
          )}

          <button type="submit" disabled={loading} style={btnStyle}>
            {loading ? "Creating account…" : "Create Account →"}
          </button>
        </form>

        <p style={{ color:"#4a7fa5", textAlign:"center", fontSize:13, marginTop:20 }}>
          Already registered?{" "}
          <Link to="/login" style={{ color:"#00d4ff", textDecoration:"none", fontWeight:600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight:"100vh", background:"#0a0e1a",
  display:"flex", alignItems:"center", justifyContent:"center",
  fontFamily:"'DM Sans', sans-serif", position:"relative", overflow:"hidden",
};
const cardStyle = {
  width:"100%", maxWidth:420,
  background:"#0d1220", border:"1px solid #1e2a45",
  borderRadius:20, padding:"40px 36px",
  position:"relative", zIndex:1,
  boxShadow:"0 24px 60px #00000080",
};
const labelStyle = { display:"block", color:"#94a3b8", fontSize:12,
  fontWeight:600, marginBottom:6, letterSpacing:0.8, textTransform:"uppercase" };
const inputStyle = {
  width:"100%", padding:"12px 16px",
  background:"#0a0e1a", border:"1px solid #1e2a45",
  borderRadius:10, color:"#e2e8f0", fontSize:14,
  outline:"none", boxSizing:"border-box",
};
const btnStyle = {
  width:"100%", padding:"14px",
  background:"linear-gradient(135deg,#00d4ff,#0057ff)",
  border:"none", borderRadius:10,
  color:"#fff", fontSize:15, fontWeight:700,
  cursor:"pointer",
};
