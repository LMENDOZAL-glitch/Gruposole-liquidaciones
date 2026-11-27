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
 const k=original.toLowerCase().replace(/[.,;:]+$/,'').replace(/\s+/g,' ');
 const frases=[
  [/\bignition pin fractured at the joint\b/gi,'Pin de encendido fracturado en la unión'],
  [/\bpoor coating finish on bases\b/gi,'Acabado deficiente del recubrimiento de las bases'],
  [/\bpoor coating finish\b/gi,'Acabado deficiente del recubrimiento'],
  [/\bignition pin\b/gi,'pin de encendido'],
  [/\bignition electrode\b/gi,'electrodo de encendido'],
  [/\bno electric arc\b/gi,'no se genera el arco eléctrico'],
  [/\bno spark\b/gi,'no se genera chispa'],
  [/\bwater leakage\b/gi,'fuga de agua'],
  [/\bgas leakage\b/gi,'fuga de gas'],
  [/\bincorrect wiring\b/gi,'cableado incorrecto'],
  [/\bwrong wiring\b/gi,'cableado incorrecto'],
  [/\bcracked glass\b/gi,'vidrio fisurado'],
  [/\bbroken glass\b/gi,'vidrio roto'],
  [/\bscratches\b/gi,'rayaduras'],
  [/\bdeformation\b/gi,'deformación'],
  [/\bdiscoloration\b/gi,'decoloración'],
  [/\bbroken\b/gi,'roto'],
  [/\bfractured\b/gi,'fracturado'],
  [/\bdetached\b/gi,'desprendido'],
  [/\bmissing\b/gi,'faltante'],
  [/\brust\b/gi,'óxido']
 ];
 if(!/[a-z]/i.test(k))return original;
 let translated=original,recognized=false;
 for(const [pattern,replacement] of frases){
   if(pattern.test(translated)){translated=translated.replace(pattern,replacement);recognized=true}
 }
 // No mostrar una traducción parcial como si fuera una descripción técnica verificada.
 const rest=translated.replace(/\b(?:pin de encendido|electrodo de encendido|no se genera el arco eléctrico|no se genera chispa|fuga de agua|fuga de gas|cableado incorrecto|vidrio fisurado|vidrio roto|rayaduras|deformación|decoloración|roto|fracturado|desprendido|faltante|óxido|Acabado deficiente del recubrimiento de las bases|Acabado deficiente del recubrimiento|Pin de encendido fracturado en la unión)\b/gi,'').replace(/[0-9\s.,;:/()\-–]+/g,'').trim();
 if(recognized && (!rest || !/[a-z]{3,}/i.test(rest)))return translated;
 if(/^[^\x00-\x7F]*[\u00C0-\u024F]/.test(original)||/\b(?:falla|defecto|fisura|rotura|fuga|rayadura|desprendimiento|problema|daño|soldadura|encendido)\b/i.test(original))return original;
 return 'Traducción al español pendiente de validar';
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
 const title=card.querySelector('.claim-record-head b');
 const id=title?.textContent?.trim();if(!id)return;
 const c=claimById(id);if(!c||String(c.claimType||'PRODUCTO').toUpperCase().includes('CAJA'))return;
 const target=card.querySelector('.claim-record-detail');if(!target)return;
 const data=defectList(c);
 const section=document.createElement('section');section.dataset.soleMotivos='1';section.className='sole-motivos-reproceso';
 const heading=document.createElement('div');heading.className='sole-motivos-head';
 const label=document.createElement('b');label.textContent='Motivo del reclamo / defecto del reproceso';
 heading.append(label);
 const general=document.createElement('p');general.className='sole-motivos-general';
 general.textContent=data.general?'Motivo general: '+enEspanol(data.general):
   'Motivo general no registrado. Completa el defecto en «Editar liquidación» para que tu jefa pueda identificarlo.';
 section.append(heading,general);
 if(data.general)general.title='Texto original: '+data.general;
 if(data.result.length){
  const table=document.createElement('table');table.className='sole-motivos-table';
  const th=document.createElement('thead');th.innerHTML='<tr><th>CÓDIGO</th><th>FILE</th><th>DEFECTO OBSERVADO</th></tr>';table.append(th);
  const tb=document.createElement('tbody');
  data.result.forEach(r=>{
    const tr=document.createElement('tr');
    [r.code||'—',r.file||'—',r.defect?enEspanol(r.defect): (data.general?'Ver motivo general indicado arriba':'Defecto específico pendiente de registrar')].forEach((v,i)=>{
      const td=document.createElement('td');td.textContent=v;
      if(i===2&&(!r.defect||enEspanol(r.defect).startsWith('Traducción al español pendiente')))td.className='sole-motivos-missing';
      if(i===2&&r.defect)td.title='Texto original: '+r.defect;
      tr.append(td);
    });tb.append(tr);
  });table.append(tb);section.append(table);
 }else{
  const p=document.createElement('p');p.className='sole-motivos-missing';p.textContent='No hay códigos registrados para identificar el defecto.';section.append(p);
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
  st.textContent='.sole-motivos-reproceso{border:1px solid #d2e1ea;background:#f7fafc;border-radius:10px;padding:12px 14px;margin:10px 0 14px;color:#243e53}.sole-motivos-head{font-size:13px;color:#1b4561}.sole-motivos-general{font-size:12px;margin:7px 0}.sole-motivos-table{width:100%;border-collapse:collapse;font-size:12px}.sole-motivos-table th{text-align:left;background:#e5eef5;padding:8px}.sole-motivos-table td{padding:8px;border-bottom:1px solid #dce5ec;vertical-align:top}.sole-motivos-missing{color:#a05a17;font-weight:600}.sole-origin-diagnostic{border:1px solid #bbcee0;background:#f0f6fa;border-radius:10px;margin:10px 0;padding:14px;color:#29435c}.sole-origin-diagnostic p{font-size:12px;line-height:1.5}';
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