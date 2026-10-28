import test from 'node:test';
import assert from 'node:assert/strict';
import {calcularTotalComanda,evaluarEstadoPermanencia,siguienteEstadoDetalle,validarCapacidadMesa} from '../src/domain.js';

test('PU-01: acepta grupos de 1 a 4 y bloquea fuera de aforo',()=>{
  for(let size=1;size<=4;size++)assert.equal(validarCapacidadMesa(4,size),true);
  for(const size of [0,-1,5,1.5])assert.equal(validarCapacidadMesa(4,size),false);
  assert.equal(validarCapacidadMesa(2,3),false);
});

test('PU-02: consolida cantidades usando precios históricos con centavos exactos',()=>{
  const total=calcularTotalComanda([
    {cantidad:2,precio_unitario_historico:14500.00},
    {cantidad:2,precio_unitario_historico:8600.00}
  ]);
  assert.equal(total,4_620_000);
  assert.equal((total/100).toLocaleString('es-AR',{minimumFractionDigits:2}), '46.200,00');
});

test('PU-03: semáforo de permanencia cambia solo al superar 40 minutos',()=>{
  const opened=Date.parse('2026-10-28T12:00:00.000Z');
  assert.equal(evaluarEstadoPermanencia(opened,opened+40*60_000),'Ocupada');
  assert.equal(evaluarEstadoPermanencia(opened,opened+40*60_000+1),'Alerta_Permanencia');
});

test('H3: los estados del plato avanzan sin saltos',()=>{
  assert.equal(siguienteEstadoDetalle('Pendiente'),'En_Preparacion');
  assert.equal(siguienteEstadoDetalle('En_Preparacion'),'Entregado');
  assert.equal(siguienteEstadoDetalle('Entregado'),null);
  assert.equal(siguienteEstadoDetalle('Cancelado'),null);
});
