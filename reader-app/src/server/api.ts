import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertCsrf, getCurrentSession, getSessionCookieName, type LocalSession } from "@/server/local";
import { getReaderBackend } from "@/backend/config";

export const apiError = (message: string, status = 400) => NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
});

export const apiJson = (value: unknown, status = 200) => NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
});

export const requireSession = async (): Promise<LocalSession | NextResponse> => {
    if (getReaderBackend() !== "local") return apiError("Local API is disabled for this deployment.", 404);
    const session = await getCurrentSession();
    return session || apiError("Sign in is required.", 401);
};

export const requireMutationSession = async (request: Request): Promise<LocalSession | NextResponse> => {
    if (getReaderBackend() !== "local") return apiError("Local API is disabled for this deployment.", 404);
    const origin = request.headers.get("origin");
    const configuredOrigin = process.env.APP_ORIGIN?.trim().replace(/\/$/, "");
    const requestOrigin = new URL(request.url).origin;
    if (origin && origin !== (configuredOrigin || requestOrigin)) {
        return apiError("Cross-origin writes are not allowed.", 403);
    }

    const token = (await cookies()).get(getSessionCookieName())?.value;
    const session = assertCsrf(token, request.headers.get("x-csrf-token"));
    return session || apiError("Your session is missing or expired. Refresh and sign in again.", 401);
};

export const requireLocalBackend = () => getReaderBackend() === "local"
    ? null
    : apiError("Local API is disabled for this deployment.", 404);

export const isApiError = (value: LocalSession | NextResponse): value is NextResponse => value instanceof NextResponse;

export const withApiError = async <T>(operation: () => Promise<T> | T) => {
    try {
        return await operation();
    } catch (error) {
        console.error("Local API request failed:", error);
        return apiError(error instanceof Error ? error.message : "The request could not be completed.", 400);
    }
};
