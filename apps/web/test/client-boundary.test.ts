import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkClientBoundary, hasUseClientDirective, importSpecifiers } from "./support/client-boundary";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/client-boundary/${name}`, import.meta.url));

describe("fronteira servidor/cliente (ADR-013; plano T2)", () => {
  it("o src/ do web não tem componente cliente que alcance código só de servidor", () => {
    const report = checkClientBoundary(webRoot);
    expect(report.violations).toStrictEqual([]);
  });

  it("acusa componente cliente que importa src/server/ diretamente", () => {
    const report = checkClientBoundary(fixture("direto"));
    expect(report.clientFiles).toStrictEqual(["src/components/painel.tsx"]);
    expect(report.violations).toStrictEqual([
      { clientFile: "src/components/painel.tsx", chain: ["src/components/painel.tsx"], reached: "src/server/db.ts" },
    ]);
  });

  it("acusa componente cliente que alcança src/server/ por um intermediário", () => {
    const report = checkClientBoundary(fixture("intermediario"));
    expect(report.violations).toStrictEqual([
      {
        clientFile: "src/components/painel.tsx",
        chain: ["src/components/painel.tsx", "src/lib/formatar.ts"],
        reached: "src/server/db.ts",
      },
    ]);
  });

  it("acusa componente cliente que importa src/server/ pelo alias do tsconfig", () => {
    const report = checkClientBoundary(fixture("alias"));
    expect(report.violations.map((v) => v.reached)).toStrictEqual(["src/server/db.ts"]);
  });

  it("acusa componente cliente que importa pacotes só de servidor", () => {
    const report = checkClientBoundary(fixture("pacote"));
    expect(report.violations.map((v) => v.reached).sort()).toStrictEqual(["@mastra/core/agent", "@prisma/client"]);
  });

  it("aceita componente cliente limpo e componente de servidor que importa src/server/", () => {
    const report = checkClientBoundary(fixture("limpo"));
    expect(report.clientFiles).toStrictEqual(["src/components/painel.tsx"]);
    expect(report.violations).toStrictEqual([]);
  });

  it("reconhece a diretiva só como primeira instrução", () => {
    expect(hasUseClientDirective('"use client";\nexport {};')).toBe(true);
    expect(hasUseClientDirective("// comentário\n'use client';\nexport {};")).toBe(true);
    expect(hasUseClientDirective('import x from "y";\n"use client";')).toBe(false);
  });

  it("lê imports estáticos, de tipo, reexports, dinâmicos e de efeito colateral", () => {
    const source = [
      'import a from "./a";',
      'import type { B } from "./b";',
      'export { c } from "./c";',
      'import "./d";',
      'const e = await import("./e");',
      'import {\n  f,\n} from "./f";',
    ].join("\n");
    expect(importSpecifiers(source).sort()).toStrictEqual(["./a", "./b", "./c", "./d", "./e", "./f"]);
  });
});
