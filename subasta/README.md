# Subasta Activa — Fase 1 (núcleo jugable)

Juego multijugador tipo Kahoot para eventos inmobiliarios. Los jugadores pujan
tapeando un botón durante 30 segundos; el servidor es la única autoridad sobre
el conteo y el reloj.

Esta entrega cubre la **Fase 1** del plan: servidor con estado en memoria,
sala única, las tres rutas (`/screen`, `/play`, `/host`) conectadas por
WebSocket, ronda de 30 s con conteo autoritativo y ganador correcto. Sin base
de datos y sin diseño final (eso es Fase 2 y 3).

## Estructura

```
packages/shared   tipos y contratos de mensajes (zod), compartidos por server y web
apps/server       Node + Fastify + ws, estado de la ronda en memoria
apps/web          React + Vite + TS + Tailwind — /screen /play /host
```

## Cómo probarlo (tres pestañas)

1. Instalar dependencias una sola vez:
   ```
   pnpm install
   ```
2. Levantar el servidor (deja la terminal abierta):
   ```
   pnpm dev:server
   ```
3. En otra terminal, levantar el cliente web:
   ```
   pnpm dev:web
   ```
4. Abrir tres pestañas del navegador:
   - `http://localhost:5173/host` — token de desarrollo: `dev-host-token`
   - `http://localhost:5173/screen` — proyector
   - `http://localhost:5173/play` (2 o 3 pestañas) — PIN fijo `1234`, cada una con un apodo distinto

5. Desde `/host`: elige un inmueble → arranca el conteo "3, 2, 1" en las tres
   pestañas de jugador → tapea el botón en cada una durante los 30 s → al
   cerrar, la pantalla principal muestra el sello de ADJUDICADO con el
   ganador. Puedes pulsar "Mostrar podio" para ver el ranking acumulado.

## Deploy en Render (para probar desde el celular con un link real)

El repo incluye `render.yaml` con dos servicios:

- `subasta-server` — el servidor Node (Fastify + ws), plan gratuito.
- `subasta-web` — el sitio estático de React/Vite.

Pasos en render.com:

1. New → Blueprint → conecta el repo `thefresh26/juego_subastas` → Render lee
   `render.yaml` y propone crear los dos servicios automáticamente.
2. Antes de aplicar, en `subasta-server` define la variable `HOST_TOKEN` con
   un valor propio (no dejar `dev-host-token` en producción).
3. Aplica el Blueprint y espera a que ambos servicios terminen de construir.
4. Cuando `subasta-server` esté arriba, confirma su URL real en el dashboard
   de Render. Si no es exactamente `subasta-server.onrender.com` (puede
   variar si el nombre ya estaba tomado), edita la variable `VITE_WS_URL` del
   servicio `subasta-web` con la URL correcta en formato `wss://...` y vuelve
   a desplegar ese servicio.
5. Abre la URL de `subasta-web` en el celular: ahí están `/play`, `/screen` y
   `/host`.

Nota: el plan gratuito de Render "duerme" el servicio tras un rato sin
tráfico y demora unos segundos en despertar con la primera conexión — no es
un error, es normal en el plan free.

## Qué falta para Fase 2 (robustez)

- Token bucket real, `isTrusted` ya está aplicado en el tap, análisis de
  jitter para marcar jugadores (el campo ya se calcula y se envía; falta la
  lógica de "3 lotes seguidos por debajo del umbral → flagged" en el servidor).
- Reconexión con backoff exponencial (hoy reconecta a intervalo fijo).
- Persistencia en Postgres al cerrar cada ronda (`round_scores`,
  `adjudications`, `round_timeline`).
- Rate limit de mensajes por conexión.

## Criterios de aceptación de Fase 1 (verificados)

- Tres jugadores en pestañas distintas tapeando 30 s producen conteos
  correctos, sin taps perdidos ni duplicados (dedup por `seq`).
- La cuenta regresiva arranca simultánea en las tres pestañas (reloj
  corregido contra el servidor vía ping/pong).
- El botón responde en el mismo frame del tap (contador optimista local).
- Ningún tap se acepta antes de `startAt` ni después de `startAt + 30.600 ms`
  (ventana autoritativa en el servidor).
- El ganador que anuncia la pantalla principal coincide con el conteo del
  servidor (el servidor es la única fuente del ranking).
- Cero errores de TypeScript, cero `any` (ver `pnpm typecheck`).
