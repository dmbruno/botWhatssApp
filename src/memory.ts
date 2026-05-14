/**
 * Memoria de conversacion por sesion (phone number).
 * Sliding window: solo se conservan los ultimos N turnos.
 *
 * IMPORTANTE: el system message NO se cuenta dentro del window, se inyecta
 * fresco en cada turno desde el prompt template del cliente (asi siempre
 * tenemos {{pushName}} y {{phoneNumber}} actualizados).
 *
 * Analogia: pensa en la memoria como una pizarra. Solo hay lugar para las
 * ultimas 10 frases. Cuando llega la 11, se borra la mas vieja.
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const store = new Map<string, ChatCompletionMessageParam[]>();

export function getHistory(phoneNumber: string): ChatCompletionMessageParam[] {
  return store.get(phoneNumber) ?? [];
}

export function appendMessages(
  phoneNumber: string,
  messages: ChatCompletionMessageParam[],
  windowSize: number
): void {
  const prev = store.get(phoneNumber) ?? [];
  const next = [...prev, ...messages];

  // Sliding window: contamos turnos "logicos" (user/assistant text),
  // pero mantenemos integridad de tool_calls (un assistant con tool_calls
  // y sus tool responses deben quedar juntos o ambos fuera).
  const trimmed = trimToWindow(next, windowSize);
  store.set(phoneNumber, trimmed);
}

export function clearHistory(phoneNumber: string): void {
  store.delete(phoneNumber);
}

/**
 * Recorta el historial a las ultimas N "vueltas" de conversacion,
 * manteniendo agrupados los tool_calls con sus respuestas.
 *
 * Una "vuelta" = un mensaje user + todo lo que vino despues hasta
 * el proximo mensaje user (incluye assistant + tool calls + tool results).
 */
function trimToWindow(
  messages: ChatCompletionMessageParam[],
  windowSize: number
): ChatCompletionMessageParam[] {
  // Indices donde empieza una vuelta (mensaje user)
  const userIndices: number[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'user') userIndices.push(i);
  });

  if (userIndices.length <= windowSize) return messages;

  // Conservamos las ultimas N vueltas
  const startIdx = userIndices[userIndices.length - windowSize];
  return messages.slice(startIdx);
}
