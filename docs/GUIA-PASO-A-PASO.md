# Guía paso a paso — Entre Líneas Lab · Etapa 3

## 1. Tecnologías y modelo de datos

Node.js ejecuta Express y Socket.IO; SQLite es el motor de datos local. El DER mantiene los nombres españoles: `Mesa`, `Rol`, `Usuario`, `Seccion_Producto`, `Producto`, `Comanda`, `Detalle_Comanda`, `Reserva` y `Transaccion_Cobro`. La extensión `Detalle_Comanda.fecha_hora_envio` guarda la hora de envío de cada ítem a cocina y sirve para ordenar KDS y medir los 25 minutos. Lista de espera se representa dentro de `Reserva`, no en una tabla paralela. Cuatro tablas auxiliares guardan control de acceso, datos operativos de comensales, claves idempotentes y auditoría.

## 2. Arranque de desarrollo local

Requisitos: Node.js 20+ y npm. Desde la carpeta raíz:

```bash
npm install --prefix server
npm install --prefix client
npm run db:init --prefix server
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Antes de un piloto, cambiar `JWT_SECRET` por un valor aleatorio fuerte y reemplazar los PIN de demo.

Iniciar servicios en terminales separadas:

```bash
npm run dev --prefix server
npm run dev --prefix client
```

Abrir `http://localhost:5173`. La API y Socket.IO usan el puerto `3001`. Para tablets LAN, crear `client/.env` con `VITE_API_URL=http://IP_DEL_SERVIDOR:3001` y poner `CLIENT_ORIGIN=http://IP_DEL_SERVIDOR:5173` en `server/.env`. El cliente ya se enlaza a `0.0.0.0`; si se usa hostname, establecer `VITE_ALLOWED_HOST` con el nombre. Esto es modo desarrollo con HTTP, no endurecido para producción.

`npm run db:init` es para inicialización/desarrollo: agrega `fecha_hora_envio` de manera incremental, crea backup antes de esa migración y siembra solo usuarios/productos faltantes. Las pruebas de integración usan una SQLite temporal; no ejecutes los tests apuntando a la base del restaurante.

## 3. Inicio de sesión y permisos

Elegir el perfil y PIN `1234` en el entorno de demostración. Cambiar el PIN antes de un piloto real. El token protege la API y la conexión Socket.IO.

- **Mozo:** ve Salón, Comanda y Despacho. Puede abrir una mesa, añadir productos a una comanda existente, marcar preparación/entrega y consultar estado de reservas sin datos ni acciones de confirmación.
- **Jefe de Salón:** ve Salón, Comanda, Reservas/Espera y Despacho; no tiene KDS general. La acción excepcional sobre un plato solo se habilita cuando transcurrieron **más de 25 minutos** desde su envío, y se audita.
- **Cocina:** ve KDS de solo lectura; las mutaciones de estado están protegidas por rol en servidor.
- **Caja:** revisa cuentas, puede anular platos pendientes o en preparación con confirmación y auditoría, selecciona un método y registra un cobro.
- **Administrador:** el perfil se mantiene, con rótulo “En desarrollo” y sin rutas, endpoints ni eventos operativos.

## 4. Salón y comanda

1. El Mozo toca una mesa libre. La mesa se abre directamente con dos comensales por defecto; puede ajustar el número dentro del aforo desde la pantalla de comanda.
2. Selecciona una sección de carta, agrega los productos, ajusta cantidad y escribe observaciones completas (incluidas alergias o instrucciones).
3. Pulsa “Enviar a cocina (KDS)”. Cada línea se almacena en `Detalle_Comanda` con `precio_unitario_historico`, `observaciones`, `fecha_hora_envio` y `estado_elaboracion='Pendiente'`.
4. La clave `Idempotency-Key` evita duplicar una comanda si el cliente reintenta. Ante una caída de red, el navegador conserva el envío en almacenamiento local y lo reintenta al reconectar; el encabezado muestra desconexión. Si el servidor rechaza un envío, la tarjeta de recuperación conserva el pedido, explica el motivo y ofrece “Reintentar” o “Descartar” (este último pide confirmación).
5. Para una mesa ocupada, pulsa “Ver Comanda”: abre la comanda activa y los nuevos ítems se agregan a esa misma cuenta. Despacho permanece separado.

## 5. Cocina y entrega a la mesa

- **Cocina:** abre KDS. Las tarjetas se ordenan por antigüedad individual, se agrupan por sección y la pantalla rota páginas cada 10 segundos. El umbral de demora es más de 25 minutos. Las observaciones se muestran completas.
- Si se pierde la conexión, el KDS queda atenuado y cubierto por un aviso de datos posiblemente desactualizados. Al reconectar, vuelve a consultar la fuente completa.
- **Mozo:** desde Despacho, para cada ítem pendiente pulsa “Marcar en preparación”; luego de entregarlo físicamente, pulsa “Confirmar entrega a mesa”. El orden no se puede saltar: `Pendiente → En_Preparacion → Entregado`.
- **Jefe:** la misma intervención se presenta como acción excepcional; el servidor devuelve error antes de que el plato supere 25 minutos. Cocina no muta la tarjeta.

## 6. Reservas y lista de espera

