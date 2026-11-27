/* Comité de Fallas — tablero ejecutivo de solo lectura */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const usd=x=>'USD '+Number(x||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const n=x=>Number(x)||0;
const status=s=>{s=String(s||'PENDIENTE').trim().toUpperCase();return ['CERRADO','CONCLUIDO'].includes(s)?'done':s==='PENDIENTE'?'pending':'working'};
const date=x=>{x=String(x||'');let m=x.match(/^(\d{4}-\d\d-\d\d)/);if(m)return m[1];m=x.match(/^(\d\d)\/(\d\d)\/(\d{4})$/);return m?m[3]+'-'+m[2]+'-'+m[1]:''};
const dl=x=>{x=date(x);return x?x.slice(8,10)+'/'+x.slice(5,7)+'/'+x.slice(0,4):'Sin fecha'};
const now=()=>{let d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
let snapshot=null,ready=false,exporting=false;
function data(){
 let a=[];let type=$('exType')?.value||'PRODUCTO',year=$('exYear')?.value||'';
 try{a=type==='PRODUCTO'?productClaimData():type==='CAJAS'?boxClaimData():[...productClaimData(),...boxClaimData()]}catch(e){console.warn('Base no disponible',e)}
 const seen=new Set(),rows=[];
 for(let c of a){
  if(!c||!c.claim)continue;
  c=typeof applyClaimEdit==='function'?applyClaimEdit(c):c;
  let claim=String(c.claim).trim().toUpperCase(),key=claim+'|'+(c.claimType||'PRODUCTO');
  if(seen.has(key)||year&&!claim.startsWith(year+'-'))continue;
  seen.add(key);
  let ed={},entries=Object.entries(typeof claimEdits==='object'?claimEdits:{});
  for(let [id,v] of entries)if(String(id).toUpperCase()===claim)ed={...ed,...v};
  let amount=n(c.amount),rec=n(typeof compSum==='function'?compSum(claim):0),stage=status(c.status);
  let follow=date(ed.nextFollowUpDate),fil=Array.isArray(c.rows)?[...new Set(c.rows.map(r=>r.file).filter(Boolean))].join(' / '):'';
  rows.push({claim,supplier:String(c.supplier||'Sin proveedor'),amount,rec,balance:Math.max(0,amount-rec),stage,status:String(c.status||'PENDIENTE'),
    follow,file:fil,events:Array.isArray(ed.trackingEvents)?ed.trackingEvents.length:0,note:String(ed.trackingNote||c.observations||'')});
 }
 let m={rows,type,year,requested:0,recovered:0,pending:0,lost:0,stages:{pending:[],working:[],done:[]},suppliers:[],overdue:[],next:[],unscheduled:[],paid:0,day:now()};
 const suppliers=new Map();
 rows.forEach(x=>{
  m.requested+=x.amount;m.recovered+=x.rec;if(x.rec>0)m.paid++;
  m.stages[x.stage].push(x);
  if(x.stage==='done')m.lost+=x.balance;
  else{
   m.pending+=x.balance;
   if(x.balance>0){
    if(x.follow&&x.follow<m.day)m.overdue.push(x);
    else if(x.follow)m.next.push(x);
    else m.unscheduled.push(x);
    let s=suppliers.get(x.supplier)||{name:x.supplier,balance:0,count:0};
    s.balance+=x.balance;s.count++;suppliers.set(x.supplier,s);
   }
  }
 });
 m.suppliers=[...suppliers.values()].sort((a,b)=>b.balance-a.balance);
 m.overdue.sort((a,b)=>a.follow.localeCompare(b.follow));
 m.next.sort((a,b)=>a.follow.localeCompare(b.follow));
 return m;
}
function html(id,value){const e=$(id);if(e)e.innerHTML=value}
function shortlist(items,withMoney=false){
 if(!items.length)return '<div class="ex-empty">No hay registros en esta categoría.</div>';
 return items.slice(0,6).map(x=>'<div class="ex-item"><strong>'+esc(x.claim)+'</strong><div><strong>'+esc(x.supplier)+'</strong><div class="ex-item-sub">'+esc(x.file||x.status)+'</div></div><em>'+(withMoney?usd(x.balance):dl(x.follow))+'</em></div>').join('');
}
function refresh(){
 if(!$('soleComiteExecutive'))return;
 const m=data();snapshot=m;
 html('exKpis',[
  ['Monto solicitado',usd(m.requested),m.rows.length+' liquidaciones'],
  ['Monto recuperado',usd(m.recovered),(m.requested?((m.recovered/m.requested)*100).toFixed(1):'0')+'% recuperado','recovered'],
  ['Saldo pendiente',usd(m.pending),'Expedientes abiertos'],
  ['Saldo no recuperado',usd(m.lost),'Remanente de casos concluidos']
 ].map(a=>'<div class="ex-kpi '+(a[3]||'')+'"><small>'+a[0]+'</small><strong>'+a[1]+'</strong><span>'+a[2]+'</span></div>').join(''));
 const stages=[['pending','Pendientes'],['working','En gestión'],['done','Concluidas']];
 html('exStages',stages.map(a=>'<div class="ex-tile"><b>'+m.stages[a[0]].length+'</b><small>'+a[1]+'</small><span>'+usd(m.stages[a[0]].reduce((s,r)=>s+r.balance,0))+' en saldo</span></div>').join(''));
 html('exProgress',stages.map(a=>'<i class="'+a[0]+'" style="width:'+(m.rows.length?100*m.stages[a[0]].length/m.rows.length:0)+'%"></i>').join(''));
 html('exCollection',[
 ['Recuperación sobre solicitado',m.requested?(100*m.recovered/m.requested).toFixed(1)+'%':'0%'],
 ['Liquidaciones con recuperación',m.paid+' / '+m.rows.length],
 ['Casos abiertos con saldo',m.rows.filter(x=>x.stage!=='done'&&x.balance>0).length],
 ['Casos sin próxima fecha',m.unscheduled.length]
 ].map(a=>'<div><span>'+a[0]+'</span><b>'+a[1]+'</b></div>').join(''));
 html('exPriority',m.suppliers.slice(0,5).map((x,i)=>'<div class="ex-priority-row"><span class="ex-rank">'+String(i+1).padStart(2,'0')+'</span><div><div class="ex-supplier">'+esc(x.name)+'</div><div class="ex-subline">'+x.count+' casos abiertos</div></div><strong>'+usd(x.balance)+'</strong></div>').join('')||'<div class="ex-empty">Sin saldos pendientes.</div>');
 let todayCount=m.next.filter(x=>x.follow===m.day).length;
 html('exAlerts',[['Seguimientos vencidos',m.overdue.length],['Para hoy',todayCount],['Próximas fechas',m.next.filter(x=>x.follow>m.day).length],['Sin fecha de seguimiento',m.unscheduled.length]]
 .map(a=>'<div><span>'+a[0]+'</span><b>'+a[1]+'</b></div>').join(''));
 html('exOverdue',shortlist(m.overdue));
 html('exNext',shortlist(m.next));
 html('exTableBody',[...m.rows].filter(x=>x.stage!=='done'&&x.balance>0).sort((a,b)=>b.balance-a.balance).slice(0,12)
  .map(x=>'<tr><td><strong>'+esc(x.claim)+'</strong><div class="ex-item-sub">'+esc(x.file)+'</div></td><td>'+esc(x.supplier)+'</td><td><span class="ex-state '+x.stage+'">'+esc(x.status)+'</span></td><td class="numeric">'+usd(x.amount)+'</td><td class="numeric">'+usd(x.rec)+'</td><td class="numeric"><b>'+usd(x.balance)+'</b></td><td>'+dl(x.follow)+'</td></tr>').join('')||'<tr><td colspan="7">No hay casos abiertos con saldo.</td></tr>');
 $('exUpdated').textContent='Actualizado: '+new Date().toLocaleString('es-PE')+' · '+(m.type==='TODOS'?'Productos y cajas':m.type==='PRODUCTO'?'Productos':'Cajas')+' · '+(m.year||'Todos los años');
 $('exBalanceCheck').textContent='Conciliación solicitada = recuperada + pendiente + no recuperada'+(Math.abs(m.requested-m.recovered-m.pending-m.lost)<.05?' ✓':' (revisar compensaciones excedentes)');
}
function years(){
 let previous=$('exYear').value,ys=[];
 try{ys=[...new Set([...productClaimData(),...boxClaimData()].map(c=>String(c.claim||'').match(/^(20\d{2})-/)?.[1]).filter(Boolean))].sort().reverse()}catch(e){}
 html('exYear','<option value="">Todos</option>'+ys.map(y=>'<option value="'+y+'">'+y+'</option>').join(''));
 if(ys.includes(previous))$('exYear').value=previous;
}
function init(){
 if(ready)return true;
 let overview=$('overview');if(!overview)return false;ready=true;
 let root=document.createElement('div');root.id='soleComiteExecutive';
 root.innerHTML=
 '<div class="ex-panel ex-top"><div><span class="ex-kicker">CONTROL DE CALIDAD · COMITÉ DE FALLAS</span><h2>Estado ejecutivo de liquidaciones</h2><p>Montos, recuperación, estados, prioridades y seguimientos sin cambiar de pantalla.</p></div>'+
 '<div class="ex-filters"><label>ALCANCE<select id="exType"><option value="PRODUCTO">Productos</option><option value="CAJAS">Cajas</option><option value="TODOS">Productos y cajas</option></select></label>'+
 '<label>AÑO<select id="exYear"><option value="">Todos</option></select></label></div>'+
 '<div class="ex-actions"><button type="button" id="exCopy">Copiar informe</button><button type="button" class="ex-primary" id="exPowerpoint">Exportar PowerPoint</button></div></div>'+
 '<div class="ex-note">Para Comité de Fallas: exporta un PowerPoint editable con las cifras y casos de este resumen. Puedes copiar sus diapositivas en la presentación que elabora el comité.</div>'+
 '<div id="exKpis" class="ex-kpis"></div>'+
 '<div class="ex-layout"><div class="ex-panel"><h3>Estado de la gestión</h3><p>Distribución por etapa y saldos asociados.</p><div id="exProgress" class="ex-progress"></div>'+
 '<div class="ex-legend"><span>Pendientes</span><span>En proceso</span><span>Concluidas</span></div><div id="exStages" class="ex-tile-grid"></div><div id="exCollection" class="ex-data-grid"></div></div>'+
 '<div class="ex-panel"><h3>Proveedores prioritarios</h3><p>Mayor saldo pendiente de recuperar.</p><div id="exPriority" class="ex-priority"></div></div></div>'+
 '<div class="ex-split"><div class="ex-panel"><h3>Control de seguimientos</h3><p>Alerta de fechas vencidas y sin programar.</p><div id="exAlerts" class="ex-data-grid"></div><h4 style="margin-top:18px">Seguimientos vencidos</h4><div id="exOverdue" class="ex-items"></div></div>'+
 '<div class="ex-panel"><h3>Próximas acciones</h3><p>Expedientes abiertos con seguimiento programado.</p><div id="exNext" class="ex-items"></div></div></div>'+
 '<div class="ex-panel"><h3>Liquidaciones de mayor prioridad</h3><p>Los 12 expedientes abiertos con mayor saldo pendiente.</p><div class="ex-table-scroll"><table><thead><tr><th>Liquidación / FILE</th><th>Proveedor</th><th>Estado</th><th class="numeric">Solicitado</th><th class="numeric">Recuperado</th><th class="numeric">Saldo pendiente</th><th>Seguimiento</th></tr></thead><tbody id="exTableBody"></tbody></table></div></div>'+
 '<p id="exUpdated" class="ex-status"></p><p id="exBalanceCheck" class="ex-status"></p><p id="exPptStatus" class="ex-status" aria-live="polite"></p>';
 const top=overview.querySelector('.sole-overview-top');
 if(top)top.after(root);else overview.prepend(root);
 $('exType').onchange=refresh;$('exYear').onchange=refresh;
 $('exCopy').onclick=copyReport;$('exPowerpoint').onclick=exportPowerPoint;
 years();refresh();return true;
}
function reportText(m){
 let parts=['GRUPO SOLE — COMITÉ DE FALLAS','Estado de liquidaciones · '+dl(m.day),
 'Alcance: '+m.type+' · '+(m.year||'Todos los años'),
 'Liquidaciones: '+m.rows.length,'Pendientes: '+m.stages.pending.length,
 'En gestión: '+m.stages.working.length,'Concluidas: '+m.stages.done.length,
 'Monto solicitado: '+usd(m.requested),'Monto recuperado: '+usd(m.recovered),
 'Saldo pendiente: '+usd(m.pending),'Saldo no recuperado: '+usd(m.lost),
 'Seguimientos vencidos: '+m.overdue.length,'Casos sin seguimiento: '+m.unscheduled.length,
 '','PROVEEDORES PRIORITARIOS'];
 m.suppliers.slice(0,8).forEach(x=>parts.push(x.name+' — '+usd(x.balance)));
 parts.push('','CASOS ABIERTOS PRIORITARIOS');
 [...m.rows].filter(x=>x.stage!=='done').sort((a,b)=>b.balance-a.balance).slice(0,12)
  .forEach(x=>parts.push(x.claim+' | '+x.supplier+' | '+x.status+' | '+usd(x.balance)+' | '+dl(x.follow)));
 return parts.join('\n');
}
async function copyReport(){
 try{
  let text=reportText(data());
  await navigator.clipboard.writeText(text);$('exCopy').textContent='Copiado ✓';
  setTimeout(()=>$('exCopy')&&($('exCopy').textContent='Copiar informe'),2100);
 }catch(e){$('exPptStatus').textContent='No se pudo copiar. Revisa los permisos del navegador.'}
}
function loadPptx(){
 if(typeof window.PptxGenJS==='function')return Promise.resolve();
 return new Promise((resolve,reject)=>{
  let script=document.createElement('script');script.src='https://cdn.jsdelivr.net/gh/gitbrent/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  script.onload=()=>typeof window.PptxGenJS==='function'?resolve():reject(Error('No se encontró el generador de PowerPoint'));
  script.onerror=()=>reject(Error('No se pudo cargar el generador de PowerPoint'));
  document.head.appendChild(script);
 });
}
async function exportPowerPoint(){
 if(exporting)return;
 const m=data();
 if(!m.rows.length){$('exPptStatus').textContent='No hay liquidaciones para los filtros seleccionados.';return}
 exporting=true;$('exPowerpoint').disabled=true;$('exPptStatus').textContent='Preparando las diapositivas editables…';
 try{
  await loadPptx();
  const pptx=new window.PptxGenJS();pptx.layout='LAYOUT_WIDE';pptx.author='Grupo Sole · Control de Calidad';
  pptx.title='Comité de Fallas · Estado de liquidaciones';pptx.lang='es-PE';
  const C={blue:'4C6082',ink:'253C55',gray:'69798A',line:'DDE5EE',soft:'F3F6FA',green:'237967',orange:'AA6A33'};
  function add(sl,txt,x,y,w,h,opt){sl.addText(String(txt),Object.assign({x,y,w,h,margin:0,fontFace:'Aptos',fontSize:11,color:C.ink},opt||{}))}
  function page(title,desc,index){
   const sl=pptx.addSlide();
   sl.background={color:'FFFFFF'};
   sl.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333,h:.16,line:{color:C.blue},fill:{color:C.blue}});
   add(sl,'GRUPO SOLE  |  COMITÉ DE FALLAS',.6,.38,10,.25,{fontSize:10,color:C.blue,bold:true});
   add(sl,title,.6,.86,11.8,.54,{fontSize:26,bold:true});
   add(sl,desc,.6,1.46,11.8,.32,{fontSize:11,color:C.gray});
   sl.addShape(pptx.ShapeType.line,{x:.6,y:6.93,w:12.0,h:0,line:{color:C.line,width:1}});
   add(sl,'Fuente: SOLE Liquidaciones / Firebase · Corte '+dl(m.day),.6,7.04,10,.18,{fontSize:8,color:C.gray});
   add(sl,String(index),12.25,7.03,.25,.18,{fontSize:8,color:C.gray});
   return sl;
  }
  function metric(sl,x,y,w,label,value,color){
   sl.addShape(pptx.ShapeType.roundRect,{x,y,w,h:1.25,rectRadius:.1,line:{color:C.line},fill:{color:C.soft}});
   add(sl,label.toUpperCase(),x+.15,y+.18,w-.3,.22,{fontSize:9,bold:true,color:C.gray});
   add(sl,value,x+.15,y+.55,w-.3,.4,{fontSize:19,bold:true,color:color||C.ink});
  }
  let s=page('Estado general de liquidaciones','Vista ejecutiva · '+m.type+' · '+(m.year||'Todos los años'),1);
  metric(s,.6,2.05,2.95,'Solicitado',usd(m.requested));
  metric(s,3.67,2.05,2.95,'Recuperado',usd(m.recovered),C.green);
  metric(s,6.74,2.05,2.95,'Pendiente',usd(m.pending));
  metric(s,9.81,2.05,2.92,'No recuperado',usd(m.lost));
  add(s,'ESTADO DE LA GESTIÓN',.65,3.8,5.2,.27,{fontSize:13,bold:true});
  [['Pendientes',m.stages.pending.length],['En gestión',m.stages.working.length],['Concluidas',m.stages.done.length]]
   .forEach((a,i)=>{let x=.7+i*2.14;add(s,String(a[1]),x,4.32,1.7,.52,{fontSize:31,bold:true});add(s,a[0],x,4.92,1.9,.3,{fontSize:11,color:C.gray})});
  add(s,'RECUPERACIÓN DEL MONTO SOLICITADO',7.54,3.8,5,.26,{fontSize:13,bold:true});
  add(s,(m.requested?(100*m.recovered/m.requested):0).toFixed(1)+'%',7.54,4.3,4.2,.55,{fontSize:32,bold:true,color:C.green});
  add(s,m.rows.length+' liquidaciones · '+m.paid+' con compensaciones',7.54,5.17,5,.3,{fontSize:11,color:C.gray});
  s=page('Prioridad de recuperación','Proveedores con mayor saldo abierto y principales expedientes',2);
  add(s,'PROVEEDORES PRIORITARIOS',.65,2.07,5.4,.28,{fontSize:13,bold:true});
  m.suppliers.slice(0,6).forEach((a,i)=>{let y=2.57+i*.52;add(s,String(i+1).padStart(2,'0'),.68,y,.42,.27,{fontSize:10,color:C.gray});add(s,a.name,1.14,y,4.0,.28,{fontSize:11,bold:true});add(s,usd(a.balance),5.25,y,1.95,.28,{fontSize:11,bold:true,align:'right'})});
  add(s,'EXPEDIENTES ABIERTOS',7.48,2.07,4.9,.28,{fontSize:13,bold:true});
  [...m.rows].filter(x=>x.stage!=='done').sort((a,b)=>b.balance-a.balance).slice(0,6).forEach((a,i)=>{let y=2.57+i*.52;add(s,a.claim,7.48,y,1.3,.28,{fontSize:11,bold:true});add(s,a.supplier,8.9,y,1.9,.27,{fontSize:9});add(s,usd(a.balance),10.83,y,1.7,.27,{fontSize:10,bold:true,align:'right'})});
  s=page('Seguimiento y acciones','Alertas para el Comité de Fallas',3);
  [['Vencidos',m.overdue.length],['Programados',m.next.length],['Sin fecha',m.unscheduled.length],['Concluidos',m.stages.done.length]]
  .forEach((a,i)=>metric(s,.65+i*3.09,2.08,2.93,a[0],String(a[1])));
  add(s,'SEGUIMIENTOS VENCIDOS',.68,3.7,5.2,.3,{fontSize:13,bold:true});
  m.overdue.slice(0,6).forEach((a,i)=>{const y=4.13+i*.36;add(s,a.claim+' · '+a.supplier,.7,y,4.7,.25,{fontSize:10});add(s,dl(a.follow),5.36,y,.9,.25,{fontSize:10,color:C.orange,align:'right'})});
  add(s,'PRÓXIMOS SEGUIMIENTOS',6.9,3.7,5.2,.3,{fontSize:13,bold:true});
  m.next.slice(0,6).forEach((a,i)=>{const y=4.13+i*.36;add(s,a.claim+' · '+a.supplier,6.93,y,4.5,.25,{fontSize:10});add(s,dl(a.follow),11.43,y,1.05,.25,{fontSize:10,align:'right'})});
  s=page('Liquidaciones prioritarias','Detalle de casos abiertos con mayor saldo · cifras en USD',4);
  const cols=[.7,2.1,5.4,7.15,9,11.04],w=[1.3,3.05,1.5,1.6,1.55,1.55];
  ['Liquidación','Proveedor','Estado','Solicitado','Recuperado','Pendiente'].forEach((a,i)=>add(s,a,cols[i],2.08,w[i],.26,{fontSize:9,bold:true,color:C.gray,align:i>2?'right':'left'}));
  [...m.rows].filter(x=>x.stage!=='done'&&x.balance>0).sort((a,b)=>b.balance-a.balance).slice(0,12).forEach((a,i)=>{
   let y=2.52+i*.33,fields=[a.claim,a.supplier,a.status,usd(a.amount),usd(a.rec),usd(a.balance)];
   fields.forEach((f,j)=>add(s,String(f).length>34?String(f).slice(0,32)+'…':f,cols[j],y,w[j],.25,{fontSize:9,bold:j===0||j===5,align:j>2?'right':'left'}))
  });
  await pptx.writeFile({fileName:'SOLE_COMITE_FALLAS_LIQUIDACIONES_'+m.day+'.pptx',compression:true});
  $('exPptStatus').textContent='Presentación descargada y editable. Puedes copiar las diapositivas al PPT del Comité de Fallas.';
 }catch(e){console.error(e);$('exPptStatus').textContent='No se pudo generar PowerPoint: '+(e.message||e)}
 finally{exporting=false;$('exPowerpoint').disabled=false}
}
window.addEventListener('load',()=>{if(!init()){let count=0;const t=setInterval(()=>{count++;if(init()||count>20)clearInterval(t)},300)}});
window.soleComiteRefresh=function(){if(init())refresh()};
setInterval(()=>{if($('overview')?.classList.contains('active')&&$('soleComiteExecutive')&&!window.soleV126Online?.estado?.dirty)refresh()},12000);
})();