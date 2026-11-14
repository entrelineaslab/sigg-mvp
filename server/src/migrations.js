import path from 'node:path';

const detailTableSql = `CREATE TABLE Detalle_Comanda_nuevo (
  id_detalle INTEGER PRIMARY KEY,
  id_comanda INTEGER NOT NULL REFERENCES Comanda(id_comanda),
  id_producto INTEGER NOT NULL REFERENCES Producto(id_producto),
  cantidad INTEGER NOT NULL CHECK(cantidad BETWEEN 1 AND 99),
  precio_unitario_historico DECIMAL(12,2) NOT NULL CHECK(precio_unitario_historico >= 0),
  observaciones TEXT NOT NULL DEFAULT '',
  fecha_hora_envio TEXT NOT NULL DEFAULT (datetime('now')),
  estado_elaboracion TEXT NOT NULL DEFAULT 'En_Preparacion'
    CHECK(estado_elaboracion IN ('En_Preparacion','Entregado','Cancelado'))
)`;

const comandaTableSql = `CREATE TABLE Comanda_nueva (
  id_comanda INTEGER PRIMARY KEY,
  id_mesa INTEGER NOT NULL REFERENCES Mesa(id_mesa),
  id_usuario INTEGER NOT NULL REFERENCES Usuario(id_usuario),
  fecha_hora TEXT NOT NULL DEFAULT (datetime('now')),
  estado TEXT NOT NULL DEFAULT 'En_Proceso' CHECK(estado IN ('En_Proceso','Cobrada_Cerrada','Cancelada'))
)`;

/** Rebuild an existing Comanda table whose CHECK predates the Cancelada state. */
export async function migrarEstadosComanda(db, dbPath) {
  const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Comanda'").get();
  if(!table)return {migrated:false,backup:null};
  if(/'Cancelada'/.test(table.sql||''))return {migrated:false,backup:null};
  const invalid=db.prepare("SELECT DISTINCT estado FROM Comanda WHERE estado NOT IN ('En_Proceso','Cobrada_Cerrada','Cancelada')").all();
  if(invalid.length)throw new Error(`Estados desconocidos en Comanda: ${invalid.map(row=>row.estado).join(', ')}`);
  const backup=`${path.resolve(dbPath)}.pre-comanda-cancelada-${Date.now()}.bak`;
  await db.backup(backup);
  db.pragma('foreign_keys = OFF');
  try{
    db.transaction(()=>{
      db.exec('DROP TABLE IF EXISTS Comanda_nueva');
      db.exec(comandaTableSql);
      db.exec(`INSERT INTO Comanda_nueva(id_comanda,id_mesa,id_usuario,fecha_hora,estado)
        SELECT id_comanda,id_mesa,id_usuario,fecha_hora,estado FROM Comanda ORDER BY id_comanda`);
      db.exec('DROP TABLE Comanda');
      db.exec('ALTER TABLE Comanda_nueva RENAME TO Comanda');
    })();
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_Comanda_mesa_en_proceso ON Comanda(id_mesa) WHERE estado='En_Proceso'");
    db.exec('CREATE INDEX IF NOT EXISTS ix_Comanda_fecha_hora ON Comanda(fecha_hora)');
    const violations=db.pragma('foreign_key_check');
    if(violations.length)throw new Error(`La migración produjo ${violations.length} violaciones de claves foráneas`);
    return {migrated:true,backup};
  }catch(error){
    throw new Error(`No se pudo migrar Comanda; la copia previa está en ${backup}. ${error.message}`,{cause:error});
  }finally{
    db.pragma('foreign_keys = ON');
  }
}

/**
 * Upgrade the former four-state item lifecycle to the official three-state model.
 * Creates a SQLite backup before rebuilding the table and is safe to re-run.
 */
export async function migrarEstadosDetalleComanda(db, dbPath) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Detalle_Comanda'").get();
  if (!table) return {migrated:false, backup:null};
  if (!db.prepare('PRAGMA table_info(Detalle_Comanda)').all().some(column=>column.name==='fecha_hora_envio')) {
    throw new Error('Migración de estados requiere ejecutar primero la migración fecha_hora_envio');
  }
  if (!/Pendiente/.test(table.sql||'')) return {migrated:false, backup:null};

  const unexpected = db.prepare(`SELECT DISTINCT estado_elaboracion AS estado
    FROM Detalle_Comanda WHERE estado_elaboracion NOT IN ('Pendiente','En_Preparacion','Entregado','Cancelado')`).all();
  if (unexpected.length) throw new Error(`Estados desconocidos en Detalle_Comanda: ${unexpected.map(row=>row.estado).join(', ')}`);

  const backup = `${path.resolve(dbPath)}.pre-estados-${Date.now()}.bak`;
  await db.backup(backup);
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(()=>{
      db.exec('DROP TABLE IF EXISTS Detalle_Comanda_nuevo');
      db.exec(detailTableSql);
      db.exec(`INSERT INTO Detalle_Comanda_nuevo
        (id_detalle,id_comanda,id_producto,cantidad,precio_unitario_historico,observaciones,fecha_hora_envio,estado_elaboracion)
        SELECT id_detalle,id_comanda,id_producto,cantidad,precio_unitario_historico,observaciones,fecha_hora_envio,
          CASE estado_elaboracion WHEN 'Pendiente' THEN 'En_Preparacion' ELSE estado_elaboracion END
        FROM Detalle_Comanda ORDER BY id_detalle`);
      db.exec('DROP TABLE Detalle_Comanda');
      db.exec('ALTER TABLE Detalle_Comanda_nuevo RENAME TO Detalle_Comanda');
    })();
    db.exec('CREATE INDEX IF NOT EXISTS ix_Detalle_Comanda_estado ON Detalle_Comanda(estado_elaboracion)');
    db.exec('CREATE INDEX IF NOT EXISTS ix_Detalle_Comanda_kds_fifo ON Detalle_Comanda(estado_elaboracion,fecha_hora_envio,id_detalle)');
    const violations = db.pragma('foreign_key_check');
    if (violations.length) throw new Error(`La migración produjo ${violations.length} violaciones de claves foráneas`);
    return {migrated:true, backup};
  } catch (error) {
    throw new Error(`No se pudo migrar Detalle_Comanda; la copia previa está en ${backup}. ${error.message}`, {cause:error});
  } finally {
    db.pragma('foreign_keys = ON');
  }
}
