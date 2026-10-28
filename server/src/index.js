import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {MINUTES,calcularTotalComanda,elapsedMs as domainElapsedMs,evaluarEstadoPermanencia,siguienteEstadoDetalle,validarCapacidadMesa} from './domain.js';
import {registerReservationRoutes} from './reservations.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const dbPath=process.env.DB_PATH?path.resolve(process.env.DB_PATH):path.join(here,'../db/entre-lineas.sqlite');
const db=new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
const hasTable=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
if(hasTable('Detalle_Comanda')&&!db.prepare('PRAGMA table_info(Detalle_Comanda)').all().some(c=>c.name==='fecha_hora_envio')){
  const backup=`${dbPath}.pre-etapa3-${Date.now()}.bak`;
  await db.backup(backup);
  db.exec("ALTER TABLE Detalle_Comanda ADD COLUMN fecha_hora_envio TEXT NOT NULL DEFAULT ''");
  db.exec(`UPDATE Detalle_Comanda SET fecha_hora_envio=COALESCE((SELECT Comanda.fecha_hora FROM Comanda WHERE Comanda.id_comanda=Detalle_Comanda.id_comanda),datetime('now')) WHERE fecha_hora_envio=''`);
  db.exec('CREATE INDEX IF NOT EXISTS ix_Detalle_Comanda_kds_fifo ON Detalle_Comanda(estado_elaboracion,fecha_hora_envio,id_detalle)');
  console.warn(`Migración fecha_hora_envio; respaldo ${path.basename(backup)}`);
}
const app=express();
const httpServer=createServer(app);
const io=new Server(httpServer,{cors:{origin:process.env.CLIENT_ORIGIN||'*'}});
app.use(cors({origin:process.env.CLIENT_ORIGIN||'*'}));
app.use(express.json({limit:'1mb'}));

const secret=process.env.JWT_SECRET||'dev-only-replace-this-secret-before-deployment';
const roleToApi={Mozo:'waiter',Jefe_Salon:'salon_manager',Cocina:'kitchen',Cajero:'cashier',Administrador:'admin'};
const rolePermissions={
  manager:['salon_manager'],
  waiter:['waiter','salon_manager'],
  kitchen:['kitchen'],
  cashier:['cashier']
};
const nowIso=()=>new Date().toISOString();
const toDate=s=>{const d=new Date(String(s).includes('T')?s:String(s).replace(' ','T')+'Z');return Number.isNaN(d.valueOf())?new Date():d};
const centsToAmount=cents=>Number((cents/100).toFixed(2));
const amountToCents=amount=>Math.round(Number(amount)*100);
const elapsedMs=stamp=>domainElapsedMs(toDate(stamp),Date.now());
const elapsedText=stamp=>{const m=Math.floor(elapsedMs(stamp)/60000);return`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`};
const apiStatus={Libre:'free',Reservada:'reserved',Alerta_Reserva:'alert_reservation',Ocupada:'occupied',Alerta_Permanencia:'alert'};
const detailStatus={Pendiente:'queued',En_Preparacion:'preparing',Entregado:'delivered',Cancelado:'void'};
const dbDetailStatus={queued:'Pendiente',preparing:'En_Preparacion',delivered:'Entregado',void:'Cancelado'};
// H33/H34: mantener hasta aprobación del equipo; no asumir el buffer propuesto de 40 min.
const RESERVATION_PREBLOCK_MINUTES=180;
const auth=(req,res,next)=>{try{req.user=jwt.verify((req.headers.authorization||'').replace(/^Bearer /,''),secret);next()}catch{return res.status(401).json({error:'Autenticación requerida'})}};
const allow=(...accepted)=>(req,res,next)=>accepted.includes(req.user.role)?next():res.status(403).json({error:'Acción no permitida para este perfil'});
io.use((socket,next)=>{try{socket.data.user=jwt.verify(socket.handshake.auth?.token,secret);next()}catch{next(new Error('Autenticación Socket.IO requerida'))}});
const emit=(event,payload)=>io.to('operators').emit(event,{...payload,emittedAt:nowIso()});
const emitCritical=(event,payload)=>{
  const emittedAt=nowIso(),started=performance.now(),recipients=io.sockets.adapter.rooms.get('operators')?.size||0;
  if(!recipients){io.to('operators').emit(event,{...payload,emittedAt});return;}
  io.to('operators').timeout(3000).emit(event,{...payload,emittedAt},err=>{
    const propagationMs=Math.round(performance.now()-started);
    if(err||propagationMs>3000){
      const details={evento:event,propagation_ms:propagationMs,receptores:recipients,timeout:Boolean(err)};
      audit(null,'Advertencia de propagación superior a 3 segundos','Evento',event,details);
      console.warn('[RNF-02] propagación lenta',JSON.stringify(details));
    }
  });
};
const audit=(user,action,type,id,details={})=>db.prepare(`INSERT INTO Registro_Auditoria(id_usuario,accion,tipo_entidad,identificador_entidad,detalle_json,fecha_hora)
  VALUES(?,?,?,?,?,?)`).run(user?.id||null,action,type,String(id),JSON.stringify(details),nowIso());
