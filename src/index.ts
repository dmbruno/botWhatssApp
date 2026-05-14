/**
 * Entry point: servidor Express con webhook de Evolution API.
 *
 * Estrategia: respondemos 200 OK al toque y procesamos en background
 * (setImmediate) para no bloquear a Evolution ni arriesgar timeouts.
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express, { type Request, type Response } from 'express';

// En Railway no hay filesystem persistente — si viene el JSON por env var,
// lo escribimos en un temp file y apuntamos GOOGLE_APPLICATION_CREDENTIALS a él.
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const tmpPath = path.join(os.tmpdir(), 'service-account.json');
  fs.writeFileSync(tmpPath, process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'utf-8');
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmpPath;
}

import { loadClient } from './client-loader';
import { processWebhook, WebhookSchema } from './pipeline';

const app = express();
app.use(express.json({ limit: '10mb' })); // audios base64 pueden ser grandes

// ------------------------------------------------------------
// Health check
// ------------------------------------------------------------
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', client: loadClient().config.name });
});

// ------------------------------------------------------------
// Webhook principal
// ------------------------------------------------------------
app.post(
  '/agente-viajes-whatsapp',
  (req: Request, res: Response): void => {
    // Validamos forma del body (rechazamos basura rapido)
    const parsed = WebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      // Igual respondemos 200 para que Evolution no reintente eternamente
      console.warn(
        '[webhook] payload invalido:',
        parsed.error.issues.slice(0, 3)
      );
      res.status(200).json({ ok: false, reason: 'invalid_payload' });
      return;
    }

    // Respondemos YA y procesamos en background.
    // setImmediate desacopla el await del ciclo de respuesta HTTP.
    res.status(200).json({ ok: true });

    setImmediate(() => {
      processWebhook(parsed.data).catch((err: unknown) => {
        console.error('[webhook] error procesando en background:', err);
      });
    });
  }
);

// ------------------------------------------------------------
// 404
// ------------------------------------------------------------
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'not_found' });
});

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------
const PORT = Number(process.env.PORT ?? 3000);

function assertEnv(name: string): void {
  if (!process.env[name]) {
    throw new Error(`Falta variable de entorno requerida: ${name}`);
  }
}

function preflight(): void {
  assertEnv('CLIENT_NAME');
  assertEnv('EVOLUTION_API_URL');
  assertEnv('EVOLUTION_API_KEY');
  assertEnv('OPENAI_API_KEY');
  assertEnv('GOOGLE_APPLICATION_CREDENTIALS');
  // Forzamos carga del cliente al arrancar (falla rapido si esta mal)
  loadClient();
}

try {
  preflight();
  app.listen(PORT, () => {
    console.log(`[server] escuchando en http://0.0.0.0:${PORT}`);
    console.log(`[server] webhook: POST /agente-viajes-whatsapp`);
  });
} catch (err) {
  console.error('[server] error al iniciar:', err);
  process.exit(1);
}
