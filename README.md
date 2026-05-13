# WhatsApp AI Agent

Servidor Node.js + TypeScript que recibe mensajes de WhatsApp vía Evolution API, los procesa con un agente de OpenAI (con tools) y responde. Soporta texto y audio (transcripción con Whisper). Diseñado para ser fácilmente adaptable a distintos clientes (agencia de viajes, taller mecánico, etc.).

## Pipeline

```
Webhook -> filtros (no grupos, no fromMe)
        -> normalizar (texto/audio Whisper)
        -> guardrail NSFW (OpenAI Moderation)
        -> agente GPT-4o + tools (catálogo + leads)
        -> guardrail PII (regex)
        -> sendText via Evolution API
```

## Estructura

```
src/
├── clients/sofia/        <-- CONFIG DEL CLIENTE (lo que cambias por cliente)
│   ├── prompt.md         <-- system prompt
│   └── config.ts         <-- IDs de Doc/Sheet, schemas de tools
├── tools/
│   ├── catalog.ts        <-- consultar_catalogo (Google Doc + cache)
│   └── leads.ts          <-- guardar_lead (Google Sheets append)
├── index.ts              <-- Express + webhook
├── pipeline.ts           <-- 6 pasos
├── agent.ts              <-- OpenAI loop + tool dispatch
├── audio.ts              <-- Whisper
├── evolution.ts          <-- cliente Evolution API
├── guardrails.ts         <-- NSFW + PII
├── memory.ts             <-- Map<phone, mensajes> sliding window
└── client-loader.ts      <-- carga cliente activo segun CLIENT_NAME
```

## Setup

### 1. Instalar dependencias

```bash
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con tus valores (ver comentarios en el archivo).

### 3. Credenciales de Google (Service Account)

1. Ir a https://console.cloud.google.com → crear/seleccionar proyecto
2. Habilitar **Google Sheets API**
3. APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio
4. Descargar el JSON y guardarlo en `./credentials/service-account.json`
5. Compartir el Google Sheet con el email del service account (algo tipo `mi-bot@mi-proyecto.iam.gserviceaccount.com`) con permiso **Editor**
6. El Google Doc del catálogo: hacerlo público de lectura ("Cualquier persona con el enlace - Lector") o compartirlo con el service account

### 4. Configurar Evolution API webhook

En tu instancia de Evolution, configurar el webhook para que dispare a:

```
POST http://tu-servidor:3000/agente-viajes-whatsapp
```

Eventos: al menos `MESSAGES_UPSERT`.

### 5. Correr

```bash
# Desarrollo (hot reload)
npm run dev

# Producción
npm run build
npm start
```

Healthcheck: `GET http://localhost:3000/health`

## Adaptar a otro cliente (ej: taller mecánico)

1. **Copiar la carpeta del cliente**:

   ```bash
   cp -r src/clients/sofia src/clients/taller
   ```

2. **Editar `src/clients/taller/prompt.md`**: ahí vive toda la personalidad y reglas del agente. Reemplazar el contenido por el prompt del taller (ej: "Sos Juan, encargado del taller mecánico..."). Mantener los placeholders `{{pushName}}` y `{{phoneNumber}}`.

3. **Editar `src/clients/taller/config.ts`**:
   - `catalog.docId`: ID del nuevo Google Doc (servicios, precios, horarios del taller)
   - `leads.spreadsheetId`: ID del nuevo Google Sheet
   - `leads.columnOrder`: si las columnas del Sheet son distintas, ajustar el orden
   - `tools`: si el dominio requiere otras tools (ej. `consultar_disponibilidad`, `agendar_turno`), modificar los schemas. Si cambias nombres, ajustar también el dispatch en `src/agent.ts`.
   - `rejectionMessage`: mensaje cuando el guardrail NSFW bloquea

4. **Compartir Sheet y Doc** con el Service Account.

5. **Cambiar `.env`**:

   ```
   CLIENT_NAME=taller
   ```

6. **Reiniciar** el servidor.

El resto del código (pipeline, agente, evolution, guardrails, memoria) no se toca.

## Notas técnicas

- **Memoria**: en RAM, se pierde al reiniciar. Sliding window de 10 turnos por sesión (phone number).
- **Background processing**: el webhook responde 200 OK al instante y procesa con `setImmediate`. Si un mensaje crashea no afecta a otros.
- **Cache del catálogo**: TTL de 60min configurable en `config.ts`.
- **Whisper**: si Evolution no devuelve `base64` en el endpoint configurado, ajustar `getMediaBase64` en `src/evolution.ts` para la variante que use tu instancia (algunas usan `POST /chat/getBase64FromMediaMessage/{instance}`).
- **Guardrails fail-open**: si la Moderation API falla, NO bloqueamos el mensaje (para no dejar al bot mudo). Configurable.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (default 3000) |
| `CLIENT_NAME` | Carpeta dentro de `src/clients/` a cargar |
| `EVOLUTION_API_URL` | Base URL de Evolution |
| `EVOLUTION_API_KEY` | API key de Evolution (header `apikey`) |
| `OPENAI_API_KEY` | Para GPT-4o, Whisper y Moderation |
| `GOOGLE_APPLICATION_CREDENTIALS` | Ruta al JSON del Service Account |
| `NSFW_THRESHOLD` | Umbral (0-1) del guardrail de entrada |
