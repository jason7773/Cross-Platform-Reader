import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { assertCsrf, getCurrentSession, getSessionCookieName, type LocalSession } from "@/server/local";

export const apiError = (message: string, status = 400) => NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store" },
});

export const apiJson = (value: unknown, status = 200) => NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
});

export const requireSession = async (): Promise<LocalSession | NextResponse> => {
    const session = await getCurrentSession();
    return session || apiError("Sign in is required.", 401);
};

export const requireMutationSession = async (request: Request): Promise<LocalSession | NextResponse> => {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
        return apiError("Cross-origin writes are not allowed.", 403);
    }

    const token = (await cookies()).get(getSessionCookieName())?.value;
    const session = assertCsrf(token, request.headers.get("x-csrf-token"));
    return session || apiError("Your session is missing or expired. Refresh and sign in again.", 401);
};

export const isApiError = (value: LocalSession | NextResponse): value is NextResponse => value instanceof NextResponse;

export const withApiError = async <T>(operation: () => Promise<T> | T) => {
    try {
        return await operation();
    } catch (error) {
        console.error("Local API request failed:", error);
        return apiError(error instanceof Error ? error.message : "The request could not be completed.", 400);
    }
};
