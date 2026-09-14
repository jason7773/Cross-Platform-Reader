#!/usr/bin/env node
// Run on an administrator machine after `npm install firebase-admin`.
import process from "node:process";
const [, , command, uid] = process.argv;
if (!command || !uid || !["approve", "disable"].includes(command)) {
  console.error("Usage: node scripts/firebase-members.mjs approve|disable FIREBASE_UID"); process.exit(1);
}
let admin;
try { admin = await import("firebase-admin"); } catch { console.error("Install firebase-admin on the administrator machine; never add its key to the browser or repository."); process.exit(1); }
admin.initializeApp();
await admin.firestore().collection("members").doc(uid).set({ active: command === "approve", updatedAt: Date.now() }, { merge: true });
console.log(`${command === "approve" ? "Approved" : "Disabled"} Firebase member ${uid}`);
