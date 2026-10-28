import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here=path.dirname(fileURLToPath(import.meta.url));
const dbPath=process.env.DB_PATH?path.resolve(process.env.DB_PATH):path.join(here,'../db/entre-lineas.sqlite');
const schemaPath=path.join(here,'../db/schema.sql');
const db=new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
const count=name=>exists(name)?db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n:0;
if(exists('Detalle_Comanda')&&!db.prepare('PRAGMA table_info(Detalle_Comanda)').all().some(c=>c.name==='fecha_hora_envio')){
  const backup=`${dbPath}.pre-etapa3-${Date.now()}.bak`;
  await db.backup(backup);
  db.exec("ALTER TABLE Detalle_Comanda ADD COLUMN fecha_hora_envio TEXT NOT NULL DEFAULT ''");
  db.exec(`UPDATE Detalle_Comanda SET fecha_hora_envio=COALESCE((SELECT Comanda.fecha_hora FROM Comanda WHERE Comanda.id_comanda=Detalle_Comanda.id_comanda),datetime('now')) WHERE fecha_hora_envio=''`);
  console.log(`Migración de fecha_hora_envio aplicada; copia previa: ${path.basename(backup)}`);
}

function roleId(oldRole,username){
  if(username==='admin')return 5;
  return ({waiter:1,salon_manager:2,kitchen:3,cashier:4})[oldRole]||5;
}
function splitDisplayName(displayName){
  const parts=String(displayName||'Usuario Demo').trim().split(/\s+/).filter(Boolean);
  return {nombre:parts.shift()||'Usuario',apellido:parts.join(' ')||'Demo'};
}
function mapNumero(table){
  const digits=String(table.code||'').match(/\d+/);
  return digits?Number(digits[0]):Number(table.id);
}

const legacy=exists('dining_tables')&&!exists('Mesa');
if(legacy){
  const oldTables=db.prepare('SELECT * FROM dining_tables ORDER BY id').all();
  const oldUsers=exists('users')?db.prepare('SELECT * FROM users ORDER BY id').all():[];
  const oldProducts=exists('menu_items')?db.prepare('SELECT * FROM menu_items ORDER BY id').all():[];
  const transactional=['orders','order_items','payments','reservations','waitlist'];
  const nonEmpty=transactional.filter(t=>count(t)>0);
  const stamp=Date.now();
  await db.backup(`${dbPath}.pre-der-espanol-${stamp}.bak`);
  if(nonEmpty.length){
    db.close();
    throw new Error(`La copia de seguridad quedó guardada, pero no se migró la base porque hay datos operativos en: ${nonEmpty.join(', ')}. Se requiere revisar su conversión antes de continuar.`);
  }
  db.pragma('foreign_keys = OFF');
  const oldNames=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name);
  for(const name of oldNames)db.exec(`DROP TABLE IF EXISTS "${name.replaceAll('"','""')}"`);
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(schemaPath,'utf8'));
  const restoreTable=db.prepare('UPDATE Mesa SET numero=?,capacidad=?,estado=\'Libre\',hora_apertura=NULL WHERE id_mesa=?');
  for(const t of oldTables){const numero=mapNumero(t);restoreTable.run(numero,Math.max(1,Math.min(4,Number(t.capacity)||4)),Number(t.id));}
  const restoreProduct=db.prepare('INSERT INTO Producto(id_producto,nombre,descripcion,precio,id_seccion) VALUES(?,?,?,?,?) ON CONFLICT(id_producto) DO UPDATE SET nombre=excluded.nombre,descripcion=excluded.descripcion,precio=excluded.precio,id_seccion=excluded.id_seccion');
  for(const p of oldProducts){if(p.active)restoreProduct.run(Number(p.id),p.name,p.description||'',Number(p.price_cents)/100,Number(p.category_id));}
  const roleNames=['Mozo','Jefe_Salon','Cocina','Cajero','Administrador'];
  const restoreUser=db.prepare('INSERT OR IGNORE INTO Usuario(id_usuario,nombre,apellido,identificador_acceso,credencial,id_rol) VALUES(?,?,?,?,?,?)');
  const restoreAccess=db.prepare('INSERT OR IGNORE INTO Control_Acceso(id_usuario,activo) VALUES(?,?)');
  for(const u of oldUsers){const name=splitDisplayName(u.display_name);const rId=roleId(u.role,u.username);restoreUser.run(Number(u.id),name.nombre,name.apellido,u.username,u.password_hash,rId);restoreAccess.run(Number(u.id),u.active?1:0);}
  console.log(`Migración de nombres aplicada; copia anterior: ${path.basename(dbPath)}.pre-der-espanol-${stamp}.bak`);
}else{
  if(exists('dining_tables')){
    db.close();
    throw new Error('Se detectaron tablas de ambos modelos. No se modificó la base; resolver la migración antes de inicializar.');
  }
  db.exec(readFileSync(schemaPath,'utf8'));
}

const demoUsers=[
  ['jefe','Jefe','de Salón',2,'salon_manager'],
  ['mozo','Mozo','Demo',1,'waiter'],
  ['cocina','Cocina','Demo',3,'kitchen'],
  ['caja','Cajero','Demo',4,'cashier'],
  ['admin','Administrador','Demo',5,'admin']
];
const insertDemoUser=db.prepare(`INSERT OR IGNORE INTO Usuario(identificador_acceso,nombre,apellido,credencial,id_rol) VALUES(?,?,?,?,?)`);
const findUser=db.prepare('SELECT id_usuario FROM Usuario WHERE identificador_acceso=?');
const insertDemoAccess=db.prepare(`INSERT OR IGNORE INTO Control_Acceso(id_usuario,activo,intentos_fallidos,bloqueado_hasta) VALUES(?,1,0,NULL)`);
for(const [username,nombre,apellido,idRol] of demoUsers){
  insertDemoUser.run(username,nombre,apellido,bcrypt.hashSync('1234',10),idRol);
  insertDemoAccess.run(findUser.get(username).id_usuario);
}
db.pragma('foreign_key_check');
console.log('Base DER en español inicializada. Usuarios demo: mozo/jefe/cocina/caja/admin; PIN: 1234.');
db.close();
