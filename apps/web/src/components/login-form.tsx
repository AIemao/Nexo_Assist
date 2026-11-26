"use client";

import { useState, type FormEvent } from "react";

// Formulário do login simulado (README §3, Tela 1). Mostra a mensagem que a rota devolve.
export function LoginForm() {
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") }),
      });
      if (response.ok) {
        window.location.assign("/");
        return;
      }
      const body: unknown = await response.json().catch(() => undefined);
      const message =
        typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
          ? body.message
          : "Não foi possível entrar. Tente de novo.";
      setError(message);
    } catch {
      setError("Não foi possível entrar. Tente de novo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p>
        <label>
          E-mail <input name="email" type="email" autoComplete="username" required />
        </label>
      </p>
      <p>
        <label>
          Senha <input name="password" type="password" autoComplete="current-password" required />
        </label>
      </p>
      <button type="submit" disabled={pending}>
        Entrar
      </button>
      {error === undefined ? null : <p role="alert">{error}</p>}
    </form>
  );
}
