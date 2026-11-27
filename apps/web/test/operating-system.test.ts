import { describe, expect, it } from "vitest";
import {
  detectOperatingSystem,
  passesApplicability,
  type ConversationText,
  type OperatingSystem,
} from "../src/server/knowledge/operating-system";

const employee = (content: string): ConversationText => ({ authorType: "EMPLOYEE", content });
const agent = (content: string): ConversationText => ({ authorType: "AGENT", content });
const detect = (...messages: ConversationText[]) => detectOperatingSystem(messages);
const known = (value: string): OperatingSystem => ({ kind: "known", value });

const vpnWindows10 = { applicability: { operatingSystems: ["Windows 10"] } };

describe("sistema operacional (PW-5; AF v1.9, nota de 2026-11-22)", () => {
  it.each([
    ["Uso Windows 10.", "Windows 10"],
    ["win 10", "Windows 10"],
    ["Windows10", "Windows 10"],
    ["windows 11", "Windows 11"],
    ["WIN 10", "Windows 10"],
    ["win10 aqui", "Windows 10"],
    ["Win 11", "Windows 11"],
    ["estou no windows 8.1", "Windows 8.1"],
    ["meu mac", "macOS"],
    ["uso macOS", "macOS"],
    ["no Mac OS", "macOS"],
    ["Ubuntu 22", "Linux"],
  ])("forma natural: %s → %s", (text, expected) => {
    expect(detect(employee(text))).toStrictEqual(known(expected));
  });

  it.each(["windows 100", "twin 10", "erro 10"])("falso positivo: %s não é Windows com versão", (text) => {
    expect(detect(employee(text)).kind).toBe("unknown");
  });

  it("twin 10 e erro 10 não citam sistema nenhum", () => {
    expect(detect(employee("twin 10"))).toStrictEqual({ kind: "unknown", reason: "none" });
    expect(detect(employee("erro 10"))).toStrictEqual({ kind: "unknown", reason: "none" });
  });

  it("nenhuma mensagem cita sistema → desconhecido", () => {
    expect(detect(employee("A VPN não conecta."))).toStrictEqual({ kind: "unknown", reason: "none" });
    expect(detect()).toStrictEqual({ kind: "unknown", reason: "none" });
  });

  it("formas diferentes do mesmo sistema contam como um", () => {
    expect(detect(employee("Windows 10, o win10 do trabalho"))).toStrictEqual(known("Windows 10"));
  });

  it("versões diferentes na mesma mensagem → desconhecido", () => {
    expect(detect(employee("Windows 10 e Windows 11"))).toStrictEqual({ kind: "unknown", reason: "ambiguous" });
  });

  it("Windows sem versão junto com uma versão específica vale a específica", () => {
    expect(detect(employee("Uso Windows, o 10 mesmo, Windows 10"))).toStrictEqual(known("Windows 10"));
  });

  it("Windows sem versão junto com duas versões → desconhecido", () => {
    expect(detect(employee("Windows, Windows 10 e Windows 11"))).toStrictEqual({ kind: "unknown", reason: "ambiguous" });
  });

  it("Windows sem versão sozinho → desconhecido", () => {
    expect(detect(employee("Uso Windows."))).toStrictEqual({ kind: "unknown", reason: "unversioned" });
  });

  it("famílias diferentes → desconhecido", () => {
    expect(detect(employee("Windows 10 e Linux"))).toStrictEqual({ kind: "unknown", reason: "ambiguous" });
  });

  it("a mensagem mais recente que cita sistema prevalece", () => {
    expect(detect(employee("Windows 10"), employee("Windows 11"))).toStrictEqual(known("Windows 11"));
    expect(detect(employee("Windows 11"), employee("Windows 10"))).toStrictEqual(known("Windows 10"));
  });

  it("mensagem mais recente sem sistema não apaga a anterior", () => {
    expect(detect(employee("Uso Windows 10."), employee("Ainda não funciona."))).toStrictEqual(known("Windows 10"));
  });

  it("texto do assistant é ignorado", () => {
    expect(detect(employee("Uso Windows 10."), agent("Você usa Windows 11?"))).toStrictEqual(known("Windows 10"));
    expect(detect(agent("Windows 11"))).toStrictEqual({ kind: "unknown", reason: "none" });
  });
});

describe("endereço MAC não é macOS", () => {
  it.each(["meu endereço MAC está bloqueado", "o endereço de MAC mudou", "tem filtro de MAC na rede", "filtragem por MAC", "qual o MAC address?"])(
    "%s → nenhum sistema",
    (text) => {
      expect(detect(employee(text))).toStrictEqual({ kind: "unknown", reason: "none" });
    },
  );

  it("endereço MAC numa mensagem mais recente não apaga o Windows 10 citado antes", () => {
    expect(detect(employee("Uso Windows 10."), employee("o endereço MAC foi bloqueado"))).toStrictEqual(known("Windows 10"));
  });

  it.each([
    ["uso meu Mac", "macOS"],
    ["meu MacBook", "macOS"],
  ])("%s → %s", (text, expected) => {
    expect(detect(employee(text))).toStrictEqual(known(expected));
  });
});

describe("versões não reconhecidas e listas de versões", () => {
  it("Windows 10 e Windows 100 → ambíguo", () => {
    expect(detect(employee("Windows 10 e Windows 100"))).toStrictEqual({ kind: "unknown", reason: "ambiguous" });
  });

  it("windows 100 sozinho → sem versão conhecida", () => {
    expect(detect(employee("windows 100"))).toStrictEqual({ kind: "unknown", reason: "unversioned" });
  });

  it.each(["Windows 10 e 11", "Windows 10 ou 11", "Windows 10/11", "win 10, 11", "uso Windows 10 ou 11, não sei"])(
    "%s → ambíguo",
    (text) => {
      expect(detect(employee(text))).toStrictEqual({ kind: "unknown", reason: "ambiguous" });
    },
  );

  it.each(["Uso Windows 10 e 2 monitores", "Windows 10. Erro 11 na tela"])("%s → Windows 10", (text) => {
    expect(detect(employee(text))).toStrictEqual(known("Windows 10"));
  });
});

describe("filtro de aplicabilidade (desvio D-4)", () => {
  it("Windows 10 passa e Windows 11 é rejeitado no artigo de VPN do Windows 10", () => {
    expect(passesApplicability(vpnWindows10, known("Windows 10"))).toBe(true);
    expect(passesApplicability(vpnWindows10, { kind: "known", value: "Windows 11" })).toBe(false);
  });

  it("sistema desconhecido → artigo com applicability rejeitado", () => {
    expect(passesApplicability(vpnWindows10, { kind: "unknown", reason: "none" })).toBe(false);
    expect(passesApplicability(vpnWindows10, { kind: "unknown", reason: "unversioned" })).toBe(false);
  });

  it("artigo sem applicability passa sempre", () => {
    expect(passesApplicability({}, { kind: "unknown", reason: "none" })).toBe(true);
  });

  it("a comparação não diferencia maiúsculas e espaços", () => {
    expect(passesApplicability({ applicability: { operatingSystems: ["windows10"] } }, { kind: "known", value: "Windows 10" })).toBe(true);
  });
});
