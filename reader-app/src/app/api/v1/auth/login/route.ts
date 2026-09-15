import { apiError, apiJson, requireLocalBackend, withApiError } from "@/server/api";
import { createSession, findUserByEmail, getSessionCookieName, sessionCookieOptions, verifyPassword } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

const attemptKey = (request: Request) => {
    if (process.env.TRUST_PROXY === "true") {
        return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            || request.headers.get("x-real-ip") || "proxy-unknown";
    }
    return "local-client-pool";
};

const recordAttempt = (key: string) => {
    const now = Date.now();
    const previous = attempts.get(key);
    const entry = !previous || previous.resetAt <= now ? { count: 1, resetAt: now + WINDOW_MS } : { ...previous, count: previous.count + 1 };
    attempts.set(key, entry);
    return entry.count > MAX_ATTEMPTS;
};

export async function POST(request: Request) {
    return withApiError(async () => {
        const backendError = requireLocalBackend();
        if (backendError) return backendError;
        const length = Number(request.headers.get("content-length") || "0");
        if (length > 64 * 1024) return apiError("Request is too large.", 413);
        const key = attemptKey(request);
        if (recordAttempt(key)) return apiError("Too many sign-in attempts. Try again later.", 429);
        const body = await request.json() as { email?: unknown; password?: unknown };
        if (typeof body.email !== "string" || typeof body.password !== "string") return apiError("Email and password are required.");
        const user = findUserByEmail(body.email);
        if (!user || user.active !== 1 || !verifyPassword(body.password, user.password_hash)) {
            return apiError("Incorrect email or password.", 401);
        }
        attempts.delete(key);
        const session = createSession(user.id);
        const response = apiJson({ user: { uid: user.id, email: user.email }, csrfToken: session.csrfToken });
        response.cookies.set(getSessionCookieName(), session.token, sessionCookieOptions(session.expiresAt));
        return response;
    });
}
