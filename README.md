# Entre Líneas Lab — Gastro POS local

MVP de operación gastronómica para tablets y servidor local. Alineado a las pantallas Figma, al DER en español y a los hallazgos de Etapa 3. Incluye Salón, Comanda, Reservas/Espera, KDS, Despacho y Caja.

## Arquitectura y datos

Node.js ejecuta Express y Socket.IO. SQLite es la base local, accedida desde Node mediante `better-sqlite3` con WAL. El archivo operativo de desarrollo está en `server/db/entre-lineas.sqlite`; el DDL está en `server/db/schema.sql`. Las nueve entidades y sus nombres de columna del DER se mantienen en español: `Mesa`, `Rol`, `Usuario`, `Seccion_Producto`, `Producto`, `Comanda`, `Detalle_Comanda`, `Reserva` y `Transaccion_Cobro`. La extensión `Detalle_Comanda.fecha_hora_envio` registra cuándo se envía cada ítem a cocina. La lista de espera se almacena en `Reserva` con `estado='En_Lista_Espera'`.

La API usa algunos alias para la interfaz React, pero no son nombres de columnas ni tablas de SQLite. Tablas auxiliares técnicas: `Control_Acceso`, `Datos_Operacion_Comanda`, `Llave_Idempotencia` y `Registro_Auditoria`.

## Requisitos e instalación

Requiere Node.js 20+ y npm. Desde la raíz del proyecto:

```bash
npm install --prefix server
npm install --prefix client
npm run db:init --prefix server
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Antes de un piloto, reemplazar el `JWT_SECRET` de `server/.env` por uno aleatorio y cambiar el PIN demo.

Para iniciar el entorno local, abrir dos terminales desde la raíz:

```bash
npm run dev --prefix server
```

```bash
npm run dev --prefix client
```

Abrir `http://localhost:5173`. La API y Socket.IO escuchan en el puerto `3001`; Vite ya enlaza el puerto `5173` a `0.0.0.0`. Para tablets, definir `VITE_API_URL=http://IP_DEL_SERVIDOR:3001` en `client/.env` y `CLIENT_ORIGIN=http://IP_DEL_SERVIDOR:5173` en `server/.env`. Si se usa un hostname en lugar de una IP, configurar `VITE_ALLOWED_HOST` con ese hostname. No se necesita Internet entre cliente y servidor de la LAN; la red local, el equipo servidor y la alimentación eléctrica sí deben estar disponibles. Esta configuración de desarrollo usa HTTP, no es una instalación endurecida para producción.

## Base existente, backup y migración

`npm run db:init --prefix server` ejecuta el DDL y crea las cuentas/catálogos demo faltantes. El campo `fecha_hora_envio` se agrega con `ALTER TABLE`; los detalles anteriores se completan con la fecha de la comanda. La migración incremental crea un archivo `.pre-etapa3-<timestamp>.bak` antes de modificar la base. Al encontrar el esquema legado en inglés, el inicializador crea una copia `.pre-der-espanol-<timestamp>.bak`; si detecta comandas, detalles, reservas, espera o cobros en ese esquema, se detiene para que se revise la conversión.

El inicializador no elimina transacciones. Los usuarios y productos ya existentes no deben sobrescribirse al volver a ejecutar el DDL: las semillas se insertan solo si faltan. Aun así, antes de usar una base del restaurante, hacer una copia manual, probar restauración y revisar las migraciones con el equipo responsable. Las pruebas no usan este archivo: inicializan su propia base SQLite temporal.

## Usuarios de demostración

Perfiles: `mozo`, `jefe`, `cocina`, `caja` y `admin`; PIN inicial de demo `1234`. El inicializador solo crea esas credenciales cuando faltan. Los PIN demo no deben usarse en producción.

- **Mozo:** Salón, comanda de mesa ocupada y Despacho; no administra reservas ni confirma llegadas.
- **Jefe de Salón:** Salón, comanda, Reservas/Espera y Despacho; no entra al KDS general. La intervención sobre un plato se habilita en servidor solo después de superar 25 minutos desde `fecha_hora_envio`.
- **Cocina:** KDS de solo lectura.
- **Caja:** revisión de cuentas, anulación auditada de ítems todavía no elaborados y cobro.
- **Administrador:** visible como “En desarrollo”; sin módulos, endpoints operativos ni sala de eventos.

### Preparación de credenciales antes de un piloto controlado

En `server/.env`, reemplaza `JWT_SECRET` por una cadena aleatoria larga. Puedes generar una con `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"`; copia el resultado **solo** a ese archivo, no al chat ni al repositorio. Reinicia la API después de cambiarlo; al rotarlo, los tokens de sesión existentes dejan de servir.

