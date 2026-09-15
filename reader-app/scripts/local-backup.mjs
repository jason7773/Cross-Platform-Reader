#!/usr/bin/env node
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const [command, targetArgument] = process.argv.slice(2);
const dataDirectory = path.resolve(process.env.READER_DATA_DIR?.trim() || path.join(process.cwd(), "data"));
const databaseName = "reader.sqlite";
const filesName = "files";
const manifestName = "reader-backup.json";
const usage = () => console.error("Usage:\n  npm run local:backup -- backup DESTINATION\n  npm run local:backup -- restore BACKUP_DIRECTORY\n\nStop the reader service before either operation. Backup destinations must be outside READER_DATA_DIR; restore targets must be empty.");

const isWithin = (candidate, parent) => candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
const directoryIsEmpty = async (directory) => {
    if (!existsSync(directory)) return true;
    return (await readdir(directory)).length === 0;
};
const sha256 = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const countFiles = async (directory) => {
    if (!existsSync(directory)) return 0;
    let count = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const item = path.join(directory, entry.name);
        if (entry.isDirectory()) count += await countFiles(item);
        else if (entry.isFile()) count += 1;
    }
    return count;
};

const backup = async (target) => {
    const sourceDatabase = path.join(dataDirectory, databaseName);
    if (!existsSync(sourceDatabase)) throw new Error(`No local database exists at ${sourceDatabase}.`);
    if (isWithin(target, dataDirectory)) throw new Error("Backup destination must be outside READER_DATA_DIR.");
    if (!await directoryIsEmpty(target)) throw new Error("Backup destination must not already contain files.");
    await mkdir(target, { recursive: true });
    const outputDatabase = path.join(target, databaseName);
    const source = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
    try {
        await source.backup(outputDatabase);
    } finally {
        source.close();
    }
    const sourceFiles = path.join(dataDirectory, filesName);
    if (existsSync(sourceFiles)) await cp(sourceFiles, path.join(target, filesName), { recursive: true, errorOnExist: true });
    const manifest = {
        format: "cross-platform-reader-local-backup",
        version: 1,
        createdAt: new Date().toISOString(),
        database: databaseName,
        filesDirectory: filesName,
        databaseSha256: await sha256(outputDatabase),
        fileCount: await countFiles(path.join(target, filesName)),
    };
    await writeFile(path.join(target, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(`Created backup at ${target} (${manifest.fileCount} file${manifest.fileCount === 1 ? "" : "s"}).`);
};

const restore = async (source) => {
    const manifestPath = path.join(source, manifestName);
    if (!existsSync(manifestPath)) throw new Error(`Backup manifest is missing from ${source}.`);
    if (!await directoryIsEmpty(dataDirectory)) throw new Error("READER_DATA_DIR must be empty before restoring.");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest?.format !== "cross-platform-reader-local-backup" || manifest?.version !== 1 || manifest.database !== databaseName || manifest.filesDirectory !== filesName) {
        throw new Error("Backup manifest format is not supported.");
    }
    const sourceDatabase = path.join(source, databaseName);
    if (!existsSync(sourceDatabase) || await sha256(sourceDatabase) !== manifest.databaseSha256) throw new Error("Backup database is missing or does not match its manifest.");
    const sourceFiles = path.join(source, filesName);
    if (await countFiles(sourceFiles) !== manifest.fileCount) throw new Error("Backup files do not match the manifest.");
    await mkdir(dataDirectory, { recursive: true });
    const destinationDatabase = path.join(dataDirectory, databaseName);
    const input = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
    try {
        await input.backup(destinationDatabase);
    } finally {
        input.close();
    }
    if (existsSync(sourceFiles)) await cp(sourceFiles, path.join(dataDirectory, filesName), { recursive: true, errorOnExist: true });
    console.log(`Restored backup from ${source}.`);
};

if (!targetArgument || !["backup", "restore"].includes(command || "")) {
    usage();
    process.exitCode = 1;
} else {
    const target = path.resolve(targetArgument);
    try {
        if (command === "backup") await backup(target);
        else await restore(target);
    } catch (error) {
        console.error(error instanceof Error ? error.message : "Backup command failed.");
        process.exitCode = 1;
    }
}
