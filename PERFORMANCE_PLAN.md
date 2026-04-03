# Plan de Performance — Bnest

> Estado: borrador de análisis  
> Rama: `claude/review-performance-options-F4TUB`

---

## Contexto

La filosofía inicial de Bnest es replicar los patrones de NestJS usando exclusivamente la API de NestJS/Elysia como capa HTTP. Este documento analiza dónde esa decisión crea fricción de performance y qué alternativas existen para cada capa del framework.

---

## 1. Capa HTTP — Elysia vs alternativas

### Estado actual

```
BnestFactory → ElysiaAdapter → Elysia.js → Bun HTTP server
```

Elysia ya es uno de los frameworks más rápidos del ecosistema Node/Bun. Sin embargo, agrega:
- Una capa de abstracción sobre `Bun.serve()`
- Hooks (`beforeHandle`, `onRequest`, `onAfterHandle`) que agregan overhead por request
- Schema validation inline (TypeBox) ejecutada en cada request

### Opciones de mejora

#### Opción A — `Bun.serve()` nativo (máximo performance)

Reemplazar `ElysiaAdapter` con un adaptador que use `Bun.serve()` directamente.

```ts
// En lugar de Elysia, usar la API nativa de Bun
Bun.serve({
  port: 3000,
  fetch(req) {
    return router.handle(req);
  },
});
```

**Ventajas:**
- Elimina la abstracción de Elysia (~10-15% menos overhead en benchmarks)
- Control total sobre el ciclo de vida del request
- Sin dependencia de terceros para la capa HTTP

**Desventajas:**
- Hay que reimplementar routing, schema validation y hooks manualmente
- Mayor complejidad de mantenimiento
- Se pierde la ergonomía de Elysia (schemas TypeBox integrados)

**Impacto estimado:** Alto. En benchmarks simples, `Bun.serve()` puro supera a Elysia en ~20-30% en requests/segundo para handlers triviales.

---

#### Opción B — Hono (framework edge-native)

