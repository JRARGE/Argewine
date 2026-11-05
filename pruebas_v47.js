// Pruebas de v47: envios que cubren varios pedidos y reenvios.
// Carga el <script> de la app en un vm con un DOM de mentira, como se venia haciendo.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const APP = path.join(__dirname, 'argewine_v5.html');
const html = fs.readFileSync(APP, 'utf8');
const src = html.slice(html.indexOf('<script>', html.indexOf('</script>')) + 8,
                      html.lastIndexOf('</script>'));

// ---------- DOM minimo ----------
function nodoFalso(id){
  return {
    id, value:'', innerHTML:'', textContent:'', checked:false, disabled:false,
    style:{}, dataset:{}, classList:{ add(){}, remove(){}, toggle(){}, contains(){return false} },
    appendChild(){}, removeChild(){}, insertAdjacentHTML(){}, focus(){}, blur(){},
    setAttribute(){}, getAttribute(){return null}, remove(){},
    addEventListener(){}, querySelector(){return null}, querySelectorAll(){return []},
    children:[], parentNode:null, closest(){return null}, scrollIntoView(){}, click(){}
  };
}
const nodos = {};
const document = {
  getElementById(id){ return nodos[id] || (nodos[id] = nodoFalso(id)); },
  querySelector(){ return null },
  querySelectorAll(){ return [] },
  createElement(t){ return nodoFalso(t) },
  addEventListener(){}, body: nodoFalso('body'), head: nodoFalso('head'),
  documentElement: nodoFalso('html')
};
const almacen = {};
const localStorage = {
  getItem(k){ return k in almacen ? almacen[k] : null },
  setItem(k,v){ almacen[k] = String(v) },
  removeItem(k){ delete almacen[k] }
};

const ctx = {
  document, localStorage, console,
  window:{ addEventListener(){}, location:{href:'',hash:''}, matchMedia(){return{matches:false,addEventListener(){}}} },
  navigator:{ userAgent:'node', onLine:true, clipboard:{ writeText(){ return Promise.resolve() } } },
  location:{ href:'', hash:'', search:'' },
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('sin red en la prueba')),
  XLSX: undefined, Date, Math, JSON, parseInt, parseFloat, isNaN, encodeURIComponent,
  decodeURIComponent, alert(){}, confirm(){return true}, prompt(){return null},
  requestAnimationFrame(f){ return setTimeout(f,0) },
  avisos: []
};
ctx.window.document = document;
ctx.globalThis = ctx;
vm.createContext(ctx);

// Expone los `let` de nivel superior, que no quedan en el contexto.
const nombres = ['S','cur','pendingFxReport','undoStack','redoStack','lastFxSheetInfo','lastFxDuplicadas'];
const cola = '\n;globalThis.__t = { ' + nombres.map(n=>`get ${n}(){return typeof ${n}!=="undefined"?${n}:undefined}, set ${n}(v){ ${n}=v }`).join(', ') + ' };';

try { vm.runInContext(src + cola, ctx, { filename:'argewine_v5.html' }); }
catch(e){ console.error('NO CARGO EL SCRIPT:', e.message); process.exit(1); }

// notify se reemplaza para poder leer los avisos
ctx.notify = (msg) => { ctx.avisos.push(String(msg)); };
ctx.schedSave = () => {};
ctx.renderAll = () => {};
ctx.saveToDrive = () => {};
ctx.schedSaveRemote = () => {};

const T = ctx.__t;

// ---------- utilidades de prueba ----------
let ok = 0, fallo = 0;
function es(nombre, real, esperado){
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if(a === b){ ok++; }
  else { fallo++; console.log('  FALLO  ' + nombre + '\n         esperado ' + b + '\n         obtuve   ' + a); }
}
function cierto(nombre, cond){ if(cond) ok++; else { fallo++; console.log('  FALLO  ' + nombre); } }

