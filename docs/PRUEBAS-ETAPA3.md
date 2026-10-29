# Resultados de pruebas — Etapa 3

**Fecha de ejecución:** 28 de octubre de 2026, Sandbox de desarrollo.

## Comandos ejecutados

```bash
node --check server/src/index.js
node --check server/src/reservations.js
node --check server/test/integration.test.js
npm test --prefix server
npm run build --prefix client
```

## Resultado observado

- Sintaxis de los módulos Node y pruebas: correcta.
- `node --test test/*.test.js`: **6 tests, 6 aprobados, 0 fallidos** (4 pruebas unitarias de dominio y 2 pruebas de integración).
- Vite: compilación completada; 55 módulos transformados.
- Las integraciones iniciaron API y SQLite en una carpeta temporal desechable y la eliminaron al terminar. No apuntaron a `server/db/entre-lineas.sqlite`.

La cobertura inspecciona aforo, total monetario histórico, frontera de 40 minutos, transición secuencial, permisos de Administrador/Mozo/Jefe/Cocina/Caja, persistencia del inicializador sin sobrescribir precio/PIN/bloqueos, idempotencia, timestamp y observaciones extensas, preparación/entrega, intervención del Jefe antes/después de 25 minutos, reserva futura, filtros fecha/turno, edición/anulación, FIFO por capacidad, llegada separada, método de pago obligatorio, rechazo sin cierre, anulación en Caja, cobro, liberación de mesa y monitor no-show/auditoría. Un cliente Socket.IO autenticado además confirma que el evento de `Alerta_Permanencia` se propaga a los tablets al superar el umbral.

Por separado de los 6 tests automáticos, el comando de cambio de PIN se ejecutó en una pseudo-terminal contra otra SQLite temporal: comprobé la entrada oculta, confirmación doble, hash bcrypt, reseteo del control de acceso y creación del backup. La base de demostración no fue modificada.

## Estado de la base local de desarrollo

Después de migrar, el DDL presenta `Detalle_Comanda.fecha_hora_envio` y el índice `ix_Detalle_Comanda_kds_fifo`. La verificación registró 10 mesas, 5 roles, 5 usuarios demo, 4 secciones, 13 productos, cero comandas/reservas/cobros operativos y cero violaciones de claves foráneas. Se preservó una copia anterior `.pre-etapa3-<timestamp>.bak` antes de añadir el campo.

## Qué no prueban estas cifras

Los tests no constituyen una prueba de carga ni certifican una latencia máxima en la red del restaurante. No se simuló un microcorte físico de WLAN en tablets; la cola persistente y reintento están implementados, pero deben comprobarse en la LAN destino. El evento crítico registra un RTT Socket.IO, pero esta ejecución no midió una propagación real superior a 3 s. La lectura física del KDS a 1,5 m tampoco se valida dentro del Sandbox.

También sigue abierta la aprobación del equipo para las ventanas operativas de reservas que señalan H33/H34.
