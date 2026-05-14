/**
 * Tool: guardar_lead
 *
 * Hace append de una fila al Google Sheet del CRM via Service Account.
 *
 * Setup previo:
 *   1. Crear Service Account en Google Cloud Console
 *   2. Habilitar Google Sheets API en el proyecto
 *   3. Descargar el JSON de credenciales
 *   4. Setear GOOGLE_APPLICATION_CREDENTIALS al path del JSON en .env
 *   5. Compartir el Google Sheet con el email del Service Account como Editor
 *      (algo tipo: my-bot@my-project.iam.gserviceaccount.com)
 */
import { google } from 'googleapis';
import { loadClient } from '../client-loader';

let _sheets: ReturnType<typeof google.sheets> | null = null;

async function sheetsClient() {
  if (_sheets) return _sheets;

  const auth = new google.auth.GoogleAuth({
    // Usa GOOGLE_APPLICATION_CREDENTIALS del env automaticamente
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const authClient = await auth.getClient();
  _sheets = google.sheets({ version: 'v4', auth: authClient as any });
  return _sheets;
}

export interface LeadArgs {
  nombre_lead: string;
  whatsapp_id: string;
  destino: string;
  presupuesto?: string;
  contexto_ia: string;
}

/**
 * Mapeo de columna -> valor para esta fila.
 * Las claves coinciden con config.leads.columnOrder.
 */
function buildRowValues(args: LeadArgs, defaultStatus: string): Record<string, string> {
  return {
    Timestamp: new Date().toISOString(),
    'Nombre Lead': args.nombre_lead,
    'WhatsApp ID': args.whatsapp_id,
    Destino: args.destino,
    Presupuesto: args.presupuesto ?? '',
    Status: defaultStatus,
    'Contexto IA': args.contexto_ia,
  };
}

export async function guardarLead(args: LeadArgs): Promise<string> {
  const { config } = loadClient();
  const { spreadsheetId, sheetName, columnOrder, defaultStatus } = config.leads;

  const rowMap = buildRowValues(args, defaultStatus);
  const row = columnOrder.map((col) => rowMap[col] ?? '');

  const sheets = await sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [row],
    },
  });

  return `Lead guardado: ${args.nombre_lead} (${args.whatsapp_id}) - ${args.destino}`;
}
