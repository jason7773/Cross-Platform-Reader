"use client";
import { useTheme } from "@/context/ThemeContext";

export default function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();

    return (
        <label
            className="relative inline-block h-8 w-[54px] shrink-0"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
            <input
                className="peer h-0 w-0 opacity-0"
                type="checkbox"
                checked={theme === "dark"}
                onChange={toggleTheme}
                aria-label="Toggle color theme"
            />
            <span className={`absolute inset-0 cursor-pointer rounded-lg border transition ${theme === "dark" ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--input-border)] bg-[var(--secondary)]"}`}>
                <span className={`absolute bottom-[3px] left-[3px] flex h-6 w-6 items-center justify-center rounded-md bg-[var(--surface)] text-[0.72rem] font-extrabold text-[var(--foreground)] shadow-[var(--shadow-sm)] transition-transform ${theme === "dark" ? "translate-x-[22px]" : ""}`}>
                    {theme === "dark" ? "D" : "L"}
                </span>
            </span>
        </label>
    );
}