const openComandaForMesa=db.prepare(`SELECT c.*,u.nombre,u.apellido FROM Comanda c JOIN Usuario u ON u.id_usuario=c.id_usuario
  WHERE c.id_mesa=? AND c.estado='En_Proceso'`);

function syncMesaStates(){
  const tables=db.prepare('SELECT * FROM Mesa ORDER BY numero').all();
  const activeReservations=db.prepare(`SELECT * FROM Reserva WHERE estado='Confirmada'
    AND id_mesa IS NOT NULL AND datetime(fecha_hora_reserva) BETWEEN datetime('now','-15 minutes') AND datetime('now',?)
    ORDER BY fecha_hora_reserva`).all(`+${RESERVATION_PREBLOCK_MINUTES} minutes`);
  const setState=db.prepare('UPDATE Mesa SET estado=?,hora_apertura=? WHERE id_mesa=?');
  for(const mesa of tables){
    const comanda=openComandaForMesa.get(mesa.id_mesa);
    if(comanda){
      const opened=comanda.fecha_hora||nowIso();
      const estado=evaluarEstadoPermanencia(opened,Date.now());
      if(mesa.estado!==estado||!mesa.hora_apertura){
        setState.run(estado,opened,mesa.id_mesa);
        if(estado==='Alerta_Permanencia'&&mesa.estado!==estado)emitCritical('tables:changed',{tableId:mesa.id_mesa,reason:'Alerta_Permanencia'});
      }
      continue;
    }
    const reserva=activeReservations.find(r=>r.id_mesa===mesa.id_mesa);
    if(reserva){
      const late=elapsedMs(reserva.fecha_hora_reserva);
      const estado=late>=10*60000?'Alerta_Reserva':'Reservada';
      if(mesa.estado!==estado||mesa.hora_apertura!==null){setState.run(estado,null,mesa.id_mesa);if(estado==='Alerta_Reserva'){emit('reservations:alert',{id:reserva.id_reserva,guestName:reserva.nombre_cliente});emit('tables:changed',{tableId:mesa.id_mesa});}}
    }else if(mesa.estado!=='Libre'||mesa.hora_apertura!==null){
      setState.run('Libre',null,mesa.id_mesa);
    }
  }
}
function mesaDto(mesa){
  const estado=mesa.estado;
  const booking=mesa.id_reserva?{
    guest_name:mesa.nombre_cliente,reserved_for:mesa.fecha_hora_reserva,
    reservation_id:mesa.id_reserva,party_size:mesa.cantidad_comensales
  }:{};
  return{
    id:mesa.id_mesa,numero:mesa.numero,code:`M${String(mesa.numero).padStart(2,'0')}`,
    capacity:mesa.capacidad,status:apiStatus[estado]||'free',estado,
    order_id:mesa.id_comanda||null,party_size:mesa.cantidad_comensales_operativa||booking.party_size||null,
    opened_at:mesa.hora_apertura||null,elapsed:mesa.hora_apertura?elapsedText(mesa.hora_apertura):null,
    waiter_name:mesa.id_comanda?`${mesa.nombre||''} ${mesa.apellido||''}`.trim():null,
    ...booking
  };
}
function createComanda({idMesa,idUsuario,cantidadComensales}){
  const idComanda=db.prepare(`INSERT INTO Comanda(id_mesa,id_usuario,fecha_hora,estado) VALUES(?,?,?,'En_Proceso')`)
    .run(idMesa,idUsuario,nowIso()).lastInsertRowid;
  db.prepare('INSERT INTO Datos_Operacion_Comanda(id_comanda,cantidad_comensales) VALUES(?,?)').run(idComanda,cantidadComensales);
  db.prepare(`UPDATE Mesa SET estado='Ocupada',hora_apertura=? WHERE id_mesa=?`).run(nowIso(),idMesa);
  return idComanda;
}