// ---------- estado de prueba ----------
function reset(){
  T.S = { months: { '2026-09': { orders: [] }, '2026-10': { orders: [] } }, awbMap:{} };
  T.cur = '2026-10';
  T.pendingFxReport = [];
}
function pedido(mk, num, bottles, tracking){
  T.S.months[mk].orders.push({
    num, bottles: bottles==null?'':String(bottles), tracking: tracking||'',
    salePrice:'100', productCostARS:'0', shippingARS:'0', dutiesARS:'0', handling:'0'
  });
}
function buscar(mk, num){ return T.S.months[mk].orders.find(o=>o.num===num); }

// =====================================================================
console.log('\nrefOrderNums — leer la referencia del remitente');
es('un pedido suelto',        ctx.refOrderNums('#2580'), ['2580']);
es('cuatro juntos',           ctx.refOrderNums('#2899 #2900 #2901 #2902'), ['2899','2900','2901','2902']);
es('separados por coma',      ctx.refOrderNums('2899, 2900,2901'), ['2899','2900','2901']);
es('reenvio',                 ctx.refOrderNums('#2924-2'), ['2924-2']);
es('vacio',                   ctx.refOrderNums(''), []);
es('nulo',                    ctx.refOrderNums(null), []);
es('ruido corto se descarta', ctx.refOrderNums('caja 2 de 3'), []);
es('texto con pedido',        ctx.refOrderNums('pedido 2580 cliente'), ['2580']);

console.log('\nfxResolver — del numero al pedido');
reset();
pedido('2026-10','2899',6); pedido('2026-10','2900',12);
pedido('2026-10','2901',2); pedido('2026-10','2902',4);
pedido('2026-09','2924',6);
const todos = ctx.allOrdersIndexed();
es('los cuatro del envio junto',
   ctx.fxResolver(todos, ['2899','2900','2901','2902']).map(t=>t.num),
   ['2899','2900','2901','2902']);
es('reenvio cae en el pedido base',
   ctx.fxResolver(todos, ['2924-2']), [{num:'2924', mk:'2026-09'}]);
es('reenvio -3 tambien',
   ctx.fxResolver(todos, ['2924-3']).map(t=>t.num), ['2924']);
es('no repite si el numero viene dos veces',
   ctx.fxResolver(todos, ['2899','2899']).map(t=>t.num), ['2899']);
es('descarta los que no existen',
   ctx.fxResolver(todos, ['2899','9999']).map(t=>t.num), ['2899']);
es('lista vacia', ctx.fxResolver(todos, []), []);

console.log('\nfxRepartir — como se parte el monto');
es('un solo pedido se lleva todo', ctx.fxRepartir(1000, [{bottles:'6'}]), [1000]);
es('por botellas 6 y 12',  ctx.fxRepartir(900, [{bottles:'6'},{bottles:'12'}]), [300, 600]);
es('en partes iguales si falta una cantidad',
   ctx.fxRepartir(900, [{bottles:'6'},{bottles:''}]), [450, 450]);
es('en partes iguales si no hay botellas en ninguno',
   ctx.fxRepartir(300, [{bottles:''},{bottles:''},{bottles:''}]), [100,100,100]);
(function(){
  // Lo importante del reparto: que la suma de exacto, sin perder ni inventar centavos.
  const m = 367985.05;
  const p = ctx.fxRepartir(m, [{bottles:'6'},{bottles:'6'},{bottles:'6'},{bottles:'6'}]);
  es('cuatro iguales', p, [91996.26, 91996.26, 91996.26, 91996.27]);
  es('la suma da el monto original', Math.round(p.reduce((a,b)=>a+b,0)*100)/100, m);
  const p2 = ctx.fxRepartir(1000, [{bottles:'1'},{bottles:'1'},{bottles:'1'}]);
  es('tres tercios suman 1000', Math.round(p2.reduce((a,b)=>a+b,0)*100)/100, 1000);
})();

// =====================================================================
console.log('\nImportar un reporte de verdad');

