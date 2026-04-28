import { createContext, useContext, useState, useEffect } from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token  = localStorage.getItem("token");
    const uid    = localStorage.getItem("user_id");
    const name   = localStorage.getItem("name");
    if (token && uid) setUser({ token, user_id: parseInt(uid), name });
  }, []);

  const loginSave = ({ token, user_id, name }) => {
    localStorage.setItem("token",   token);
    localStorage.setItem("user_id", user_id);
    localStorage.setItem("name",    name);
    setUser({ token, user_id, name });
  };

  const logout = () => {
    localStorage.clear();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loginSave, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
