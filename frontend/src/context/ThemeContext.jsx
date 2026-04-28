import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    return localStorage.getItem("theme") !== "light";
  });

  useEffect(() => {
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const toggle = () => setDark(d => !d);

  const t = dark ? {
    bg:        "#050C1A",
    sidebar:   "#07101E",
    card:      "#0D1829",
    card2:     "#0A1525",
    border:    "#1A2840",
    text:      "#E2E8F0",
    textMuted: "#4A7FA5",
    textSub:   "#64748B",
    cyan:      "#00D4FF",
    blue:      "#0057FF",
    green:     "#00D97E",
    orange:    "#FF9D00",
    red:       "#FF4D6D",
    inputBg:   "#070E1C",
  } : {
    bg:        "#F0F4F8",
    sidebar:   "#FFFFFF",
    card:      "#FFFFFF",
    card2:     "#F8FAFC",
    border:    "#CBD5E1",
    text:      "#0F172A",
    textMuted: "#475569",
    textSub:   "#94A3B8",
    cyan:      "#0284C7",
    blue:      "#1D4ED8",
    green:     "#059669",
    orange:    "#D97706",
    red:       "#DC2626",
    inputBg:   "#FFFFFF",
  };

  return (
    <ThemeContext.Provider value={{ dark, toggle, t }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
