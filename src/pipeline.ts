/**
 * Pipeline principal: orquesta los 6 pasos.
 *
 *   1. Ingestion + filtros (grupos / mensajes propios)
 *   2. Normalizar mensaje (texto o audio -> string)
 *   3. Input guardrail (NSFW)
 *   4. Agente Sofia (loop con tool calls)
 *   5. Output guardrail (PII / secretos)
 *   6. Enviar respuesta por Evolution API
 *
 * Toda la logica especifica del cliente vive en src/clients/<name>/.
 * Este archivo es agnostico.
 */
import { z } from 'zod';

import { runAgent } from './agent';
import { transcribeBase64Audio } from './audio';
import { loadClient } from './client-loader';
import { getMediaBase64, sendText } from './evolution';
import { checkNsfw, sanitizeOutput } from './guardrails';

// ------------------------------------------------------------
// Schema del webhook entrante (Evolution API)
// ------------------------------------------------------------
// Validamos solo los campos que usamos. Si faltan -> rechazamos.

const KeySchema = z.object({
  remoteJid: z.string(),
  fromMe: z.boolean(),
  id: z.string(),
});

const MessageSchema = z.object({
  conversation: z.string().optional(),
  extendedTextMessage: z
    .object({ text: z.string() })
    .partial()
    .optional(),
  audioMessage: z.unknown().optional(), // solo nos importa que exista
});

const DataSchema = z.object({
  key: KeySchema,
  pushName: z.string().optional(),
  message: MessageSchema.optional(),
  messageType: z.string().optional(),
});

export const WebhookSchema = z.object({
  instance: z.string().optional(),
  data: DataSchema,
});

export type WebhookPayload = z.infer<typeof WebhookSchema>;

// ------------------------------------------------------------
// Pipeline
// ------------------------------------------------------------

export async function processWebhook(payload: WebhookPayload): Promise<void> {
  // ----- PASO 1: filtros de ingestion -----
  const { data, instance } = payload;
  const remoteJid = data.key.remoteJid;

  if (remoteJid.includes('@g.us')) {
    console.log('[pipeline] ignorado: mensaje de grupo');
    return;
  }
  if (data.key.fromMe) {
    console.log('[pipeline] ignorado: mensaje propio (fromMe)');
    return;
  }

  const phoneNumber = remoteJid.replace(/@s\.whatsapp\.net$/, '');
  const pushName = data.pushName ?? 'cliente';
  const instanceName = instance ?? '';
  if (!instanceName) {
    console.warn('[pipeline] payload sin instance, no podre responder');
  }

  // ----- PASO 2: normalizar mensaje -----
  const chatInput = await normalizeMessage(payload);
  if (!chatInput) {
    console.log('[pipeline] mensaje vacio o tipo no soportado, ignorado');
    return;
  }

  console.log(
    `[pipeline] ${phoneNumber} (${pushName}): "${chatInput.slice(0, 120)}"`
  );

  // ----- PASO 3: input guardrail (NSFW) -----
  const nsfw = await checkNsfw(chatInput);
  if (nsfw.blocked) {
    console.warn(
      `[pipeline] NSFW bloqueado (${nsfw.reason}, score=${nsfw.maxScore.toFixed(2)})`
    );
    const { config } = loadClient();
    await sendText(instanceName, phoneNumber, config.rejectionMessage);
    return;
  }

  // ----- PASO 4: agente -----
  const agentText = await runAgent({
    userText: chatInput,
    phoneNumber,
    pushName,
  });

  // ----- PASO 5: output guardrail (PII) -----
  const { sanitized, redactions } = sanitizeOutput(agentText);
  if (redactions.length > 0) {
    console.warn(`[pipeline] PII redactada: ${redactions.join(', ')}`);
  }

  if (!sanitized.trim()) {
    console.warn('[pipeline] respuesta vacia tras sanitizar, no se envia');
    return;
  }

  // ----- PASO 6: enviar respuesta -----
  await sendText(instanceName, phoneNumber, sanitized);
  console.log(`[pipeline] respuesta enviada a ${phoneNumber}`);
}

// ------------------------------------------------------------
// Paso 2: normalizar segun tipo de mensaje
// ------------------------------------------------------------

async function normalizeMessage(
  payload: WebhookPayload
): Promise<string | null> {
  const msg = payload.data.message;
  if (!msg) return null;

  // 2.a - texto plano
  if (msg.conversation && msg.conversation.trim()) {
    return msg.conversation.trim();
  }

  // 2.b - texto extendido (citas, links)
  if (
    msg.extendedTextMessage &&
    typeof msg.extendedTextMessage.text === 'string' &&
    msg.extendedTextMessage.text.trim()
  ) {
    return msg.extendedTextMessage.text.trim();
  }

  // 2.c - audio: bajar base64 + Whisper
  if (msg.audioMessage) {
    const instanceName = payload.instance ?? '';
    const messageId = payload.data.key.id;
    if (!instanceName || !messageId) {
      console.warn(
        '[pipeline] audio sin instance/messageId, no se puede transcribir'
      );
      return null;
    }
    try {
      const b64 = await getMediaBase64(instanceName, messageId);
      const text = await transcribeBase64Audio(b64);
      console.log(`[pipeline] audio transcrito: "${text.slice(0, 120)}"`);
      return text;
    } catch (err) {
      console.error('[pipeline] error transcribiendo audio:', err);
      return null;
    }
  }

  return null;
}
