"use client";

// Fixture: componente cliente que importa src/server/ pelo alias do tsconfig.
import { db } from "@/server/db";

export function Painel() {
  return <p>{db}</p>;
}
