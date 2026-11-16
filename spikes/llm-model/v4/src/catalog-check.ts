// Checagem de catálogos do gabarito (v4/CRITERIA.md, "Estrutura > Etapa 1", exceção controlada 2).
//
// CÓPIA do trecho de ../../src/check-cases.ts (V1, congelado): o mapa CATALOG_BY_PATH e o laço de
// verificação por caso, numa função exportada. Motivo: o original é um script com o caminho
// ../cases.json fixo e código no nível superior, sem nada exportado. O catalog-check.test.ts confere
// que os dois trechos são idênticos ao original, linha a linha, descontada a indentação.
import type { CasesFile } from "../../src/cases-schema.ts";
import { normalizeText } from "../../src/fixtures.ts";
import { TOOL_INPUT_SCHEMAS } from "../../src/tools.ts";
import {
  AFFECTED_SCOPES,
  COMMITMENT_RISKS,
  INTENTS,
  MISSING_FIELDS,
  TICKET_CATEGORIES,
  TICKET_TYPES,
  WORK_IMPACTS,
} from "../../src/schema.ts";

// Campos cujos valores são de catálogo: uma regra "equals" só pode citar valores do catálogo.
const CATALOG_BY_PATH: Record<string, readonly string[]> = {
  category: TICKET_CATEGORIES,
  type: TICKET_TYPES,
  "impact.affectedScope": AFFECTED_SCOPES,
  "impact.workImpact": WORK_IMPACTS,
  "impact.commitmentRisk": COMMITMENT_RISKS,
  "impactAssessment.affectedScope": AFFECTED_SCOPES,
  "impactAssessment.workImpact": WORK_IMPACTS,
  "impactAssessment.commitmentRisk": COMMITMENT_RISKS,
};

// Problemas encontrados no arquivo já validado pelo casesFileSchema (lista vazia = válido).
export function checkCatalogs(file: CasesFile): string[] {
  const problems: string[] = [];

  // --- início do trecho copiado de ../../src/check-cases.ts ---
  const scenarios = new Set<string>();
  for (const c of file.cases) {
    const where = `${c.id} (${c.scenario})`;
    if (scenarios.has(c.scenario)) problems.push(`${where}: cenário repetido`);
    scenarios.add(c.scenario);

    if (!(INTENTS as readonly string[]).includes(c.expected.intent)) problems.push(`${where}: intent fora do catálogo`);

    // Chamadas gravadas no histórico obedecem ao schema de entrada da tool.
    const proposals: unknown[] = [];
    for (const [i, turn] of c.history.entries()) {
      if (turn.role !== "assistant") continue;
      for (const call of turn.toolCalls ?? []) {
        const parsed = TOOL_INPUT_SCHEMAS[call.tool].safeParse(call.args);
        if (!parsed.success) problems.push(`${where}: histórico, turno ${i + 1}: argumentos inválidos para ${call.tool}`);
        if (call.tool === "proposeTicketDraft") proposals.push(call.result);
      }
    }

    // O estado declarado bate com o histórico. Verificado: a PendingAction (id, versão, status e
    // type). Uma PendingAction no estado exige uma proposta gravada com o mesmo id, versão e
    // status; como a proposta vem da proposeTicketDraft, o type tem de ser CREATE_TICKET. Sem
    // PendingAction, nenhuma proposta gravada. NÃO verificado (metadado do cenário, sem como
    // conferir pelas mensagens): conversationStatus e focusTicketId.
    const pa = c.state.pendingAction;
    if (pa === null) {
      if (proposals.length > 0) problems.push(`${where}: o histórico tem proposta, mas o estado não tem PendingAction`);
    } else {
      if (proposals.length > 0 && pa.type !== "CREATE_TICKET") {
        problems.push(`${where}: a proposta gravada vem da proposeTicketDraft, mas o estado declara a PendingAction como ${pa.type}`);
      }
      const last = proposals.at(-1);
      const matches =
        typeof last === "object" &&
        last !== null &&
        "pendingActionId" in last &&
        last.pendingActionId === pa.id &&
        "version" in last &&
        last.version === pa.version &&
        "status" in last &&
        last.status === pa.status;
      if (!matches) problems.push(`${where}: o estado declara a PendingAction ${pa.id}, que não é o resultado da última proposta gravada`);
    }

    const mf = c.expected.missingFields;
    const mfValues = mf.mode === "exact" ? mf.values : [...mf.required, ...mf.forbidden];
    for (const v of mfValues) {
      if (!(MISSING_FIELDS as readonly string[]).includes(v)) problems.push(`${where}: missingField "${v}" fora do catálogo`);
    }

    for (const rule of [...c.expected.entities, ...(c.expected.toolArgs?.fields ?? [])]) {
      if (rule.presence === "absent") continue;
      const catalog = CATALOG_BY_PATH[rule.path];
      if (rule.rule.match === "equals" && catalog !== undefined) {
        for (const v of rule.rule.values) {
          if (!catalog.includes(v)) problems.push(`${where}: "${v}" fora do catálogo de ${rule.path}`);
        }
      }
      if (rule.rule.match === "normalized-contains-any") {
        for (const v of rule.rule.values) {
          if (normalizeText(v) !== v) problems.push(`${where}: valor "${v}" de ${rule.path} não está normalizado`);
        }
      }
    }
  }
  // --- fim do trecho copiado ---

  return problems;
}
