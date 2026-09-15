import { apiJson, requireLocalBackend, withApiError } from "@/server/api";
import { getLocalDb } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    return withApiError(() => {
        const backendError = requireLocalBackend();
        if (backendError) return backendError;
        getLocalDb().prepare("SELECT 1").get();
        return apiJson({ ok: true });
    });
}
