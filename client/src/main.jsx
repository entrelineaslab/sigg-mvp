import React,{useEffect,useMemo,useRef,useState}from'react';
import{createRoot}from'react-dom/client';
import{io}from'socket.io-client';
import'./style.css';

const API=import.meta.env.VITE_API_URL||'http://localhost:3001';
const QUEUE_KEY='entre-lineas-pedidos-pendientes-v1';
const CATEGORIES=['Cocina Caliente','Cocina Fría','Postres','Bebidas'];
const ROLE_CARDS=[
  {id:'waiter',user:'mozo',title:'Mozo / Salón',sub:'Mesas y comandas',icon:'♙'},
  {id:'manager',user:'jefe',title:'Jefe de Salón',sub:'Reservas y supervisión',icon:'▤'},
  {id:'kitchen',user:'cocina',title:'Cocina (KDS)',sub:'Monitor de pase · solo lectura',icon:'♨'},
  {id:'cashier',user:'caja',title:'Caja / Cobro',sub:'Cierres y facturación',icon:'＄'},
  {id:'admin',user:'admin',title:'Administrador',sub:'En desarrollo · sin funciones operativas',icon:'⚙'}
];
const ROLE_NAMES={salon_manager:'Jefe de Salón',waiter:'Mozo / Salón',kitchen:'Cocina (KDS)',cashier:'Caja / Cobro',admin:'Administrador'};
const todayArgentina=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const defaultTurno=()=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',hourCycle:'h23'}).format(new Date()))<18?'Mediodía':'Noche';
const localInputValue=value=>{const d=value?new Date(value):new Date(Date.now()+60*60*1000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
function queuedOrders(){try{return JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]')}catch{return[]}}
function saveQueuedOrders(list){localStorage.setItem(QUEUE_KEY,JSON.stringify(list))}
function newIdempotencyKey(){const bytes=new Uint8Array(16);if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);return`el-${Date.now()}-${Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('')}`}
async function api(path,token,options={}){
  let response;
  try{response=await fetch(`${API}/api${path}`,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(options.headers||{})}})}
  catch(error){error.offline=true;throw error}
  let data={};try{data=await response.json()}catch{}
  if(!response.ok){const error=new Error(data.error||'No se pudo completar la operación');error.status=response.status;error.details=data;throw error}
  return data;
}
async function flushOrderQueue(token,username,forceKey=null){
  const owned=queuedOrders().filter(item=>item.username===username),completed=[],blocked=[];
  for(const item of owned){
    if(item.blocked&&item.key!==forceKey){blocked.push({key:item.key,error:item.lastError||'Requiere revisión'});break}
    try{
      await api('/orders',token,{method:'POST',headers:{'Idempotency-Key':item.key},body:JSON.stringify(item.body)});
      completed.push(item.key);
    }catch(error){
      if(error.status&&error.status!==401&&error.status<500){
        const lastError=error.message;
        saveQueuedOrders(queuedOrders().map(entry=>entry.key===item.key?{...entry,blocked:true,lastError}:entry));
        blocked.push({key:item.key,error:lastError});
      }
      break;
    }
  }
  if(completed.length)saveQueuedOrders(queuedOrders().filter(item=>!completed.includes(item.key)));
  return{sent:completed.length,blocked};
}
function money(cents){return new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format((cents||0)/100)}
function elapsed(stamp){if(!stamp)return'00:00';const value=stamp.includes('T')?stamp:stamp.replace(' ','T')+'Z';const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`}
function datetimeForApi(local){return new Date(local).toISOString()}

function Login({onLogin}){
  const[role,setRole]=useState(ROLE_CARDS[0]),[pin,setPin]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const key=value=>setPin(current=>(current+value).slice(0,4));
  async function enter(){if(pin.length!==4||busy)return;setBusy(true);setError('');try{const result=await api('/auth/login',null,{method:'POST',body:JSON.stringify({username:role.user,password:pin})});onLogin(result)}catch(e){setPin('');setError(e.message)}finally{setBusy(false)}}
  return <main className="login-figma"><section className="login-heading"><div className="brand-lockup"><span className="brand-symbol">EL</span><div><b>ENTRE LÍNEAS LAB</b><small>SISTEMA INTEGRAL GASTRONÓMICO</small></div></div><h1>El servicio,<br/><i>en su punto.</i></h1><p>Seleccione su rol operativo para iniciar el turno.</p></section><section className="login-panel"><div className="role-grid">{ROLE_CARDS.map(item=><button key={item.id} onClick={()=>{setRole(item);setError('')}} className={`role-card ${role.id===item.id?'chosen':''}`}><span className="role-icon">{item.icon}</span><span><b>{item.title}</b><small>{item.sub}</small></span></button>)}</div><div className="pin-entry"><div><b>Ingrese su PIN</b><span>4 dígitos · {role.title}</span></div><div className="pin-dots">{[0,1,2,3].map(i=><i key={i} className={pin.length>i?'filled':''}/>)}</div><div className="keypad">{[1,2,3,4,5,6,7,8,9,'',0,'←'].map((n,i)=><button key={i} disabled={n===''} onClick={()=>n==='←'?setPin(current=>current.slice(0,-1)):key(String(n))}>{n}</button>)}</div>{error&&<p className="error">{error}</p>}<button className="primary login-submit" onClick={enter} disabled={pin.length!==4||busy}>{busy?'Validando…':'Ingresar al sistema'} <span>➜</span></button><small className="demo-note">PIN demo para todos los perfiles: 1234 · cambiar antes de producción</small></div></section></main>;
}
function AdministratorNotice({logout}){return <main className="admin-notice"><div className="brand-symbol">EL</div><span className="overline">PERFIL AUTENTICADO</span><h1>Administrador · En desarrollo</h1><p>Este perfil se conserva en el sistema, pero aún no tiene módulos ni permisos operativos habilitados.</p><button className="outline-btn" onClick={logout}>Cerrar sesión</button></main>}

function App(){
  const[session,setSession]=useState(()=>{try{return JSON.parse(localStorage.getItem('el-session'))}catch{return null}});
  const[view,setView]=useState('salon'),[tables,setTables]=useState([]),[menu,setMenu]=useState([]),[kds,setKds]=useState([]),[orders,setOrders]=useState([]),[reservations,setReservations]=useState([]),[waitlist,setWaitlist]=useState([]),[selectedTable,setSelectedTable]=useState(null),[error,setError]=useState(''),[online,setOnline]=useState(false),[toast,setToast]=useState(''),[opening,setOpening]=useState(null),[queueProblem,setQueueProblem]=useState(null);
  const[serviceDate,setServiceDate]=useState(todayArgentina),[turno,setTurno]=useState(defaultTurno);
  const openingRef=useRef(new Set());
  const token=session?.token,user=session?.user;
  const reportQueueResult=result=>{if(result.sent){setToast(`${result.sent} comanda(s) transmitida(s) tras reconexión`);refresh()}if(result.blocked.length)setQueueProblem(result.blocked[0]);else if(result.sent)setQueueProblem(null)};
  const roles=useMemo(()=>user?.role==='salon_manager'?['salon','comanda','reservas','despacho']:user?.role==='waiter'?['salon','comanda','despacho']:user?.role==='kitchen'?['kds']:user?.role==='cashier'?['caja']:[],[user]);
  const filters=`?fecha=${encodeURIComponent(serviceDate)}&turno=${encodeURIComponent(turno)}`;
  const refresh=async(date=serviceDate,shift=turno)=>{
    if(!token||user?.role==='admin')return;
    try{
      if(['waiter','salon_manager'].includes(user.role))setTables(await api('/tables',token));
      if(user.role==='salon_manager'){setReservations(await api(`/reservations?fecha=${encodeURIComponent(date)}&turno=${encodeURIComponent(shift)}`,token));setWaitlist(await api(`/waitlist?fecha=${encodeURIComponent(date)}&turno=${encodeURIComponent(shift)}`,token));setKds(await api('/dispatch/items',token))}
      if(user.role==='waiter')setKds(await api('/dispatch/items',token));
      if(user.role==='kitchen')setKds(await api('/kds',token));
      if(user.role==='cashier')setOrders(await api('/cashier/orders',token));
    }catch(e){if(e.status)setError(e.message);else setOnline(false)}
  };
  useEffect(()=>{
    if(!session)return;
    localStorage.setItem('el-session',JSON.stringify(session));
    if(user.role==='admin')return;
    api('/menu',token).then(setMenu).catch(e=>{if(e.status)setError(e.message)});
    refresh();
    const socket=io(API,{auth:{token},transports:['websocket','polling']});
    socket.on('connect',()=>{setOnline(true);refresh();flushOrderQueue(token,user.username).then(reportQueueResult)});
    socket.on('disconnect',()=>setOnline(false));
    const events=['tables:changed','order:created','kds:nueva_comanda','kds:changed','payment:closed','reservations:changed','reservations:alert','waitlist:changed','waitlist:offered'];
    events.forEach(event=>socket.on(event,(_payload,ack)=>{refresh();if(event==='reservations:alert')setToast('Reserva con más de 10 minutos de demora');if(typeof ack==='function')ack({received:true})}));
    socket.on('delivery:confirmed',(event,ack)=>{refresh();setToast(`Entrega confirmada · ${event.tableCode}`);if(typeof ack==='function')ack({received:true})});
    const interval=setInterval(()=>{refresh();flushOrderQueue(token,user.username).then(reportQueueResult)},10000);
    const onlineHandler=()=>{setOnline(true);flushOrderQueue(token,user.username).then(reportQueueResult)};
    const offlineHandler=()=>setOnline(false);
    window.addEventListener('online',onlineHandler);window.addEventListener('offline',offlineHandler);
    return()=>{socket.disconnect();clearInterval(interval);window.removeEventListener('online',onlineHandler);window.removeEventListener('offline',offlineHandler)};
  },[token,session,user?.role,user?.username,serviceDate,turno]);
  useEffect(()=>{if(user&&roles.length&&!roles.includes(view))setView(roles[0])},[user,roles,view]);
  const logout=()=>{localStorage.removeItem('el-session');setSession(null);setView('salon')};
  async function retryQueued(key){const result=await flushOrderQueue(token,user.username,key);reportQueueResult(result)}
  function discardQueued(key){if(!window.confirm('¿Eliminar esta comanda fallida guardada en este dispositivo? Revise y vuelva a cargarla si corresponde.'))return;saveQueuedOrders(queuedOrders().filter(item=>item.key!==key));setQueueProblem(null)}
  const go=next=>{
    setView(next);setError('');
    if(next==='salon')refresh();
    if(next==='comanda'&&selectedTable?.id)api(`/orders/by-table/${selectedTable.id}`,token).catch(e=>setError(e.message));
    if(next==='kds')api('/kds',token).then(setKds).catch(e=>setError(e.message));
    if(next==='despacho')api('/dispatch/items',token).then(setKds).catch(e=>setError(e.message));
    if(next==='caja')api('/cashier/orders',token).then(setOrders).catch(e=>setError(e.message));
    if(next==='reservas')refresh(serviceDate,turno);
  };
  async function openTable(table){
    if(openingRef.current.has(table.id))return;
    openingRef.current.add(table.id);setOpening(table.id);
    try{
      const result=await api('/tables/open',token,{method:'POST',body:JSON.stringify({tableId:table.id,partySize:2})});
      setSelectedTable({...table,...result,id:table.id,order_id:result.id,party_size:2});setView('comanda');await refresh();
    }catch(e){setError(e.message)}finally{openingRef.current.delete(table.id);setOpening(null)}
  }
  async function tableAction(table){
    if(table.status==='free'){await openTable(table);return}
    if(['reserved','alert_reservation'].includes(table.status)){
      if(user.role!=='salon_manager')return;
      try{await api(`/reservations/${table.reservation_id}/arrive`,token,{method:'POST'});setToast('Ingreso confirmado; la mesa está en servicio');await refresh()}catch(e){setError(e.message)}return;
    }
    setSelectedTable(table);
    go(user.role==='waiter'?'comanda':'despacho');
  }
  if(!session)return <Login onLogin={result=>{localStorage.setItem('el-session',JSON.stringify(result));setSession(result);setView(result.user.role==='kitchen'?'kds':result.user.role==='cashier'?'caja':'salon')}}/>;
  if(user?.role==='admin')return <AdministratorNotice logout={logout}/>;
  const free=tables.filter(t=>t.status==='free').length,occupied=tables.filter(t=>t.status==='occupied').length,alert=tables.filter(t=>t.status==='alert').length,reserved=tables.filter(t=>['reserved','alert_reservation'].includes(t.status)).length;
  const title={salon:'Salón Principal',comanda:`Mesa ${String(selectedTable?.numero||selectedTable?.id||'').padStart(2,'0')} · Comanda`,reservas:'Gestión de Reservas y Lista de Espera',kds:'Monitor de Pase y Cocina',caja:'Estación de Caja y Facturación',despacho:'Preparación y entrega a la mesa'}[view];
  return <div className="figma-app"><header className="app-header"><div className="brand-lockup mini"><span className="brand-symbol">EL</span><div><b>ENTRE LÍNEAS LAB</b><small>GASTRO POS · OPERACIÓN LOCAL</small></div></div><div className="header-context"><span className={`connection ${online?'':'disconnected'}`}><i/>{online?'Red local conectada':'Desconectado · datos pueden estar desactualizados'}</span><span className="user-tag">{user.name} <small>{ROLE_NAMES[user.role]}</small></span><button className="logout" onClick={logout}>Salir ↗</button></div></header><div className="app-body"><aside className="nav-rail">{roles.map(role=><button key={role} className={view===role?'active':''} onClick={()=>go(role)} title={role}><span>{({salon:'▦',comanda:'＋',reservas:'▤',kds:'♨',caja:'＄',despacho:'✓'})[role]}</span><small>{({salon:'Salón',comanda:'Comanda',reservas:'Reservas',kds:'Cocina',caja:'Caja',despacho:'Despacho'})[role]}</small></button>)}</aside><main className={`workspace ${view==='kds'?'workspace-kds':''}`}><div className="page-heading"><div><span className="overline">OPERACIÓN LOCAL · {turno.toUpperCase()}</span><h1>{title}</h1></div>{view==='salon'&&user.role==='salon_manager'&&<button className="outline-btn" onClick={()=>go('reservas')}>▤ Reservas / Espera <b>{reservations.length+waitlist.length}</b></button>}</div>{error&&<div className="alert-banner">{error}<button onClick={()=>setError('')}>×</button></div>}{toast&&<div className="alert-banner">{toast}<button onClick={()=>setToast('')}>×</button></div>}{queueProblem&&<div className="alert-banner queue-warning"><span>Comanda pendiente guardada en este dispositivo: {queueProblem.error}</span><div><button className="outline-btn tiny" onClick={()=>retryQueued(queueProblem.key)}>Reintentar</button><button className="text-danger tiny" onClick={()=>discardQueued(queueProblem.key)}>Descartar</button></div></div>}
    {view==='salon'&&<><div className="salon-summary"><div><strong>{tables.length||10}</strong><span>10 Mesas / 40 Plazas</span></div><div className="summary-count free-count"><b>{free}</b><span>Libres</span></div><div className="summary-count occupied-count"><b>{occupied}</b><span>Ocupadas</span></div><div className="summary-count alert-count"><b>{alert}</b><span>En alerta</span></div><div className="summary-count reserve-count"><b>{reserved}</b><span>Reservadas</span></div>{user.role==='salon_manager'&&<button className="new-reservation" onClick={()=>go('reservas')}>▤ Reservas / Espera ({reservations.length+waitlist.length})</button>}</div><div className="tables-board">{tables.map(table=><TableCard key={table.id} table={table} busy={opening===table.id} canConfirm={user.role==='salon_manager'} onAction={()=>tableAction(table)}/>)}</div><p className="board-caption"><span className="state-key"><i className="state-dot free"/>Libre</span><span className="state-key"><i className="state-dot occupied"/>Ocupada</span><span className="state-key"><i className="state-dot alert"/>Alerta de permanencia (&gt;40 min)</span><span className="state-key"><i className="state-dot reserved"/>Reservada</span><span className="state-key"><i className="state-dot reserve-alert"/>Alerta de reserva (10–15 min)</span></p></>}
    {view==='comanda'&&selectedTable&&<OrderScreen key={selectedTable.order_id||selectedTable.id} table={selectedTable} menu={menu} token={token} username={user.username} onBack={()=>go('salon')} onSent={refresh} setError={setError} setToast={setToast}/>}
    {view==='reservas'&&user.role==='salon_manager'&&<Reservations reservations={reservations} waitlist={waitlist} tables={tables} token={token} date={serviceDate} setDate={setServiceDate} turno={turno} setTurno={setTurno} onRefresh={refresh} setError={setError} setToast={setToast}/>}
    {view==='kds'&&user.role==='kitchen'&&<KdsBoard items={kds} online={online}/>}
    {view==='despacho'&&['waiter','salon_manager'].includes(user.role)&&<Dispatch items={kds} token={token} role={user.role} onRefresh={refresh} setError={setError} setToast={setToast}/>}
    {view==='caja'&&user.role==='cashier'&&<CashDesk orders={orders} token={token} onRefresh={refresh} setError={setError}/>}
  </main></div></div>;
}

function TableCard({table:t,onAction,canConfirm,busy}){
  const state=t.status||'free',stateClass=state==='alert_reservation'?'alert-reservation':state;
  const names={free:'Libre',occupied:'Ocupada',alert:'Alerta permanencia',reserved:'Reservada',alert_reservation:'Alerta de reserva'};
  const isReservation=['reserved','alert_reservation'].includes(state),actionLabel=state==='free'?'+ Abrir mesa':isReservation?(canConfirm?'Confirmar ingreso':'Ingreso reservado · Jefe de Salón'):state==='alert'?'Gestionar cuenta':'Ver comanda';
  return <article className={`table-tile ${stateClass}`}><div className="tile-status"><b>{names[state]}</b>{t.elapsed&&<span>{t.elapsed}</span>}{isReservation&&t.reserved_for&&<span>{new Date(t.reserved_for).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</span>}</div><div className="tile-number">{String(t.numero||t.id).padStart(2,'0')}</div>{isReservation?<p className="tile-info">{canConfirm?t.guest_name||'Reserva':'Reserva confirmada'} · {t.party_size||1} personas</p>:t.order_id?<p className="tile-info">♙ {t.party_size||t.capacity} personas</p>:<p className="tile-info">Capacidad: {t.capacity} plazas · apertura rápida (2)</p>}{state==='alert'&&<p className="alert-hint">⚠ Superó 40 min</p>}{state==='alert_reservation'&&<p className="alert-hint">⚠ Demora de 10 a 15 min</p>}<button disabled={busy||isReservation&&!canConfirm} onClick={onAction} className="tile-action">{busy?'Abriendo…':actionLabel}</button></article>;
}

function OrderScreen({table,menu,token,username,onBack,onSent,setError,setToast}){
  const[items,setItems]=useState([]),[category,setCategory]=useState(CATEGORIES[0]),[busy,setBusy]=useState(false),[existing,setExisting]=useState([]),[partySize,setPartySize]=useState(table.party_size||2);
  const idempotencyKey=useRef(null),lastSend=useRef(0);
  useEffect(()=>{if(table?.order_id)api(`/orders/by-table/${table.id}`,token).then(setExisting).catch(()=>{})},[table.id,table.order_id,token]);
  const products=menu.filter(item=>item.category===category),total=items.reduce((sum,item)=>sum+item.quantity*item.price_cents,0);
  function add(product){setItems(current=>{const found=current.find(item=>item.id===product.id);return found?current.map(item=>item.id===product.id?{...item,quantity:Math.min(99,item.quantity+1)}:item):[...current,{...product,quantity:1,notes:''}]})}
  const update=(id,patch)=>setItems(current=>current.map(item=>item.id===id?{...item,...patch}:item));
  async function send(){
    if(!items.length||busy||Date.now()-lastSend.current<500)return;
    lastSend.current=Date.now();setBusy(true);
    const key=idempotencyKey.current||(idempotencyKey.current=newIdempotencyKey());
    const body={tableId:table.id,partySize:Number(partySize),items:items.map(item=>({menuItemId:item.id,quantity:item.quantity,notes:item.notes}))};
    const queueEntry={key,body,username,createdAt:new Date().toISOString()};
    try{
      const pending=queuedOrders();if(!pending.some(item=>item.key===key))saveQueuedOrders([...pending,queueEntry]);
      await api('/orders',token,{method:'POST',headers:{'Idempotency-Key':key},body:JSON.stringify(body)});
      saveQueuedOrders(queuedOrders().filter(item=>item.key!==key));idempotencyKey.current=null;setItems([]);setToast('Comanda enviada a cocina');await onSent();onBack();
    }catch(e){
      if(!e.status||e.status>=500){setItems([]);idempotencyKey.current=null;setToast('Sin conexión. Comanda guardada y reintentando automáticamente al reconectar.');onBack()}
      else{saveQueuedOrders(queuedOrders().filter(item=>item.key!==key));idempotencyKey.current=null;setError(e.message)}
    }finally{setBusy(false)}
  }
  return <section className="order-screen"><button className="back-link" onClick={onBack}>← Volver al Salón</button><div className="order-layout"><div className="catalog"><div className="category-tabs">{CATEGORIES.map((name,index)=><button className={category===name?'active':''} onClick={()=>setCategory(name)} key={name}><span>{['🍲','🥗','🍰','🍷'][index]}</span>{name}</button>)}</div><div className="product-grid">{products.map(product=><article className="product-card" key={product.id}><span className="product-mark">{product.category==='Bebidas'?'◒':'✦'}</span><h3>{product.name}</h3><p>{product.descripcion||product.description}</p><div><b>{money(product.price_cents)}</b><button onClick={()=>add(product)}>+ Añadir</button></div></article>)}</div>{existing.length>0&&<div className="existing-items"><b>Comanda activa · los nuevos ítems se agregan a la misma cuenta</b>{existing.map(item=><p key={item.id}>{item.quantity} × {item.name} · {item.status} {item.notes&&`· ${item.notes}`}</p>)}</div>}</div><aside className="ticket"><div className="ticket-heading"><div><span className="overline">COMANDA ACTIVA</span><h2>Mesa {String(table.numero||table.id).padStart(2,'0')}</h2></div><b>{items.length+existing.length} ítems</b></div><label className="party-size-label">Comensales<select value={partySize} onChange={event=>setPartySize(Number(event.target.value))}>{Array.from({length:Math.min(4,table.capacity||4)},(_,index)=>index+1).map(number=><option key={number} value={number}>{number}</option>)}</select></label><div className="ticket-items">{items.map(item=><article key={item.id} className="ticket-item"><button className="remove-item" onClick={()=>setItems(current=>current.filter(row=>row.id!==item.id))}>×</button><b>{item.name}</b><div className="quantity"><button onClick={()=>update(item.id,{quantity:Math.max(1,item.quantity-1)})}>−</button><span>{item.quantity}</span><button onClick={()=>update(item.id,{quantity:Math.min(99,item.quantity+1)})}>＋</button><strong>{money(item.quantity*item.price_cents)}</strong></div><textarea value={item.notes} onChange={event=>update(item.id,{notes:event.target.value})} placeholder="Observaciones íntegras: alergias, cocción…" rows="2"/></article>)}{!items.length&&<p className="empty-ticket">Seleccioná platos del menú para agregarlos a la comanda.</p>}</div><div className="ticket-total"><span>Subtotal estimado · nuevos ítems</span><b>{money(total)}</b></div><button className="send-order" onClick={send} disabled={!items.length||busy}>{busy?'Enviando…':'Enviar a cocina (KDS) ➜'}</button></aside></div></section>;
}

function Reservations({reservations,waitlist,tables,token,date,setDate,turno,setTurno,onRefresh,setError,setToast}){
  const[form,setForm]=useState({guestName:'',phone:'',partySize:2,reservedFor:localInputValue(),turno}),[wl,setWl]=useState({guestName:'',phone:'',partySize:2,turno}),[editing,setEditing]=useState(null),[editForm,setEditForm]=useState(null),[busy,setBusy]=useState(false);
  useEffect(()=>{setForm(current=>({...current,turno,reservedFor:current.reservedFor||localInputValue()}));setWl(current=>({...current,turno}))},[turno]);
  async function reserve(event){event.preventDefault();setBusy(true);const payload={...form,partySize:Number(form.partySize),reservedFor:datetimeForApi(form.reservedFor)};try{let result;try{result=await api('/reservations',token,{method:'POST',body:JSON.stringify(payload)})}catch(error){if(error.details?.requiresWaitlistConfirmation&&window.confirm(`${error.message}\n\n¿Registrar al cliente en la lista de espera para esa fecha y turno?`)){result=await api('/reservations',token,{method:'POST',body:JSON.stringify({...payload,acceptWaitlist:true})})}else throw error}setForm(current=>({...current,guestName:'',phone:''}));setToast(result.status==='En_Lista_Espera'?'Grupo agregado a la lista de espera':'Reserva confirmada');await onRefresh(date,turno)}catch(error){setError(error.message)}finally{setBusy(false)}}
  async function join(event){event.preventDefault();try{await api('/waitlist',token,{method:'POST',body:JSON.stringify({...wl,partySize:Number(wl.partySize),serviceDate:date})});setWl(current=>({...current,guestName:'',phone:''}));setToast('Cliente agregado a la lista de espera');await onRefresh(date,turno)}catch(error){setError(error.message)}}
  function beginEdit(reservation){setEditing(reservation);setEditForm({guestName:reservation.guest_name,phone:reservation.phone||'',partySize:reservation.party_size,reservedFor:localInputValue(reservation.reserved_for),turno:reservation.turno,tableId:reservation.table_id})}
  async function saveEdit(event){event.preventDefault();try{let result;const payload={...editForm,partySize:Number(editForm.partySize),tableId:editForm.tableId?Number(editForm.tableId):null,reservedFor:datetimeForApi(editForm.reservedFor)};try{result=await api(`/reservations/${editing.id}`,token,{method:'PATCH',body:JSON.stringify(payload)})}catch(error){if(error.details?.requiresWaitlistConfirmation&&window.confirm(`${error.message}\n\n¿Pasar la reserva a lista de espera?`)){result=await api(`/reservations/${editing.id}`,token,{method:'PATCH',body:JSON.stringify({...payload,acceptWaitlist:true})})}else throw error}setEditing(null);setToast(result.status==='En_Lista_Espera'?'Reserva pasada a lista de espera':'Reserva actualizada');await onRefresh(date,turno)}catch(error){setError(error.message)}}
  async function cancelReservation(reservation){if(!window.confirm(`¿Anular la reserva de ${reservation.guest_name}? La mesa se liberará si no tiene una comanda activa.`))return;try{const result=await api(`/reservations/${reservation.id}/cancel`,token,{method:'POST'});setToast(result.mesaLiberada?'Reserva anulada y mesa liberada':'Reserva anulada; la mesa conserva una comanda activa');await onRefresh(date,turno)}catch(error){setError(error.message)}}
  async function arrive(reservation){try{await api(`/reservations/${reservation.id}/arrive`,token,{method:'POST'});setToast(`Ingreso de ${reservation.guest_name} confirmado`);await onRefresh(date,turno)}catch(error){setError(error.message)}}
  async function assign(group){try{const result=await api(`/waitlist/${group.id}/assign`,token,{method:'POST'});setToast(`Mesa ${String(result.tableId).padStart(2,'0')} asignada y reservada; confirmar ingreso cuando llegue el grupo.`);await onRefresh(date,turno)}catch(error){setError(error.message)}}
  async function cancelWait(group){if(!window.confirm(`¿Retirar a ${group.guest_name} de la lista de espera?`))return;try{await api(`/waitlist/${group.id}/cancel`,token,{method:'POST'});await onRefresh(date,turno)}catch(error){setError(error.message)}}
  return <div className="reservations-layout"><section className="reservation-form panel-card"><h2>＋ Registrar nueva reserva</h2><div className="service-filters"><label>Fecha<input type="date" value={date} onChange={event=>{const next=event.target.value;setDate(next);setForm(current=>({...current,reservedFor:`${next}T${turno==='Mediodía'?'12:00':'20:00'}`}))}}/></label><label>Turno<select value={turno} onChange={event=>{const shift=event.target.value;setTurno(shift);setForm(current=>({...current,turno:shift,reservedFor:`${date}T${shift==='Mediodía'?'12:00':'20:00'}`}));setWl(current=>({...current,turno:shift}))}}><option>Mediodía</option><option>Noche</option></select></label></div><form onSubmit={reserve}><label>Nombre del titular<input required value={form.guestName} onChange={event=>setForm({...form,guestName:event.target.value})}/></label><label>Teléfono / WhatsApp<input value={form.phone} onChange={event=>setForm({...form,phone:event.target.value})}/></label><label>Comensales<select value={form.partySize} onChange={event=>setForm({...form,partySize:Number(event.target.value)})}>{[1,2,3,4].map(number=><option key={number} value={number}>{number} personas</option>)}</select></label><label>Fecha y hora pactadas<input type="datetime-local" required value={form.reservedFor} onChange={event=>setForm({...form,reservedFor:event.target.value})}/></label><label>Mesa<select value="" onChange={()=>{}} disabled><option value="">Asignación automática por disponibilidad</option></select><small className="field-note">La ocupación actual no bloquea por sí sola una reserva futura.</small></label><button className="primary" disabled={busy}>{busy?'Guardando…':'Guardar reserva confirmada'}</button></form><hr/><h3>Grupo presente sin reserva</h3><form onSubmit={join}><input placeholder="Nombre" required value={wl.guestName} onChange={event=>setWl({...wl,guestName:event.target.value})}/><input placeholder="Teléfono / WhatsApp" value={wl.phone} onChange={event=>setWl({...wl,phone:event.target.value})}/><select value={wl.partySize} onChange={event=>setWl({...wl,partySize:Number(event.target.value)})}>{[1,2,3,4].map(number=><option key={number} value={number}>{number} personas</option>)}</select><select value={wl.turno} onChange={event=>setWl({...wl,turno:event.target.value})}><option>Mediodía</option><option>Noche</option></select><button className="outline-btn">Enviar a lista de espera</button></form><p className="field-note">Solo se agrega con aceptación explícita del grupo. Asignar mesa no equivale a confirmar llegada.</p></section>
    <section className="reservation-lists"><div className="panel-card"><div className="section-title"><div><h2>Reservas confirmadas · {date} · {turno}</h2><small>Alerta visual a +10 min · cancelación automática a +15 min</small></div><span>{reservations.length}</span></div>{reservations.map(reservation=><div className="reservation-row" key={reservation.id}><div><b>{reservation.guest_name}</b><small>Tel: {reservation.phone||'—'} · {reservation.party_size} comensales · {reservation.table_code||'Mesa a asignar'}</small></div><div className="reserve-meta"><b>{new Date(reservation.reserved_for).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</b><small>{reservation.turno}</small></div><span className={`status-chip ${reservation.alerted_at?'late':''}`}>{reservation.alerted_at?'⚠ Demora 10+ min':reservation.status}</span><div className="reservation-actions"><button className="outline-btn tiny" onClick={()=>beginEdit(reservation)}>Editar</button><button className="outline-btn tiny" onClick={()=>arrive(reservation)}>Llegó / Sentar</button><button className="text-danger tiny" onClick={()=>cancelReservation(reservation)}>Anular</button></div></div>)}{!reservations.length&&<p className="empty-text">No hay reservas para esta fecha y turno.</p>}</div>
      <div className="panel-card"><div className="section-title"><div><h2>Lista de espera · FIFO</h2><small>Solo el primer grupo compatible puede recibir mesa</small></div><span>{waitlist.length}</span></div>{waitlist.map((group,index)=><div className={`reservation-row ${group.eligible?'fifo-next':''}`} key={group.id}><div><b>#{index+1} · {group.guest_name} ({group.party_size})</b><small>Alta {new Date(group.created_at).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})} · {group.turno} · esperando {elapsed(group.created_at)}</small></div>{group.eligible?<button className="primary tiny" onClick={()=>assign(group)}>Asignar {group.eligible_table_code||'mesa'}</button>:<span className="status-chip">En espera de mesa compatible</span>}<button className="text-danger tiny" onClick={()=>cancelWait(group)}>Retirar</button></div>)}{!waitlist.length&&<p className="empty-text">La lista de este turno está vacía.</p>}</div></section>
    {editing&&<div className="modal-shade" onClick={()=>setEditing(null)}><section className="dialog edit-reservation" onClick={event=>event.stopPropagation()}><button className="dialog-x" onClick={()=>setEditing(null)}>×</button><span className="overline">RESERVA #{editing.id}</span><h2>Editar reserva</h2><form onSubmit={saveEdit}><label>Nombre<input required value={editForm.guestName} onChange={event=>setEditForm({...editForm,guestName:event.target.value})}/></label><label>Teléfono<input value={editForm.phone} onChange={event=>setEditForm({...editForm,phone:event.target.value})}/></label><label>Comensales<select value={editForm.partySize} onChange={event=>setEditForm({...editForm,partySize:Number(event.target.value)})}>{[1,2,3,4].map(number=><option key={number}>{number}</option>)}</select></label><label>Fecha y hora<input type="datetime-local" required value={editForm.reservedFor} onChange={event=>setEditForm({...editForm,reservedFor:event.target.value})}/></label><label>Turno<select value={editForm.turno} onChange={event=>setEditForm({...editForm,turno:event.target.value})}><option>Mediodía</option><option>Noche</option></select></label><label>Mesa<select value={editForm.tableId||''} onChange={event=>setEditForm({...editForm,tableId:event.target.value||null})}><option value="">Automática</option>{tables.map(table=><option key={table.id} value={table.id}>Mesa {table.numero} · capacidad {table.capacity}{table.status==='free'?' · libre':''}</option>)}</select></label><div className="dialog-actions"><button type="button" className="outline-btn" onClick={()=>setEditing(null)}>Cancelar</button><button className="primary">Guardar cambios</button></div></form></section></div>}
  </div>;
}

function KdsBoard({items,online}){
  const[page,setPage]=useState(0),PAGE_SIZE=16;
  const ordered=useMemo(()=>[...items].sort((a,b)=>Date.parse(a.sent_at||a.created_at)-Date.parse(b.sent_at||b.created_at)||a.item_id-b.item_id),[items]);
  const pageCount=Math.max(1,Math.ceil(ordered.length/PAGE_SIZE));
  useEffect(()=>{if(page>=pageCount)setPage(0)},[page,pageCount]);
  useEffect(()=>{if(pageCount<=1)return;const timer=setInterval(()=>setPage(current=>(current+1)%pageCount),10000);return()=>clearInterval(timer)},[pageCount]);
  const visible=ordered.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE),grouped=CATEGORIES.map(name=>({name,items:visible.filter(item=>item.category===name)}));
  return <div className={`kds-wrap ${online?'':'kds-stale'}`}><div className="kds-legend"><span>● En tiempo · hasta 25 min</span><span className="late">● Demorado · más de 25 min</span><b>Solo lectura · antigüedad primero</b><span className="kds-page">Página {page+1}/{pageCount} · rotación 10 s</span></div><div className="kds-columns">{grouped.map(column=><section className="kds-column" key={column.name}><header>{column.name.toUpperCase()} <b>({column.items.length})</b></header>{column.items.length?column.items.map(item=><article className={`kds-order ${item.delayed?'late':''}`} key={item.item_id}><div className="kds-card-head"><b>MESA {item.table_code}</b><time>{elapsed(item.sent_at||item.created_at)}</time></div><h3>{item.quantity}× {item.item_name}</h3>{item.status==='preparing'&&<strong className="kds-preparing">EN PREPARACIÓN</strong>}{item.notes&&<p>⚠ {item.notes}</p>}</article>):<div className="kds-empty">Sin comandas pendientes</div>}</section>)}</div>{!online&&<div className="kds-offline-overlay"><strong>CONEXIÓN PERDIDA · KDS DESACTUALIZADO</strong><p>Las tarjetas visibles pueden no reflejar el estado vigente. No preparar basándose en esta pantalla hasta recuperar la red.</p><span>La pantalla se resincronizará automáticamente al reconectar.</span></div>}</div>;
}

function Dispatch({items,token,role,onRefresh,setError,setToast}){
  const[busy,setBusy]=useState(null),lastAction=useRef(new Map());
  async function advance(item){
    const id=item.item_id,now=Date.now();if(busy===id||now-(lastAction.current.get(id)||0)<500)return;lastAction.current.set(id,now);setBusy(id);
    const next=item.status==='queued'?'preparing':'delivered';
    try{const result=await api(`/order-items/${id}/status`,token,{method:'PATCH',body:JSON.stringify({status:next})});setToast(result.status==='delivered'?'Entrega confirmada en la mesa':`Ítem ${item.item_name}: en preparación`);await onRefresh()}
    catch(error){setError(error.message)}finally{setBusy(null)}
  }
  const managerLocked=role==='salon_manager';
  return <section className="panel-card dispatch-list"><div className="section-title"><div><h2>Preparación y entrega a la mesa</h2><small>Mozo: flujo normal · Jefe: intervención jerárquica después de 25 minutos.</small></div><b>{items.length} activo{items.length===1?'':'s'}</b></div>{items.length?items.map(item=>{const next=item.status==='queued'?'preparing':'delivered',locked=managerLocked&&!item.delayed;return <article key={item.item_id} className={`dispatch-row ${item.delayed?'late':''}`}><div><span className="overline">MESA {item.table_code} · {item.category} · EN COCINA {elapsed(item.sent_at||item.created_at)}</span><h3>{item.quantity} × {item.item_name}</h3><span className={`item-state ${item.status}`}>{item.status==='queued'?'PENDIENTE':item.status==='preparing'?'EN PREPARACIÓN':'ENTREGADO'}</span>{item.notes&&<p className="dispatch-notes">Observación íntegra: {item.notes}</p>}</div><button className="delivery-confirm-btn" disabled={busy===item.item_id||locked} onClick={()=>advance(item)}>{busy===item.item_id?'Registrando…':locked?'Disponible para Jefe después de 25 min':next==='preparing'?'▶ Marcar en preparación':'✓ Confirmar entrega a mesa'}</button></article>}) :<div className="delivery-empty"><b>✓ No hay platos pendientes de preparación o entrega</b><p>Los nuevos platos enviados desde la comanda aparecerán aquí.</p></div>}</section>;
}

function CashDesk({orders,token,onRefresh,setError}){
  const[selected,setSelected]=useState(null),[details,setDetails]=useState([]),[method,setMethod]=useState(''),[busy,setBusy]=useState(false),[printed,setPrinted]=useState(false);
  async function choose(order){setSelected(order);setMethod('');setPrinted(false);try{setDetails(await api(`/cashier/orders/${order.id}`,token))}catch(error){setError(error.message)}}
  const total=details.reduce((sum,item)=>sum+item.quantity*item.unit_price_cents,0),undelivered=details.filter(item=>item.status!=='delivered'&&item.status!=='void'),cancelable=details.filter(item=>['queued','preparing'].includes(item.status));
  async function cancelItem(item){if(!window.confirm(`¿Anular ${item.quantity} × ${item.name}? Solo se admite si aún no fue elaborado.`))return;try{await api(`/cashier/orders/${selected.id}/items/${item.id}/cancel`,token,{method:'POST'});setDetails(await api(`/cashier/orders/${selected.id}`,token));await onRefresh()}catch(error){setError(error.message)}}
  async function settle(simulateRejection=false){if(!selected||!method||busy)return;setBusy(true);try{await api('/payments/close',token,{method:'POST',body:JSON.stringify({orderId:selected.id,payments:[{method,amountCents:total}],simulateRejection})});setSelected(null);setDetails([]);setMethod('');await onRefresh()}catch(error){setError(error.message)}finally{setBusy(false)}}
  return <div className="cash-layout"><section className="panel-card pending-panel"><div className="section-title"><h2>Cuentas pendientes de cierre</h2><b>{orders.length}</b></div>{orders.map(order=><button className={`pending-order ${selected?.id===order.id?'selected':''}`} key={order.id} onClick={()=>choose(order)}><div><b>MESA {order.table_code}</b><small>{order.party_size} comensales · Mozo: {order.waiter_name||'—'}</small><small>{order.delivered_count}/{order.item_count} entregados</small></div><div><time>{elapsed(order.opened_at)}</time><strong>{money(order.total_cents)}</strong>{order.delivered_count<order.item_count&&<small className="late-text">⚠ Faltan entregas</small>}</div></button>)}{!orders.length&&<p className="empty-text">No hay cuentas pendientes.</p>}</section><section className="panel-card settlement-panel"><div className="section-title"><h2>Pre-cuenta / liquidación</h2>{selected&&<span>Mesa {selected.table_code}</span>}</div>{!selected?<p className="empty-settlement">Seleccioná una cuenta para ver el detalle.</p>:<><div className={`delivery-banner ${undelivered.length?'warning':''}`}>{undelivered.length?`⚠ Hay ${undelivered.length} ítem(s) pendientes o en preparación. Esperá o anulalos explícitamente.`:'✓ Integridad de despacho: todos los ítems activos fueron entregados.'}</div><div className="bill-head"><span>Descripción</span><span>Cant.</span><span>Precio unit.</span><span>Subtotal</span></div>{details.map(item=><div className="bill-row" key={item.id}><span>{item.name}{item.status!=='delivered'&&<small> · {item.status==='queued'?'pendiente':'en preparación'}</small>}</span><span>{item.quantity}</span><span>{money(item.unit_price_cents)}</span><b>{money(item.quantity*item.unit_price_cents)}</b>{cancelable.some(row=>row.id===item.id)&&<button className="text-danger tiny" onClick={()=>cancelItem(item)}>Anular plato</button>}</div>)}<div className="total-line"><span>Total a cobrar</span><b>{money(total)}</b></div><p className="payment-label">Seleccionar medio de pago · obligatorio</p><div className="payment-methods">{[['cash','💵','Efectivo'],['debit','💳','Tarjeta débito'],['credit','💳','Tarjeta crédito'],['qr','▦','Transferencia QR']].map(([id,icon,name])=><button key={id} className={method===id?'chosen':''} onClick={()=>setMethod(id)}><span>{icon}</span>{name}</button>)}</div><button className="charge-btn" disabled={busy||undelivered.length>0||!method} onClick={()=>settle(false)}>{busy?'Registrando…':total===0?`Cerrar cuenta sin saldo · ${selected.table_code}`:`Registrar pago y liberar mesa ${selected.table_code} ➜`}</button>{method&&method!=='cash'&&<button className="simulate-rejection" disabled={busy||undelivered.length>0} onClick={()=>settle(true)}>Simular rechazo del pago electrónico (prueba)</button>}</>}</section></div>;
}

createRoot(document.getElementById('root')).render(<App/>);
