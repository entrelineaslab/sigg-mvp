import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {migrarEstadosComanda,migrarEstadosDetalleComanda} from '../src/migrations.js';

test('migra Detalle_Comanda desde Pendiente al CHECK oficial y conserva datos',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'entre-lineas-migration-'));
  const dbPath=path.join(directory,'migration.sqlite');
  const db=new Database(dbPath);
  t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true})});
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE Comanda(id_comanda INTEGER PRIMARY KEY);
    CREATE TABLE Producto(id_producto INTEGER PRIMARY KEY);
    INSERT INTO Comanda VALUES(10);
    INSERT INTO Producto VALUES(20);
    CREATE TABLE Detalle_Comanda(
      id_detalle INTEGER PRIMARY KEY,
      id_comanda INTEGER NOT NULL REFERENCES Comanda(id_comanda),
      id_producto INTEGER NOT NULL REFERENCES Producto(id_producto),
      cantidad INTEGER NOT NULL CHECK(cantidad BETWEEN 1 AND 99),
      precio_unitario_historico DECIMAL(12,2) NOT NULL,
      observaciones TEXT NOT NULL DEFAULT '',
      fecha_hora_envio TEXT NOT NULL DEFAULT (datetime('now')),
      estado_elaboracion TEXT NOT NULL DEFAULT 'Pendiente' CHECK(estado_elaboracion IN ('Pendiente','En_Preparacion','Entregado','Cancelado'))
    );
    CREATE INDEX ix_Detalle_Comanda_estado ON Detalle_Comanda(estado_elaboracion);
    CREATE INDEX ix_Detalle_Comanda_kds_fifo ON Detalle_Comanda(estado_elaboracion,fecha_hora_envio,id_detalle);
    INSERT INTO Detalle_Comanda VALUES(1,10,20,2,1250.50,'sin sal','2026-10-01T12:00:00.000Z','Pendiente');
    INSERT INTO Detalle_Comanda VALUES(2,10,20,1,800,'bien cocido','2026-10-01T12:01:00.000Z','Entregado');
  `);

  const result=await migrarEstadosDetalleComanda(db,dbPath);
  assert.equal(result.migrated,true);
  assert.ok(existsSync(result.backup),'se conserva el backup anterior');
  assert.deepEqual(db.prepare('SELECT id_detalle,cantidad,precio_unitario_historico,observaciones,fecha_hora_envio,estado_elaboracion FROM Detalle_Comanda ORDER BY id_detalle').all(),[
    {id_detalle:1,cantidad:2,precio_unitario_historico:1250.5,observaciones:'sin sal',fecha_hora_envio:'2026-10-01T12:00:00.000Z',estado_elaboracion:'En_Preparacion'},
    {id_detalle:2,cantidad:1,precio_unitario_historico:800,observaciones:'bien cocido',fecha_hora_envio:'2026-10-01T12:01:00.000Z',estado_elaboracion:'Entregado'}
  ]);
  const createSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='Detalle_Comanda'").get().sql;
  assert.equal(createSql.includes("'Pendiente'"),false,'la tabla ya no admite el valor eliminado');
  assert.throws(()=>db.prepare('UPDATE Detalle_Comanda SET estado_elaboracion=? WHERE id_detalle=1').run('Pendiente'),/CHECK constraint failed/);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name IN ('ix_Detalle_Comanda_estado','ix_Detalle_Comanda_kds_fifo')").get().n,2);
  const second=await migrarEstadosDetalleComanda(db,dbPath);
  assert.equal(second.migrated,false,'segunda ejecución no vuelve a reconstruir ni respaldar');
});

test('amplía el CHECK de Comanda para admitir Cancelada y conserva registros relacionados',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'entre-lineas-comanda-migration-'));
  const dbPath=path.join(directory,'migration.sqlite');
  const db=new Database(dbPath);
  t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true})});
  db.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE Mesa(id_mesa INTEGER PRIMARY KEY);
    CREATE TABLE Usuario(id_usuario INTEGER PRIMARY KEY);
    INSERT INTO Mesa VALUES(4); INSERT INTO Usuario VALUES(7);
    CREATE TABLE Comanda(id_comanda INTEGER PRIMARY KEY,id_mesa INTEGER NOT NULL REFERENCES Mesa(id_mesa),id_usuario INTEGER NOT NULL REFERENCES Usuario(id_usuario),fecha_hora TEXT NOT NULL DEFAULT (datetime('now')),estado TEXT NOT NULL DEFAULT 'En_Proceso' CHECK(estado IN ('En_Proceso','Cobrada_Cerrada')));
    CREATE UNIQUE INDEX ux_Comanda_mesa_en_proceso ON Comanda(id_mesa) WHERE estado='En_Proceso';
    CREATE INDEX ix_Comanda_fecha_hora ON Comanda(fecha_hora);
    INSERT INTO Comanda VALUES(12,4,7,'2026-11-14T10:00:00.000Z','En_Proceso');
    CREATE TABLE Detalle_Comanda(id_detalle INTEGER PRIMARY KEY,id_comanda INTEGER NOT NULL REFERENCES Comanda(id_comanda));
    CREATE TABLE Datos_Operacion_Comanda(id_comanda INTEGER PRIMARY KEY REFERENCES Comanda(id_comanda),cantidad_comensales INTEGER NOT NULL);
    CREATE TABLE Transaccion_Cobro(id_cobro INTEGER PRIMARY KEY,id_comanda INTEGER NOT NULL UNIQUE REFERENCES Comanda(id_comanda));
    INSERT INTO Detalle_Comanda VALUES(31,12);
    INSERT INTO Datos_Operacion_Comanda VALUES(12,3);
  `);

  const result=await migrarEstadosComanda(db,dbPath);
  assert.equal(result.migrated,true);
  assert.ok(existsSync(result.backup),'se crea copia previa de la base');
  db.prepare("UPDATE Comanda SET estado='Cancelada' WHERE id_comanda=12").run();
  assert.equal(db.prepare('SELECT estado FROM Comanda WHERE id_comanda=12').get().estado,'Cancelada');
  assert.equal(db.prepare('SELECT id_comanda FROM Detalle_Comanda WHERE id_detalle=31').get().id_comanda,12);
  assert.equal(db.prepare('SELECT cantidad_comensales FROM Datos_Operacion_Comanda WHERE id_comanda=12').get().cantidad_comensales,3);
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name IN ('ux_Comanda_mesa_en_proceso','ix_Comanda_fecha_hora')").get().n,2);
  const second=await migrarEstadosComanda(db,dbPath);
  assert.equal(second.migrated,false,'la migración puede ejecutarse más de una vez sin reconstrucciones');
});
