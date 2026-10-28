# Confirmación de entrega a la mesa

## Flujo para Mozo y Jefe de Salón

1. **Mozo** o **Jefe de Salón** abre Despacho; Mozo también puede abrirlo al tocar una mesa ocupada desde Salón.
2. Se muestra cada ítem no entregado, agrupado por mesa/sección, con su estado, observaciones completas y edad desde `Detalle_Comanda.fecha_hora_envio`.
3. El Mozo avanza cada ítem de forma secuencial: primero “Marcar en preparación”; después de llevarlo físicamente al cliente, “Confirmar entrega a mesa”. No se admite saltar `Pendiente → Entregado`.
4. El Jefe mantiene el KDS general fuera de su menú. En Despacho solo puede ejecutar la intervención excepcional después de **más de 25 minutos** desde el envío; el servidor vuelve a validar el umbral y registra auditoría.
5. La actualización queda en `Detalle_Comanda.estado_elaboracion`, se propaga por Socket.IO y permite a Caja habilitar el cierre cuando no quedan ítems pendientes de entrega/elaboración.

El **Administrador** conserva la cuenta visible como “En desarrollo” y no puede usar este flujo ni ningún otro endpoint operativo. Un reintento de una entrega ya registrada no duplica la transición ni la auditoría. Un ítem cancelado o una comanda cerrada no se puede entregar.

## Cambios técnicos

- El timestamp del detalle se agrega a bases previas con migración respaldada y backfill desde `Comanda.fecha_hora`; no cambia los demás nombres del DER.
- `PATCH /api/order-items/:id/status` valida rol, comanda abierta, transición secuencial y, para Jefe, edad mayor a 25 minutos. Cada cambio autorizado se audita.
- Socket.IO autentica tokens; los usuarios autorizados confirman la recepción de eventos críticos y el servidor registra una advertencia si el RTT supera 3 s.
- Pruebas: `npm test --prefix server` cubre estados por rol, umbral jerárquico y persistencia temporal; `npm run build --prefix client` verifica que React compile. Las pruebas no sustituyen la medición física de red del restaurante.
