# Modelo de datos — DER oficial Entre Líneas Lab

El esquema SQLite conserva los nombres de las nueve entidades y los atributos del DER en español. Los alias que aparecen en ciertas respuestas JSON son una capa de compatibilidad con React; no son nombres de columnas ni tablas persistidas.

## Entidades y atributos del DER

### Mesa
`id_mesa` (PK), `numero` (INT, UNIQUE), `capacidad` (INT, máximo 4), `estado` (ENUM: `Libre`, `Reservada`, `Alerta_Reserva`, `Ocupada`, `Alerta_Permanencia`) y `hora_apertura` (DATETIME NULL).

### Rol
`id_rol` (PK), `nombre_rol` (ENUM: `Mozo`, `Jefe_Salon`, `Cocina`, `Cajero`, `Administrador`).

### Usuario
`id_usuario` (PK), `nombre`, `apellido`, `identificador_acceso`, `credencial` e `id_rol` (FK → `Rol`). `credencial` guarda el hash del PIN, nunca el PIN en texto.

### Seccion_Producto
`id_seccion` (PK), `nombre` (`Cocina Caliente`, `Cocina Fría`, `Postres`, `Bebidas`).

### Producto
`id_producto` (PK), `nombre`, `descripcion`, `precio` (DECIMAL) e `id_seccion` (FK → `Seccion_Producto`).

### Comanda
`id_comanda` (PK), `id_mesa` (FK → `Mesa`), `id_usuario` (FK → `Usuario`), `fecha_hora` (DATETIME) y `estado` (`En_Proceso`, `Cobrada_Cerrada`). Un índice único parcial garantiza como máximo una comanda `En_Proceso` por mesa.

### Detalle_Comanda
`id_detalle` (PK), `id_comanda` (FK → `Comanda`), `id_producto` (FK → `Producto`), `cantidad`, `precio_unitario_historico` (DECIMAL), `observaciones` y `estado_elaboracion` (`Pendiente`, `En_Preparacion`, `Entregado`, `Cancelado`). El precio queda fijado al agregar el ítem.

### Reserva
`id_reserva` (PK), `nombre_cliente`, `telefono`, `fecha_hora_reserva`, `turno` (`Mediodía`, `Noche`), `cantidad_comensales` (1–4), `id_mesa` (FK → `Mesa`, NULL para espera), `estado` (`Confirmada`, `En_Lista_Espera`, `Arribo_Confirmado`, `Cancelada`, `Cancelada_Ausencia`), `fecha_hora_registro` e `id_usuario_registro` (FK → `Usuario`). Reserva y lista de espera comparten la entidad; no existe una tabla de dominio `Lista_Espera`.

### Transaccion_Cobro
`id_cobro` (PK), `id_comanda` (FK → `Comanda`, UNIQUE), `id_usuario` (FK → `Usuario`), `fecha_hora`, `total` (DECIMAL) y `medio_pago` (`Efectivo`, `Tarjeta_Debito`, `Tarjeta_Credito`, `Transferencia_QR`). La unicidad de `id_comanda` implementa 0..1 cobro por comanda; no se admiten pagos divididos en esta versión.

## Extensión de operación: `fecha_hora_envio`

El hallazgo H2/H30 requiere medir edad y FIFO por **plato enviado**, no por apertura de mesa. Por eso se agrega `Detalle_Comanda.fecha_hora_envio` (DATETIME, NOT NULL) como extensión técnica aditiva. Se registra al insertar cada detalle, se usa para ordenar KDS y como inicio de los 25 minutos del despacho de Jefe. No reemplaza, traduce ni elimina ningún atributo original del DER. Los datos existentes reciben backfill desde `Comanda.fecha_hora`.

## Relaciones y reglas

- `Rol` 1:N `Usuario`.
- `Mesa` 1:N `Comanda`, con una sola `En_Proceso` por mesa.
- `Usuario` 1:N `Comanda`, `Reserva` y `Transaccion_Cobro`.
- `Comanda` 1:N `Detalle_Comanda`; `Producto` 1:N `Detalle_Comanda`.
- `Seccion_Producto` 1:N `Producto`.
- `Mesa` 0..N `Reserva`; `Reserva.id_mesa` puede ser NULL cuando `estado='En_Lista_Espera'`.
- `Comanda` 0..1 `Transaccion_Cobro`.

## Tablas auxiliares fuera de las nueve entidades

`Control_Acceso` conserva bloqueo/habilitación; `Datos_Operacion_Comanda` conserva cantidad de comensales que necesita la interfaz; `Llave_Idempotencia` evita repetir envíos y `Registro_Auditoria` mantiene trazabilidad. No agregan campos a las entidades oficiales.

## DDL y migración

DDL: `server/db/schema.sql`. Base de desarrollo: `server/db/entre-lineas.sqlite`. La migración aditiva crea `.pre-etapa3-<timestamp>.bak` antes de agregar `fecha_hora_envio`. La migración histórica desde el modelo inicial en inglés crea `.pre-der-espanol-<timestamp>.bak` y se detiene si encuentra transacciones que aún necesiten conversión; no borra comandas reales.