[Hono](https://hono.dev) corre en Bun, Deno, Cloudflare Workers y Node. Es extremadamente liviano y más rápido que Elysia en varios benchmarks.

```ts
import { Hono } from 'hono';
const app = new Hono();
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));
```

**Ventajas:**
- Más rápido que Elysia en benchmarks de routing (trie-based router)
- Portable: el mismo código funciona en Edge/Serverless
- API más simple que Elysia
- Middleware ecosystem maduro

**Desventajas:**
- Cambio de dependencia — habría que reescribir `ElysiaAdapter` → `HonoAdapter`
- Sin schema validation integrado como TypeBox en Elysia (se usa Zod o Valibot)
- Se pierde el sistema de tipos de Elysia

**Impacto estimado:** Medio-Alto. Hono supera a Elysia en routing con muchas rutas registradas (el trie-router escala mejor que el router de Elysia).

---

#### Opción C — Mantener Elysia + optimizar el adaptador (recomendado a corto plazo)

En lugar de cambiar el framework HTTP, optimizar la integración actual:

1. **Eliminar WeakMap para tracking de tiempos** — usar `performance.now()` dentro del handler compilado directamente, evitando el hook `onRequest`.
2. **Lazy logging** — acumular logs y flushear en batch cada N ms en lugar de loggear por request.
3. **Desactivar logging en producción por defecto** — el flag `logger: false` ya existe pero no está documentado como default recomendado en prod.

**Impacto estimado:** Bajo-Medio. Reduce overhead de logging ~5-10% en carga alta.

---

## 2. Reflexión y Metadatos — `reflect-metadata` vs alternativas

### Estado actual

El contenedor DI y el scanner de rutas dependen completamente de `reflect-metadata`:

```ts
// container.ts — línea 96
const tokens: any[] = Reflect.getMetadata("design:paramtypes", target) || [];

// Decoradores — en cada @Controller, @Injectable, @Get, etc.
Reflect.defineMetadata(KEY, value, target);
```

### El problema

`Reflect.getMetadata()` es una operación sincrónica pero no trivial:
- Recorre la cadena de prototipos
- No tiene caché nativo — cada llamada relee el WeakMap interno de V8
- En startup con muchos módulos, el costo se acumula
- En el router, se llama múltiples veces por ruta durante la compilación

### Opciones de mejora

#### Opción A — Caché de metadata en Map estático

Agregar una capa de caché sobre las llamadas a `Reflect.getMetadata` para los tokens de constructor:

```ts
// Antes (en container.ts)
const tokens = Reflect.getMetadata("design:paramtypes", target) || [];

// Después
const paramTypesCache = new Map<Function, any[]>();

function getParamTypes(target: Function): any[] {
  if (paramTypesCache.has(target)) return paramTypesCache.get(target)!;
  const tokens = Reflect.getMetadata("design:paramtypes", target) || [];
  paramTypesCache.set(target, tokens);
  return tokens;
}
```

**Impacto:** Bajo en runtime (singletons ya son cacheados), Alto en startup con muchos providers.

---

#### Opción B — Eliminar `reflect-metadata` con registros explícitos

Reemplazar el sistema de reflexión con un registro explícito de dependencias, similar a como Angular lo hace en su compilador:

```ts
// Registro explícito en lugar de decoradores con reflect-metadata
@Injectable({ deps: [UserRepository, Logger] })
class UserService {}
```

El decorador `@Injectable` almacenaría los tokens en un Map estático propio, sin depender de `design:paramtypes`.

**Ventajas:**
- Elimina la dependencia de `reflect-metadata` completamente
- Más rápido en startup (lookup O(1) en Map vs cadena de prototipos)
- Funciona sin `experimentalDecorators` + `emitDecoratorMetadata`

**Desventajas:**
- Breaking change en la API pública — los usuarios tendrían que declarar dependencias explícitamente
- Reduce la ergonomía "NestJS-compatible"

**Impacto estimado:** Medio en startup, irrelevante en runtime (singletons ya cacheados).

---

#### Opción C — Metadata por código generado en build time (largo plazo)

Similar a lo que hace el compilador de Angular o el plugin de Babel/SWC de NestJS:

- Un plugin de compilación (ej. un Bun macro o un plugin de Bun build) analiza las clases en tiempo de compilación y genera los tokens de DI como código estático.
- En runtime, no hay llamadas a `Reflect.getMetadata` — los tokens vienen hardcodeados.

**Ventajas:** Máxima velocidad en startup, compatible con tree-shaking, sin `reflect-metadata` en producción.

**Desventajas:** Alta complejidad de implementación. Requiere un pipeline de build propio.

---

## 3. Event Store — O(n) linear scan vs índices

### Estado actual

```ts
// src/cqrs/events/event-store.ts
async getEvents(aggregateId: string): Promise<StoredEvent[]> {
  return this.events.filter(e => e.aggregateId === aggregateId); // O(n)
}
```

Con miles de eventos, cada consulta escanea el array completo.

### Opciones de mejora

#### Opción A — Índice en memoria con Map (recomendado, mínimo cambio)

```ts
class InMemoryEventStore {
  private eventsByAggregate = new Map<string, StoredEvent[]>();
  private eventsByType = new Map<string, StoredEvent[]>();

  async append(aggregateId: string, type: string, data: any) {
    const event = { ... };
    
    // Actualizar índice por aggregateId
    const byAgg = this.eventsByAggregate.get(aggregateId) ?? [];
    byAgg.push(event);
    this.eventsByAggregate.set(aggregateId, byAgg);
    
    // Actualizar índice por type
    const byType = this.eventsByType.get(type) ?? [];
    byType.push(event);
    this.eventsByType.set(type, byType);
    
    return event;
  }

  async getEvents(aggregateId: string) {
    return this.eventsByAggregate.get(aggregateId) ?? []; // O(1)
  }
}
```

**Impacto:** Alto. Cambia complejidad de O(n) a O(1) sin cambiar la API pública.

---

#### Opción B — SQLite con Bun nativo (`bun:sqlite`)

Para persistencia local sin infraestructura adicional, Bun incluye SQLite nativo:

```ts
import { Database } from "bun:sqlite";

class SQLiteEventStore {
  private db = new Database(":memory:"); // o ruta en disco

  constructor() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        aggregate_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT,
        timestamp INTEGER,
        INDEX idx_aggregate (aggregate_id),
        INDEX idx_type (type)
      )
    `);
  }

  async getEvents(aggregateId: string) {
    return this.db.query("SELECT * FROM events WHERE aggregate_id = ?").all(aggregateId);
  }
}
```

**Ventajas:**
- Persistencia entre reinicios sin Redis
- Queries complejas (ORDER BY, paginación, range queries por timestamp)
- `bun:sqlite` es síncrono y extremadamente rápido (C nativo)

**Desventajas:**
- No distribuido — solo para un proceso
- Migración de datos al reiniciar si se usa en disco

**Impacto estimado:** Alto. SQLite con índices supera al array en memoria para +10k eventos.

---

#### Opción C — Redis Streams (distribuido)

Para escenarios distribuidos o multi-proceso:

```ts
// XADD agrega al stream con ID autoincremental
await client.xadd(`events:${aggregateId}`, "*", "type", type, "data", JSON.stringify(data));

