/**
 * Cliente HTTP para Evolution API (WhatsApp).
 *
 * Endpoints usados:
 *   - POST /message/sendText/{instance}          -> enviar texto
 *   - GET  /chat-api/get-media-base64/{instance}/{messageId} -> bajar audio
 *
 * Si tu instancia de Evolution usa otra ruta para bajar media
 * (algunas versiones exponen POST /chat/getBase64FromMediaMessage/{instance}),
 * ajustar getMediaBase64() abajo.
 */

const BASE_URL = () => process.env.EVOLUTION_API_URL || '';
const API_KEY = () => process.env.EVOLUTION_API_KEY || '';

function authHeaders(): Record<string, string> {
  return {
    apikey: API_KEY(),
    'Content-Type': 'application/json',
  };
}

/**
 * Envia un mensaje de texto al numero indicado.
 */
export async function sendText(
  instanceName: string,
  phoneNumber: string,
  text: string
): Promise<void> {
  const url = `${BASE_URL()}/message/sendText/${encodeURIComponent(instanceName)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      number: phoneNumber,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Evolution sendText fallo (${res.status}): ${body.slice(0, 300)}`
    );
  }
}

/**
 * Descarga el audio en base64 desde Evolution API.
 * Retorna el string base64 listo para decodificar a Buffer.
 */
export async function getMediaBase64(
  instanceName: string,
  messageId: string
): Promise<string> {
  const url = `${BASE_URL()}/chat-api/get-media-base64/${encodeURIComponent(
    instanceName
  )}/${encodeURIComponent(messageId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { apikey: API_KEY() },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Evolution getMediaBase64 fallo (${res.status}): ${body.slice(0, 300)}`
    );
  }

  const data = (await res.json()) as { base64?: string; data?: string };
  const b64 = data.base64 ?? data.data;
  if (!b64) {
    throw new Error('Evolution getMediaBase64 no devolvio campo base64/data');
  }
  return b64;
}
