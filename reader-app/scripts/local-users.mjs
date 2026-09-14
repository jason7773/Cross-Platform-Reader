#!/usr/bin/env node
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const [command, emailInput, ...flags] = process.argv.slice(2);
const dataDirectory = path.resolve(process.env.READER_DATA_DIR?.trim() || path.join(process.cwd(), "data"));
const databasePath = path.join(dataDirectory, "reader.sqlite");
const email = emailInput?.trim().toLowerCase();
const requiresPassword = command === "create" || command === "reset-password";

const usage = () => {
    console.error("Usage:\n  npm run local:user -- create EMAIL --password-stdin\n  npm run local:user -- disable EMAIL\n  npm run local:user -- enable EMAIL\n  npm run local:user -- reset-password EMAIL --password-stdin\n  npm run local:user -- list");
};

if (!command || (command !== "list" && (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) || (requiresPassword && !flags.includes("--password-stdin"))) {
    usage();
    process.exitCode = 1;
} else {
    const password = requiresPassword ? (await new Promise((resolve, reject) => {
        let input = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => { input += chunk; });
        process.stdin.on("end", () => resolve(input.replace(/[\r\n]+$/, "")));
        process.stdin.on("error", reject);
    })) : undefined;
    if (requiresPassword && (typeof password !== "string" || password.length < 12)) {
        console.error("Passwords must contain at least 12 characters.");
        process.exitCode = 1;
    } else {
        mkdirSync(dataDirectory, { recursive: true });
        const db = new Database(databasePath);
        db.pragma("foreign_keys = ON");
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, csrf_token TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
        `);
        const hashPassword = (raw) => {
            const salt = randomBytes(16).toString("hex");
            return `scrypt$${salt}$${scryptSync(raw, salt, 64).toString("hex")}`;
        };
        try {
            if (command === "create") {
                const now = Date.now();
                db.prepare("INSERT INTO users (id, email, password_hash, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
                    .run(randomUUID(), email, hashPassword(password), now, now);
                console.log(`Created active library user: ${email}`);
            } else if (command === "disable" || command === "enable") {
                const active = command === "enable" ? 1 : 0;
                const result = db.prepare("UPDATE users SET active = ?, updated_at = ? WHERE email = ?").run(active, Date.now(), email);
                if (result.changes !== 1) throw new Error("User not found.");
                if (!active) db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);
                console.log(`${active ? "Enabled" : "Disabled"} library user: ${email}`);
            } else if (command === "reset-password") {
                const result = db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE email = ?").run(hashPassword(password), Date.now(), email);
                if (result.changes !== 1) throw new Error("User not found.");
                db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);
                console.log(`Reset password and revoked sessions for: ${email}`);
            } else if (command === "list") {
                const rows = db.prepare("SELECT email, active, created_at FROM users ORDER BY email").all();
                console.table(rows.map((row) => ({ email: row.email, status: row.active ? "active" : "disabled", createdAt: new Date(row.created_at).toISOString() })));
            } else {
                usage();
                process.exitCode = 1;
            }
        } catch (error) {
            console.error(error instanceof Error ? error.message : "User command failed.");
            process.exitCode = 1;
        } finally {
            db.close();
        }
    }
}
