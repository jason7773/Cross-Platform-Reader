import { apiJson, withApiError } from "@/server/api";
import { getLocalDb } from "@/server/local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    return withApiError(() => {
        getLocalDb().prepare("SELECT 1").get();
        return apiJson({ ok: true });
    });
}
