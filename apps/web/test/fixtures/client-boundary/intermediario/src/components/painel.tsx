"use client";

// Fixture: componente cliente que alcança src/server/ por um intermediário.
import { rotulo } from "../lib/formatar";

export function Painel() {
  return <p>{rotulo}</p>;
}
