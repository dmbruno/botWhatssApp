# CLAUDE.md — Contexto del proyecto

> Este archivo es la fuente de verdad para que Claude entienda el proyecto.
> Antes de implementar o modificar algo, leelo completo.

## Qué es este proyecto

Un **bot de WhatsApp genérico con IA**, pensado para ser reutilizado en distintos negocios (agencia de viajes, taller mecánico, inmobiliaria, restaurante, etc.) cambiando lo mínimo posible.

La idea central: **el código del pipeline es agnóstico al cliente**. Toda la personalización vive en una sola carpeta: `src/clients/<nombre>/`. Para un nuevo cliente solo se cambian dos cosas:

1. **El prompt del agente** (`src/clients/<nombre>/prompt.md`) — define personalidad, reglas, flujo de conversación.
2. **La ruta a la "base de datos" del cliente** (`src/clients/<nombre>/config.ts`) — IDs del Google Doc (catálogo / info del negocio) y del Google Sheet (CRM de leads).

Nada más debería tocarse al cambiar de cliente, salvo que el dominio requiera tools nuevas.

## Stack

- Node.js + Express + TypeScript
- OpenAI SDK (GPT-4o + Whisper + Moderation)
- googleapis (Sheets + Docs export público)
- Evolution API (WhatsApp Business)
- zod (validación de webhooks)

## Arquitectura — qué archivo hace qué

```
src/
├── clients/                  ← CAPA DE CLIENTE (lo único que se cambia)
│   └── sofia/
│       ├── prompt.md         ← Personalidad y reglas del agente
│       └── config.ts         ← IDs de Doc/Sheet, schemas de tools, modelo
│
├── tools/                    ← Implementación de las tools (genérico)
│   ├── catalog.ts            ← Descarga Google Doc + cache TTL
│   └── leads.ts              ← Append a Google Sheet (Service Account)
│
├── index.ts                  ← Express + webhook (responde 200 OK al toque,
│                                procesa con setImmediate en background)
├── pipeline.ts               ← Orquesta los 6 pasos del pipeline
├── agent.ts                  ← Loop OpenAI con tool_calls re-inyectados
├── audio.ts                  ← base64 → Buffer → Whisper (es)
├── evolution.ts              ← Cliente HTTP de Evolution API
├── guardrails.ts             ← NSFW (Moderation) + PII (regex)
├── memory.ts                 ← Map<phone, mensajes> sliding window
└── client-loader.ts          ← Carga el cliente activo según CLIENT_NAME
```

### Pipeline (6 pasos en `pipeline.ts`)

```
Webhook -> 1. filtros (no grupos, no fromMe)
        -> 2. normalizar (texto / audio Whisper)
        -> 3. guardrail NSFW (OpenAI Moderation)
        -> 4. agente GPT-4o + tools
        -> 5. guardrail PII (regex: emails, tarjetas, teléfonos, API keys)
        -> 6. sendText via Evolution API
```

## Cómo adaptar a un nuevo cliente

**Caso ejemplo: taller mecánico**

1. Copiar la carpeta:
   ```bash
   cp -r src/clients/sofia src/clients/taller
   ```

2. Editar `src/clients/taller/prompt.md`:
   - Reemplazar el prompt entero por el del nuevo negocio.
   - **Conservar los placeholders** `{{pushName}}` y `{{phoneNumber}}` — los inyecta el agente en cada turno.

3. Editar `src/clients/taller/config.ts`:
   - `catalog.docId` → ID del Google Doc con servicios/precios del taller.
   - `leads.spreadsheetId` → ID del Google Sheet del CRM.
   - `leads.columnOrder` → si las columnas del Sheet difieren, ajustar el orden exacto.
   - `tools` → si el dominio pide tools distintas (ej. `agendar_turno`, `consultar_stock_repuestos`), actualizar los schemas. **Si se cambian nombres de tools, también hay que ajustar el dispatch en `src/agent.ts`** (función `executeToolCall`).
   - `rejectionMessage` → mensaje cuando el guardrail NSFW bloquea.

4. En `.env`:
   ```
   CLIENT_NAME=taller
   ```

5. Compartir Google Doc (lectura pública) y Google Sheet (con el email del Service Account como Editor).

6. Reiniciar el servidor.

**El resto del código no se toca.** Si te encontrás modificando archivos fuera de `src/clients/<nombre>/` para adaptar a otro cliente, probablemente estás haciendo algo mal — preguntá antes.

## Convenciones del código

- **TypeScript strict** activado. Sin `any` salvo cast puntual y comentado.
- **Sin hardcodear secretos**: todo en `.env`, y validado con `assertEnv` en el arranque.
- **Sin logs de PII**: los regex de `guardrails.ts` redactan antes de enviar; en logs solo loguear tipos de redacción, no el contenido.
- **Fail-fast en el arranque**: si falta `OPENAI_API_KEY`, `CLIENT_NAME`, etc., el server no levanta.
- **Fail-open en runtime**: si la Moderation API falla, no bloqueamos al usuario (sino el bot se queda mudo por errores transitorios).
- **El webhook responde 200 OK siempre** (incluso con payload inválido) para que Evolution no haga reintentos infinitos. El procesamiento real va en `setImmediate`.

## Memoria de conversación

- En RAM (Map en `memory.ts`). Se pierde al reiniciar el server. Aceptable para el caso de uso actual.
- **Sliding window de 10 turnos** por número de teléfono.
- El `system` no se persiste — se reinyecta fresco en cada turno desde el template del cliente (así `{{pushName}}` y `{{phoneNumber}}` siempre están actualizados).
- Los `tool_calls` y sus `tool_results` se conservan juntos cuando se recorta la ventana.

## Preferencias del usuario (Diego)

- Stack principal: **Python/Flask** (pero este proyecto es Node por requerimiento). Es desarrollador fullstack, también maneja React y bases relacionales (MySQL, SQLite, Postgres).
- **Respuestas concretas, sin humo.** Nada de "es importante notar que...".
- Le sirven **analogías de la vida real** para explicar conceptos.
- **Antes de implementar cambios grandes, preguntar** si hay ambigüedad. Mejor confirmar el camino que reescribir después.
- Español rioplatense informal (vos, podés, querés, etc.).

## Cosas que NO hay que hacer

- ❌ Hardcodear el prompt o los IDs de Google dentro de `pipeline.ts`, `agent.ts` o cualquier archivo del pipeline.
- ❌ Agregar lógica específica de "Sofia" o "viajes" fuera de `src/clients/sofia/`.
- ❌ Loguear `userText` completo si pasó por el guardrail NSFW y fue bloqueado.
- ❌ Crear archivos de documentación nuevos sin que Diego lo pida.
- ❌ Usar `npm install <paquete>` sin confirmar primero — preferir resolver con lo que ya está.

## Cosas útiles para saber

- **Cache del catálogo**: 60 min en `config.ts`. Si Diego dice "el catálogo no se actualiza", probablemente sea esto. Hay un `clearCatalogCache()` exportado en `src/tools/catalog.ts`.
- **Audio de WhatsApp**: viene en `audio/ogg`. Si en algún momento Evolution cambia el endpoint de descarga de media, ajustar `getMediaBase64` en `src/evolution.ts`.
- **Health check**: `GET /health` devuelve `{ status: "ok", client: "<nombre>" }`.

## Comandos rápidos

```bash
npm run dev         # desarrollo con hot reload (tsx watch)
npm run build       # compila a dist/ y copia los .md
npm start           # produce: corre dist/index.js
npm run typecheck   # tsc --noEmit, verificar tipos sin compilar
```
