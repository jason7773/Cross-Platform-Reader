"use client";
import { useTheme } from "@/context/ThemeContext";
import styles from "./ThemeToggle.module.css";

export default function ThemeToggle() {
    const { theme, toggleTheme } = useTheme();

    return (
        <label className={styles.switch}>
            <input
                type="checkbox"
                checked={theme === "dark"}
                onChange={toggleTheme}
            />
            <span className={styles.slider}>
                <span className={styles.icon}>{theme === "dark" ? "🌙" : "☀️"}</span>
            </span>
        </label>
    );
}
