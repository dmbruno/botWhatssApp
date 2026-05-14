/**
 * Agente OpenAI con loop de tool calls.
 *
 * Flujo:
 *   1. Construye system prompt con datos del cliente
 *   2. Toma historial previo de memoria + agrega el mensaje nuevo del usuario
 *   3. Llama a OpenAI con las tools del cliente
 *   4. Si el modelo pide tool_calls -> ejecutarlas -> re-llamar al modelo
 *      (repetir hasta que el modelo devuelva texto final o se acabe el limite)
 *   5. Guarda en memoria los mensajes nuevos
 *   6. Retorna el texto final
 *
 * Analogia: es como un mozo que va y viene a la cocina. El cliente pide algo,
 * el mozo pregunta al chef (modelo), el chef puede pedir "trame los precios"
 * (tool call), el mozo va, vuelve con la respuesta, el chef finalmente arma
 * la respuesta para el cliente.
 */
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions';

import { loadClient } from './client-loader';
import { appendMessages, getHistory } from './memory';
import { consultarCatalogo } from './tools/catalog';
import { guardarLead, type LeadArgs } from './tools/leads';

const MAX_TOOL_ITERATIONS = 5;

let _openai: OpenAI | null = null;
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export interface AgentInput {
  userText: string;
  phoneNumber: string;
  pushName: string;
}

export async function runAgent(input: AgentInput): Promise<string> {
  const { config, buildSystemPrompt } = loadClient();

  const systemPrompt = buildSystemPrompt(input.pushName, input.phoneNumber);
  const history = getHistory(input.phoneNumber);

  // Mensajes de esta vuelta (los que persistiremos al final)
  const newMessages: ChatCompletionMessageParam[] = [
    { role: 'user', content: input.userText },
  ];

  // Mensajes que enviamos al modelo (system + historial + nuevos)
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    ...newMessages,
  ];

  let finalText = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const completion = await openai().chat.completions.create({
      model: config.agent.model,
      temperature: config.agent.temperature,
      max_tokens: config.agent.maxTokens,
      tools: config.tools,
      messages,
    });

    const choice = completion.choices[0];
    const assistantMsg = choice.message;

    // Construimos un mensaje "Param" compatible con el historial,
    // tomando solo los campos que la API acepta como input.
    const assistantParam: ChatCompletionMessageParam = {
      role: 'assistant',
      content: assistantMsg.content ?? '',
      ...(assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0
        ? { tool_calls: assistantMsg.tool_calls }
        : {}),
    };

    messages.push(assistantParam);
    newMessages.push(assistantParam);

    // Si no hay tool calls -> respuesta final
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      finalText = assistantMsg.content ?? '';
      break;
    }

    // Ejecutar tool calls en paralelo
    const toolResults = await Promise.all(
      assistantMsg.tool_calls.map((tc) => executeToolCall(tc))
    );

    for (const tr of toolResults) {
      const toolMsg: ChatCompletionMessageParam = {
        role: 'tool',
        tool_call_id: tr.toolCallId,
        content: tr.content,
      };
      messages.push(toolMsg);
      newMessages.push(toolMsg);
    }
  }

  if (!finalText) {
    finalText =
      'Disculpa, tuve un problema procesando tu mensaje. Podrias repetirlo?';
  }

  // Persistir en memoria (sliding window)
  appendMessages(input.phoneNumber, newMessages, config.agent.memoryWindow);

  return finalText;
}

// ------------------------------------------------------------
// Tool dispatch
// ------------------------------------------------------------

interface ToolResult {
  toolCallId: string;
  content: string;
}

async function executeToolCall(
  toolCall: ChatCompletionMessageToolCall
): Promise<ToolResult> {
  const name = toolCall.function.name;
  let rawArgs: unknown;
  try {
    rawArgs = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    return {
      toolCallId: toolCall.id,
      content: `ERROR: argumentos invalidos para ${name}`,
    };
  }

  try {
    if (name === 'consultar_catalogo') {
      const args = rawArgs as { consulta: string };
      const result = await consultarCatalogo(args);
      return { toolCallId: toolCall.id, content: result };
    }

    if (name === 'guardar_lead') {
      const args = rawArgs as LeadArgs;
      const result = await guardarLead(args);
      return { toolCallId: toolCall.id, content: result };
    }

    return {
      toolCallId: toolCall.id,
      content: `ERROR: tool desconocida "${name}"`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[agent] tool ${name} fallo:`, msg);
    return {
      toolCallId: toolCall.id,
      content: `ERROR ejecutando ${name}: ${msg}`,
    };
  }
}
