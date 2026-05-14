/**
 * Configuracion del cliente Sofia (UBM Viajes).
 *
 * Para adaptar a otro cliente:
 *   1. Copiar esta carpeta completa: src/clients/sofia -> src/clients/<nuevo>
 *   2. Editar prompt.md con el nuevo system prompt
 *   3. Cambiar los IDs de Google Doc y Google Sheet abajo
 *   4. Ajustar columnas del Sheet y schemas de tools si hace falta
 *   5. Setear CLIENT_NAME=<nuevo> en .env
 */
import fs from 'fs';
import path from 'path';
import type { ClientConfig } from '../../client-loader';

// El prompt.md se lee al iniciar y se cachea en memoria
const promptTemplate = fs.readFileSync(
  path.join(__dirname, 'prompt.md'),
  'utf-8'
);

export const config: ClientConfig = {
  name: 'sofia-ubm-viajes',

  // ============================================================
  // AGENTE - parametros del modelo
  // ============================================================
  agent: {
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1024,
    memoryWindow: 10, // sliding window: ultimos 10 turnos
    systemPromptTemplate: promptTemplate,
  },

  // ============================================================
  // CATALOGO - Google Doc con los productos/info del negocio
  // ============================================================
  // Para un taller mecanico, esto seria el doc con servicios, precios,
  // horarios, etc.
  catalog: {
    docId: '1pysF0_CduLGoCuy2it4TZMB0zjZbiZjDqBtW8CQbRUU',
    cacheTTLMinutes: 60,
  },

  // ============================================================
  // LEADS - Google Sheet donde se guardan los contactos
  // ============================================================
  leads: {
    spreadsheetId: '1d0c2YdDCpQZEU9Bv58DtmtwoM87J2RjdwupF8QPOXdU',
    sheetName: 'Hoja1',
    // Las columnas deben coincidir con el orden del Sheet
    columnOrder: [
      'Timestamp',
      'Nombre Lead',
      'WhatsApp ID',
      'Destino',
      'Presupuesto',
      'Status',
      'Contexto IA',
    ],
    defaultStatus: 'Pendiente de contacto',
  },

  // ============================================================
  // TOOLS - schemas que ve el agente OpenAI
  // ============================================================
  tools: [
    {
      type: 'function',
      function: {
        name: 'consultar_catalogo',
        description:
          'Consulta el catalogo oficial de UBM Viajes. Usala SIEMPRE para responder sobre destinos, precios, paquetes, fechas o que incluye cada viaje. NUNCA respondas sobre paquetes especificos sin consultar esta herramienta primero.',
        parameters: {
          type: 'object',
          properties: {
            consulta: {
              type: 'string',
              description: 'Pregunta o destino a buscar en el catalogo',
            },
          },
          required: ['consulta'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'guardar_lead',
        description:
          'Registra en Google Sheets CRM la informacion de un cliente interesado en viajar. Usar solo cuando ya se tiene el nombre del cliente.',
        parameters: {
          type: 'object',
          properties: {
            nombre_lead: {
              type: 'string',
              description: 'Nombre completo del cliente',
            },
            whatsapp_id: {
              type: 'string',
              description:
                'Numero de telefono WhatsApp (sin @s.whatsapp.net)',
            },
            destino: {
              type: 'string',
              description: 'Destino o destinos de interes',
            },
            presupuesto: {
              type: 'string',
              description: 'Presupuesto aproximado mencionado',
            },
            contexto_ia: {
              type: 'string',
              description:
                'Resumen del interes y contexto de la conversacion',
            },
          },
          required: ['nombre_lead', 'whatsapp_id', 'destino', 'contexto_ia'],
        },
      },
    },
  ],

  // ============================================================
  // MENSAJE DE RECHAZO - cuando el guardrail NSFW bloquea
  // ============================================================
  rejectionMessage:
    'Lo siento, no puedo responder a ese tipo de mensaje. Estoy aqui para ayudarte con informacion sobre viajes. En que puedo asistirte?',
};

/**
 * Inyecta variables dinamicas en el template del prompt.
 */
export function buildSystemPrompt(
  pushName: string,
  phoneNumber: string
): string {
  return config.agent.systemPromptTemplate
    .replace(/\{\{pushName\}\}/g, pushName || 'cliente')
    .replace(/\{\{phoneNumber\}\}/g, phoneNumber);
}
