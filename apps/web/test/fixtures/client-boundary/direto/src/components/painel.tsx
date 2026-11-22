"use client";

// Fixture: componente cliente que importa um módulo de src/server/ diretamente.
import { db } from "../server/db";

export function Painel() {
  return <p>{db}</p>;
}