app.get('/api/health',(_req,res)=>res.json({ok:true,service:'entre-lineas',database:'sqlite-local-der-es',time:nowIso()}));
app.post('/api/auth/login',(req,res)=>{
  const{username,password}=req.body||{};
  if(!username||!password)return res.status(400).json({error:'Perfil y PIN de 4 dígitos requeridos'});
  const user=db.prepare(`SELECT u.*,r.nombre_rol,ca.activo,ca.intentos_fallidos,ca.bloqueado_hasta
    FROM Usuario u JOIN Rol r ON r.id_rol=u.id_rol JOIN Control_Acceso ca ON ca.id_usuario=u.id_usuario
    WHERE u.identificador_acceso=?`).get(username);
  if(!user||!user.activo)return res.status(401).json({error:'PIN inválido'});
  if(user.bloqueado_hasta&&toDate(user.bloqueado_hasta)>new Date())return res.status(423).json({error:'Acceso bloqueado durante 60 segundos',lockedUntil:user.bloqueado_hasta});
  if(!bcrypt.compareSync(String(password),user.credencial)){
    const count=user.intentos_fallidos+1,locked=count>=5?new Date(Date.now()+60000).toISOString():null;
    db.prepare('UPDATE Control_Acceso SET intentos_fallidos=?,bloqueado_hasta=? WHERE id_usuario=?').run(locked?0:count,locked,user.id_usuario);
    return res.status(401).json({error:locked?'PIN incorrecto. Perfil bloqueado durante 60 segundos':'PIN inválido',...(locked?{lockedUntil:locked}:{})});
  }
  db.prepare('UPDATE Control_Acceso SET intentos_fallidos=0,bloqueado_hasta=NULL WHERE id_usuario=?').run(user.id_usuario);
  const payload={id:user.id_usuario,username:user.identificador_acceso,name:`${user.nombre} ${user.apellido}`.trim(),role:roleToApi[user.nombre_rol]};
  res.json({token:jwt.sign(payload,secret,{expiresIn:'12h'}),user:payload});
});

