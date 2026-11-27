/* Lectura de defectos y diagnóstico de correlativos, solo visualización.
   No altera Firebase ni elimina registros. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const upper=x=>String(x??'').trim().toUpperCase();
const norm=x=>{const v=upper(x).replace(/\s+/g,'');const m=/^(\d{4})-(\d+)(SN)?$/.exec(v);return m?m[1]+'-'+String(Number(m[2])).padStart(3,'0')+(m[3]||''):v};
const good=x=>{
 const v=String(x||'').trim();
 return v&&!/^(REPROCESO|DEVOLUCI[ÓO]N CLIENTE)(?:\s*·.*)?$/i.test(v)
   && !/^(COBRAR REPROCESO|COBRAR PRODUCTO|NO COBRAR|REWORK COST|PRODUCT CHARGE)$/i.test(v) ? v:'';
};
function claimById(id){
 const key=norm(id);
 try{
   const c=(Array.isArray(localClaims)?localClaims:[]).find(c=>norm(c.claim)===key);
   if(c)return c;
   if(typeof claimDataByNo==='function')return claimDataByNo(id)||null;
 }catch(_){}
 return null;
}
function entryOrigins(id){
 const key=norm(id),entries=[];
 const add=(type,detail)=>{if(!entries.some(x=>x.type===type))entries.push({type,detail})};
 try{
  if(Array.isArray(localClaims)){
   const c=localClaims.find(x=>norm(x.claim)===key);
   if(c)add('Liquidación local',String(c.supplier||'Proveedor sin registrar')+' · USD '+Number(c.amount||0).toFixed(2)+' · '+String(c.documentName||''));
  }
  if(Array.isArray(HIST)&&HIST.some(x=>norm(x.claim)===key))add('Histórico importado','Registrado en la base histórica; puede no pertenecer a la vista de producto');
  if(Array.isArray(boxDb?.rows)&&boxDb.rows.some(x=>[x.claim,x.claimUnique,x.claimRaw].some(y=>norm(y)===key)))add('Liquidación de cajas','Revisa la pestaña CAJAS');
  if(typeof claimEdits==='object'&&claimEdits&&Object.keys(claimEdits).some(x=>norm(x)===key))add('Seguimiento o edición','Existe una referencia de seguimiento, aunque no haya ficha visible');
  if(typeof compensations!=='undefined'&&Array.isArray(compensations)&&compensations.some(x=>norm(x.claim)===key))add('Compensación','Existen pagos o compensaciones vinculadas al correlativo');
  if(typeof deletedClaims!=='undefined'&&deletedClaims&&[...deletedClaims].some(x=>norm(x)===key))add('Registro oculto','El número figura entre los ocultados; no se eliminará ni reutilizará automáticamente');
 }catch(err){console.warn('Diagnóstico de correlativo',err)}
 return entries;
}
function explainId(id){
 const entries=entryOrigins(id);
 if(!entries.length)return 'No se encontró el número entre las fuentes accesibles de esta sesión. Comprueba que la nube haya terminado de cargar; no se debe reutilizar sin verificar.';
 return entries.map(x=>x.type+': '+x.detail).join('\n');
}
window.soleDiagnosticarCorrelativo=explainId;
/* Traducción visual al español: el texto original se conserva en la base.
   Términos técnicos aprobados para los casos conocidos; no se inventan traducciones. */
