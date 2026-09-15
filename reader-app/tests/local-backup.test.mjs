import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, chownSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

test("backup and restore preserve database and files with a private writable destination", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "reader-backup-test-"));
    const source = path.join(root, "source");
    const backup = path.join(root, "backup");
    const restored = path.join(root, "restored");
    const checkLinuxOwnership = process.platform === "linux" && process.getuid?.() === 0;
    const run = (command, data, target) => spawnSync(process.execPath, ["scripts/local-backup.mjs", command, target], {
        encoding: "utf8",
        env: { ...process.env, READER_DATA_DIR: data },
        ...(checkLinuxOwnership ? { uid: 1000, gid: 1000 } : {}),
    });
    try {
        chmodSync(root, 0o755);
        for (const directory of [source, backup, restored]) mkdirSync(directory);
        mkdirSync(path.join(source, "files"));
        writeFileSync(path.join(source, "files", "book.txt"), "reader backup fixture");
        const database = new Database(path.join(source, "reader.sqlite"));
        database.pragma("journal_mode = WAL");
        database.exec("CREATE TABLE fixture (value TEXT); INSERT INTO fixture VALUES ('saved progress')");
        database.close();
        if (checkLinuxOwnership) {
            for (const directory of [source, restored]) chownSync(directory, 1000, 1000);
            // Reproduce the runner-owned Linux bind mount from CI.
            chownSync(backup, 1001, 1001);
            chmodSync(backup, 0o755);
            const denied = run("backup", source, backup);
            assert.notEqual(denied.status, 0);
            assert.match(denied.stderr, /unable to open database file/);
            chownSync(backup, 1000, 1000);
        }
        chmodSync(backup, 0o700);
        const saved = run("backup", source, backup);
        assert.equal(saved.status, 0, saved.stderr);
        // Model a read-only backup mount, including the SQLite database.
        chmodSync(path.join(backup, "reader.sqlite"), 0o444);
        chmodSync(backup, 0o555);
        const recovered = run("restore", restored, backup);
        assert.equal(recovered.status, 0, recovered.stderr);
        const result = new Database(path.join(restored, "reader.sqlite"), { readonly: true });
        try { assert.equal(result.prepare("SELECT value FROM fixture").get().value, "saved progress"); }
        finally { result.close(); }
        assert.equal(readFileSync(path.join(restored, "files", "book.txt"), "utf8"), "reader backup fixture");
        const repeated = run("restore", restored, backup);
        assert.notEqual(repeated.status, 0);
        assert.match(repeated.stderr, /must be empty/);
    } finally {
        chmodSync(backup, 0o700);
        rmSync(root, { recursive: true, force: true });
    }
});
