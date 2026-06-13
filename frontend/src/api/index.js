import axios from "axios";

const BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

const api = axios.create({ baseURL: BASE });

// Attach JWT token automatically
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Auth
export const register = (d) => api.post("/register", d);
export const login    = (d) => api.post("/login", d);

// User
export const getUser       = (id)         => api.get(`/users/${id}`);
export const updateLimits  = (id, d)      => api.put(`/users/${id}/limits`, d);

// Taps
export const getTaps    = (uid)       => api.get(`/taps/${uid}`);
export const addTap     = (d)         => api.post("/add-tap", d);
export const deleteTap  = (id)        => api.delete(`/delete-tap/${id}`);
export const tapOn      = (id)        => api.post(`/tap-on/${id}`);
export const tapOff     = (id)        => api.post(`/tap-off/${id}`);

// Flow status (AI throttle)
export const getFlowStatus = (uid)    => api.get(`/flow-status/${uid}`);

// Dashboard & analytics
export const getDashboard      = (uid)       => api.get(`/dashboard/${uid}`);
export const getTimeseries     = (uid, hrs)  => api.get(`/usage-timeseries/${uid}?hours=${hrs}`);
export const getDailyUsage     = (uid, days) => api.get(`/daily-usage/${uid}?days=${days}`);
export const getUsageByTap     = (uid, days) => api.get(`/usage-by-tap/${uid}?days=${days}`);
export const getHourlyPattern  = (uid, days) => api.get(`/hourly-pattern/${uid}?days=${days}`);
export const getTapLimits      = (uid)        => api.get(`/tap-limits/${uid}`);
export const getExportUrl = (uid, days) => {
  const token = localStorage.getItem("token") || "";
  return `${BASE}/export-csv/${uid}?days=${days}&token=${token}`;
};

export default api;