function enEspanol(raw){
 const original=String(raw||'').trim();
 if(!original)return '';
 // Una descripción ya registrada en español debe permanecer intacta.
 const spanish=/\b(?:soporte|vidrio|roto|rota|fisura|fractura|fracturado|fuga|agua|gas|encendido|electrodo|pin|dañado|dañada|desprendido|desalineado|mal|deficiente|rayaduras|rayado|óxido|oxidación|soldadura|manchas|empaque|cableado|incorrecto|tornillo|defecto|falla|problema|base|conexión|quemador|funciona|incompleto|incompleta|faltante|reproceso)\b/i;
 if(spanish.test(original)&&!/\b(?:broken|cracked|leakage|fractured|wrong|poor|missing|rust|scratched|misaligned|damaged|bracket|coating|ignition|wiring|glass|failure)\b/i.test(original))return original;
 const map=[
  [/glass (?:support|bracket) broken/gi,'Soporte de vidrio roto'],
  [/(?:broken|fractured) glass (?:support|bracket)/gi,'Soporte de vidrio roto'],
  [/glass (?:support|bracket) (?:damaged|fractured)/gi,'Soporte de vidrio dañado'],
  [/ignition pin fractured at the joint/gi,'Pin de encendido fracturado en la unión'],
  [/poor coating finish on bases/gi,'Acabado deficiente del recubrimiento de las bases'],
  [/poor coating finish/gi,'Acabado deficiente del recubrimiento'],
  [/no electric arc/gi,'No se genera el arco eléctrico'],
  [/no spark/gi,'No se genera chispa'],
  [/water leakage/gi,'Fuga de agua'],
  [/gas leakage/gi,'Fuga de gas'],
  [/incorrect wiring|wrong wiring/gi,'Cableado incorrecto'],
  [/cracked glass/gi,'Vidrio fisurado'],
  [/broken glass/gi,'Vidrio roto'],
  [/ignition electrode/gi,'Electrodo de encendido'],
  [/ignition pin/gi,'Pin de encendido'],
  [/missing screws?/gi,'Tornillo faltante'],
  [/scratches/gi,'Rayaduras'],
  [/deformation/gi,'Deformación'],
  [/rust/gi,'Óxido']
 ];
 for(const [rx,es] of map){
   if(rx.test(original))return original.replace(rx,es);
 }
 // En textos desconocidos conservar la descripción real y marcarla para revisión.
 // Nunca reemplazar el defecto por una cadena genérica que oculte la información.
 return original;
}
function defectList(c){
 let rows=Array.isArray(c?.rows)?c.rows:[];
 let lines=Array.isArray(c?.builderSnapshot?.lines)?c.builderSnapshot.lines:[];
 const result=[];
 for(let i=0;i<Math.max(rows.length,lines.length);i++){
  const r=rows[i]||{},l=lines[i]||{};
  const code=String(r.code||l.code||'').trim();
  const file=String(r.file||l.file||'').trim();
  const defect=good(l.defect)||good(r.defect)||good(l.sourceDefects?.map(x=>x.note||x.defect).filter(Boolean).join('; '));
  if(code||file||defect)result.push({code,file,defect});
 }
 const general=good(c?.problem)||good(c?.builderSnapshot?.problem);
 return {result,general};
}
function decorateCard(card){
 if(card.querySelector('[data-sole-motivos]'))return;
 const id=card.querySelector('.claim-record-head b')?.textContent?.trim();
 if(!id)return;
 const c=claimById(id);
 if(!c||String(c.claimType||'PRODUCTO').toUpperCase().includes('CAJA'))return;
 const target=card.querySelector('.claim-record-detail');if(!target)return;
 const data=defectList(c);
 const unique=[...new Map(data.result.filter(x=>x.defect).map(r=>{
   const translated=enEspanol(r.defect);
   return [translated.toLocaleLowerCase('es'),{text:translated,original:r.defect}];
 })).values()];
 const general=data.general?enEspanol(data.general):'';
 // Evitar repetir el detalle ya existente en la tabla inferior.
 const section=document.createElement('section');
 section.dataset.soleMotivos='1';section.className='sole-motivos-reproceso';
 const heading=document.createElement('b');heading.textContent='Motivo del reproceso';
 section.append(heading);
 const content=document.createElement('span');
 content.className='sole-motivos-short';
 if(unique.length===1)content.textContent=unique[0].text;
 else if(unique.length>1)content.textContent=unique.length+' defectos registrados: '+unique.slice(0,3).map(x=>x.text).join(' · ')+(unique.length>3?' · y '+(unique.length-3)+' más':'');
 else if(general)content.textContent=general;
 else content.textContent='Pendiente de registrar en Observaciones de la liquidación';
 section.append(content);
 const note=String(c?.builderSnapshot?.notes||c?.notes||'').trim();
 if(note){
   const p=document.createElement('small');p.textContent='Observación: '+note;
   section.append(p);
 }
 if(unique.length>1){
   const d=document.createElement('details');d.className='sole-motivos-expand';
   const sum=document.createElement('summary');sum.textContent='Ver los '+unique.length+' defectos diferentes';
   const ul=document.createElement('ul');
   unique.forEach(x=>{const li=document.createElement('li');li.textContent=x.text;li.title='Texto registrado: '+x.original;ul.append(li)});
   d.append(sum,ul);section.append(d);
 }
 const original=target.querySelector('.claim-detail-table');
 if(original)target.insertBefore(section,original);
 else target.prepend(section);
}
function makeDiagnostic(){
 const search=$('claimSearch'),list=$('claimList');
 if(!search||!list)return;
 let id=norm(search.value);
 let prior=document.getElementById('soleClaimOriginDiagnostic');
 if(!/^20\d{2}-\d{3}(?:SN)?$/.test(id)){prior?.remove();return}
 const matching=[...list.querySelectorAll('.claim-record')].some(x=>norm(x.querySelector('.claim-record-head b')?.textContent)===id);
 if(matching){prior?.remove();return}
 if(!prior){
  prior=document.createElement('div');prior.id='soleClaimOriginDiagnostic';
  prior.className='sole-origin-diagnostic';
  list.parentElement.insertBefore(prior,list);
 }
 prior.replaceChildren();
 const title=document.createElement('strong');title.textContent='Diagnóstico del correlativo '+id;
 const text=document.createElement('p');text.style.whiteSpace='pre-line';text.textContent=explainId(id);
 const info=document.createElement('p');info.textContent='Si el número aparece ocupado pero no está en esta lista, puede estar oculto por filtros, pertenecer a CAJAS o existir solo como referencia histórica o de seguimiento. No lo duplicaremos.';
 prior.append(title,text,info);
 const btn=document.createElement('button');btn.type='button';btn.className='btn ghost';btn.textContent='Quitar filtros y buscar en productos';
 btn.addEventListener('click',()=>{
  for(const k of ['claimSupplier','claimStatus','claimBrand','claimYear','claimRecoveryYear']){
    const el=$(k);if(el)el.value='';
  }
  if(typeof setClaimView==='function')setClaimView('PRODUCTO');
  if(typeof renderClaims==='function')renderClaims();
 });prior.append(btn);
}
function decorate(){
 const list=$('claimList');if(!list)return;
 list.querySelectorAll('.claim-record').forEach(decorateCard);
 makeDiagnostic();
}
function init(){
 if(!document.getElementById('soleMotivosCss')){
  const st=document.createElement('style');st.id='soleMotivosCss';
  st.textContent='.sole-motivos-reproceso{border:1px solid #d2e1ea;border-left:4px solid #245777;background:#f7fafc;border-radius:8px;padding:12px 14px;margin:10px 0 14px;color:#243e53;display:flex;gap:8px 12px;flex-wrap:wrap;align-items:baseline}.sole-motivos-reproceso>b{font-size:13px;color:#1b4561}.sole-motivos-short{font-size:13px}.sole-motivos-reproceso>small{flex-basis:100%;font-size:11px;color:#526a80}.sole-motivos-expand{flex-basis:100%;font-size:12px}.sole-motivos-expand ul{margin:6px 0}.sole-origin-diagnostic{border:1px solid #bbcee0;background:#f0f6fa;border-radius:10px;margin:10px 0;padding:14px;color:#29435c}.sole-origin-diagnostic p{font-size:12px;line-height:1.5}';
  document.head.append(st);
 }
 const root=$('claimList');
 if(!root)return;
 new MutationObserver(()=>{if(!window.__soleMotivosBusy){window.__soleMotivosBusy=true;try{decorate()}finally{window.__soleMotivosBusy=false}}})
  .observe(root,{subtree:true,childList:true});
 $('claimSearch')?.addEventListener('input',()=>setTimeout(decorate,0));
 decorate();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();