app.get('/api/tables',auth,allow(...rolePermissions.waiter),(_req,res)=>{
  syncMesaStates();
  const tables=db.prepare(`SELECT m.*,c.id_comanda,c.fecha_hora,u.nombre,u.apellido,oc.cantidad_comensales cantidad_comensales_operativa,
      r.id_reserva,r.nombre_cliente,r.fecha_hora_reserva,r.cantidad_comensales
    FROM Mesa m
    LEFT JOIN Comanda c ON c.id_mesa=m.id_mesa AND c.estado='En_Proceso'
    LEFT JOIN Usuario u ON u.id_usuario=c.id_usuario
    LEFT JOIN Datos_Operacion_Comanda oc ON oc.id_comanda=c.id_comanda
    LEFT JOIN Reserva r ON r.id_mesa=m.id_mesa AND r.estado='Confirmada'
      AND datetime(r.fecha_hora_reserva) BETWEEN datetime('now','-15 minutes') AND datetime('now',?)
    ORDER BY m.numero,r.fecha_hora_reserva`).all(`+${RESERVATION_PREBLOCK_MINUTES} minutes`);
  const seen=new Set();
  res.json(tables.filter(m=>{const key=m.id_mesa;if(seen.has(key))return false;seen.add(key);return true}).map(mesaDto));
});
app.post('/api/tables/open',auth,allow(...rolePermissions.waiter),(req,res)=>{
  const{tableId,partySize}=req.body||{};
  if(!Number.isInteger(tableId)||!validarCapacidadMesa(4,partySize))return res.status(400).json({error:'Mesa y comensales (1–4) son requeridos'});
  try{
    const idComanda=db.transaction(()=>{
      const mesa=db.prepare('SELECT * FROM Mesa WHERE id_mesa=?').get(tableId);
      if(!mesa)throw new Error('Mesa inexistente');
      if(!validarCapacidadMesa(mesa.capacidad,partySize))throw new Error('La cantidad supera la capacidad de la mesa');
      if(openComandaForMesa.get(tableId))throw new Error('La mesa ya tiene una comanda en proceso');
      if(db.prepare(`SELECT 1 FROM Reserva WHERE id_mesa=? AND estado='Confirmada'
        AND datetime(fecha_hora_reserva) BETWEEN datetime('now','-15 minutes') AND datetime('now',?)`).get(tableId,`+${RESERVATION_PREBLOCK_MINUTES} minutes`))throw new Error('La mesa tiene una reserva vigente');
      const id=createComanda({idMesa:tableId,idUsuario:req.user.id,cantidadComensales:partySize});
      audit(req.user,'Comanda abierta','Mesa',tableId,{cantidad_comensales:partySize,id_comanda:id});
      return id;
    })();
    emit('tables:changed',{tableId});res.status(201).json({id:idComanda,id_comanda:idComanda,id_mesa:tableId,party_size:partySize});
  }catch(e){res.status(400).json({error:e.message})}
});
app.get('/api/menu',auth,allow(...rolePermissions.waiter,...rolePermissions.kitchen,...rolePermissions.cashier),(_req,res)=>res.json(db.prepare(`SELECT p.id_producto id,p.nombre AS name,p.descripcion,
    CAST(ROUND(p.precio*100) AS INTEGER) price_cents,s.nombre category,p.id_seccion
  FROM Producto p JOIN Seccion_Producto s ON s.id_seccion=p.id_seccion ORDER BY p.id_seccion,p.nombre`).all()));
