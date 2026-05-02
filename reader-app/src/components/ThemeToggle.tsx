"use client";
import { useTheme } from "@/context/ThemeContext";
import styles from "./ThemeToggle.module.css";

export default function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();

    return (
        <label className={styles.switch} title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
            <input
                type="checkbox"
                checked={theme === "dark"}
                onChange={toggleTheme}
                aria-label="Toggle color theme"
            />
            <span className={styles.slider}>
                <span className={styles.icon}>{theme === "dark" ? "D" : "L"}</span>
            </span>
        </label>
    );
}