Para cambiar el PIN de un perfil, desde la raíz ejecuta, por ejemplo, `npm run user:set-pin --prefix server -- mozo`. La terminal pedirá dos veces un PIN nuevo de 4 dígitos sin mostrarlo, guardará solo su hash, limpiará bloqueos y creará una copia de seguridad de la base. Repite el comando usando `jefe`, `cocina`, `caja` o `admin`. No introduzcas PIN por SQL ni modifiques manualmente `Usuario.credencial`.

**Límite importante:** esta versión tiene una cuenta compartida por rol (por ejemplo, `mozo`), no cuentas personales para cada empleado; cambiar el PIN del rol no da atribución individual. Es adecuada para un piloto técnico controlado en LAN, no es todavía una solución endurecida para el registro individual de personal.

## Flujos disponibles

- **Salón y comanda:** una pulsación en una mesa libre abre una comanda con dos comensales por defecto; el aforo se ajusta en la pantalla. Un toque en “Ver Comanda” para una mesa ocupada abre la comanda existente. Cada ítem guarda precio histórico, observaciones completas y hora individual de envío; la clave idempotente protege los reintentos.
- **Preparación y entrega:** el ciclo del ítem es `Pendiente → En_Preparacion → Entregado`; no se aceptan saltos. Mozo confirma la preparación y la entrega. Jefe solo puede intervenir por demora superior a 25 minutos y queda auditado. Caja no puede cerrar una cuenta con platos pendientes; permite anular explícitamente platos pendientes/en preparación y recalcula.
- **Desconexión:** los pedidos enviados durante un microcorte quedan en almacenamiento local del navegador y se reintentan con la misma clave al reconectar y durante el ciclo de recuperación. Si el servidor rechaza permanentemente uno, queda retenido con el error visible y el usuario puede reintentar o descartarlo con confirmación. En el KDS se advierte cuando la vista puede estar desactualizada y se resincroniza al volver la conexión.
- **Reservas y lista de espera:** se filtran por fecha y turno; la ausencia genera alerta a 10 minutos y cancelación a 15. Anular una reserva libera su mesa cuando corresponde y genera auditoría. El backend asigna al primer grupo elegible por orden de registro y capacidad; asignar mesa crea `Confirmada/Reservada`, no comanda. La llegada se confirma por separado y entonces crea la comanda.
- **KDS:** solo lectura, ordena por fecha/hora individual más antigua, marca el umbral de 25 minutos, muestra observaciones íntegras y rota páginas cada 10 segundos.
- **Caja:** no preselecciona medio de pago. Soporta `Efectivo`, `Tarjeta_Debito`, `Tarjeta_Credito` y `Transferencia_QR`. La acción “Simular rechazo” es exclusivamente de prueba: no registra cobro, no cierra comanda ni libera mesa. No hay integración real con adquirentes ni bancos.
- **Tiempo real:** eventos críticos requieren reconocimiento de clientes Socket.IO; el servidor registra una advertencia si su RTT supera 3 segundos. Esto instrumenta el criterio, pero no equivale a una medición ni certificación de latencia en la red del restaurante.

## Pruebas

Desde la raíz:

```bash
npm test --prefix server
npm run build --prefix client
```

Las pruebas unitarias revisan capacidad, total monetario histórico, límite de permanencia y estados secuenciales. La prueba de integración crea una base temporal desechable y cubre permisos, idempotencia, observaciones largas, timestamps, estados por rol, reserva futura, filtros, edición/anulación, prioridad FIFO por capacidad, confirmación de llegada, rechazo de pago, cierre de Caja y monitor de no-show. No altera el archivo de demostración. El resultado y sus límites están en [Resultados de pruebas Etapa 3](docs/PRUEBAS-ETAPA3.md).

## Regla temporal pendiente de aprobación

Hallazgos H33/H34 señalan que la ventana de conflicto entre reservas (±120 minutos) y el pre-bloqueo de mesas (+180 minutos) requieren confirmación del equipo; se conservan aisladas y no se reemplazan por una hipótesis de 40 minutos. La reserva futura no se rechaza solo por una comanda actualmente abierta, porque el sistema todavía no tiene una duración de servicio aprobada.
El filtro de turno predeterminado infiere `Noche` desde las 18:00 y `Mediodía` antes de esa hora, ya que el documento aún no define los horarios oficiales de los turnos. Se puede cambiar manualmente en pantalla y el límite horario debe validarse con el equipo.

## Antes de un piloto real

En una copia separada, cambiar PIN y `JWT_SECRET`, ajustar usuarios/catálogo y definir backups/recuperación. Medir la lectura del KDS a 1,5 m, la propagación con carga y los microcortes reales desde las tablets; revisar las ventanas de reserva con el equipo. Las pruebas de Sandbox no sustituyen esas comprobaciones locales.
