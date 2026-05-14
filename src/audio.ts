/**
 * Transcripcion de audio con OpenAI Whisper.
 *
 * Flujo: base64 (Evolution) -> Buffer -> Whisper -> texto en espanol.
 */
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Convierte base64 (audio/ogg de WhatsApp) a texto.
 */
export async function transcribeBase64Audio(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');

  // OpenAI.toFile crea un File compatible con la API de Whisper
  // a partir de un Buffer + nombre de archivo (la extension importa)
  const file = await OpenAI.toFile(buffer, 'audio.ogg');

  const transcription = await openai().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'es',
  });

  return transcription.text.trim();
}