function filasFedex(lineas){
  return lineas.map(l => ({
    'Tipo de factura': l.tipo || 'Transporte',
    'Referencia del remitente 1': l.ref || '',
    'Número de guía aérea': l.awb || '',
    'Monto total guía aérea': String(l.monto),
    'Número de factura': l.fac || 'F1'
  }));
}
function importar(lineas){
  ctx.processFxReportRows(filasFedex(lineas), { name:'Data', sheets:['Data'], extractRows(){return []} });
}

reset();
pedido('2026-10','2899',6); pedido('2026-10','2900',12);
pedido('2026-10','2901',2); pedido('2026-10','2902',4);
pedido('2026-09','2924',6,'525173582570');
importar([
  { ref:'#2899 #2900 #2901 #2902', awb:'111122223333', monto:'367985,05' },
  { ref:'#2924-2',                 awb:'444455556666', monto:'571433,63' }
]);
es('entraron las dos lineas', T.pendingFxReport.length, 2);
es('la consolidada apunta a los cuatro',
   T.pendingFxReport[0].targets.map(t=>t.num), ['2899','2900','2901','2902']);
es('cruzo por numero de pedido', T.pendingFxReport[0].matchSrc, 'pedido');
es('el reenvio apunta al pedido base',
   T.pendingFxReport[1].targets.map(t=>t.num), ['2924']);
es('y al mes del pedido base', T.pendingFxReport[1].targets[0].mk, '2026-09');

ctx.applyFedexReport();
es('2899 (6 bot.) se lleva un cuarto',  buscar('2026-10','2899').shippingARS, '91996.26');
es('2900 (12 bot.) se lleva el doble',  buscar('2026-10','2900').shippingARS, '183992.53');
es('2901 (2 bot.)',                     buscar('2026-10','2901').shippingARS, '30665.42');
es('2902 (4 bot.)',                     buscar('2026-10','2902').shippingARS, '61330.84');
(function(){
  const suma = ['2899','2900','2901','2902']
    .reduce((a,n)=>a + parseFloat(buscar('2026-10',n).shippingARS), 0);
  es('los cuatro suman el monto del envio', Math.round(suma*100)/100, 367985.05);
})();
es('el reenvio se sumo al pedido 2924', buscar('2026-09','2924').shippingARS, '571433.63');
cierto('el aviso menciona el reparto', ctx.avisos.join('\n').includes('más de un pedido'));

// ---------- reenvio sobre un pedido que YA tenia envio ----------
console.log('\nReenvio sobre un pedido que ya tenia su envio cargado');
reset();
pedido('2026-10','2924',6,'525173582570');
buscar('2026-10','2924').shippingARS = '200000.00';
ctx.avisos.length = 0;
importar([{ ref:'#2924-2', awb:'444455556666', monto:'571433,63' }]);
// En modo sumar (el radio no existe en la prueba, asi que queda "reemplazar"),
// se pone en cero y se carga el del reporte: es el comportamiento ya elegido.
ctx.applyFedexReport();
es('reemplazar deja solo lo del reporte', buscar('2026-10','2924').shippingARS, '571433.63');

// ---------- el envio original Y el reenvio en el mismo reporte ----------
console.log('\nEl envio original y el reenvio vienen juntos en el reporte');
reset();
pedido('2026-10','2924',6,'525173582570');
importar([
  { ref:'#2924',   awb:'525173582570', monto:'200000' },
  { ref:'#2924-2', awb:'444455556666', monto:'571433,63' }
]);
es('las dos lineas van al mismo pedido',
   T.pendingFxReport.map(e=>e.targets[0].num), ['2924','2924']);
ctx.applyFedexReport();
// En reemplazar se pone en cero UNA vez por pedido y despues suman las dos:
// el pedido salio dos veces y pago dos envios.
es('el pedido queda con los dos envios', buscar('2026-10','2924').shippingARS, '771433.63');

