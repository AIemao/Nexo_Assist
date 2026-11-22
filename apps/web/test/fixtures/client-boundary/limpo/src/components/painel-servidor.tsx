// Fixture: componente de servidor (sem "use client") pode importar src/server/.
import { db } from "../server/db";

export function PainelServidor() {
  return <p>{db}</p>;
}
