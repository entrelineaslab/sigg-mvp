import {fechaLocalArgentina,validarCapacidadMesa} from './domain.js';

const VALID_TURNOS=new Set(['Mediodía','Noche']);
const CONFLICT_MINUTES=120; // H33/H34: conservado hasta aprobación expresa del equipo.
const PREBLOCK_MINUTES=180; // H33/H34: conservado hasta aprobación expresa del equipo.

export function registerReservationRoutes({app,db,auth,managerAuth,emit,emitCritical,audit,nowIso,syncMesaStates,createComanda,openComandaForMesa}){
  const queryDto=`SELECT r.*,m.numero,m.estado mesa_estado FROM Reserva r LEFT JOIN Mesa m ON m.id_mesa=r.id_mesa`;
  const localDate=value=>fechaLocalArgentina(value);
  const dayFilter=(date)=>`date(r.fecha_hora_reserva,'-3 hours')=?`;
  const filtersFrom=req=>{
    const date=/^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha||'')?req.query.fecha:localDate(nowIso());
    const localHour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',hourCycle:'h23'}).format(new Date()));
    const turno=VALID_TURNOS.has(req.query.turno)?req.query.turno:(localHour<18?'Mediodía':'Noche');
    return{date,turno};
  };
  const dto=r=>({
    id:r.id_reserva,guest_name:r.nombre_cliente,phone:r.telefono,party_size:r.cantidad_comensales,
    table_id:r.id_mesa,table_code:r.numero==null?null:`M${String(r.numero).padStart(2,'0')}`,
    reserved_for:r.fecha_hora_reserva,turno:r.turno,status:r.estado,created_at:r.fecha_hora_registro,
    created_by:r.id_usuario_registro,alerted_at:r.mesa_estado==='Alerta_Reserva'?r.fecha_hora_reserva:null,
    eligible:Boolean(r.eligible),eligible_table_code:r.eligible_table_code||null
  });
  const overlapFor=(tableId,reservedFor,ignoreId=null)=>db.prepare(`SELECT 1 FROM Reserva
    WHERE id_mesa=? AND estado='Confirmada' AND id_reserva!=COALESCE(?, -1)
    AND datetime(fecha_hora_reserva) BETWEEN datetime(?,'-${CONFLICT_MINUTES} minutes') AND datetime(?,'+${CONFLICT_MINUTES} minutes') LIMIT 1`)
    .get(tableId,ignoreId,reservedFor,reservedFor);
  const tableUsableFor=(mesa,reservedFor,ignoreReservationId=null)=>{
    if(!mesa||!validarCapacidadMesa(mesa.capacidad,1)||overlapFor(mesa.id_mesa,reservedFor,ignoreReservationId))return false;
    const opens=db.prepare(`SELECT fecha_hora FROM Comanda WHERE id_mesa=? AND estado='En_Proceso'`).get(mesa.id_mesa);
    // H22: no inventar duración del servicio actual (H33/H34 pendiente); la ocupación presente no bloquea una reserva futura.
    if(opens&&new Date(reservedFor).getTime()<=Date.now())return false;
    return true;
  };
  const findTableFor=(partySize,reservedFor,ignoreReservationId=null,preferredId=null)=>{
    let tables=db.prepare('SELECT * FROM Mesa WHERE capacidad>=? ORDER BY capacidad,numero').all(partySize);
    if(preferredId)tables=tables.filter(m=>m.id_mesa===Number(preferredId));
    return tables.find(m=>tableUsableFor(m,reservedFor,ignoreReservationId))||null;
  };
  const freeNowTables=()=>db.prepare(`SELECT m.* FROM Mesa m
    WHERE NOT EXISTS(SELECT 1 FROM Comanda c WHERE c.id_mesa=m.id_mesa AND c.estado='En_Proceso')
    AND NOT EXISTS(SELECT 1 FROM Reserva r WHERE r.id_mesa=m.id_mesa AND r.estado='Confirmada'
      AND datetime(r.fecha_hora_reserva) BETWEEN datetime('now','-15 minutes') AND datetime('now',?))
    ORDER BY m.capacidad,m.numero`).all(`+${PREBLOCK_MINUTES} minutes`);
  const queueFor=(date,turno)=>db.prepare(`SELECT * FROM Reserva r WHERE r.estado='En_Lista_Espera'
    AND r.turno=? AND ${dayFilter(date)} ORDER BY r.fecha_hora_registro,r.id_reserva`).all(turno,date);
  const firstEligible=(date,turno,mesas=freeNowTables())=>{
    if(date!==localDate(nowIso()))return null;
    const queue=queueFor(date,turno);
    for(const reserva of queue){
      const mesa=mesas.find(m=>m.capacidad>=reserva.cantidad_comensales);
      if(mesa)return{reserva,mesa};
    }
    return null;
  };
  const offerNext=(tableId,date,turno)=>{
    const mesa=db.prepare('SELECT * FROM Mesa WHERE id_mesa=?').get(tableId);
    if(!mesa)return null;
    const candidate=queueFor(date,turno).find(r=>r.cantidad_comensales<=mesa.capacidad);
    if(candidate)emit('waitlist:offered',{waitlistId:candidate.id_reserva,tableId,guestName:candidate.nombre_cliente,partySize:candidate.cantidad_comensales,turno,fecha:date});
    return candidate||null;
  };
  const emitChanged=(id,tableId=null)=>{emitCritical('reservations:changed',{id});if(tableId)emit('tables:changed',{tableId});emit('waitlist:changed',{id});};

  app.get('/api/reservations',auth,managerAuth,(req,res)=>{
    syncMesaStates();
    const{date,turno}=filtersFrom(req);
    const rows=db.prepare(`${queryDto} WHERE r.estado='Confirmada' AND r.turno=? AND ${dayFilter(date)} ORDER BY r.fecha_hora_reserva,r.id_reserva`).all(turno,date);
    res.json(rows.map(dto));
  });
  app.post('/api/reservations',auth,managerAuth,(req,res)=>{
    const{guestName,phone='',partySize,tableId,reservedFor,turno='Mediodía',acceptWaitlist=false}=req.body||{};
    if(!String(guestName||'').trim()||!validarCapacidadMesa(4,partySize)||!reservedFor||!VALID_TURNOS.has(turno)||Number.isNaN(new Date(reservedFor).getTime()))return res.status(400).json({error:'Nombre, fecha/hora, turno y comensales (1–4) son obligatorios'});
    const mesa=findTableFor(partySize,reservedFor,null,tableId);
    if(tableId&&!mesa)return res.status(409).json({error:'La mesa no está disponible para ese horario o no tiene capacidad suficiente'});
    if(!mesa&&!acceptWaitlist)return res.status(409).json({error:'No hay mesa compatible para esa fecha y hora. ¿Desea ofrecer lista de espera?',requiresWaitlistConfirmation:true});
    try{
      const id=db.transaction(()=>{
        const estado=mesa?'Confirmada':'En_Lista_Espera';
        const idReserva=db.prepare(`INSERT INTO Reserva(nombre_cliente,telefono,fecha_hora_reserva,turno,cantidad_comensales,id_mesa,estado,fecha_hora_registro,id_usuario_registro)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(String(guestName).trim(),String(phone||''),new Date(reservedFor).toISOString(),turno,partySize,mesa?.id_mesa??null,estado,nowIso(),req.user.id).lastInsertRowid;
        audit(req.user,mesa?'Reserva creada':'Reserva incorporada a lista de espera','Reserva',idReserva,{turno,fecha_hora_reserva:reservedFor,id_mesa:mesa?.id_mesa??null,estado});
        return idReserva;
      })();
      const saved=db.prepare(`${queryDto} WHERE r.id_reserva=?`).get(id);
      emitChanged(id,mesa?.id_mesa);
      res.status(201).json(dto(saved));
    }catch(e){res.status(400).json({error:e.message})}
  });
  app.patch('/api/reservations/:id',auth,managerAuth,(req,res)=>{
    const old=db.prepare(`SELECT * FROM Reserva WHERE id_reserva=? AND estado='Confirmada'`).get(req.params.id);
    if(!old)return res.status(404).json({error:'Reserva confirmada no encontrada'});
    const guestName=String(req.body?.guestName??old.nombre_cliente).trim();
    const phone=String(req.body?.phone??old.telefono);
    const partySize=Number(req.body?.partySize??old.cantidad_comensales);
    const reservedFor=req.body?.reservedFor??old.fecha_hora_reserva;
    const turno=req.body?.turno??old.turno;
    const tableId=Object.hasOwn(req.body||{},'tableId')?req.body.tableId:old.id_mesa;
    if(!guestName||!validarCapacidadMesa(4,partySize)||!VALID_TURNOS.has(turno)||Number.isNaN(new Date(reservedFor).getTime()))return res.status(400).json({error:'Datos de reserva inválidos'});
    const mesa=findTableFor(partySize,reservedFor,old.id_reserva,tableId);
    if(!mesa){
      if(req.body?.acceptWaitlist===true){
        const id=db.transaction(()=>{db.prepare(`UPDATE Reserva SET nombre_cliente=?,telefono=?,fecha_hora_reserva=?,turno=?,cantidad_comensales=?,id_mesa=NULL,estado='En_Lista_Espera' WHERE id_reserva=? AND estado='Confirmada'`).run(guestName,phone,new Date(reservedFor).toISOString(),turno,partySize,old.id_reserva);if(old.id_mesa&&!openComandaForMesa.get(old.id_mesa))db.prepare(`UPDATE Mesa SET estado='Libre',hora_apertura=NULL WHERE id_mesa=? AND estado IN ('Reservada','Alerta_Reserva')`).run(old.id_mesa);audit(req.user,'Reserva modificada y pasada a lista de espera','Reserva',old.id_reserva,{tableId:old.id_mesa,turno});return old.id_reserva;})();
        emitChanged(id,old.id_mesa);return res.json(dto(db.prepare(`${queryDto} WHERE r.id_reserva=?`).get(id)));
      }
      return res.status(409).json({error:'No hay mesa compatible para los nuevos datos. ¿Desea pasar el grupo a lista de espera?',requiresWaitlistConfirmation:true});
    }
    try{
      db.transaction(()=>{
        db.prepare(`UPDATE Reserva SET nombre_cliente=?,telefono=?,fecha_hora_reserva=?,turno=?,cantidad_comensales=?,id_mesa=? WHERE id_reserva=? AND estado='Confirmada'`)
          .run(guestName,phone,new Date(reservedFor).toISOString(),turno,partySize,mesa.id_mesa,old.id_reserva);
        audit(req.user,'Reserva modificada','Reserva',old.id_reserva,{mesa_anterior:old.id_mesa,mesa_nueva:mesa.id_mesa,turno,fecha_hora_reserva:reservedFor,cantidad_comensales:partySize});
      })();
      emitChanged(old.id_reserva,mesa.id_mesa);if(old.id_mesa!==mesa.id_mesa)emit('tables:changed',{tableId:old.id_mesa});
      res.json(dto(db.prepare(`${queryDto} WHERE r.id_reserva=?`).get(old.id_reserva)));
    }catch(e){res.status(400).json({error:e.message})}
  });
  app.post('/api/reservations/:id/arrive',auth,managerAuth,(req,res)=>{
    try{
      const output=db.transaction(()=>{
        const r=db.prepare(`SELECT * FROM Reserva WHERE id_reserva=? AND estado='Confirmada'`).get(req.params.id);
        if(!r)throw new Error('Reserva no pendiente');
        const mesa=db.prepare('SELECT * FROM Mesa WHERE id_mesa=?').get(r.id_mesa);
        if(!mesa||openComandaForMesa.get(mesa.id_mesa))throw new Error('La mesa reservada ya está ocupada');
        const changed=db.prepare(`UPDATE Reserva SET estado='Arribo_Confirmado' WHERE id_reserva=? AND estado='Confirmada'`).run(r.id_reserva);
        if(!changed.changes)throw new Error('La reserva cambió en otra terminal');
        const idComanda=createComanda({idMesa:mesa.id_mesa,idUsuario:req.user.id,cantidadComensales:r.cantidad_comensales});
        audit(req.user,'Arribo de reserva confirmado','Reserva',r.id_reserva,{id_mesa:mesa.id_mesa,id_comanda:idComanda});
        return{tableId:mesa.id_mesa,orderId:idComanda};
      })();
      emitChanged(Number(req.params.id),output.tableId);
      res.json({ok:true,status:'Arribo_Confirmado',...output});
    }catch(e){res.status(400).json({error:e.message})}
  });
  app.post('/api/reservations/:id/cancel',auth,managerAuth,(req,res)=>{
    try{
      const result=db.transaction(()=>{
        const r=db.prepare(`SELECT * FROM Reserva WHERE id_reserva=? AND estado='Confirmada'`).get(req.params.id);
        if(!r)throw new Error('Reserva pendiente no encontrada');
        const updated=db.prepare(`UPDATE Reserva SET estado='Cancelada' WHERE id_reserva=? AND estado='Confirmada'`).run(r.id_reserva);
        if(!updated.changes)throw new Error('La reserva cambió en otra terminal');
        const released=Boolean(r.id_mesa&&!openComandaForMesa.get(r.id_mesa));
        if(released)db.prepare(`UPDATE Mesa SET estado='Libre',hora_apertura=NULL WHERE id_mesa=?`).run(r.id_mesa);
        audit(req.user,'Reserva anulada manualmente','Reserva',r.id_reserva,{id_mesa:r.id_mesa,turno:r.turno,fecha_hora_reserva:r.fecha_hora_reserva});
        return{...r,released};
      })();
      emitChanged(Number(req.params.id),result.id_mesa);
      const date=localDate(result.fecha_hora_reserva);if(result.released)offerNext(result.id_mesa,date,result.turno);
      res.json({ok:true,status:'Cancelada',mesaLiberada:result.released});
    }catch(e){res.status(400).json({error:e.message})}
  });

  app.get('/api/waitlist',auth,managerAuth,(req,res)=>{
    const{date,turno}=filtersFrom(req),candidates=queueFor(date,turno),offer=firstEligible(date,turno);
    const eligibleId=offer?.reserva.id_reserva;
    const tableCode=offer?`M${String(offer.mesa.numero).padStart(2,'0')}`:null;
    res.json(candidates.map(r=>dto({...r,numero:null,mesa_estado:null,eligible:r.id_reserva===eligibleId,eligible_table_code:r.id_reserva===eligibleId?tableCode:null})));
  });
  app.post('/api/waitlist',auth,managerAuth,(req,res)=>{
    const{guestName,phone='',partySize,turno='Mediodía',serviceDate=localDate(nowIso())}=req.body||{};
    if(!String(guestName||'').trim()||!validarCapacidadMesa(4,partySize)||!VALID_TURNOS.has(turno))return res.status(400).json({error:'Nombre, turno y comensales (1–4) son obligatorios'});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate))return res.status(400).json({error:'Fecha de servicio inválida'});
    const timestamp=nowIso(),date=serviceDate,serviceTime=turno==='Mediodía'?'12:00:00':'20:00:00';
    const scheduledAt=new Date(`${date}T${serviceTime}-03:00`).toISOString();
    const id=db.transaction(()=>{
      const idReserva=db.prepare(`INSERT INTO Reserva(nombre_cliente,telefono,fecha_hora_reserva,turno,cantidad_comensales,id_mesa,estado,fecha_hora_registro,id_usuario_registro)
        VALUES(?,?,?,?,?,NULL,'En_Lista_Espera',?,?)`).run(String(guestName).trim(),String(phone||''),scheduledAt,turno,partySize,timestamp,req.user.id).lastInsertRowid;
      audit(req.user,'Cliente agregado a lista de espera','Reserva',idReserva,{turno,fecha:date,cantidad_comensales:partySize});return idReserva;
    })();
    emit('waitlist:changed',{id});res.status(201).json(dto(db.prepare(`${queryDto} WHERE r.id_reserva=?`).get(id)));
  });
  app.post('/api/waitlist/:id/cancel',auth,managerAuth,(req,res)=>{
    try{
      const out=db.transaction(()=>{
        const r=db.prepare(`SELECT * FROM Reserva WHERE id_reserva=? AND estado='En_Lista_Espera'`).get(req.params.id);
        if(!r)throw new Error('Cliente en espera no encontrado');
        db.prepare(`UPDATE Reserva SET estado='Cancelada' WHERE id_reserva=? AND estado='En_Lista_Espera'`).run(r.id_reserva);
        audit(req.user,'Cliente retirado de lista de espera','Reserva',r.id_reserva,{turno:r.turno,fecha:localDate(r.fecha_hora_reserva)});return r;
      })();
      emit('waitlist:changed',{id:Number(req.params.id),status:'Cancelada'});res.json({ok:true});
    }catch(e){res.status(400).json({error:e.message})}
  });
  app.post('/api/waitlist/:id/assign',auth,managerAuth,(req,res)=>{
    try{
      const result=db.transaction(()=>{
        const r=db.prepare(`SELECT * FROM Reserva WHERE id_reserva=? AND estado='En_Lista_Espera'`).get(req.params.id);
        if(!r)throw new Error('Cliente no disponible en lista de espera');
        const date=localDate(r.fecha_hora_reserva),offer=firstEligible(date,r.turno);
        if(!offer)throw new Error('No hay mesa libre compatible en este turno');
        if(offer.reserva.id_reserva!==r.id_reserva)throw new Error(`Prioridad FIFO: corresponde ofrecer primero a ${offer.reserva.nombre_cliente}`);
        const preferred=req.body?.tableId?Number(req.body.tableId):offer.mesa.id_mesa;
        const mesa=freeNowTables().find(m=>m.id_mesa===preferred&&m.capacidad>=r.cantidad_comensales);
        if(!mesa)throw new Error('La mesa ya no está libre o no tiene capacidad suficiente');
        const changed=db.prepare(`UPDATE Reserva SET estado='Confirmada',id_mesa=? WHERE id_reserva=? AND estado='En_Lista_Espera'`).run(mesa.id_mesa,r.id_reserva);
        if(!changed.changes)throw new Error('El grupo cambió en otra terminal');
        db.prepare(`UPDATE Mesa SET estado='Reservada',hora_apertura=NULL WHERE id_mesa=?`).run(mesa.id_mesa);
        audit(req.user,'Mesa asignada a lista de espera','Reserva',r.id_reserva,{id_mesa:mesa.id_mesa,fecha:date,turno:r.turno,prioridad_fifo:true});
        return{reservationId:r.id_reserva,tableId:mesa.id_mesa};
      })();
      emitChanged(result.reservationId,result.tableId);res.json({ok:true,status:'Confirmada',...result});
    }catch(e){res.status(409).json({error:e.message})}
  });

  function processNoShows(){
    const pending=db.prepare(`SELECT * FROM Reserva WHERE estado='Confirmada' AND datetime(fecha_hora_reserva)<=datetime('now','-15 minutes')`).all();
    for(const r of pending){
      const changed=db.transaction(()=>{
        const update=db.prepare(`UPDATE Reserva SET estado='Cancelada_Ausencia' WHERE id_reserva=? AND estado='Confirmada'`).run(r.id_reserva);
        if(!update.changes)return false;
        const released=Boolean(r.id_mesa&&!openComandaForMesa.get(r.id_mesa));
        if(released)db.prepare(`UPDATE Mesa SET estado='Libre',hora_apertura=NULL WHERE id_mesa=?`).run(r.id_mesa);
        audit(null,'Reserva cancelada por ausencia (No-Show)','Reserva',r.id_reserva,{id_mesa:r.id_mesa,turno:r.turno,fecha_hora_reserva:r.fecha_hora_reserva,actor:'Sistema'});
        return{released};
      })();
      if(changed===false)continue;
      emitCritical('reservations:changed',{id:r.id_reserva,status:'Cancelada_Ausencia'});
      if(r.id_mesa){emit('tables:changed',{tableId:r.id_mesa});if(changed.released)offerNext(r.id_mesa,localDate(r.fecha_hora_reserva),r.turno);}
    }
  }
  return{processNoShows,filtersFrom};
}
