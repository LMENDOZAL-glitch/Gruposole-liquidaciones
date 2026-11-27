/* Consolidado de productos bloqueados — solo crea un borrador nuevo.
   No modifica los registros originales ni Firestore hasta guardar la liquidación. */
(function(){
'use strict';
let mode='FILE', quantities={};
const $=id=>document.getElementById(id);
const norm=v=>String(v??'').trim().toUpperCase().replace(/\s+/g,' ');
const get=(r,fields)=>typeof qaGet==='function'?qaGet(r,fields):'';
const group=r=>({file:String(get(r,['FILE'])||'').trim(),
  supplier:String(get(r,['PROVEEDOR','PROVIDER','SUPPLIER'])||'').trim()});
const rowsAll=()=>qaData&&Array.isArray(qaData.pt)?qaData.pt:[];
const key=r=>qaSelectionKey(r);
const selected=()=>rowsAll().filter(r=>qaSelected.has(key(r)));
function sameSupplier(r){
 const a=selected();if(!a.length)return true;
 const first=norm(group(a[0]).supplier),candidate=norm(group(r).supplier);
 return !!first&&candidate===first;
}
function compatible(r){
 if(!qaSelected.size)return true;
 if(mode==='BLOQUEADOS')return sameSupplier(r);
 const a=selected()[0];if(!a)return true;
 return group(a).file===group(r).file&&sameSupplier(r);
}
function status(){
 const list=selected(),files=[...new Set(list.map(r=>group(r).file).filter(Boolean))];
 const count=$('excelSelectedCount'),bar=$('excelSelectBar'),info=$('excelSelectedGroup');
 if(count)count.textContent=String(list.length);
 if(bar)bar.classList.toggle('show',list.length>0);
 if(info)info.textContent=!list.length?'':mode==='BLOQUEADOS'?
  'CONSOLIDADO BLOQUEADOS · '+group(list[0]).supplier+' · '+files.length+' FILE · '+
  list.filter(r=>Number.isInteger(quantities[key(r)])).length+'/'+list.length+' cantidades registradas'
  :'FILE '+(files[0]||'—')+' · '+group(list[0]).supplier;
}
function switchMode(v){
 mode=v==='BLOQUEADOS'?'BLOQUEADOS':'FILE';
 qaSelected.clear();quantities={};window.renderExcelQueue();status();
}
window.excelChangeBlockedMode=switchMode;
window.excelBlockedQtyChanged=function(i,v){
 const r=(window._excelQueueRows||[])[i];if(!r)return;
 const k=key(r),str=String(v??'').trim();
 if(!str){delete quantities[k];status();return}
 const qty=Number(str),lot=Number(get(r,['CANT/LOTE'])||0);
 if(!Number.isInteger(qty)||qty<1||(lot>0&&qty>lot)){
  delete quantities[k];
  alert('Cantidad bloqueada inválida. Indica un entero mayor que cero'+(lot>0?' y no superior al lote '+lot:'')+'.');
  window.renderExcelQueue();return;
 }
 quantities[k]=qty;status();
};
function decorate(){
 const page=$('excelqueue');if(!page)return;
 const head=page.querySelector('.excel-queue-head');
 if(head&&!$('soleBlockedModeBox')){
  const wrap=document.createElement('div');wrap.id='soleBlockedModeBox';
  wrap.style.cssText='padding:13px 15px;margin:8px 0;border:1px solid #cbd9e6;border-radius:12px;background:#f2f6fa;display:flex;align-items:center;flex-wrap:wrap;gap:12px;color:#24425e;font-size:12px';
  const label=document.createElement('label');label.textContent='TIPO DE CONSOLIDADO';
  label.style.cssText='font-size:11px;font-weight:800;display:flex;align-items:center;gap:9px';
  const select=document.createElement('select');select.id='soleBlockedMode';
  select.style.cssText='border:1px solid #bbcbd9;border-radius:8px;padding:9px;max-width:370px;color:#1d3c58;background:#fff';
  select.innerHTML='<option value="FILE">Normal — mismo FILE y proveedor</option><option value="BLOQUEADOS">Productos bloqueados — varios FILE del mismo proveedor</option>';
  select.value=mode;select.onchange=()=>switchMode(select.value);
  label.append(select,wrapText('El modo bloqueados requiere ingresar la cantidad real por código; no utiliza automáticamente todo el lote.'));
  wrap.appendChild(label);
  head.after(wrap);
 }
 const table=page.querySelector('.excel-queue-table');
 if(!table)return;
 const h=table.querySelector('thead tr');
 if(h&&!h.querySelector('[data-sole-blocked]')){
  const col=document.createElement('th');col.dataset.soleBlocked='1';col.textContent='CANT. BLOQUEADA';
  h.insertBefore(col,h.children[9]||null);
 }
 const trs=[...table.querySelectorAll('tbody tr')];
 const visible=window._excelQueueRows||[];
 trs.forEach((tr,i)=>{
  const r=visible[i];if(!r)return;
  const k=key(r),check=tr.querySelector('.excel-row-check'),on=qaSelected.has(k);
  if(check)check.checked=on;
  tr.style.opacity=compatible(r)||on?'1':'.55';
  let td=tr.querySelector('td[data-sole-blocked]');
  if(!td){td=document.createElement('td');td.dataset.soleBlocked='1';tr.insertBefore(td,tr.children[9]||null)}
  td.replaceChildren();
  if(mode!=='BLOQUEADOS'){td.textContent='—';return}
  const input=document.createElement('input');input.type='number';input.min='1';input.step='1';
  input.style.cssText='width:94px;padding:8px;border:1px solid #bdcad8;border-radius:7px;font-size:12px;background:#fff;color:#253a55';
  input.value=quantities[k]??'';input.placeholder='Unidades';
  input.disabled=!on;input.title='Cantidad bloqueada de este código para el nuevo reproceso';
  input.setAttribute('aria-label','Cantidad bloqueada de '+String(get(r,['CODIGO','CÓDIGO'])||'código'));
  input.onchange=()=>window.excelBlockedQtyChanged(i,input.value);
  td.append(input);
 });
 status();
}
function wrapText(s){
 const span=document.createElement('span');span.style.cssText='font-size:11px;font-weight:400;color:#64778b';
 span.textContent=s;return span;
}
function pick(i,on){
 const r=(window._excelQueueRows||[])[i];if(!r)return;
 if(on&&!compatible(r)){
  const a=selected()[0],ga=a?group(a):{},gb=group(r);
  alert(mode==='BLOQUEADOS'?
   'No puedes consolidar proveedores diferentes.\nProveedor seleccionado: '+ga.supplier+'\nProveedor elegido: '+gb.supplier:
   'La liquidación normal exige el mismo FILE y proveedor.');
  window.renderExcelQueue();return;
 }
 if(on)qaSelected.add(key(r));else{qaSelected.delete(key(r));delete quantities[key(r)]}
 window.renderExcelQueue();
}
function selectAll(){
 const visible=window._excelQueueRows||[];
 const ref=selected()[0]||visible[0];
 if(!ref)return;
 const g=group(ref);
 visible.filter(r=>norm(group(r).supplier)===norm(g.supplier)&&(mode==='BLOQUEADOS'||group(r).file===g.file))
 .forEach(r=>qaSelected.add(key(r)));
 window.renderExcelQueue();
}
function clear(){qaSelected.clear();quantities={};window.renderExcelQueue()}
function createOne(i){
 const r=(window._excelQueueRows||[])[i];if(!r)return;
 if(mode==='FILE'){
  qaSelected.clear();qaSelected.add(key(r));qaCreateClaimFromSelected();return;
 }
 qaSelected.clear();quantities={};qaSelected.add(key(r));
 window.renderExcelQueue();
 alert('Ingresa la cantidad bloqueada de este código. Después pulsa «Generar liquidación con seleccionados».');
}
function createSelected(){
 const rs=selected();
 if(!rs.length){alert('Selecciona uno o más códigos.');return}
 const supplier=norm(group(rs[0]).supplier);
 if(!supplier||rs.some(r=>norm(group(r).supplier)!==supplier)){
  alert('Todos los códigos deben tener el mismo proveedor identificado.');return;
 }
 const files=[...new Set(rs.map(r=>group(r).file))];
 if(mode==='FILE'){
  if(files.length>1){alert('La liquidación normal solo permite un FILE.');return}
  qaCreateClaimFromSelected();return;
 }
 for(const r of rs){
  const q=quantities[key(r)],lot=Number(get(r,['CANT/LOTE'])||0);
  if(!Number.isInteger(q)||q<=0||(lot>0&&q>lot)){
   alert('Completa la cantidad bloqueada de todos los códigos seleccionados antes de continuar.');return;
  }
 }
 if(!confirm('Crear borrador de NUEVO REPROCESO consolidado del proveedor '+group(rs[0]).supplier+
    '\nRegistros: '+rs.length+' · FILE distintos: '+files.length+
    '\nCantidad bloqueada total: '+rs.reduce((a,r)=>a+quantities[key(r)],0)+
    '\n\nNo se alterarán los reprocesos originales. Revisa los costos antes de guardar.'))return;
 qaCreateClaimFromSelected({blocked:true,quantities:{...quantities}});
}
function install(){
 const oldRender=window.renderExcelQueue;
 if(typeof oldRender!=='function'||!$('excelqueue'))return false;
 if(window.__soleBlockedConsolidatedInstalled)return true;
 window.__soleBlockedConsolidatedInstalled=true;
 window.renderExcelQueue=function(){oldRender.apply(this,arguments);decorate()};
 window.excelToggleSelect=pick;
 window.excelSelectVisible=function(on){if(on)selectAll();else clear()};
 window.excelClearSelection=clear;
 window.excelQueueCreate=createOne;
 window.excelQueueCreateSelected=createSelected;
 window.renderExcelQueue();
 return true;
}
window.addEventListener('load',()=>{let count=0;const timer=setInterval(()=>{count++;if(install()||count>30)clearInterval(timer)},180)});
})();