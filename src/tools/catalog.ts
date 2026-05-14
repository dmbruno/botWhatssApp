/**
 * Tool: consultar_catalogo
 *
 * Descarga el Google Doc del catalogo como texto plano y lo retorna al agente.
 * Cachea en memoria con TTL (configurable por cliente).
 *
 * Analogia: el Doc es como una vidriera del negocio. La cache evita ir
 * a buscar la vidriera cada vez; refresca cada X minutos.
 */
import { loadClient } from '../client-loader';

interface CacheEntry {
  text: string;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Descarga el Google Doc publicamente exportable como texto.
 *
 * Nota: si el doc es privado, esta URL devuelve 401. En ese caso:
 *   - Hacerlo "Cualquier persona con el enlace - Lector" (publico), o
 *   - Compartirlo con el Service Account y usar la API de Docs.
 *
 * Para empezar usamos export?format=txt que NO requiere auth si el doc
 * tiene acceso publico de lectura.
 */
async function fetchDocAsText(docId: string): Promise<string> {
  const url = `https://docs.google.com/document/d/${docId}/export?format=txt`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `No se pudo descargar el catalogo (docId=${docId}, status=${res.status}). ` +
        `Verifica que el Doc tenga acceso "Cualquiera con el enlace - Lector".`
    );
  }
  return await res.text();
}

/**
 * Devuelve el contenido del catalogo. Usa cache si esta vigente.
 */
export async function consultarCatalogo(args: {
  consulta: string;
}): Promise<string> {
  const { config } = loadClient();
  const { docId, cacheTTLMinutes } = config.catalog;
  const ttlMs = cacheTTLMinutes * 60 * 1000;

  const cached = cache.get(docId);
  if (cached && Date.now() - cached.fetchedAt < ttlMs) {
    return formatResult(args.consulta, cached.text);
  }

  const text = await fetchDocAsText(docId);
  cache.set(docId, { text, fetchedAt: Date.now() });
  return formatResult(args.consulta, text);
}

function formatResult(consulta: string, fullText: string): string {
  // Devolvemos el catalogo completo y dejamos que el modelo busque/responda.
  // Si en el futuro crece mucho, aca podriamos filtrar por palabra clave o
  // chunkear + embeddings.
  return [
    `[Catalogo UBM Viajes - consulta: "${consulta}"]`,
    '',
    fullText,
  ].join('\n');
}

/**
 * Para debugging / invalidar cache manualmente.
 */
export function clearCatalogCache(): void {
  cache.clear();
}