app.post('/api/orders',auth,allow(...rolePermissions.waiter),(req,res)=>{
  const key=req.get('Idempotency-Key')||req.body?.clientId;
  if(!key)return res.status(400).json({error:'Falta Idempotency-Key para impedir duplicados'});
  const cached=db.prepare('SELECT respuesta_json FROM Llave_Idempotencia WHERE clave=?').get(key);
  if(cached)return res.json(JSON.parse(cached.respuesta_json));
  const{tableId,partySize,items}=req.body||{};
  if(!Number.isInteger(tableId)||!validarCapacidadMesa(4,partySize)||!Array.isArray(items)||!items.length)return res.status(400).json({error:'Mesa, comensales (1–4) y al menos un plato son obligatorios'});
  try{
    const result=db.transaction(()=>{
      const mesa=db.prepare('SELECT * FROM Mesa WHERE id_mesa=?').get(tableId);
      if(!mesa)throw new Error('Mesa inexistente');
      if(!validarCapacidadMesa(mesa.capacidad,partySize))throw new Error('La cantidad supera la capacidad de la mesa');
      const comanda=openComandaForMesa.get(tableId);
      if(!comanda)throw new Error('Primero hay que abrir la mesa');
      db.prepare('UPDATE Datos_Operacion_Comanda SET cantidad_comensales=? WHERE id_comanda=?').run(partySize,comanda.id_comanda);
      const sentAt=nowIso();
      const add=db.prepare(`INSERT INTO Detalle_Comanda(id_comanda,id_producto,cantidad,precio_unitario_historico,observaciones,fecha_hora_envio,estado_elaboracion)
        VALUES(?,?,?,?,?,?,'Pendiente')`);
      for(const item of items){
        const producto=db.prepare('SELECT * FROM Producto WHERE id_producto=?').get(item.menuItemId);
        const qty=Number(item.quantity);
        if(!producto)throw new Error('Producto no disponible');
        if(!Number.isInteger(qty)||qty<1||qty>99)throw new Error('Cantidad inválida');
        add.run(comanda.id_comanda,producto.id_producto,qty,producto.precio,String(item.notes??''),sentAt);
      }
      audit(req.user,'Detalle de comanda agregado','Comanda',comanda.id_comanda,{cantidad_items:items.length});
      const response={
        orderId:comanda.id_comanda,tableId,
        items:db.prepare(`SELECT d.id_detalle item_id,p.nombre,d.cantidad quantity,d.observaciones notes,d.fecha_hora_envio sent_at,d.estado_elaboracion status
          FROM Detalle_Comanda d JOIN Producto p ON p.id_producto=d.id_producto WHERE d.id_comanda=? ORDER BY d.id_detalle DESC LIMIT ?`)
          .all(comanda.id_comanda,items.length).map(x=>({...x,status:detailStatus[x.status],category_id:db.prepare('SELECT id_seccion FROM Producto WHERE id_producto=(SELECT id_producto FROM Detalle_Comanda WHERE id_detalle=?)').get(x.item_id)?.id_seccion}))
      };
      db.prepare('INSERT INTO Llave_Idempotencia(clave,respuesta_json) VALUES(?,?)').run(key,JSON.stringify(response));
      return response;
    })();
    emitCritical('order:created',{tableId,orderId:result.orderId});emitCritical('kds:nueva_comanda',{tableId,orderId:result.orderId});emit('tables:changed',{tableId});emit('kds:changed',{});
    res.status(201).json(result);
  }catch(e){res.status(400).json({error:e.message})}
});
app.get('/api/orders/by-table/:tableId',auth,allow(...rolePermissions.waiter),(req,res)=>{
  const comanda=openComandaForMesa.get(Number(req.params.tableId));
  if(!comanda)return res.json([]);
  res.json(db.prepare(`SELECT d.id_detalle id,p.nombre,d.cantidad quantity,d.observaciones notes,
    d.estado_elaboracion,d.fecha_hora_envio sent_at,d.fecha_hora_envio created_at FROM Detalle_Comanda d
    JOIN Producto p ON p.id_producto=d.id_producto JOIN Comanda c ON c.id_comanda=d.id_comanda
    WHERE d.id_comanda=? AND d.estado_elaboracion!='Cancelado' ORDER BY d.fecha_hora_envio,d.id_detalle`)
    .all(comanda.id_comanda).map(x=>({...x,status:detailStatus[x.estado_elaboracion]})));
});
const activeItemQuery=`SELECT d.id_detalle item_id,c.id_comanda order_id,printf('M%02d',m.numero) table_code,
  s.nombre category,p.nombre item_name,d.cantidad quantity,d.observaciones notes,d.fecha_hora_envio sent_at,
  d.estado_elaboracion FROM Detalle_Comanda d JOIN Comanda c ON c.id_comanda=d.id_comanda
  JOIN Mesa m ON m.id_mesa=c.id_mesa JOIN Producto p ON p.id_producto=d.id_producto
  JOIN Seccion_Producto s ON s.id_seccion=p.id_seccion
  WHERE c.estado='En_Proceso' AND d.estado_elaboracion IN ('Pendiente','En_Preparacion')`;
