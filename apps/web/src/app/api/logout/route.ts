import { productionAuthDeps } from "../../../server/auth/deps";
import { handleLogout } from "../../../server/auth/logout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleLogout(request, productionAuthDeps());
}
