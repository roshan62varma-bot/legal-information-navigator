"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsDark } from "@/lib/hooks";

export function ThemeToggle() {
  // Reads the class the pre-paint script set; the MutationObserver in useIsDark re-renders on change.
  const dark = useIsDark();

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("lin-theme", next ? "dark" : "light");
    } catch {
      /* storage blocked: theme still applies for this visit */
    }
  };

  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={dark}>
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
