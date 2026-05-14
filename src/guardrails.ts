/**
 * Guardrails de entrada y salida.
 *
 * - Input  -> OpenAI Moderation (omni-moderation-latest) -> bloquea NSFW
 * - Output -> regex -> oculta emails, tarjetas, telefonos, API keys
 */
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ------------------------------------------------------------
// INPUT - NSFW
// ------------------------------------------------------------

export interface NsfwResult {
  blocked: boolean;
  maxScore: number;
  reason?: string;
}

/**
 * Chequea si el mensaje del usuario supera el umbral NSFW.
 * Devuelve blocked=true si hay que rechazar.
 */
export async function checkNsfw(text: string): Promise<NsfwResult> {
  const threshold = Number(process.env.NSFW_THRESHOLD ?? '0.7');

  try {
    const mod = await openai().moderations.create({
      model: 'omni-moderation-latest',
      input: text,
    });

    const result = mod.results[0];
    if (!result) return { blocked: false, maxScore: 0 };

    // Tomamos el score mas alto entre todas las categorias
    const scores = Object.values(result.category_scores) as number[];
    const maxScore = scores.reduce((a, b) => Math.max(a, b), 0);

    const blocked = result.flagged || maxScore >= threshold;

    if (blocked) {
      const flaggedCats = Object.entries(result.categories)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ');
      return {
        blocked: true,
        maxScore,
        reason: flaggedCats || `score=${maxScore.toFixed(2)}`,
      };
    }

    return { blocked: false, maxScore };
  } catch (err) {
    // Si la Moderation API falla, NO bloqueamos (fail-open).
    // La alternativa fail-closed dejaria al bot sin responder por errores de red.
    console.warn('[guardrails] Moderation API fallo, no se bloquea:', err);
    return { blocked: false, maxScore: 0 };
  }
}

// ------------------------------------------------------------
// OUTPUT - PII / secretos
// ------------------------------------------------------------

const PII_RULES: Array<{ name: string; pattern: RegExp; replace: string }> = [
  // Emails
  {
    name: 'email',
    pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/gi,
    replace: '[email oculto]',
  },
  // Tarjetas de credito (13-19 digitos con espacios/guiones opcionales)
  {
    name: 'credit_card',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    replace: '[numero oculto]',
  },
  // Telefonos: 7+ digitos consecutivos (con guiones/espacios opcionales)
  // El prompt prohibe que Sofia mencione telefonos.
  {
    name: 'phone',
    pattern: /(?:\+?\d[\d\s-]{6,}\d)/g,
    replace: '[telefono oculto]',
  },
  // OpenAI API keys
  {
    name: 'openai_key',
    pattern: /sk-[A-Za-z0-9_-]{20,}/g,
    replace: '[clave oculta]',
  },
  // AWS access keys
  {
    name: 'aws_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replace: '[clave oculta]',
  },
];

export interface PiiResult {
  sanitized: string;
  redactions: string[];
}

/**
 * Aplica los regex de PII al output del agente. Devuelve el texto saneado
 * y la lista de tipos redactados (para logging).
 */
export function sanitizeOutput(text: string): PiiResult {
  let sanitized = text;
  const redactions: string[] = [];

  for (const rule of PII_RULES) {
    if (rule.pattern.test(sanitized)) {
      redactions.push(rule.name);
      // Re-crear regex porque .test() avanzo el lastIndex
      const re = new RegExp(rule.pattern.source, rule.pattern.flags);
      sanitized = sanitized.replace(re, rule.replace);
    }
  }

  return { sanitized, redactions };
}
