# Hoja de ruta — Etapa 3

## Correcciones funcionales

- [x] **H1 — Administrador fuera del alcance operativo:** conservar cuenta y rol; mostrar “En desarrollo” en el login/entrada; impedir rutas de Salón, Reservas, Cocina y Caja tanto en la UI como en los endpoints y en los eventos de la sala Socket.IO.
- [x] **H2/H30 — Tiempo por plato:** persistir `Detalle_Comanda.fecha_hora_envio` al enviar cada ítem y ordenar KDS por esa fecha y `id_detalle`; usar la misma fecha para el umbral de 25 minutos. Las bases previas reciben backup, columna nueva y backfill desde `Comanda.fecha_hora`.
- [x] **H3 — Estados secuenciales:** implementar Pendiente → En_Preparacion → Entregado, sin saltos; mantener KDS de Cocina pasivo y actualizarlo por eventos desde los perfiles operativos autorizados.
- [x] **H4/H48 — FIFO por elegibilidad:** centralizar selección en backend, ordenar por `fecha_hora_registro,id_reserva`, no permitir saltos y escoger el primer grupo que quepa en la capacidad de la mesa disponible (`cantidad_comensales <= capacidad`). La prueba modifica capacidades en una SQLite temporal para cubrir un grupo grande seguido por el primer grupo compatible.
- [x] **H5/H20 — Cancelación trazable:** cancelar una reserva en una transacción, liberar su mesa cuando corresponda, auditar cancelación manual y automática/no-show y notificar salón/espera.
- [x] **H6 — Asignar no es sentar:** al asignar un cliente en espera, pasar a `Confirmada`, asignar `id_mesa` y dejar la mesa `Reservada`; no crear comanda hasta confirmar la llegada, que pasa a `Arribo_Confirmado/Ocupada`.
- [x] **H7 — Intervención jerárquica:** antes de 25 minutos la operación corresponde al Mozo; Jefe no puede intervenir antes de superar 25 minutos, con validación de servidor desde `fecha_hora_envio` y auditoría de la excepción.
- [x] **H8 — Resolver ítems no elaborados en Caja:** informar si existen estados Pendiente o En_Preparacion; permitir anulación explícita de esos platos, auditar y recalcular el total; no alterar transacciones ya asentadas. Caja no cierra si quedan platos no entregados o no anulados.
- [x] **H10/H11 — Reintento de comandas y debounce:** guardar localmente el envío ante microcorte, informar “Sin conexión. Comanda guardada…”; reenviar automáticamente al reconectar y periódicamente con la misma clave de idempotencia y bloquear dobles toques por 500 ms en envío/entrega. Un rechazo permanente queda visible en una cola recuperable, con reintento o descarte confirmado. La prueba confirma que repetir la clave no duplica detalles; la interrupción real de WLAN queda para la validación local.
- [x] **H13/H14 — Temporizadores de servidor:** revisar hitos con resolución de 1 s; emitir alerta de reserva a 10 min, no-show a 15 min y permanencia al superar 40 min sin depender del polling del navegador. La integración verifica el no-show/liberación y un cliente Socket.IO autenticado recibe el cambio inmediato a Alerta_Permanencia.
- [x] **H15 — CRUD de reservas:** permitir editar fecha/hora, comensales y mesa; volver a validar capacidad/superposición; permitir anular desde la interfaz y aplicar H5.
- [x] **H16 — Consentimiento para espera:** si no hay mesa, preguntar al Jefe si el cliente acepta quedar en lista; crear `En_Lista_Espera` solo tras aceptación explícita.
- [x] **H17/H18 — KDS legible y sin saturación:** rotar automáticamente páginas cada 10 s, con prioridad de ítems antiguos; aumentar tipografía/contraste y espacio de observaciones para lectura objetivo a 1,5 m.
- [x] **H19 — Comanda de mesa ocupada:** “Ver Comanda” abre la comanda activa y permite agregar ítems a la misma cabecera; Despacho permanece separado.
- [x] **H21 — KDS desactualizado:** al desconectar mostrar advertencia roja, atenuar/cubrir contenido potencialmente viejo y forzar resincronización íntegra al reconectar.
- [x] **H22 — Reserva futura:** separar disponibilidad inmediata de futura; una ocupación actual no debe bloquear una reserva futura por sí sola. No se inventa la duración del servicio que aún no aprobó el equipo.
- [x] **H23 — Rechazo de pago electrónico:** un rechazo simulado no crea `Transaccion_Cobro`, no cierra comanda ni libera mesa; permitir elegir otro medio/reintentar.
- [x] **H27 — Alerta de reserva:** agregar parpadeo discreto y visible a `Alerta_Reserva`.
- [x] **H28 — Separación Cocina/Jefe:** quitar KDS general del menú y permisos del Jefe; su intervención >25 min se mantiene como acción específica en tablet. Cocina conserva KDS de solo lectura.
- [x] **H29 — Máximo cuatro pulsaciones:** una pulsación en la mesa libre la abre con dos comensales por defecto; agregar dos platos y enviar comanda completa el caso estándar en cuatro pulsaciones. El aforo es ajustable desde la comanda.
- [x] **H31/H46 — Reserva no es función del Mozo:** Mozo ve solo el estado reservado/alerta, sin módulo de reservas ni botón para confirmar ingreso.
- [x] **H33/H34 — Regla de ventanas pendiente:** no fijar valores nuevos hasta que el equipo apruebe una regla; aislar y explicitar los valores existentes (±120 min para conflicto, +180 min de pre-bloqueo).
- [x] **H35 — Medio explícito:** Caja inicia sin método elegido y no permite cobrar hasta que Cajero seleccione uno, validado también en servidor.
- [x] **H36 — Fecha y turno:** reservas y espera se filtran por fecha y turno operativos; FIFO se aplica solo dentro de esa operación.
- [x] **H37 — Latencia:** medir RTT de confirmación de los eventos Socket.IO críticos; registrar advertencia si supera 3 s y emitir comandas antes de actualizaciones secundarias. No se afirma haber medido SLA en la WLAN del restaurante.
- [x] **H38 — Observaciones íntegras:** eliminar recorte silencioso de 500 caracteres y conservar/mostrar el texto completo.

## Etapa 3 — documentación y pruebas

- [x] Añadir pruebas unitarias reproducibles de aforo, total histórico y umbral de permanencia.
- [x] Añadir pruebas de integración en un archivo SQLite temporal para permisos, idempotencia/timestamp, estados por rol, cierre de caja, CRUD/reserva/espera FIFO por aforo, rechazo y monitor no-show; no escribir/eliminar datos de la base de demostración durante los tests.
- [x] Actualizar guía técnica/usuario, CRUD, mensajes y límites; no presentar texto de ejemplo ni cifras de latencia como evidencia real.
- [ ] **Validación en el restaurante:** comprobar lectura del KDS a 1,5 m; realizar medida de RTT bajo carga y prueba de microcortes/reconexión en la WLAN y las tablets destino.
- [ ] **Decisión del equipo pendiente:** aprobar o modificar las ventanas de conflicto entre reservas y pre-bloqueo de mesas. El código conserva los valores vigentes, no los presenta como definitivos.
- [ ] **Horario oficial de turnos:** el filtro infiere `Noche` desde las 18:00 y `Mediodía` antes cuando no se elige manualmente; confirmar los horarios oficiales del local y parametrizar el corte.