// ---------- memoria por guia aerea ----------
console.log('\nQueda recordado para el proximo reporte');
reset();
pedido('2026-10','3001',6); pedido('2026-10','3002',6);
importar([{ ref:'sin referencia util', awb:'777788889999', monto:'100000' }]);
es('al principio no cruza', T.pendingFxReport[0].targets.length, 0);
ctx.setFxMulti(0, '3001 3002');
es('asignado a mano a dos pedidos', T.pendingFxReport[0].targets.map(t=>t.num), ['3001','3002']);
es('se guardo en la memoria de guias', T.S.awbMap['777788889999'], '3001 3002');
ctx.applyFedexReport();
es('se repartio mitad y mitad', buscar('2026-10','3001').shippingARS, '50000.00');

// el proximo reporte con la misma guia ya sabe
importar([{ ref:'', awb:'777788889999', monto:'80000' }]);
es('el segundo reporte ya los conoce', T.pendingFxReport[0].targets.map(t=>t.num), ['3001','3002']);
es('y dice que fue a mano', T.pendingFxReport[0].matchSrc, 'manual');

// ---------- memoria vieja, de un solo numero ----------
console.log('\nLa memoria vieja de un solo pedido se sigue leyendo');
reset();
pedido('2026-10','3100',6);
T.S.awbMap = { '121212121212': '3100' };
importar([{ ref:'', awb:'121212121212', monto:'50000' }]);
es('leyo el formato viejo', T.pendingFxReport[0].targets.map(t=>t.num), ['3100']);

// ---------- volver a uno solo ----------
console.log('\nVolver atras: de varios a uno solo');
reset();
pedido('2026-10','4001',6); pedido('2026-10','4002',6);
importar([{ ref:'#4001 #4002', awb:'131313131313', monto:'60000' }]);
es('arranco con dos', T.pendingFxReport[0].targets.length, 2);
ctx.setFxMatch(0, '2026-10|4001');
es('quedo uno solo', T.pendingFxReport[0].targets.map(t=>t.num), ['4001']);
es('la memoria quedo con uno', T.S.awbMap['131313131313'], '4001');
ctx.setFxMatch(0, '');
es('sin asignar borra la memoria', T.S.awbMap['131313131313'], undefined);
es('y no quedan pedidos', T.pendingFxReport[0].targets.length, 0);

// ---------- no romper lo que ya andaba ----------
console.log('\nLo de siempre sigue andando');
reset();
pedido('2026-10','2580',6,'525173582570');
pedido('2026-09','2500',6,'525173582591');
ctx.avisos.length = 0;
importar([
  { ref:'#2580', awb:'525173582570', monto:'150000' },
  { ref:'',      awb:'525173582591', monto:'120000', tipo:'Impuestos/aranceles' }
]);
es('el de siempre cruza por pedido', T.pendingFxReport[0].matchSrc, 'pedido');
es('el otro cruza por guia aerea',   T.pendingFxReport[1].matchSrc, 'guia');
es('y lo clasifica como duties',     T.pendingFxReport[1].type, 'duties');
ctx.applyFedexReport();
es('envio cargado entero',  buscar('2026-10','2580').shippingARS, '150000.00');
es('duties cargados en su mes', buscar('2026-09','2500').dutiesARS, '120000.00');

console.log('\nGuias distintas que comparten los primeros 10 digitos');
reset();
pedido('2026-10','5001',6,'525173582570');
pedido('2026-10','5002',6,'525173582591');
importar([{ ref:'', awb:'525173582591', monto:'90000' }]);
es('va al pedido correcto, no al del prefijo parecido',
   T.pendingFxReport[0].targets.map(t=>t.num), ['5002']);

console.log('\nUna guia que no es de ningun pedido');
reset();
pedido('2026-10','6001',6,'525173582570');
importar([{ ref:'', awb:'999999999999', monto:'70000' }]);
es('no la cruza con nada', T.pendingFxReport[0].targets.length, 0);
ctx.applyFedexReport();
es('y el pedido no se toco', buscar('2026-10','6001').shippingARS, '0');

// =====================================================================
console.log('\n' + (fallo ? 'FALLARON ' + fallo + ' de ' + (ok+fallo) : 'Pasaron las ' + ok) + ' pruebas');
process.exit(fallo ? 1 : 0);
