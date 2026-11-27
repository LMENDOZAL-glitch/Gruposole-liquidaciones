/* PDF desde tarjeta de Registro: usa exclusivamente la liquidación guardada. */
(function(){
'use strict';
const el=id=>document.getElementById(id);
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]});
const usd=v=>'USD '+(Number(v)||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const show=v=>v==null||v===''?'—':esc(v);
const num=v=>Number.isFinite(Number(v))?Number(v):0;
const list=v=>Array.isArray(v)?v:[];
const idKey=v=>String(v||'').trim().toUpperCase();
function getClaim(id){
 if(typeof claimDataByNo!=='function')return null;
 const c=claimDataByNo(id);
 return c&&idKey(c.claim)===idKey(id)?c:null;
}
function getCompensations(id){
 if(typeof compensations==='undefined'||!Array.isArray(compensations))return [];
 return compensations.filter(x=>idKey(x.claim)===idKey(id));
}
function getEdits(id){
 if(typeof claimEdits==='undefined'||!claimEdits)return {};
 let combined={};
 Object.keys(claimEdits).forEach(k=>{if(idKey(k)===idKey(id))combined={...combined,...(claimEdits[k]||{})}});
 return combined;
}
function objectText(item){
 if(item==null)return '';
 if(typeof item==='string'||typeof item==='number')return String(item);
 if(Array.isArray(item))return item.map(objectText).filter(Boolean).join(', ');
 if(typeof item==='object'){
  const code=item.code||item.codigo||item.partCode||item.sparePartCode||item.reference||item.ref||'';
  const description=item.description||item.descripcion||item.name||item.nombre||item.partName||'';
  const qty=item.qty??item.quantity??item.cantidad??item.count;
  const parts=[code,description,qty==null?'':'Cantidad: '+qty].filter(Boolean);
  return parts.length?parts.join(' · '):JSON.stringify(item);
 }
 return String(item);
}
function rowTable(headers,body,cls){
 return '<table class="'+(cls||'')+'"><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+
 (body&&body.length?body.map(row=>'<tr>'+row.map(v=>'<td>'+show(v)+'</td>').join('')+'</tr>').join(''):
 '<tr><td colspan="'+headers.length+'">Sin datos registrados.</td></tr>')+'</tbody></table>';
}
function section(title,body){return '<section><h2>'+esc(title)+'</h2>'+body+'</section>'}
function formatLines(lines,isBoxes){
 if(isBoxes){
  const b=lines.map(r=>[
   r.file||'',r.solped||'',r.po||'',r.code||'',r.description||'',r.lotQty??r.qty??'',
   r.g1??'',r.g2??'',r.requested??''
  ]);
  return rowTable(['FILE','SOLPED','OC','CÓDIGO','DESCRIPCIÓN','LOTE','G1','G2','CAJAS SOLICITADAS'],b,'detail');
 }
 const rows=lines.map(r=>[
  r.file||'',r.solped||'',r.po||'',r.code||'',r.description||'',r.lotQty??r.qty??'',
  r.importedBadQty??r.chargeQty??r.noRecovered??'',
  r.defect||r.source||r.treatment||''
 ]);
 return rowTable(['FILE','SOLPED','OC','CÓDIGO','DESCRIPCIÓN','CANT. INVOLUCRADA','NO RECUP. / COBRADA','DEFECTO / ORIGEN'],rows,'detail');
}
function technicalLines(c){
 const base=list(c?.builderSnapshot?.lines);
 if(base.length)return base;
 return list(c?.rows);
}
function printTechnical(c){
 const rows=technicalLines(c);
 let hasDetails=false;
 let entries=rows.map((r,i)=>{
  const serials=list(r.serials).length?list(r.serials):typeof r.serials==='string'?[r.serials]:[];
  const requested=list(r.spareParts);
  const broken=list(r.defectiveSpareParts);
  const details=String(r.sparePartsDetail||r.sparePartCode||'').trim();
  const opts=[];
  if(serials.length){hasDetails=true;opts.push('<div><strong>Series ('+serials.length+')</strong><p class="wrap">'+serials.map(x=>esc(objectText(x))).join(' · ')+'</p></div>')}
  if(requested.length){hasDetails=true;opts.push('<div><strong>Repuestos solicitados</strong><ul>'+requested.map(x=>'<li>'+esc(objectText(x))+'</li>').join('')+'</ul></div>')}
  if(broken.length){hasDetails=true;opts.push('<div><strong>Repuestos defectuosos</strong><ul>'+broken.map(x=>'<li>'+esc(objectText(x))+'</li>').join('')+'</ul></div>')}
  if(details){hasDetails=true;opts.push('<div><strong>Observaciones de repuestos</strong><p class="wrap">'+esc(details)+'</p></div>')}
  if(!opts.length)return '';
  return '<article class="tech"><h3>'+esc(r.code||'Código '+(i+1))+' · '+esc(r.description||'')+'</h3>'+opts.join('')+'</article>';
 }).filter(Boolean);
 return hasDetails?section('Series y repuestos registrados',entries.join('')):'';
}
function costs(c){
 const snapshot=c.builderSnapshot||{},rw=c.manualRework||{};
 const raw=list(snapshot.costDetailRows).length?snapshot.costDetailRows:list(rw.detailRows);
 const rows=raw.map(r=>{
  if(Array.isArray(r))return [r[0]??'',r[1]??'',r[2]===undefined?'':Number(r[2]).toLocaleString('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2}),r[3]===undefined?'':usd(r[3])];
  return [r.concept||r.name||'',r.detail||'',r.pen??'',r.usd===undefined?'':usd(r.usd)];
 });
 let bits=[];
 if(raw.length)bits.push(rowTable(['CONCEPTO','DETALLE','PEN','USD'],rows,'costs'));
 if(Number.isFinite(Number(c.productChargeTotal)))bits.push('<p><strong>Cobro por producto registrado:</strong> '+usd(c.productChargeTotal)+'</p>');
 if(Number.isFinite(Number(c.reworkChargeTotal)))bits.push('<p><strong>Reproceso registrado:</strong> '+usd(c.reworkChargeTotal)+'</p>');
 if(c.oldFormat||snapshot.oldFormat)bits.push('<p class="note">Liquidación histórica: el monto solicitado se toma del importe guardado y no se recalcula a partir de los conceptos.</p>');
 if(!bits.length)bits.push('<p class="note">No se registró un desglose adicional de costos en esta ficha.</p>');
 return section('Detalle de costos guardado',bits.join(''));
}
function tracking(id){
 const edits=getEdits(id);
 const out=[];
 if(edits.nextFollowUpDate)out.push('<p><strong>Próximo seguimiento:</strong> '+show(edits.nextFollowUpDate)+'</p>');
 if(edits.trackingNote)out.push('<p><strong>Nota de seguimiento:</strong> '+esc(edits.trackingNote)+'</p>');
 const events=list(edits.trackingEvents);
 if(events.length)out.push(rowTable(['FECHA','TIPO / ESTADO','DETALLE'],events.map(e=>[
 e.date||e.fecha||e.createdAt||'',e.type||e.status||e.title||'',e.note||e.detail||e.text||''
 ]),'tracking'));
 const cal=list(edits.calendarEvents);
 if(cal.length)out.push(rowTable(['FECHA','DETALLE'],cal.map(e=>[e.date||e.fecha||'',e.note||e.detail||e.title||'']),'tracking'));
 return out.length?section('Seguimiento registrado',out.join('')):'';
}
function documentHtml(c){
 const isBoxes=String(c.claimType||'PRODUCTO').toUpperCase().includes('CAJA');
 const rows=list(c.rows);
 const comps=getCompensations(c.claim),paid=comps.reduce((sum,x)=>sum+num(x.value),0);
 const amount=num(c.amount),remaining=Math.max(0,amount-paid);
 const closed=['CONCLUIDO','CERRADO'].includes(String(c.status||'').toUpperCase());
 const files=[...new Set(rows.map(r=>r.file).filter(Boolean))].join(' / ');
 const pos=[...new Set(rows.map(r=>r.po).filter(Boolean))].join(' / ');
 const solpeds=[...new Set(rows.map(r=>r.solped).filter(Boolean))].join(' / ');
 const brand=c.brand||c.builderSnapshot?.brand||'';
 const cash='<div class="summary">'+[
  ['Monto solicitado',usd(amount)],['Monto recuperado',usd(paid)],
  ['Saldo pendiente',usd(closed?0:remaining)],['Saldo no recuperado',usd(closed?remaining:0)]
 ].map(p=>'<div><small>'+p[0]+'</small><b>'+p[1]+'</b></div>').join('')+'</div>';
 const notes=String(c.observations||'').trim();
 const cost=costs(c);
 const boxes=c.boxSummary?'<p><strong>Cajas solicitadas:</strong> '+show(c.boxSummary.boxes)+
  ' &nbsp; <strong>Paletas:</strong> '+show(c.boxSummary.pallets)+
  ' &nbsp; <strong>Viajes:</strong> '+show(c.boxSummary.trips)+'</p>':'';
 const tableComps=comps.length?section('Compensaciones registradas',rowTable(['FECHA','TIPO','DETALLE','RECUPERADO USD'],
  comps.map(x=>[x.date||'',x.type||'',x.detail||'',usd(x.value)]),'costs')):'';
 const logo=new URL('grupo_sole_logo_oficial_extraido.png',document.baseURI).href;
 const text='<!doctype html><html lang="es"><head><meta charset="utf-8"><title>SOLE_LIQUIDACION_'+esc(c.claim)+'</title>'+
 '<style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#22364b;font-size:10px;line-height:1.45}header{border-bottom:3px solid #52658a;padding-bottom:14px;margin-bottom:16px;display:flex;align-items:center;gap:15px;justify-content:space-between}header img{width:135px;max-height:62px;object-fit:contain}header .headinfo{text-align:right}h1{font-size:20px;color:#3f5680;margin:0}h2{font-size:12px;background:#e9eef6;border-left:4px solid #506586;padding:6px 10px;margin:19px 0 9px}h3{font-size:11px;margin:3px 0 6px}section{break-inside:auto;margin:8px 0 15px}p{margin:6px 0;white-space:pre-wrap}ul{margin:4px 0;padding-left:22px}li{margin:2px 0}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px 15px;margin-bottom:14px}.meta div{border-bottom:1px solid #e2e8f0;padding:3px 0}.meta strong{display:block;font-size:9px;color:#60738a;text-transform:uppercase}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.summary div{padding:12px 10px;border:1px solid #dbe3ed;background:#f5f8fb;border-radius:6px}.summary small{display:block;color:#62758c;font-size:9px}.summary b{display:block;font-size:16px;color:#294662;margin-top:5px}table{width:100%;border-collapse:collapse;table-layout:auto;font-size:9px}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #d6dde7;padding:6px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eaf0f6;color:#344e70;font-size:8px;text-transform:uppercase}.detail td:nth-child(5){min-width:130px}.tech{break-inside:avoid;border:1px solid #dfe6ee;margin:7px 0;padding:10px 12px;border-radius:6px}.tech>div{margin:7px 0}.wrap{overflow-wrap:anywhere;white-space:normal}.note{color:#65788b;font-size:9px}.foot{border-top:1px solid #d9e1eb;margin-top:25px;padding-top:10px;font-size:8px;color:#64758a}.screenbutton{background:#4d6285;color:white;border:0;padding:11px 17px;border-radius:7px;font-size:12px;cursor:pointer;margin-bottom:15px}.no-print-info{padding:10px;background:#e9f3fb;margin-bottom:12px;border-radius:7px;color:#26466a}@media print{.screenbutton,.no-print-info{display:none!important}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>'+
 '<div class="no-print-info">Documento de solo lectura generado desde la liquidación guardada. Selecciona «Imprimir / Guardar como PDF» y elige «Guardar como PDF».</div>'+
 '<button type="button" class="screenbutton" onclick="window.print()">Imprimir / Guardar como PDF</button>'+
 '<header><img src="'+esc(logo)+'" alt="Grupo Sole"><div class="headinfo"><h1>LIQUIDACIÓN DE CALIDAD</h1><div>'+(isBoxes?'CAJAS':'PRODUCTO')+' · '+show(c.claim)+'</div></div></header>'+
 '<div class="meta">'+[
  ['Liquidación',c.claim],['Proveedor',c.supplier],['Estado',c.status],
  ['Fecha de liquidación',c.date||c.builderSnapshot?.date],['Marca',brand],['Elaborado por',c.preparedBy||c.builderSnapshot?.preparedBy],
  ['FILE',files],['SOLPED',solpeds],['OC',pos]
 ].map(x=>'<div><strong>'+esc(x[0])+'</strong>'+show(x[1])+'</div>').join('')+'</div>'+
 cash+
 section('Detalle de '+(isBoxes?'cajas':'productos'),formatLines(rows,isBoxes)+boxes)+
 (!isBoxes?printTechnical(c):'')+
 cost+
 tableComps+
 tracking(c.claim)+
 (notes?section('Observaciones / acuerdos','<p>'+esc(notes)+'</p>'):'')+
 '<div class="foot">Grupo Sole · Control de Calidad · Generado desde la información guardada. Los importes no se recalculan ni modifican al imprimir.</div>'+
 '</body></html>';
 return text;
}
function pdf(id){
 if(!document.documentElement.classList.contains('sole-authorized')){alert('Debes iniciar sesión con un usuario autorizado.');return}
 const c=getClaim(id);
 if(!c){alert('No se encontró la liquidación '+id+' en el registro actual. Actualiza la página e inténtalo otra vez.');return}
 let w=window.open('','_blank');
 if(!w){alert('Permite las ventanas emergentes para generar el PDF.');return}
 try{
  w.document.open();
  w.document.write(documentHtml(c));
  w.document.close();
  // Esperar a que se cargue el logotipo antes de abrir la impresión.
  const run=()=>{if(w.closed)return;try{w.focus();w.print()}catch(e){console.warn('No se abrió impresión automáticamente',e)}};
  const img=w.document.querySelector('header img');
  if(img&&!img.complete){
   img.addEventListener('load',()=>setTimeout(run,180),{once:true});
   img.addEventListener('error',()=>setTimeout(run,180),{once:true});
   setTimeout(()=>{if(!w.closed)w.document.querySelector('.screenbutton')?.focus()},1800);
  }else setTimeout(run,350);
 }catch(e){w.close();console.error(e);alert('No se pudo generar el documento: '+(e.message||e))}
}
function enhance(){
 const root=el('claimList');if(!root)return;
 root.querySelectorAll('.claim-record').forEach(card=>{
  const actions=card.querySelector('.claim-record-actions'),no=card.querySelector('.claim-record-head > div:first-child > b');
  if(!actions||!no||actions.querySelector('[data-sole-print]'))return;
  const claim=no.textContent.trim();if(!claim)return;
  const b=document.createElement('button');
  b.type='button';b.className='btn ghost';b.dataset.solePrint='1';b.textContent='Generar PDF';
  b.title='Documento PDF de la liquidación guardada; no modifica el registro ni abre la edición';
  b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();pdf(claim)});
  actions.insertBefore(b,actions.firstChild);
 });
}
function install(){
 if(install.done)return;
 const root=el('claimList');if(!root)return;
 install.done=true;enhance();
 const observer=new MutationObserver(()=>enhance());
 observer.observe(root,{childList:true,subtree:true});
}
window.soleGenerarPdfRegistro=pdf;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);
else install();
window.addEventListener('load',install);
})();