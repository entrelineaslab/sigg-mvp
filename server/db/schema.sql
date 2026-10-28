PRAGMA foreign_keys = ON;

-- Entidades del DER: los nombres de tabla, columna y dominio se conservan en español.
CREATE TABLE IF NOT EXISTS Rol (
  id_rol INTEGER PRIMARY KEY,
  nombre_rol TEXT NOT NULL UNIQUE CHECK(nombre_rol IN ('Mozo','Jefe_Salon','Cocina','Cajero','Administrador'))
);

CREATE TABLE IF NOT EXISTS Usuario (
  id_usuario INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  apellido TEXT NOT NULL,
  identificador_acceso TEXT NOT NULL UNIQUE,
  credencial TEXT NOT NULL,
  id_rol INTEGER NOT NULL REFERENCES Rol(id_rol)
);

CREATE TABLE IF NOT EXISTS Mesa (
  id_mesa INTEGER PRIMARY KEY,
  numero INTEGER NOT NULL UNIQUE,
  capacidad INTEGER NOT NULL CHECK(capacidad BETWEEN 1 AND 4),
  estado TEXT NOT NULL DEFAULT 'Libre' CHECK(estado IN ('Libre','Reservada','Alerta_Reserva','Ocupada','Alerta_Permanencia')),
  hora_apertura TEXT,
  CHECK (
    (estado IN ('Libre','Reservada','Alerta_Reserva') AND hora_apertura IS NULL)
    OR (estado IN ('Ocupada','Alerta_Permanencia') AND hora_apertura IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS Seccion_Producto (
  id_seccion INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE CHECK(nombre IN ('Cocina Caliente','Cocina Fría','Postres','Bebidas'))
);

CREATE TABLE IF NOT EXISTS Producto (
  id_producto INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  precio DECIMAL(12,2) NOT NULL CHECK(precio >= 0),
  id_seccion INTEGER NOT NULL REFERENCES Seccion_Producto(id_seccion),
  UNIQUE(id_seccion,nombre)
);

CREATE TABLE IF NOT EXISTS Comanda (
  id_comanda INTEGER PRIMARY KEY,
  id_mesa INTEGER NOT NULL REFERENCES Mesa(id_mesa),
  id_usuario INTEGER NOT NULL REFERENCES Usuario(id_usuario),
  fecha_hora TEXT NOT NULL DEFAULT (datetime('now')),
  estado TEXT NOT NULL DEFAULT 'En_Proceso' CHECK(estado IN ('En_Proceso','Cobrada_Cerrada'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_Comanda_mesa_en_proceso
  ON Comanda(id_mesa) WHERE estado = 'En_Proceso';
CREATE INDEX IF NOT EXISTS ix_Comanda_fecha_hora ON Comanda(fecha_hora);

CREATE TABLE IF NOT EXISTS Detalle_Comanda (
  id_detalle INTEGER PRIMARY KEY,
  id_comanda INTEGER NOT NULL REFERENCES Comanda(id_comanda),
  id_producto INTEGER NOT NULL REFERENCES Producto(id_producto),
  cantidad INTEGER NOT NULL CHECK(cantidad BETWEEN 1 AND 99),
  precio_unitario_historico DECIMAL(12,2) NOT NULL CHECK(precio_unitario_historico >= 0),
  observaciones TEXT NOT NULL DEFAULT '',
  fecha_hora_envio TEXT NOT NULL DEFAULT (datetime('now')),
  estado_elaboracion TEXT NOT NULL DEFAULT 'Pendiente' CHECK(estado_elaboracion IN ('Pendiente','En_Preparacion','Entregado','Cancelado'))
);
CREATE INDEX IF NOT EXISTS ix_Detalle_Comanda_estado ON Detalle_Comanda(estado_elaboracion);
CREATE INDEX IF NOT EXISTS ix_Detalle_Comanda_kds_fifo ON Detalle_Comanda(estado_elaboracion,fecha_hora_envio,id_detalle);

CREATE TABLE IF NOT EXISTS Reserva (
  id_reserva INTEGER PRIMARY KEY,
  nombre_cliente TEXT NOT NULL,
  telefono TEXT NOT NULL DEFAULT '',
  fecha_hora_reserva TEXT NOT NULL,
  turno TEXT NOT NULL CHECK(turno IN ('Mediodía','Noche')),
  cantidad_comensales INTEGER NOT NULL CHECK(cantidad_comensales BETWEEN 1 AND 4),
  id_mesa INTEGER REFERENCES Mesa(id_mesa),
  estado TEXT NOT NULL DEFAULT 'Confirmada' CHECK(estado IN ('Confirmada','En_Lista_Espera','Arribo_Confirmado','Cancelada','Cancelada_Ausencia')),
  fecha_hora_registro TEXT NOT NULL DEFAULT (datetime('now')),
  id_usuario_registro INTEGER NOT NULL REFERENCES Usuario(id_usuario),
  CHECK ((estado = 'En_Lista_Espera' AND id_mesa IS NULL) OR (estado IN ('Confirmada','Arribo_Confirmado') AND id_mesa IS NOT NULL) OR estado IN ('Cancelada','Cancelada_Ausencia'))
);
CREATE INDEX IF NOT EXISTS ix_Reserva_turno_estado_hora ON Reserva(turno,estado,fecha_hora_reserva);
CREATE INDEX IF NOT EXISTS ix_Reserva_lista_espera ON Reserva(estado,fecha_hora_registro);

CREATE TABLE IF NOT EXISTS Transaccion_Cobro (
  id_cobro INTEGER PRIMARY KEY,
  id_comanda INTEGER NOT NULL UNIQUE REFERENCES Comanda(id_comanda),
  id_usuario INTEGER NOT NULL REFERENCES Usuario(id_usuario),
  fecha_hora TEXT NOT NULL DEFAULT (datetime('now')),
  total DECIMAL(12,2) NOT NULL CHECK(total >= 0),
  medio_pago TEXT NOT NULL CHECK(medio_pago IN ('Efectivo','Tarjeta_Debito','Tarjeta_Credito','Transferencia_QR'))
);

INSERT OR IGNORE INTO Rol(id_rol,nombre_rol) VALUES
  (1,'Mozo'),(2,'Jefe_Salon'),(3,'Cocina'),(4,'Cajero'),(5,'Administrador');
INSERT OR IGNORE INTO Mesa(id_mesa,numero,capacidad,estado,hora_apertura) VALUES
  (1,1,4,'Libre',NULL),(2,2,4,'Libre',NULL),(3,3,4,'Libre',NULL),(4,4,4,'Libre',NULL),(5,5,4,'Libre',NULL),
  (6,6,4,'Libre',NULL),(7,7,4,'Libre',NULL),(8,8,4,'Libre',NULL),(9,9,4,'Libre',NULL),(10,10,4,'Libre',NULL);
INSERT OR IGNORE INTO Seccion_Producto(id_seccion,nombre) VALUES
  (1,'Cocina Caliente'),(2,'Cocina Fría'),(3,'Postres'),(4,'Bebidas');
INSERT INTO Producto(id_producto,id_seccion,nombre,descripcion,precio) VALUES
  (1,1,'Bife de Chorizo Tradicional','Guarnición: papas fritas o ensalada',14500.00),
  (2,1,'Pastel de Papas Criollo','Carne cortada a cuchillo gratinada',11200.00),
  (3,1,'Ravioles Caseros de Ricota','Salsa bolognesa o fileto artesanal',10800.00),
  (4,1,'Sorrentinos de Jamón y Queso','Masa casera con salsa cuatro quesos',11500.00),
  (5,1,'Milanesa de Ternera Napolitana','Jamón natural, mozzarella y orégano',12900.00),
  (6,1,'Risotto de Hongos de Pino','Arroz carnaroli y queso reggianito',13400.00),
  (7,3,'Flan Casero Mixto','Con dulce de leche y crema',3800.00),
  (8,3,'Fruta de Estación','Fruta fresca de temporada',3500.00),
  (9,4,'Copa Malbec Reserva','Copa de vino tinto reserva',3800.00),
  (10,4,'Agua Mineral','Con o sin gas',2800.00),
  (11,4,'Gaseosa','Línea clásica',3500.00),
  (12,2,'Ensalada César','Pollo grillado y aderezo César',9800.00),
  (13,2,'Tabla de Quesos','Selección de quesos de la casa',11000.00)
ON CONFLICT(id_producto) DO NOTHING;

-- Tablas técnicas auxiliares (no agregan campos a las entidades del DER).
CREATE TABLE IF NOT EXISTS Control_Acceso (
  id_usuario INTEGER PRIMARY KEY REFERENCES Usuario(id_usuario),
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0,1)),
  intentos_fallidos INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT
);
CREATE TABLE IF NOT EXISTS Datos_Operacion_Comanda (
  id_comanda INTEGER PRIMARY KEY REFERENCES Comanda(id_comanda),
  cantidad_comensales INTEGER NOT NULL CHECK(cantidad_comensales BETWEEN 1 AND 4)
);
CREATE TABLE IF NOT EXISTS Llave_Idempotencia (
  clave TEXT PRIMARY KEY,
  respuesta_json TEXT NOT NULL,
  fecha_hora_registro TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS Registro_Auditoria (
  id_registro INTEGER PRIMARY KEY,
  id_usuario INTEGER REFERENCES Usuario(id_usuario),
  accion TEXT NOT NULL,
  tipo_entidad TEXT NOT NULL,
  identificador_entidad TEXT NOT NULL,
  detalle_json TEXT NOT NULL DEFAULT '{}',
  fecha_hora TEXT NOT NULL DEFAULT (datetime('now'))
);
