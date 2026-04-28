import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import Login       from "./pages/Login";
import Register    from "./pages/Register";
import Dashboard   from "./pages/Dashboard";
import ManageConfig from "./pages/ManageConfig";
import Reports     from "./pages/Reports";
import Layout      from "./components/Layout";

function PrivateRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login"    element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/" element={
              <PrivateRoute><Layout /></PrivateRoute>
            }>
              <Route index          element={<Dashboard />} />
              <Route path="manage"  element={<ManageConfig />} />
              <Route path="reports" element={<Reports />} />
              {/* Legacy redirects */}
              <Route path="config"         element={<Navigate to="/manage" replace />} />
              <Route path="tap-control"    element={<Navigate to="/" replace />} />
              <Route path="tap-management" element={<Navigate to="/manage" replace />} />
              <Route path="setup"          element={<Navigate to="/manage" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
