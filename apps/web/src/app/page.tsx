import { redirect } from "next/navigation";
import { LogoutButton } from "../components/logout-button";
import { getCurrentSession } from "../server/session/current-session";

// A verificação da sessão fica no server component (sem middleware do Next, que roda em edge).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getCurrentSession();
  if (session === undefined) redirect("/login");

  return (
    <main>
      <h1>Nexo Assist</h1>
      <p>Olá, {session.name}</p>
      <LogoutButton />
      <p>O chat entra numa próxima entrega.</p>
    </main>
  );
}
