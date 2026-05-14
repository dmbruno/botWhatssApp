/**
 * Carga dinamica del cliente activo segun la variable de entorno CLIENT_NAME.
 *
 * Este modulo es el unico punto de acoplamiento entre el pipeline (generico)
 * y la configuracion de cada cliente.
 */
import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface ClientConfig {
  name: string;
  agent: {
    model: string;
    temperature: number;
    maxTokens: number;
    memoryWindow: number;
    systemPromptTemplate: string;
  };
  catalog: {
    docId: string;
    cacheTTLMinutes: number;
  };
  leads: {
    spreadsheetId: string;
    sheetName: string;
    columnOrder: string[];
    defaultStatus: string;
  };
  tools: ChatCompletionTool[];
  rejectionMessage: string;
}

export interface ClientModule {
  config: ClientConfig;
  buildSystemPrompt: (pushName: string, phoneNumber: string) => string;
}

let cachedClient: ClientModule | null = null;

export function loadClient(): ClientModule {
  if (cachedClient) return cachedClient;

  const clientName = process.env.CLIENT_NAME;
  if (!clientName) {
    throw new Error(
      'CLIENT_NAME no esta definida en .env. Ej: CLIENT_NAME=sofia'
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(`./clients/${clientName}/config`);
    if (!mod.config || !mod.buildSystemPrompt) {
      throw new Error(
        `El cliente '${clientName}' no exporta { config, buildSystemPrompt }`
      );
    }
    cachedClient = mod as ClientModule;
    console.log(`[client-loader] Cliente activo: ${mod.config.name}`);
    return cachedClient;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `No se pudo cargar el cliente '${clientName}'. ` +
        `Revisa que exista src/clients/${clientName}/config.ts. Detalle: ${msg}`
    );
  }
}
