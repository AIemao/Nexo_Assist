// Extensões do contrato do agent (W8.3; PW-8): confere os bytes contra o manifesto, sem git e sem rede,
// no padrão do baseline-v4.test.ts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AGENT_CONTRACT_VERSION } from "../src/server/agent/contract-version";
import { viewMyTicketInputSchema } from "../src/server/agent/extensions/view-my-ticket";
import { listMyTicketsInputSchema } from "../src/server/tickets/list-my-tickets";

const webRoot = new URL("../", import.meta.url);
const manifestSchema = z.object({
  agentContractVersion: z.string(),
  files: z.record(z.string(), z.object({ sha256: z.string() })),
});
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(new URL("src/server/agent/extensions/manifest.json", webRoot), "utf8")),
);

describe("extensões do contrato do agent", () => {
  it("o manifesto registra a versão do contrato e o arquivo da viewMyTicket", () => {
    expect(manifest.agentContractVersion).toBe(AGENT_CONTRACT_VERSION);
    expect(AGENT_CONTRACT_VERSION).toBe("nexo-agent-contract-v1");
    expect(Object.keys(manifest.files)).toStrictEqual(["src/server/agent/extensions/view-my-ticket.ts"]);
  });

  it.each(Object.entries(manifest.files))("SHA-256 de %s igual ao do manifesto", (path, entry) => {
    expect(createHash("sha256").update(readFileSync(new URL(path, webRoot))).digest("hex")).toBe(entry.sha256);
  });
});

// Nenhuma propriedade de identidade nos schemas de entrada: a identidade só vem do actor da sessão.
const IDENTITY = /employee|actor|email|user|requester|header|session/i;

describe("schemas de entrada das leituras", () => {
  it.each([
    ["viewMyTicket", viewMyTicketInputSchema, ["ticketId"]],
    ["listMyTickets", listMyTicketsInputSchema, []],
  ] as const)("%s: propriedades exatas e nenhuma de identidade", (_name, schema, keys) => {
    const properties = Object.keys(z.toJSONSchema(schema).properties ?? {});
    expect(properties).toStrictEqual(keys);
    for (const property of properties) expect(property).not.toMatch(IDENTITY);
  });

  it.each([{ employeeId: "x" }, { actor: { employeeId: "x" } }, { email: "x@y" }, { headers: { "X-Actor-Employee-Id": "x" } }])(
    "schemas estritos recusam argumentos de identidade: %j",
    (extra) => {
      expect(viewMyTicketInputSchema.safeParse({ ticketId: "x", ...extra }).success).toBe(false);
      expect(listMyTicketsInputSchema.safeParse(extra).success).toBe(false);
    },
  );
});
