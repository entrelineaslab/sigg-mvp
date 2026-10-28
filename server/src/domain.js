export const MINUTES=60_000;

export function validarCapacidadMesa(capacidad,comensales){
  return Number.isInteger(capacidad)&&capacidad>=1&&capacidad<=4&&Number.isInteger(comensales)&&comensales>=1&&comensales<=capacidad;
}

export function calcularTotalComanda(detalles){
  return detalles.reduce((total,item)=>total+Math.round(Number(item.precio_unitario_historico)*100)*Number(item.cantidad),0);
}

export function elapsedMs(desde,hasta=Date.now()){
  const inicio=typeof desde==='number'?desde:new Date(desde).getTime();
  const fin=typeof hasta==='number'?hasta:new Date(hasta).getTime();
  if(!Number.isFinite(inicio)||!Number.isFinite(fin))return 0;
  return Math.max(0,fin-inicio);
}

export function evaluarEstadoPermanencia(horaApertura,horaActual=Date.now()){
  return elapsedMs(horaApertura,horaActual)>40*MINUTES?'Alerta_Permanencia':'Ocupada';
}

const transiciones={Pendiente:'En_Preparacion',En_Preparacion:'Entregado'};
export function siguienteEstadoDetalle(estadoActual){return transiciones[estadoActual]||null;}

export function fechaLocalArgentina(iso){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
}
