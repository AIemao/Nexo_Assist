import type { MessageAuthorType } from "../../domain/conversation";
import { normalizeText } from "./search";

// Sistema operacional do filtro de aplicabilidade (AF v1.9, nota de 2026-11-22; plano PW-5; desvio
// D-4 da W8.3). Função pura sobre as mensagens persistidas da conversa, em ordem. Só as mensagens do
// funcionário contam: nunca o texto do assistant, dos artigos nem os argumentos do modelo.

export interface ConversationText {
  authorType: MessageAuthorType;
  content: string;
}

export type OperatingSystem =
  | { kind: "known"; value: string }
  // none: nenhuma mensagem cita sistema; ambiguous: a mais recente cita sistemas diferentes;
  // unversioned: a mais recente cita Windows sem versão.
  | { kind: "unknown"; reason: "none" | "ambiguous" | "unversioned" };

// Versões numéricas do Windows reconhecidas. Outro número depois de "windows" ou "win" é uma versão
// distinta não reconhecida: sozinho, Windows sem versão conhecida ("windows 100"); junto com outra
// versão, ambíguo ("Windows 10 e Windows 100").
const WINDOWS_VERSIONS: readonly string[] = ["7", "8", "8.1", "10", "11"];

// Fronteira dos dois lados: "twin 10" não casa. Depois da versão, ponto final de frase vale
// ("Uso Windows 10."); ponto seguido de algarismo faria parte dela.
const NUMBER_END = String.raw`(?![\p{L}\p{N}]|\.\d)`;
const WINDOWS_WITH_VERSION = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:windows|win)\s*(\d+(?:\.\d+)?)${NUMBER_END}`, "gu");
// Lista de versões ligada a uma ocorrência de Windows com versão: "10 e 11", "10 ou 11", "10/11",
// "10, 11". Só números de WINDOWS_VERSIONS continuam a lista ("Windows 10 e 2 monitores" para no 2).
const LIST_CONTINUATION = new RegExp(String.raw`\s*(?:,|\/|e|ou)\s*(\d+(?:\.\d+)?)${NUMBER_END}`, "uy");
const WINDOWS_WORD = /(?<![\p{L}\p{N}])windows(?![\p{L}])/u;
const MAC_FORMS = /(?<![\p{L}\p{N}])(macbook|macos|mac\s*os|mac)(?![\p{L}\p{N}])/gu;
// "mac" em contexto de endereço de rede não cita sistema: "endereço (de|do) MAC", "filtro (de|por)
// MAC", "filtragem (de|por) MAC" e "MAC address".
const MAC_ADDRESS_BEFORE = /(?:(?<![\p{L}\p{N}])enderecos?\s+(?:(?:de|do)\s+)?|(?<![\p{L}\p{N}])(?:filtro|filtragem)\s+(?:(?:de|por)\s+)?)$/u;
const MAC_ADDRESS_AFTER = /^\s+address(?![\p{L}\p{N}])/u;
const LINUX = /(?<![\p{L}\p{N}])(?:linux|ubuntu)(?![\p{L}\p{N}])/u;

// Versões citadas nas ocorrências de Windows com número, inclusive as listas ligadas a elas.
function windowsVersionsIn(normalized: string): Set<string> {
  const versions = new Set<string>();
  for (const match of normalized.matchAll(WINDOWS_WITH_VERSION)) {
    versions.add(match[1] ?? "");
    let position = (match.index ?? 0) + match[0].length;
    for (;;) {
      LIST_CONTINUATION.lastIndex = position;
      const next = LIST_CONTINUATION.exec(normalized);
      const version = next?.[1];
      if (next === null || version === undefined || !WINDOWS_VERSIONS.includes(version)) break;
      versions.add(version);
      position = LIST_CONTINUATION.lastIndex;
    }
  }
  return versions;
}

function citesMacOs(normalized: string): boolean {
  for (const match of normalized.matchAll(MAC_FORMS)) {
    if (match[1] !== "mac") return true;
    const start = match.index ?? 0;
    const before = normalized.slice(0, start);
    const after = normalized.slice(start + match[0].length);
    if (!MAC_ADDRESS_BEFORE.test(before) && !MAC_ADDRESS_AFTER.test(after)) return true;
  }
  return false;
}

// Sistemas citados numa mensagem, ou undefined se ela não cita nenhum.
function systemsIn(text: string): OperatingSystem | undefined {
  const normalized = normalizeText(text);
  const windowsVersions = windowsVersionsIn(normalized);
  // "windows" sem número junto (fora das ocorrências com versão) é menção genérica.
  const windowsGeneric = WINDOWS_WORD.test(normalized.replace(WINDOWS_WITH_VERSION, " "));

  const families: string[] = [];
  if (windowsVersions.size > 0 || windowsGeneric) families.push("windows");
  if (citesMacOs(normalized)) families.push("macos");
  if (LINUX.test(normalized)) families.push("linux");

  if (families.length === 0) return undefined;
  if (families.length > 1) return { kind: "unknown", reason: "ambiguous" };
  const family = families[0];
  if (family === "macos") return { kind: "known", value: "macOS" };
  if (family === "linux") return { kind: "known", value: "Linux" };
  // Windows: duas versões quaisquer (reconhecidas ou não) são ambíguas; uma só vale se for
  // reconhecida, mesmo com "Windows" genérico junto; sem versão reconhecida, desconhecido.
  if (windowsVersions.size > 1) return { kind: "unknown", reason: "ambiguous" };
  const [version] = [...windowsVersions];
  return version !== undefined && WINDOWS_VERSIONS.includes(version)
    ? { kind: "known", value: `Windows ${version}` }
    : { kind: "unknown", reason: "unversioned" };
}

// Vale a mensagem do funcionário mais recente que cita algum sistema.
export function detectOperatingSystem(messages: readonly ConversationText[]): OperatingSystem {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message === undefined || message.authorType !== "EMPLOYEE") continue;
    const found = systemsIn(message.content);
    if (found !== undefined) return found;
  }
  return { kind: "unknown", reason: "none" };
}

// Comparação interna ao filtro: sem diferenciar maiúsculas, acentos e espaços. Não modifica o artigo.
function osKey(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

// Artigo sem applicability passa sempre; com applicability, só se o sistema conhecido estiver nela.
export function passesApplicability(
  article: { applicability?: { operatingSystems: readonly string[] } },
  system: OperatingSystem,
): boolean {
  if (article.applicability === undefined) return true;
  if (system.kind !== "known") return false;
  const key = osKey(system.value);
  return article.applicability.operatingSystems.some((value) => osKey(value) === key);
}
