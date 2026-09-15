#!/usr/bin/env node
const [baseUrl, email, password] = process.argv.slice(2);
if (!baseUrl || !email || !password) {
    console.error("Usage: npm run test:local-api -- BASE_URL EMAIL PASSWORD");
    process.exit(1);
}

const base = baseUrl.replace(/\/$/, "");
const expectStatus = async (path, init, expected) => {
    const response = await fetch(`${base}${path}`, init);
    if (response.status !== expected) throw new Error(`${init?.method || "GET"} ${path}: expected ${expected}, received ${response.status}: ${await response.text()}`);
    return response;
};
const cookieFrom = (response) => {
    const cookie = response.headers.get("set-cookie");
    if (!cookie?.includes("reader_session=")) throw new Error("Login did not return a reader session cookie.");
    return cookie.split(";", 1)[0];
};

await expectStatus("/api/v1/health", undefined, 200);
await expectStatus("/api/v1/books", undefined, 401);
await expectStatus("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "wrong-password" }) }, 401);
const login = await expectStatus("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) }, 200);
const cookie = cookieFrom(login);
const loginPayload = await login.json();
if (!loginPayload.csrfToken) throw new Error("Login did not return a CSRF token.");
const sessionHeaders = { cookie };
const session = await expectStatus("/api/v1/auth/session", { headers: sessionHeaders }, 200);
const sessionPayload = await session.json();
if (sessionPayload.user?.email !== email.toLowerCase() || sessionPayload.csrfToken !== loginPayload.csrfToken) throw new Error("Session response does not match the login session.");
await expectStatus("/api/v1/books", { headers: sessionHeaders }, 200);
await expectStatus("/api/v1/auth/logout", { method: "POST", headers: sessionHeaders }, 401);
await expectStatus("/api/v1/auth/logout", { method: "POST", headers: { ...sessionHeaders, "x-csrf-token": loginPayload.csrfToken } }, 200);
await expectStatus("/api/v1/auth/session", { headers: sessionHeaders }, 401);
console.log("Local API smoke test passed.");
