import { productionAuthDeps } from "../../../server/auth/deps";
import { handleLogin } from "../../../server/auth/login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handleLogin(request, productionAuthDeps());
}
