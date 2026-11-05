import type { Priority } from "./priority.js";

// DM v2.6 §8.5.2. Fuso operacional do MVP: UTC−03:00 com deslocamento fixo, sem
// biblioteca de fuso. Risco registrado: se o horário de verão voltar a ser aplicável,
// esta estratégia precisa ser revista.
const OPERATIONAL_OFFSET_MINUTES = -180;
const WINDOW_OPEN_HOUR = 8;
const WINDOW_CLOSE_HOUR = 18;
const BUSINESS_MINUTES_PER_DAY = (WINDOW_CLOSE_HOUR - WINDOW_OPEN_HOUR) * 60;

const MS_PER_MINUTE = 60 * 1000;

type SlaRule = { minutes: number; businessHours: boolean };

// Crítica em tempo corrido (24×7); as demais em minutos úteis
// (Média = 3 × BUSINESS_MINUTES_PER_DAY; Baixa = 5 × BUSINESS_MINUTES_PER_DAY).
const SLA_BY_PRIORITY: Record<Priority, SlaRule> = {
  CRITICAL: { minutes: 60, businessHours: false },
  HIGH: { minutes: 240, businessHours: true },
  MEDIUM: { minutes: 3 * BUSINESS_MINUTES_PER_DAY, businessHours: true },
  LOW: { minutes: 5 * BUSINESS_MINUTES_PER_DAY, businessHours: true },
};

export function computeDueAt(start: string, priority: Priority): string {
  const rule = SLA_BY_PRIORITY[priority];
  const startMs = Date.parse(start);

  if (!rule.businessHours) {
    return new Date(startMs + rule.minutes * MS_PER_MINUTE).toISOString();
  }

  const operationalStart = toOperational(startMs);
  const operationalDue = addBusinessMinutes(nextBusinessInstant(operationalStart), rule.minutes);
  return new Date(fromOperational(operationalDue)).toISOString();
}

// DM v2.6 §8.5.2: vencido só depois do prazo; no instante exato ainda não.
export function isOverdue(dueAt: string, now: string): boolean {
  return Date.parse(now) > Date.parse(dueAt);
}

// Instante deslocado para o horário operacional; lido sempre com os getters UTC.
function toOperational(utcMs: number): Date {
  return new Date(utcMs + OPERATIONAL_OFFSET_MINUTES * MS_PER_MINUTE);
}

function fromOperational(operational: Date): number {
  return operational.getTime() - OPERATIONAL_OFFSET_MINUTES * MS_PER_MINUTE;
}

function isWeekend(operational: Date): boolean {
  const day = operational.getUTCDay();
  return day === 0 || day === 6;
}

function atHour(operational: Date, hour: number): Date {
  const result = new Date(operational.getTime());
  result.setUTCHours(hour, 0, 0, 0);
  return result;
}

// Abertura (08:00) do próximo dia útil depois do dia de `operational`.
function nextOpening(operational: Date): Date {
  const result = atHour(operational, WINDOW_OPEN_HOUR);
  do {
    result.setUTCDate(result.getUTCDate() + 1);
  } while (isWeekend(result));
  return result;
}

// Ajusta o início para dentro da janela útil: antes das 08:00 → 08:00 do mesmo dia;
// às 18:00 ou depois, ou no fim de semana → próxima abertura.
function nextBusinessInstant(operational: Date): Date {
  if (isWeekend(operational) || operational.getTime() >= atHour(operational, WINDOW_CLOSE_HOUR).getTime()) {
    return nextOpening(operational);
  }
  const opening = atHour(operational, WINDOW_OPEN_HOUR);
  return operational.getTime() < opening.getTime() ? opening : new Date(operational.getTime());
}

// Consome os minutos úteis a partir de um instante já dentro da janela. Se o restante
// couber exatamente até o fechamento, o prazo é 18:00 daquele dia.
function addBusinessMinutes(start: Date, minutes: number): Date {
  let cursor = start;
  let remainingMs = minutes * MS_PER_MINUTE;
  for (; ;) {
    const untilCloseMs = atHour(cursor, WINDOW_CLOSE_HOUR).getTime() - cursor.getTime();
    if (remainingMs <= untilCloseMs) {
      return new Date(cursor.getTime() + remainingMs);
    }
    remainingMs -= untilCloseMs;
    cursor = nextOpening(cursor);
  }
}
