/* Panel de auditoría de registros ocultos: solo restaura por decisión explícita. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const canonId=x=>String(x??'').trim().toUpperCase().replace(/\s+/g,'').replace(/^(\d{4})-(\d{1,3})$/,(_,y,z)=>y+'-'+z.padStart(3,'0'));
const css='.sole-hidden-audit{border:1px solid #cbd9e6;border-radius:12px;margin:12px 0;background:#f8fafc;padding:12px;color:#263e54}.sole-hidden-audit>summary{font-weight:800;cursor:pointer;font-size:13px}.sole-hidden-audit table{width:100%;border-collapse:collapse;margin-top:12px;font-size:12px}.sole-hidden-audit th{background:#e5edf5;text-align:left}.sole-hidden-audit td,.sole-hidden-audit th{border-bottom:1px solid #dae3ec;padding:8px;vertical-align:top}.sole-hidden-audit .muted{color:#67798a}.sole-hidden-audit button{white-space:nowrap}.sole-hidden-audit .tag{border-radius:5px;padding:3px 6px;background:#edf1f7;font-size:11px}.sole-hidden-audit .actions{display:flex;gap:5px;flex-wrap:wrap}.sole-hidden-audit .preview{max-width:450px;white-space:pre-wrap;line-height:1.5}.sole-hidden-audit .info{font-size:12px;margin:8px 0;line-height:1.5}';
function rows(){
 const hidden=typeof deletedClaims!=='undefined'?[...deletedClaims]:[];
 return [...new Set(hidden.map(canonId))].sort().map(id=>{
  const local=(typeof localClaims!=='undefined'&&Array.isArray(localClaims)?localClaims:[]).find(c=>canonId(c.claim)===id);
  const hist=(typeof HIST!=='undefined'&&Array.isArray(HIST)?HIST:[]).filter(c=>canonId(c.claim)===id);
  const box=(typeof boxDb!=='undefined'&&Array.isArray(boxDb?.rows)?boxDb.rows:[]).filter(x=>[x.claim,x.claimUnique,x.claimRaw].some(k=>canonId(k)===id));
  const source=local?'Liquidación guardada':hist.length?'Histórico importado':box.length?'Liquidación de cajas':'Solo referencia / sin ficha';
  const base=local||hist[0]||box[0]||{};
  const supplier=local?.supplier||hist.find(c=>c.supplier)?.supplier||box.find(c=>c.supplier)?.supplier||'Sin identificar';
  const amount=local?Number(local.amount||0):hist.length?Number(hist.find(x=>x.unique)?.uniqueAmount??hist[0].amount??0):Number(base.amountUnique||base.amount||0);
  const codes=[...new Set((local?.rows||hist||box).map(x=>x.code).filter(Boolean))];
  return {id,source,supplier,amount,codes,base,exists:!!(local||hist.length||box.length),hist:hist.length,local};
 });
}
function overview(row){
 let lines=[row.id+' · '+row.source,'Proveedor: '+row.supplier,'Monto referencial: USD '+row.amount.toFixed(2),'Códigos: '+(row.codes.join(', ')||'No disponibles')];
 if(row.hist)lines.push('Filas históricas: '+row.hist);
 const a=row.local?.problem||row.local?.builderSnapshot?.problem||row.base?.observations;
 if(a)lines.push('Observaciones / defecto: '+String(a).slice(0,1500));
 return lines.join('\n');
}
function render(){
 const container=$('soleHiddenAudit');
 if(!container)return;
 const data=rows();
 const summary=container.querySelector('summary');
 summary.textContent='Registros ocultos / reservados · '+data.length+' — Revisar y recuperar';
 const body=container.querySelector('tbody');body.replaceChildren();
 const msg=container.querySelector('[data-summary]');
 msg.textContent=data.length?'Estos registros están ocultos, pero conservan su numeración. Revisa la ficha antes de restaurar. No se elimina ni libera ningún número automáticamente.':'No hay registros marcados como ocultos en la base cargada.';
 for(const item of data){
  const tr=document.createElement('tr');
  for(const val of [item.id,item.supplier,item.source,'USD '+item.amount.toFixed(2)]){
   const td=document.createElement('td');td.textContent=val;tr.append(td);
  }
  const td=document.createElement('td');td.className='actions';
  const view=document.createElement('button');view.type='button';view.className='btn ghost';view.textContent='Revisar';
  view.onclick=()=>{
   const below=tr.nextElementSibling;
   if(below?.dataset?.previewFor===item.id){below.remove();return}
   const next=document.createElement('tr');next.dataset.previewFor=item.id;
   const cell=document.createElement('td');cell.colSpan=5;cell.className='preview';
   cell.textContent=overview(item);next.append(cell);tr.after(next);
  };
  td.append(view);
  if(item.exists){
    const btn=document.createElement('button');btn.type='button';btn.className='btn primary';btn.textContent='Restaurar visibilidad';
    btn.onclick=async()=>{
      if(!document.documentElement.classList.contains('sole-is-admin')){
        alert('Solo el administrador puede restaurar un registro oculto.');return;
      }
      if(!confirm('¿Restaurar la liquidación '+item.id+' ('+item.supplier+') desde Firebase?'))return;
      if(typeof window.soleGestionOcultos?.restaurar!=='function'){
        alert('La conexión de administración no está disponible. Actualiza la página con Ctrl + Shift + R.');return;
      }
      btn.disabled=true;btn.textContent='Restaurando…';
      try{
        const message=await window.soleGestionOcultos.restaurar(item.id);
        render();alert(message);
      }catch(err){alert('NO SE RESTAURÓ: '+(err?.message||err));console.error(err)}
      finally{btn.disabled=false;btn.textContent='Restaurar visibilidad'}
    };
    td.append(btn);
    const del=document.createElement('button');del.type='button';del.className='btn danger';
    del.textContent='Eliminar definitivamente';
    del.title='Eliminación de Firebase e histórico con copia de seguridad y doble confirmación';
    del.onclick=async()=>{
      if(!document.documentElement.classList.contains('sole-is-admin')){
        alert('Solo el administrador puede eliminar datos.');return;
      }
      if(!window.soleGestionOcultos?.eliminar){
        alert('El módulo de administración no está disponible. Actualiza la página.');return;
      }
      del.disabled=true;del.textContent='Verificando…';
      try{const msg=await window.soleGestionOcultos.eliminar(item.id);render();alert(msg)}
      catch(err){alert('NO SE ELIMINÓ: '+(err?.message||err));console.error(err)}
      finally{del.disabled=false;del.textContent='Eliminar definitivamente'}
    };
    td.append(del);
  }
  tr.append(td);body.append(tr);
 }
}
function install(){
 const list=$('claimList');if(!list||$('soleHiddenAudit'))return;
 const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
 const details=document.createElement('details');details.id='soleHiddenAudit';details.className='sole-hidden-audit';
 const sum=document.createElement('summary');details.append(sum);
 const info=document.createElement('p');info.dataset.summary='1';info.className='info';details.append(info);
 const table=document.createElement('table');
 table.innerHTML='<thead><tr><th>LIQUIDACIÓN</th><th>PROVEEDOR</th><th>ORIGEN</th><th>MONTO</th><th>ACCIONES</th></tr></thead><tbody></tbody>';
 details.append(table);
 const tools=document.createElement('div');tools.className='sole-hidden-admin-tools';
 tools.style.cssText='display:flex;flex-wrap:wrap;gap:10px;margin:12px 0;padding:12px;background:#eef4f8;border-radius:9px';
 const restoreFour=document.createElement('button');restoreFour.type='button';restoreFour.className='btn primary';
 restoreFour.textContent='1. Recuperar 001, 002, 003 y 016 con notas';
 restoreFour.onclick=async()=>{
  if(!document.documentElement.classList.contains('sole-is-admin')){alert('Solo administrador.');return}
  if(typeof window.soleGestionOcultos?.recuperarCuatro!=='function'){alert('Actualiza la página para cargar la recuperación.');return}
  restoreFour.disabled=true;restoreFour.textContent='Comprobando el respaldo histórico…';
  try{const result=await window.soleGestionOcultos.recuperarCuatro();render();alert(result)}
  catch(e){alert('NO SE RESTAURARON LOS DATOS: '+(e?.message||e));console.error(e)}
  finally{restoreFour.disabled=false;restoreFour.textContent='1. Recuperar 001, 002, 003 y 016 con notas'}
 };
 const bulk=document.createElement('button');bulk.type='button';bulk.className='btn primary';
 bulk.textContent='2. Limpiar los demás registros ocultos';
 bulk.onclick=async()=>{
  if(!document.documentElement.classList.contains('sole-is-admin')){
   alert('Solo el administrador puede realizar esta operación.');return;
  }
  if(!window.soleGestionOcultos?.limpiarConservando){
   alert('Actualiza la página para cargar el administrador de Firebase.');return;
  }
  bulk.disabled=true;bulk.textContent='Revisando registros en Firebase…';
  try{
   const res=await window.soleGestionOcultos.limpiarConservando();
   render();alert(res);
  }catch(e){alert('No se completó la operación. No vuelvas a intentarla sin revisar este error:\n'+(e?.message||e));console.error(e)}
  finally{bulk.disabled=false;bulk.textContent='2. Limpiar los demás registros ocultos'}
 };
 const notes=document.createElement('button');notes.type='button';notes.className='btn ghost';
 notes.textContent='Revisar notas históricas de 2026-001';
 notes.onclick=async()=>{
  if(!window.soleGestionOcultos?.notas001){alert('Actualiza la página.');return}
  notes.disabled=true;
  try{
   const report=await window.soleGestionOcultos.notas001();
   const pre=details.querySelector('[data-notes001]')||document.createElement('pre');
   pre.dataset.notes001='1';pre.style.cssText='white-space:pre-wrap;font:12px/1.5 Arial;padding:14px;margin:9px 0;background:#fff;border:1px solid #cbd9e6;border-radius:9px';
   pre.textContent=report.report;tools.after(pre);
  }catch(e){alert('No se pudieron recuperar las notas históricas: '+(e?.message||e))}
  finally{notes.disabled=false}
 };
 tools.append(restoreFour,notes,bulk);
 details.insertBefore(tools,table);
 list.parentElement.insertBefore(details,list);
 details.addEventListener('toggle',()=>{if(details.open)render()});
 render();
}
function boot(){
 install();
 const list=$('claimList');if(!list)return;
 const obs=new MutationObserver(()=>{if($('soleHiddenAudit')?.open)render()});
 obs.observe(list,{childList:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
