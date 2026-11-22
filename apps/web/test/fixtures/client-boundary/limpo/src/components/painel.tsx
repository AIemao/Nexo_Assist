"use client";

// Fixture: componente cliente limpo (só utilitário puro e React).
import { useState } from "react";
import { formatar } from "@/lib/formatar";

export function Painel() {
  const [texto] = useState(formatar(" ok "));
  return <p>{texto}</p>;
}
