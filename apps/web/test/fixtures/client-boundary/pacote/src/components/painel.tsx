"use client";

// Fixture: componente cliente que importa pacotes só de servidor.
import { PrismaClient } from "@prisma/client";
import { Agent } from "@mastra/core/agent";

export function Painel() {
  return <p>{String(PrismaClient)}{String(Agent)}</p>;
}