1. Ingresar como Jefe y seleccionar **fecha** y **turno** (`Mediodía` o `Noche`). Las listas muestran solo esa operación.
2. Registrar nombre, contacto, cantidad y fecha/hora. La mesa se asigna automáticamente cuando está disponible y tiene capacidad. Si no hay mesa, la aplicación pregunta si el cliente acepta la lista de espera; sin aceptar, no crea la entrada.
3. Para modificar una reserva existente, usar **Editar**, corregir nombre/contacto, cantidad, fecha/hora, turno o mesa y guardar. Al cambiar a datos sin mesa compatible, se vuelve a pedir consentimiento antes de pasarla a espera. **Anular** registra auditoría y libera la mesa cuando corresponde.
4. La lista de espera se ordena por `fecha_hora_registro,id_reserva`. El backend ofrece únicamente el primer grupo elegible que cabe en la capacidad disponible. **Asignar mesa** pasa ese registro a `Confirmada`, y la mesa a `Reservada`; aún no crea una comanda.
5. Al llegar el grupo, el Jefe pulsa **Llegó / Sentar** en la reserva. Entonces el estado pasa a `Arribo_Confirmado` y se crea la comanda/ocupación.
6. El monitor servidor revisa cada segundo: alerta de reserva a los 10 minutos, no-show/cancelación a los 15 minutos. La cancelación automática queda auditada y libera la mesa si no hay comanda activa.

La ocupación actual no impide por sí sola hacer una reserva futura. El sistema conserva las ventanas existentes de ±120 minutos entre reservas y +180 minutos de pre-bloqueo hasta que el equipo apruebe una regla definitiva; no se tomó como aprobada la propuesta de 40 minutos. Si no se ha elegido manualmente, la pantalla infiere `Noche` desde las 18:00 y `Mediodía` antes; el equipo debe confirmar los horarios oficiales de esos turnos.

## 7. Caja y cierre

1. Caja selecciona una cuenta activa y revisa los ítems y totales históricos.
2. No se habilita el cierre si quedan productos `Pendiente` o `En_Preparacion`. Se puede esperar al despacho o anular explícitamente un plato aún no elaborado; esa anulación se audita y recalcula el total.
3. Elegir obligatoriamente un medio: `Efectivo`, `Tarjeta_Debito`, `Tarjeta_Credito` o `Transferencia_QR`.
4. Si una operación electrónica es rechazada, la simulación deja la cuenta y la mesa abiertas y no crea `Transaccion_Cobro`; se puede seleccionar otro medio/reintentar. No es una conexión real con adquirente o banco.
5. Al registrar el cobro válido, `Comanda.estado` pasa a `Cobrada_Cerrada` y la mesa vuelve a `Libre`.

## 8. CRUD y rutas principales de la API

Todas las rutas salvo salud/login requieren un token; cada ruta verifica su rol.

| Método y ruta | Uso |
|---|---|
| `GET /api/tables`, `GET /api/menu` | Consultar tablero y carta. |
| `POST /api/tables/open` | Abrir una mesa y guardar cantidad de comensales. |
| `POST /api/orders` | Agregar detalle; requiere `Idempotency-Key`. |
| `GET /api/orders/by-table/:tableId` | Consultar comanda activa de mesa. |
| `GET /api/kds` | KDS de Cocina, solo lectura. |
| `GET /api/dispatch/items`, `PATCH /api/order-items/:id/status` | Despacho por Mozo/Jefe con transición/umbral verificados. |
| `GET/POST /api/reservations` | Consultar por `?fecha=YYYY-MM-DD&turno=...` y crear reserva. |
| `PATCH /api/reservations/:id`, `POST /api/reservations/:id/cancel`, `POST /api/reservations/:id/arrive` | Editar, anular o confirmar llegada. |
| `GET/POST /api/waitlist` | Consultar lista filtrada y agregar grupo presente/aceptado. |
| `POST /api/waitlist/:id/assign`, `POST /api/waitlist/:id/cancel` | Asignar respetando elegibilidad FIFO o retirar de la lista. |
| `GET /api/cashier/orders`, `GET /api/cashier/orders/:id` | Consultar cuentas abiertas y detalle. |
| `POST /api/cashier/orders/:orderId/items/:itemId/cancel` | Anular ítem aún no elaborado. |
| `POST /api/payments/close` | Una transacción por comanda; valida medio, importe y despacho. |

Los cambios críticos se emiten por Socket.IO autenticado. El backend mide el RTT de confirmación y registra advertencia si supera 3 s; esa instrumentación no certifica la latencia de la LAN destino.

## 9. Pruebas y solución de problemas

Ejecutar desde raíz:

```bash
npm test --prefix server
npm run build --prefix client
```

La prueba unitaria cubre aforo, cálculo de total histórico, frontera de 40 minutos y transición secuencial. La integración usa una base SQLite temporal e inspecciona permisos, claves idempotentes, timestamp y texto largo, reserva futura/edición/anulación, filtros fecha-turno, FIFO por capacidad, llegada, rechazo, cierre y temporizador no-show. Las pruebas actuales pasan en Sandbox; se debe volver a ejecutarlas en el equipo objetivo.

Si no aparece el KDS, comprobar primero el estado de red, que API y frontend apunten al mismo `VITE_API_URL`, el token/rol de Cocina y `CLIENT_ORIGIN`. Si una reserva no aparece, revisar fecha y turno activos. Si el Jefe no puede actualizar un plato, verificar `fecha_hora_envio`; debe haber superado 25 minutos. No crear datos temporales sobre la base operativa para probar.

## 10. Validaciones requeridas antes de producción

Cambiar PIN demo y `JWT_SECRET`, revisar backups/restauración y probar reconexión en una WLAN real. Medir la propagación bajo carga, comprobar lectura del KDS a 1,5 m y revisar con el equipo los umbrales H33/H34. El entorno Sandbox no mide esos resultados físicos.
