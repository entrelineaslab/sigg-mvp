# Plan de implementación — Entre Líneas Lab, Etapa 3

## Arquitectura y organización

Continuar el monorepo local ya iniciado: `client/` contiene React/Vite, los módulos de pantalla y estilos táctiles; `server/src/index.js` contiene Express, autenticación por PIN, autorización, Socket.IO, pedidos, KDS, despacho y caja; `server/src/reservations.js` encapsula reservas/lista de espera, FIFO, filtros y temporizadores; `server/src/domain.js` reúne reglas puras compartidas y verificables; `server/db/schema.sql` define SQLite con los nombres españoles del DER; `server/src/init-db.js` crea y migra la base sin eliminar datos operativos; `server/test/` contiene pruebas unitarias y de integración sobre una base temporal; `docs/` contiene las guías y decisiones.

Mantener Node.js, Express, Socket.IO y SQLite local mediante `better-sqlite3` en modo WAL. No migrar a MongoDB ni alterar nombres de tablas/campos del DER. La extensión `Detalle_Comanda.fecha_hora_envio` se conserva como campo técnico necesario para edad, FIFO y retrasos, sin renombrar el resto del esquema. Los permisos del backend son la autoridad, no solo la navegación React.

## Diseño de la experiencia

Conservar el POS editorial cálido derivado de Figma. Separar acciones por rol: Cocina recibe un KDS de alto contraste y solo lectura; Mozo usa el flujo normal de preparar/entregar; Jefe administra salón, reservas y excepciones de despacho; Caja puede anular ítems no elaborados y liquidar; Administrador conserva su rol visible como “En desarrollo”, pero sin rutas operativas, endpoints autorizados ni sala Socket.IO operativa. La comanda usa apertura rápida de mesa con dos comensales por defecto y selector posterior, para reducir pasos. Una desconexión muestra claramente los datos KDS obsoletos y conserva comandas pendientes en el almacenamiento local del dispositivo.

## Enfoque de implementación

1. Preservar el DER y extender solo `Detalle_Comanda` con `fecha_hora_envio`; migrar los registros anteriores con un backup y usar la marca individual para FIFO, edad y el límite jerárquico de 25 minutos.
2. Completar el ciclo secuencial Pendiente → En_Preparacion → Entregado. Cocina no muta su KDS pasivo. Mozo realiza el ciclo ordinario; Jefe solo interviene después de superar 25 minutos y el servidor valida el límite. Caja puede anular ítems aún no elaborados, con auditoría y recálculo.
3. Endurecer acceso por rol, mostrar la comanda activa al seleccionar una mesa ocupada, proteger las acciones de reservas frente al perfil Mozo, y sincronizar el salón, el KDS y despacho mediante eventos autenticados.
4. Implementar edición/anulación de reservas, liberación de mesa y auditoría en cancelación/no-show, consentimiento antes de añadir a espera, filtros por fecha/turno, asignación FIFO como `Confirmada`/`Reservada` y confirmación de llegada en un paso separado.
5. Hacer idempotente y durable el envío de comandas en el cliente, reintentarlo al reconectar y en ciclos de recuperación, proteger dobles toques por 500 ms, revisar hitos temporales con resolución de un segundo y registrar advertencias cuando un evento crítico supere 3 s de RTT de confirmación.
6. Ordenar KDS por antigüedad, rotar páginas cada 10 s, elevar tamaño/contraste de las tarjetas y mostrar observaciones completas. En Caja exigir método explícito; una simulación de rechazo electrónico no debe mutar transacción, comanda ni mesa.
7. Añadir pruebas con `node:test`, en particular en un archivo SQLite temporal para no tocar los datos locales durante integración; documentar instalación, uso, CRUD, limitaciones y resultados medidos.

## Regla temporal aún pendiente del equipo

H33/H34 identifican como no aprobadas las ventanas existentes de ±2 horas entre reservas y +3 horas de pre-bloqueo, y proponen discutir 40 minutos. Se mantienen aisladas y sin cambiar a 40 minutos mientras no haya una regla aprobada. Para H22, la reserva futura no se rechaza solo porque exista una comanda actual: no se inventa una duración del servicio vigente; los conflictos con reservas confirmadas siguen sujetos a la ventana configurada, que deberá revisarse con el equipo. El filtro de turno infiere `Noche` desde las 18:00, pero el horario oficial tampoco está definido: el usuario puede cambiarlo en pantalla y el corte debe confirmarse y parametrizarse con el local.

## Límites y operación segura

La base es SQLite local y las pruebas de integración crean/eliminan exclusivamente archivos temporales. La migración de producción requiere respaldo y validación del equipo; nunca se borran comandas reales. El rechazo electrónico es una simulación del flujo, no una pasarela. La lectura física del KDS a 1,5 m, la propagación bajo carga y los microcortes de WLAN del restaurante son verificaciones del entorno real; el Sandbox no debe presentarlas como resultados medidos.