// XRANGE obtiene eventos en orden de forma eficiente
const events = await client.xrange(`events:${aggregateId}`, "-", "+");
```

**Ventajas:** Distribuido, ordenado, comparte infraestructura con la queue de Redis ya existente.

**Desventajas:** Requiere Redis como dependencia obligatoria.

---

## 4. Queue Worker — Polling vs Push

### Estado actual

```ts
// src/queue/worker.ts
private async poll() {
  const job = await this.queue.dequeue();
  if (job) {
    // procesar
  } else {
    setTimeout(() => this.poll(), this.pollingInterval); // esperar 1s y reintentar
  }
}
```

El polling con intervalo fijo de 1000ms introduce hasta 1 segundo de latencia en jobs nuevos y consume CPU innecesariamente cuando la queue está vacía.

### Opciones de mejora

#### Opción A — Backoff exponencial en idle (mínimo cambio)

```ts
private async poll(idleMs = 100) {
  const job = await this.queue.dequeue();
  if (job) {
    this.processJob(job);
    setTimeout(() => this.poll(100), 0); // reset backoff
  } else {
    const nextInterval = Math.min(idleMs * 2, 30_000); // max 30s
    setTimeout(() => this.poll(nextInterval), idleMs);
  }
}
```

**Impacto:** Reduce CPU idle hasta ~99%, mantiene baja latencia cuando hay jobs.

---

#### Opción B — `BLPOP` para Redis (blocking pop)

En lugar de polling, usar el comando blocking de Redis que duerme hasta que haya trabajo:

```ts
// RedisQueue.dequeue() con blocking pop
async dequeue(): Promise<Job | null> {
  // Bloquea hasta 30s esperando un item — 0 CPU mientras espera
  const result = await this.client.blpop(this.queueKey, 30);
  if (!result) return null;
  const [_, id] = result;
  // ... mover a processing queue
}
```

**Ventajas:** 0% CPU mientras no hay jobs, latencia de ~1ms al recibir job.

**Desventajas:** Solo aplica al adaptador Redis. Memory y SQLite seguirían necesitando polling.

**Impacto estimado:** Alto para el adaptador Redis.

---

#### Opción C — Bun Worker Threads + SharedArrayBuffer (avanzado)

Para la queue en memoria, usar workers nativos de Bun con memoria compartida para evitar serialización IPC:

```ts
// main thread
const sab = new SharedArrayBuffer(4);
const signal = new Int32Array(sab);
const worker = new Worker("./queue-worker.ts", { smol: true });

// Cuando se encola un job, despertar al worker
Atomics.notify(signal, 0);

// queue-worker.ts
Atomics.wait(signal, 0, 0); // duerme sin usar CPU hasta que llegue un job
```

**Ventajas:** Paralelismo real (usa múltiples CPU cores), 0 overhead de serialización con SAB.

**Desventajas:** Alta complejidad. Solo aplica a la queue en memoria. Bun Workers todavía tienen limitaciones.

---

## 5. Caching de respuestas HTTP

### Estado actual

No existe ningún mecanismo de caching de respuestas. Cada request ejecuta el handler completo.

### Propuesta — Decorador `@Cacheable()`

```ts
@Controller('products')
export class ProductsController {
  
  @Get(':id')
  @Cacheable({ ttl: 60_000 }) // 60 segundos
  async getProduct(@Param('id') id: string) {
    return this.productsService.findById(id);
  }
}
```

Implementación con Map en memoria:

```ts
// Middleware compilado en RouterExecutionContext
const cache = new Map<string, { value: any; expiresAt: number }>();

function cacheMiddleware(ttl: number) {
  return (context: any) => {
    const key = context.request.url;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    // continuar con el handler y cachear el resultado
  };
}
```

**Impacto:** Alto para endpoints read-heavy con datos que cambian poco.

---

## 6. Resumen de prioridades

| # | Área | Cambio | Impacto | Esfuerzo | Prioridad |
|---|------|--------|---------|----------|-----------|
| 1 | EventStore | Índice Map por aggregateId | Alto | Bajo | **Crítica** |
| 2 | Worker | Backoff exponencial en idle | Alto | Bajo | **Crítica** |
| 3 | Worker/Redis | Usar `BLPOP` en RedisQueue | Alto | Bajo | Alta |
| 4 | Container/DI | Cachear `Reflect.getMetadata` | Medio | Bajo | Alta |
| 5 | HTTP | Agregar decorador `@Cacheable()` | Alto | Medio | Alta |
| 6 | EventStore | Migrar a `bun:sqlite` como opción | Alto | Medio | Media |
| 7 | HTTP | Adaptador Hono en lugar de Elysia | Medio | Alto | Media |
| 8 | HTTP | Adaptador `Bun.serve()` nativo | Alto | Alto | Baja |
| 9 | DI | Eliminar `reflect-metadata` | Medio | Muy Alto | Baja |
| 10 | Build | Metadata generada en compile-time | Alto | Muy Alto | Largo plazo |

---

## 7. Decisión recomendada

Para mantener la filosofía del proyecto (NestJS API surface) y maximizar el ROI de esfuerzo:

**Corto plazo (sin breaking changes):**
- Implementar índices en `InMemoryEventStore` (ítem #1)
- Agregar backoff exponencial al `Worker` (ítem #2)
- Usar `BLPOP` en `RedisQueue.dequeue()` (ítem #3)
- Cachear `Reflect.getMetadata` en el container (ítem #4)

**Mediano plazo (nuevas features):**
- Decorador `@Cacheable()` con TTL (ítem #5)
- `SQLiteEventStore` como adaptador alternativo (ítem #6)

**Largo plazo (potencial breaking change):**
- Evaluar migración a Hono si se necesita portabilidad Edge/Serverless (ítem #7)
- `Bun.serve()` nativo solo si se decide abandonar Elysia como dependencia (ítem #8)

Los cambios de HTTP layer (ítems #7 y #8) solo tienen sentido si los benchmarks con carga real demuestran que Elysia es el cuello de botella — lo más probable es que el cuello de botella esté en la lógica de negocio o en I/O, no en el framework HTTP.