const itemDto=rows=>rows.map(x=>({...x,created_at:x.sent_at,status:detailStatus[x.estado_elaboracion],delayed:elapsedMs(x.sent_at)>25*MINUTES}));
app.get('/api/kds',auth,allow(...rolePermissions.kitchen),(_req,res)=>{
  res.json(itemDto(db.prepare(`${activeItemQuery} ORDER BY d.fecha_hora_envio,d.id_detalle`).all()));
});
app.get('/api/dispatch/items',auth,allow(...rolePermissions.waiter),(_req,res)=>{
  res.json(itemDto(db.prepare(`${activeItemQuery} ORDER BY d.fecha_hora_envio,d.id_detalle`).all()));
});
app.patch('/api/order-items/:id/status',auth,allow(...rolePermissions.waiter),(req,res)=>{
  const{status}=req.body||{},target=dbDetailStatus[status];
  if(!target||!['En_Preparacion','Entregado'].includes(target))return res.status(400).json({error:'El cambio debe ser secuencial: Pendiente → En_Preparacion → Entregado'});
  const item=db.prepare(`SELECT d.*,c.estado estado_comanda,c.id_mesa,m.numero
    FROM Detalle_Comanda d JOIN Comanda c ON c.id_comanda=d.id_comanda
    JOIN Mesa m ON m.id_mesa=c.id_mesa WHERE d.id_detalle=?`).get(req.params.id);
  if(!item)return res.status(404).json({error:'Ítem no encontrado'});
  if(item.estado_elaboracion==='Cancelado')return res.status(400).json({error:'El ítem está cancelado'});
  if(item.estado_comanda!=='En_Proceso')return res.status(400).json({error:'La comanda ya está cerrada'});
  if(item.estado_elaboracion===target||item.estado_elaboracion==='Entregado')return res.json({ok:true,alreadyApplied:true,itemId:item.id_detalle,status:detailStatus[item.estado_elaboracion],tableId:item.id_mesa});
  if(siguienteEstadoDetalle(item.estado_elaboracion)!==target)return res.status(409).json({error:`Transición inválida desde ${item.estado_elaboracion}`});
  const elapsed=elapsedMs(item.fecha_hora_envio);
  if(req.user.role==='salon_manager'&&elapsed<=25*MINUTES)return res.status(403).json({error:'La intervención del Jefe está disponible solo después de superar 25 minutos desde el envío a cocina',remainingMs:25*MINUTES-elapsed});
  const result=db.transaction(()=>{
    const updated=db.prepare('UPDATE Detalle_Comanda SET estado_elaboracion=? WHERE id_detalle=? AND estado_elaboracion=?').run(target,item.id_detalle,item.estado_elaboracion);
    if(!updated.changes)throw new Error('El estado cambió en otra terminal; actualiza la pantalla');
    const action=target==='Entregado'?'Entrega confirmada en mesa':'Inicio de preparación registrado';
    audit(req.user,req.user.role==='salon_manager'?`Intervención jerárquica: ${action}`:action,'Detalle_Comanda',item.id_detalle,{id_comanda:item.id_comanda,id_mesa:item.id_mesa,estado_anterior:item.estado_elaboracion,estado_nuevo:target,demora_ms:elapsed});
    return updated.changes;
  })();
  const code=`M${String(item.numero).padStart(2,'0')}`;
  emit('kds:changed',{itemId:item.id_detalle,status:detailStatus[target]});
  if(target==='Entregado')emitCritical('delivery:confirmed',{itemId:item.id_detalle,orderId:item.id_comanda,tableId:item.id_mesa,tableCode:code});
  emit('tables:changed',{tableId:item.id_mesa});
  res.json({ok:true,itemId:item.id_detalle,status:detailStatus[target],tableId:item.id_mesa,tableCode:code,changed:result>0});
});
app.get('/api/cashier/orders',auth,allow(...rolePermissions.cashier),(req,res)=>{
  const rows=db.prepare(`SELECT c.id_comanda id,c.id_mesa table_id,printf('M%02d',m.numero) table_code,
    COALESCE(oc.cantidad_comensales,(SELECT r.cantidad_comensales FROM Reserva r WHERE r.id_mesa=m.id_mesa AND r.estado='Arribo_Confirmado' ORDER BY r.fecha_hora_reserva DESC LIMIT 1),m.capacidad) party_size,
    c.fecha_hora opened_at,trim(u.nombre||' '||u.apellido) waiter_name,
    COUNT(CASE WHEN d.estado_elaboracion!='Cancelado' THEN d.id_detalle END) item_count,
    SUM(CASE WHEN d.estado_elaboracion='Entregado' THEN 1 ELSE 0 END) delivered_count,
    COALESCE(SUM(CASE WHEN d.estado_elaboracion!='Cancelado' THEN d.cantidad*CAST(ROUND(d.precio_unitario_historico*100) AS INTEGER) ELSE 0 END),0) total_cents
    FROM Comanda c JOIN Mesa m ON m.id_mesa=c.id_mesa JOIN Usuario u ON u.id_usuario=c.id_usuario
    LEFT JOIN Datos_Operacion_Comanda oc ON oc.id_comanda=c.id_comanda LEFT JOIN Detalle_Comanda d ON d.id_comanda=c.id_comanda
    WHERE c.estado='En_Proceso' GROUP BY c.id_comanda ORDER BY c.fecha_hora`).all();
  res.json(rows);
});
app.get('/api/cashier/orders/:id',auth,allow(...rolePermissions.cashier),(req,res)=>{
  const comanda=db.prepare(`SELECT id_comanda FROM Comanda WHERE id_comanda=? AND estado='En_Proceso'`).get(req.params.id);
  if(!comanda)return res.status(404).json({error:'Cuenta abierta no encontrada'});
  const rows=db.prepare(`SELECT d.id_detalle id,p.nombre,d.cantidad quantity,
    CAST(ROUND(d.precio_unitario_historico*100) AS INTEGER) unit_price_cents,d.estado_elaboracion
    FROM Detalle_Comanda d JOIN Producto p ON p.id_producto=d.id_producto
    WHERE d.id_comanda=? AND d.estado_elaboracion!='Cancelado' ORDER BY d.id_detalle`).all(comanda.id_comanda);
  res.json(rows.map(x=>({...x,status:detailStatus[x.estado_elaboracion]})));
});
app.post('/api/cashier/orders/:orderId/items/:itemId/cancel',auth,allow(...rolePermissions.cashier),(req,res)=>{
  try{
    const result=db.transaction(()=>{
      const item=db.prepare(`SELECT d.*,c.estado estado_comanda,c.id_mesa FROM Detalle_Comanda d JOIN Comanda c ON c.id_comanda=d.id_comanda WHERE d.id_detalle=? AND d.id_comanda=?`)
        .get(req.params.itemId,req.params.orderId);
      if(!item||item.estado_comanda!=='En_Proceso')throw new Error('Ítem o cuenta activa no encontrada');
      if(!['Pendiente','En_Preparacion'].includes(item.estado_elaboracion))throw new Error('Solo puede anularse un plato pendiente o en preparación');
      const changed=db.prepare(`UPDATE Detalle_Comanda SET estado_elaboracion='Cancelado' WHERE id_detalle=? AND estado_elaboracion=?`).run(item.id_detalle,item.estado_elaboracion);
      if(!changed.changes)throw new Error('El estado cambió en otra terminal');
      audit(req.user,'Plato no elaborado anulado en Caja','Detalle_Comanda',item.id_detalle,{id_comanda:item.id_comanda,estado_anterior:item.estado_elaboracion});
      const rows=db.prepare(`SELECT cantidad,precio_unitario_historico FROM Detalle_Comanda WHERE id_comanda=? AND estado_elaboracion!='Cancelado'`).all(item.id_comanda);
      return{orderId:item.id_comanda,tableId:item.id_mesa,totalCents:calcularTotalComanda(rows)};
    })();
    emit('kds:changed',{itemId:Number(req.params.itemId),status:'void'});emit('tables:changed',{tableId:result.tableId});res.json(result);
  }catch(e){res.status(400).json({error:e.message})}
});
app.post('/api/payments/close',auth,allow(...rolePermissions.cashier),(req,res)=>{
  const{orderId,payments,simulateRejection=false}=req.body||{};
  if(!Number.isInteger(orderId)||!Array.isArray(payments)||payments.length!==1)return res.status(400).json({error:'El DER admite una sola transacción de cobro por comanda'});
  const methodMap={cash:'Efectivo',debit:'Tarjeta_Debito',credit:'Tarjeta_Credito',qr:'Transferencia_QR'};
  const selectedPayment=payments[0],selectedMethod=methodMap[selectedPayment.method];
  if(!selectedMethod)return res.status(400).json({error:'Debe seleccionar un medio de pago válido'});
  if(simulateRejection){
    if(selectedPayment.method==='cash')return res.status(400).json({error:'El efectivo no admite rechazo electrónico'});
    const active=db.prepare(`SELECT id_comanda FROM Comanda WHERE id_comanda=? AND estado='En_Proceso'`).get(orderId);
    if(!active)return res.status(404).json({error:'Cuenta abierta no encontrada'});
    audit(req.user,'Rechazo electrónico simulado','Comanda',orderId,{medio_pago:selectedMethod,simulado:true});
    return res.status(402).json({error:'Pago electrónico rechazado. La cuenta y la mesa siguen abiertas; seleccione otro medio o reintente.',paymentRejected:true});
  }
  try{
    const result=db.transaction(()=>{
      const comanda=db.prepare(`SELECT * FROM Comanda WHERE id_comanda=? AND estado='En_Proceso'`).get(orderId);
      if(!comanda)throw new Error('Cuenta abierta no encontrada');
      const pendiente=db.prepare(`SELECT COUNT(*) n FROM Detalle_Comanda WHERE id_comanda=? AND estado_elaboracion NOT IN ('Entregado','Cancelado')`).get(orderId).n;
      if(pendiente)throw new Error('No se puede cobrar: todos los platos deben estar entregados por el mozo');
      const totalCents=calcularTotalComanda(db.prepare(`SELECT cantidad,precio_unitario_historico FROM Detalle_Comanda WHERE id_comanda=? AND estado_elaboracion!='Cancelado'`).all(orderId));
      const payment=payments[0],medioPago=methodMap[payment.method];
      if(!medioPago||!Number.isInteger(payment.amountCents)||payment.amountCents<0)throw new Error('Medio o importe de pago inválido');
      if(payment.amountCents!==totalCents)throw new Error(`El total debe coincidir con ${totalCents} centavos`);
      db.prepare(`INSERT INTO Transaccion_Cobro(id_comanda,id_usuario,fecha_hora,total,medio_pago) VALUES(?,?,?,?,?)`)
        .run(orderId,req.user.id,nowIso(),centsToAmount(totalCents),medioPago);
      const closed=db.prepare(`UPDATE Comanda SET estado='Cobrada_Cerrada' WHERE id_comanda=? AND estado='En_Proceso'`).run(orderId);
      if(!closed.changes)throw new Error('La comanda cambió de estado en otra terminal');
      db.prepare(`UPDATE Mesa SET estado='Libre',hora_apertura=NULL WHERE id_mesa=?`).run(comanda.id_mesa);
      audit(req.user,'Transacción de cobro registrada','Comanda',orderId,{total:centsToAmount(totalCents),medio_pago:medioPago});
      return{orderId,totalCents,tableId:comanda.id_mesa};
    })();
    emit('tables:changed',{tableId:result.tableId});emitCritical('payment:closed',result);res.json(result);
  }catch(e){res.status(400).json({error:e.message})}
});

const reservationRuntime=registerReservationRoutes({app,db,auth,managerAuth:allow(...rolePermissions.manager),emit,emitCritical,audit,nowIso,syncMesaStates,createComanda,openComandaForMesa});
setInterval(()=>{
  try{reservationRuntime.processNoShows();syncMesaStates();}
  catch(error){console.error('Error en el monitor temporal del servidor',error);}
},1000).unref();
io.on('connection',socket=>{
  if(socket.data.user?.role!=='admin')socket.join('operators');
  socket.emit('system:connected',{serverTime:nowIso()});
});
const port=Number(process.env.PORT||3001);
httpServer.listen(port,'0.0.0.0',()=>console.log(`Entre Líneas API + Socket.IO en http://0.0.0.0:${port}`));
