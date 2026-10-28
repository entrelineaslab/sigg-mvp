import test,{before,after}from'node:test';
import assert from'node:assert/strict';
import {spawn,execFileSync}from'node:child_process';
import {mkdtempSync,rmSync}from'node:fs';
import {tmpdir}from'node:os';
import path from'node:path';
import net from'node:net';
import {fileURLToPath}from'node:url';
import Database from'better-sqlite3';
import {io as connectSocket}from'socket.io-client';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const temp=mkdtempSync(path.join(tmpdir(),'entre-lineas-test-'));
const dbPath=path.join(temp,'integration.sqlite'),secret='integration-only-secret';
let server,base,port;
function localDate(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
async function freePort(){return await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const value=s.address().port;s.close(()=>resolve(value))})})}
async function request(route,token,method='GET',body,headers={}){
  const response=await fetch(`${base}/api${route}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  let data={};try{data=await response.json()}catch{}
  return{status:response.status,data};
}
async function login(username){const result=await request('/auth/login',null,'POST',{username,password:'1234'});assert.equal(result.status,200,result.data.error);return result.data.token}

before(async()=>{
  port=await freePort();base=`http://127.0.0.1:${port}`;
  const env={...process.env,DB_PATH:dbPath,JWT_SECRET:secret,PORT:String(port),CLIENT_ORIGIN:'*'};
  execFileSync(process.execPath,['src/init-db.js'],{cwd:path.join(root,'server'),env,stdio:'ignore'});
  const seeded=new Database(dbPath),mozoId=seeded.prepare("SELECT id_usuario FROM Usuario WHERE identificador_acceso='mozo'").get().id_usuario;
  const originalPrice=seeded.prepare('SELECT precio FROM Producto WHERE id_producto=1').get().precio;
  const originalHash=seeded.prepare("SELECT credencial FROM Usuario WHERE identificador_acceso='mozo'").get().credencial;
  seeded.prepare('UPDATE Producto SET precio=777.77 WHERE id_producto=1').run();
  seeded.prepare("UPDATE Control_Acceso SET activo=0,intentos_fallidos=3,bloqueado_hasta='2030-01-01T00:00:00.000Z' WHERE id_usuario=?").run(mozoId);
  seeded.close();
  execFileSync(process.execPath,['src/init-db.js'],{cwd:path.join(root,'server'),env,stdio:'ignore'});
  const verified=new Database(dbPath);
  assert.equal(verified.prepare('SELECT precio FROM Producto WHERE id_producto=1').get().precio,777.77,'la inicialización no sobrescribe un precio administrado');
  assert.equal(verified.prepare("SELECT credencial FROM Usuario WHERE identificador_acceso='mozo'").get().credencial,originalHash,'la inicialización no restablece el PIN de una cuenta existente');
  assert.deepEqual(verified.prepare('SELECT activo,intentos_fallidos,bloqueado_hasta FROM Control_Acceso WHERE id_usuario=?').get(mozoId),{activo:0,intentos_fallidos:3,bloqueado_hasta:'2030-01-01T00:00:00.000Z'},'la inicialización conserva estado de acceso');
  verified.prepare('UPDATE Producto SET precio=? WHERE id_producto=1').run(originalPrice);
  verified.prepare("UPDATE Control_Acceso SET activo=1,intentos_fallidos=0,bloqueado_hasta=NULL WHERE id_usuario=?").run(mozoId);
  verified.close();
  server=spawn(process.execPath,['src/index.js'],{cwd:path.join(root,'server'),env,stdio:'ignore'});
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    try{const response=await fetch(`${base}/api/health`);if(response.ok){ready=true;break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(ready,true,'API de pruebas no inició');
});
after(async()=>{
  if(server&&server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await stopped}
  rmSync(temp,{recursive:true,force:true});
});

test('PI: permisos, comanda idempotente, ciclo de ítem, lista FIFO y caja transaccional',async()=>{
  const admin=await login('admin'),mozo=await login('mozo'),jefe=await login('jefe'),cocina=await login('cocina'),caja=await login('caja');
  assert.equal((await request('/tables',admin)).status,403,'Administrador no debe acceder al salón');
  assert.equal((await request('/menu',admin)).status,403,'Administrador no debe acceder a la carta');
  assert.equal((await request('/reservations',mozo)).status,403,'Mozo no administra reservas');
  assert.equal((await request('/kds',jefe)).status,403,'Jefe no accede al KDS general');
  assert.equal((await request('/kds',cocina)).status,200,'Cocina sí consulta el KDS read-only');

  const tables=(await request('/tables',mozo)).data,table=tables.find(item=>item.status==='free');
  const opened=await request('/tables/open',mozo,'POST',{tableId:table.id,partySize:2});
  assert.equal(opened.status,201,opened.data.error);
  const key=`integration-${Date.now()}`,notes='Alergia e indicación culinaria '.repeat(25);
  const orderBody={tableId:table.id,partySize:2,items:[{menuItemId:1,quantity:1,notes},{menuItemId:2,quantity:1,notes:''}]};
  const sent=await request('/orders',mozo,'POST',orderBody,{'Idempotency-Key':key});
  assert.equal(sent.status,201,sent.data.error);
  const replay=await request('/orders',mozo,'POST',orderBody,{'Idempotency-Key':key});
  assert.equal(replay.status,200);
  assert.equal(replay.data.orderId,sent.data.orderId);
  const db=new Database(dbPath);
  const rows=db.prepare('SELECT * FROM Detalle_Comanda WHERE id_comanda=? ORDER BY id_detalle').all(sent.data.orderId);
  assert.equal(rows.length,2,'el reintento no debe duplicar ítems');
  assert.equal(rows[0].observaciones,notes,'observaciones completas, sin recorte');
  assert.ok(rows[0].fecha_hora_envio,'fecha_hora_envio debe persistirse por ítem');

  const first=rows[0],second=rows[1];
  const skip=await request(`/order-items/${first.id_detalle}/status`,mozo,'PATCH',{status:'delivered'});
  assert.equal(skip.status,409,'no debe saltarse En_Preparacion');
  const kitchenMutation=await request(`/order-items/${first.id_detalle}/status`,cocina,'PATCH',{status:'preparing'});
  assert.equal(kitchenMutation.status,403,'la pantalla de Cocina permanece de solo lectura');
  const waiterStart=await request(`/order-items/${first.id_detalle}/status`,mozo,'PATCH',{status:'preparing'});
  assert.equal(waiterStart.status,200,waiterStart.data.error);
  const waiterDeliver=await request(`/order-items/${first.id_detalle}/status`,mozo,'PATCH',{status:'delivered'});
  assert.equal(waiterDeliver.status,200,waiterDeliver.data.error);
  const managerEarly=await request(`/order-items/${second.id_detalle}/status`,jefe,'PATCH',{status:'preparing'});
  assert.equal(managerEarly.status,403,'Jefe no debe intervenir antes de 25 minutos');
  db.prepare('UPDATE Detalle_Comanda SET fecha_hora_envio=? WHERE id_detalle=?').run(new Date(Date.now()-26*60_000).toISOString(),second.id_detalle);
  const managerStart=await request(`/order-items/${second.id_detalle}/status`,jefe,'PATCH',{status:'preparing'});
  assert.equal(managerStart.status,200,managerStart.data.error);
  const managerDeliver=await request(`/order-items/${second.id_detalle}/status`,jefe,'PATCH',{status:'delivered'});
  assert.equal(managerDeliver.status,200,managerDeliver.data.error);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM Registro_Auditoria WHERE accion LIKE 'Intervención jerárquica:%'").get().n>0);

  const future=new Date(Date.now()+6*60*60_000).toISOString();
  const futureReservation=await request('/reservations',jefe,'POST',{guestName:'Reserva futura',phone:'555',partySize:2,tableId:table.id,reservedFor:future,turno:'Noche'});
  assert.equal(futureReservation.status,201,futureReservation.data.error);
  assert.equal(futureReservation.data.status,'Confirmada','la ocupación actual no debe bloquear una reserva posterior');
  const resDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(future));
  const filteredReservations=await request(`/reservations?fecha=${resDate}&turno=Noche`,jefe);
  assert.ok(filteredReservations.data.some(item=>item.id===futureReservation.data.id),'filtra reservas por fecha y turno');
  const edited=await request(`/reservations/${futureReservation.data.id}`,jefe,'PATCH',{guestName:'Reserva futura editada',partySize:3,reservedFor:new Date(Date.now()+7*60*60_000).toISOString(),turno:'Noche',tableId:table.id});
  assert.equal(edited.status,200,edited.data.error);assert.equal(edited.data.party_size,3);

  const turno=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',hourCycle:'h23'}).format(new Date()))<18?'Mediodía':'Noche';
  db.prepare(`UPDATE Mesa SET capacidad=2 WHERE id_mesa!=? AND NOT EXISTS(SELECT 1 FROM Comanda c WHERE c.id_mesa=Mesa.id_mesa AND c.estado='En_Proceso')`).run(table.id);
  const createWait=async(name,partySize=2)=>request('/waitlist',jefe,'POST',{guestName:name,partySize,turno,serviceDate:localDate()});
  const w1=await createWait('FIFO no compatible primero',4),w2=await createWait('FIFO primer compatible',2),w3=await createWait('FIFO siguiente compatible',2);
  assert.equal(w1.status,201,w1.data.error);assert.equal(w2.status,201,w2.data.error);
  const queue=await request(`/waitlist?fecha=${localDate()}&turno=${encodeURIComponent(turno)}`,jefe);
  assert.equal(w3.status,201,w3.data.error);
  assert.equal(queue.status,200);assert.equal(queue.data.find(x=>x.id===w1.data.id).eligible,false,'un grupo de 4 no cabe en mesas de capacidad 2');
  assert.equal(queue.data.find(x=>x.id===w2.data.id).eligible,true,'se elige el primer grupo que cabe');
  const nextDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+86400000));
  assert.equal((await request(`/waitlist?fecha=${nextDate}&turno=${encodeURIComponent(turno)}`,jefe)).data.length,0,'la lista se filtra por fecha operativa');
  const skipped=await request(`/waitlist/${w1.data.id}/assign`,jefe,'POST',{});
  assert.equal(skipped.status,409,'no se debe asignar un grupo que no cabe ni saltar al primer compatible');
  const assigned=await request(`/waitlist/${w2.data.id}/assign`,jefe,'POST',{});
  assert.equal(assigned.status,200,assigned.data.error);assert.equal(assigned.data.status,'Confirmada');
  const countBeforeArrival=db.prepare("SELECT COUNT(*) n FROM Comanda WHERE estado='En_Proceso'").get().n;
  assert.equal(countBeforeArrival,1,'asignar mesa no debe crear una comanda antes de confirmar llegada');
  const arrived=await request(`/reservations/${w2.data.id}/arrive`,jefe,'POST',{});
  assert.equal(arrived.status,200,arrived.data.error);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM Comanda WHERE estado='En_Proceso'").get().n,2);

  const cashierOrders=await request('/cashier/orders',caja);
  const firstOrder=cashierOrders.data.find(item=>item.id===sent.data.orderId);
  assert.ok(firstOrder);
  const noMethod=await request('/payments/close',caja,'POST',{orderId:firstOrder.id,payments:[{method:'',amountCents:firstOrder.total_cents}]});
  assert.equal(noMethod.status,400,'Caja exige selección explícita de medio de pago');
  const rejected=await request('/payments/close',caja,'POST',{orderId:firstOrder.id,payments:[{method:'debit',amountCents:firstOrder.total_cents}],simulateRejection:true});
  assert.equal(rejected.status,402);assert.equal(rejected.data.paymentRejected,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM Transaccion_Cobro WHERE id_comanda=?').get(firstOrder.id).n,0);
  assert.equal(db.prepare("SELECT estado FROM Comanda WHERE id_comanda=?").get(firstOrder.id).estado,'En_Proceso');
  assert.equal(db.prepare('SELECT estado FROM Mesa WHERE id_mesa=?').get(table.id).estado,'Ocupada');
  const closed=await request('/payments/close',caja,'POST',{orderId:firstOrder.id,payments:[{method:'cash',amountCents:firstOrder.total_cents}]});
  assert.equal(closed.status,200,closed.data.error);
  assert.equal(db.prepare('SELECT estado FROM Mesa WHERE id_mesa=?').get(table.id).estado,'Libre');

  const cancellable=await request('/reservations',jefe,'POST',{guestName:'Reserva a anular',partySize:2,tableId:3,reservedFor:new Date(Date.now()+8*60*60_000).toISOString(),turno:'Noche'});
  assert.equal(cancellable.status,201,cancellable.data.error);
  const cancelledReservation=await request(`/reservations/${cancellable.data.id}/cancel`,jefe,'POST',{});
  assert.equal(cancelledReservation.status,200);assert.equal(db.prepare('SELECT estado FROM Mesa WHERE id_mesa=3').get().estado,'Libre');
  assert.ok(db.prepare("SELECT COUNT(*) n FROM Registro_Auditoria WHERE accion='Reserva anulada manualmente' AND identificador_entidad=?").get(String(cancellable.data.id)).n>0);

  const lateTable=6,managerId=db.prepare("SELECT id_usuario FROM Usuario WHERE identificador_acceso='jefe'").get().id_usuario;
  const lateId=db.prepare(`INSERT INTO Reserva(nombre_cliente,telefono,fecha_hora_reserva,turno,cantidad_comensales,id_mesa,estado,fecha_hora_registro,id_usuario_registro)
    VALUES('No-show de integración','',?,?,2,?,'Confirmada',?,?)`).run(new Date(Date.now()-16*60_000).toISOString(),turno,lateTable,new Date().toISOString(),managerId).lastInsertRowid;
  db.prepare("UPDATE Mesa SET estado='Reservada',hora_apertura=NULL WHERE id_mesa=?").run(lateTable);
  let noShow=false;
  for(let attempt=0;attempt<50;attempt++){
    if(db.prepare('SELECT estado FROM Reserva WHERE id_reserva=?').get(lateId).estado==='Cancelada_Ausencia'){noShow=true;break}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(noShow,true,'monitor de reservas ejecuta el no-show con resolución de 1 segundo');
  assert.equal(db.prepare('SELECT estado FROM Mesa WHERE id_mesa=?').get(lateTable).estado,'Libre');
  assert.ok(db.prepare("SELECT COUNT(*) n FROM Registro_Auditoria WHERE id_usuario IS NULL AND accion LIKE '%No-Show%' AND identificador_entidad=?").get(String(lateId)).n>0);

  const other=(await request('/tables',mozo)).data.find(item=>item.status==='free')?.id;
  const opened2=await request('/tables/open',mozo,'POST',{tableId:other,partySize:1});assert.equal(opened2.status,201);
  const sent2=await request('/orders',mozo,'POST',{tableId:other,partySize:1,items:[{menuItemId:3,quantity:1,notes:''}]},{'Idempotency-Key':`cancel-${Date.now()}`});assert.equal(sent2.status,201);
  const cashierList=(await request('/cashier/orders',caja)).data,order2=cashierList.find(item=>item.id===sent2.data.orderId);
  const blocked=await request('/payments/close',caja,'POST',{orderId:order2.id,payments:[{method:'cash',amountCents:order2.total_cents}]});assert.equal(blocked.status,400,'Caja no cierra mientras haya ítem pendiente');
  const detail=db.prepare('SELECT id_detalle FROM Detalle_Comanda WHERE id_comanda=?').get(sent2.data.orderId);
  const cancelled=await request(`/cashier/orders/${sent2.data.orderId}/items/${detail.id_detalle}/cancel`,caja,'POST',{});assert.equal(cancelled.status,200,cancelled.data.error);
  const zero=await request('/payments/close',caja,'POST',{orderId:sent2.data.orderId,payments:[{method:'cash',amountCents:0}]});assert.equal(zero.status,200,zero.data.error);
  db.close();
});

test('H14: la alerta de permanencia se propaga a tablets por Socket.IO al superar 40 minutos',async()=>{
  const mozo=await login('mozo'),table=(await request('/tables',mozo)).data.find(item=>item.status==='free');
  assert.ok(table,'se requiere una mesa libre para la integración Socket.IO');
  const opened=await request('/tables/open',mozo,'POST',{tableId:table.id,partySize:2});assert.equal(opened.status,201);
  const sent=await request('/orders',mozo,'POST',{tableId:table.id,partySize:2,items:[{menuItemId:1,quantity:1,notes:''}]},{'Idempotency-Key':`alert-${Date.now()}`});assert.equal(sent.status,201);
  const socket=connectSocket(base,{auth:{token:mozo},transports:['websocket']});let db;
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket.IO no conectó en tiempo')),2500);socket.once('connect',()=>{clearTimeout(timer);resolve()});socket.once('connect_error',error=>{clearTimeout(timer);reject(error)})});
    const alertEvent=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('La transición a Alerta_Permanencia no se propagó')),2500);socket.on('tables:changed',(payload,ack)=>{ack?.({received:true});if(payload?.tableId===table.id&&payload?.reason==='Alerta_Permanencia'){clearTimeout(timer);resolve(payload)}})});
    const dbPathLocal=dbPath;db=new Database(dbPathLocal);const openedAt=new Date(Date.now()-40*60_000-5).toISOString();
    db.prepare('UPDATE Comanda SET fecha_hora=? WHERE id_comanda=?').run(openedAt,sent.data.orderId);
    db.prepare("UPDATE Mesa SET estado='Ocupada',hora_apertura=? WHERE id_mesa=?").run(openedAt,table.id);
    const event=await alertEvent;assert.equal(event.reason,'Alerta_Permanencia');
    const updated=(await request('/tables',mozo)).data.find(item=>item.id===table.id);assert.equal(updated.status,'alert');
  }finally{socket.disconnect();db?.close()}
});
