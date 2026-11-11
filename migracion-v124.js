/* Migración protegida de datos V124. Este archivo NO contiene datos de SOLE. */
(function(){
'use strict';
const COLLECTION='v126_demo_abierto';
const SEED_COLLECTION='sole_seed_privado';
const FIELD='sole_v126_contenido_json_v2';
const EXPECTED_FORMAT='sole-v124-reemplazo-firebase-exacto-v1';
const $=id=>document.getElementById(id);
let working=false;

const numeric=v=>Number(v)||0;
const round=v=>Math.round((numeric(v)+Number.EPSILON)*100)/100;
const claimKey=v=>String(v||'').trim().toUpperCase();
function checkLoggedAdmin(){
 const state=window.soleV126Online?.estado;
 return !!(state?.ready&&state.rol==='Administrador'&&!state.busy&&!state.dirty&&!state.conflict);
}
function toFirestore(d){
 return {
  claim:claimKey(d.claim),
  registro:d.registro==null?null:{[FIELD]:JSON.stringify(d.registro)},
  edicion:{[FIELD]:JSON.stringify(d.edicion||{})},
  compensaciones:[{[FIELD]:JSON.stringify(d.compensaciones||[])}],
  eliminada:!!d.eliminada
 };
}
function preflight(p){
 if(p?.formato==='sole-firestore-respaldo-completo-antes-v124-v1')throw Error('ARCHIVO EQUIVOCADO: seleccionaste la COPIA DE SEGURIDAD descargada de Firebase. Ese archivo conserva los datos anteriores y NO contiene las 37 liquidaciones originales. Debes seleccionar el JSON de restauración V124 original (aproximadamente 413 KB), no el de respaldo de Firebase (aproximadamente 236 KB). Aunque ambos tengan el mismo nombre, son archivos distintos. No se modificó Firebase.');
 if(!p || p.formato!==EXPECTED_FORMAT)throw Error('Archivo no válido: el respaldo correcto debe empezar con "formato": "sole-v124-reemplazo-firebase-exacto-v1". No se modificó Firebase.');
 const hist=p.historico, docs=p.documentosFirebase, summary=p.resumen;
 if(!Array.isArray(hist)||!Array.isArray(docs)||!summary)throw Error('El archivo no incluye todas las secciones requeridas.');
 if(hist.length!==summary.filasHistoricas||docs.length!==summary.registrosFirebase)throw Error('La cantidad de registros del archivo no coincide con su resumen.');
 const ids=new Set(), deletes=new Set(), groups=new Map();
 for(const d of docs){
  const id=claimKey(d.claim);
  if(!/^[A-Z0-9._-]{1,120}$/.test(id)||ids.has(id))throw Error('ID inválido o repetido: '+id);
  ids.add(id);
  if(d.registro && claimKey(d.registro.claim)!==id)throw Error('Identificador del registro no corresponde: '+id);
  if(!Array.isArray(d.compensaciones))throw Error('Compensación no válida en '+id);
  if(d.eliminada)deletes.add(id);
  const serialized=JSON.stringify(toFirestore(d));
  if(new TextEncoder().encode(serialized).length>800000)throw Error('La liquidación '+id+' supera el tamaño seguro para Firestore.');
 }
 for(const h of hist){
  const id=claimKey(h.claim);
  if(!id)throw Error('Hay liquidaciones del histórico sin número.');
  if(!groups.has(id))groups.set(id,{claim:id,amount:numeric(h.unique?h.uniqueAmount:h.amount),status:h.status,claimType:'PRODUCTO'});
  if(h.unique){const g=groups.get(id);g.amount=numeric(h.uniqueAmount||h.amount);g.status=h.status}
 }
 for(const d of docs){
  let g=groups.get(d.claim);
  if(d.registro){g={...d.registro,claim:d.claim};groups.set(d.claim,g)}
  if(g&&d.edicion)Object.assign(g,d.edicion);
 }
 for(const id of deletes)groups.delete(id);
 const active=[...groups.values()];
 const product=active.filter(d=>d.claimType!=='CAJAS');
 const boxes=active.filter(d=>d.claimType==='CAJAS');
 const sum=round(product.reduce((s,d)=>s+numeric(d.amount),0));
 const rec=round(docs.reduce((s,d)=>s+d.compensaciones.reduce((a,c)=>a+numeric(c.value),0),0));
 const closed=product.filter(d=>claimKey(d.status)==='CONCLUIDO').length;
 if(product.length!==summary.productosDespuesDeSepararSN || boxes.length!==1)
  throw Error('No se obtienen las liquidaciones esperadas. Productos: '+product.length+'; cajas: '+boxes.length+'.');
 if(Math.abs(sum-numeric(summary.solicitadoUSD))>.009||Math.abs(rec-numeric(summary.recuperadoUSD))>.009)
  throw Error('Los importes o compensaciones no coinciden con el archivo original.');
 if(closed!==summary.concluidas||product.length-closed!==summary.abiertas)throw Error('Los estados no coinciden con el respaldo.');
 if(!ids.has('2026-001SN')||!hist.some(h=>h.claim==='2026-002SN'))
  throw Error('Faltan los dos expedientes S/N numerados.');
 return {docs, hist, summary, products:product.length,boxes:boxes.length, sum,rec};
}
function dateSuffix(){return new Date().toISOString().replace(/[:.]/g,'-')}
function saveBackup(backup){
 const name='RESPALDO_FIREBASE_ANTES_MIGRACION_V124_'+dateSuffix()+'.json';
 const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
 return name;
}
async function retrieveCurrent(db){
 const claims=await db.collection(COLLECTION).get({source:'server'});
 const seeds=await db.collection(SEED_COLLECTION).get({source:'server'});
 if(claims.metadata.fromCache||seeds.metadata.fromCache)throw Error('No se recibió una copia confirmada del servidor.');
 return {
  formato:'sole-firestore-respaldo-completo-antes-v124-v1',
  projectId:db.app.options.projectId,
  fecha:new Date().toISOString(),
  colecciones:{
   [COLLECTION]:claims.docs.map(d=>({id:d.id,data:d.data()})),
   [SEED_COLLECTION]:seeds.docs.map(d=>({id:d.id,data:d.data()}))
  }
 };
}
function matchSnapshot(current,live,seedLive){
 const old=current.colecciones[COLLECTION];
 const now=live.docs.map(d=>({id:d.id,data:d.data()}));
 const oldSeeds=current.colecciones[SEED_COLLECTION];
 const nowSeeds=seedLive.docs.map(d=>({id:d.id,data:d.data()}));
 const stable=a=>JSON.stringify(a.sort((x,y)=>x.id.localeCompare(y.id)));
 return stable(old)===stable(now)&&stable(oldSeeds)===stable(nowSeeds);
}
function canonicalJson(v){
 if(v&&typeof v==='object'&&typeof v.toJSON==='function')return canonicalJson(v.toJSON());
 if(Array.isArray(v))return v.map(canonicalJson);
 if(v&&typeof v==='object'){
  const out={};for(const key of Object.keys(v).sort())out[key]=canonicalJson(v[key]);return out;
 }
 return v;
}
function equalData(a,b){return JSON.stringify(canonicalJson(a))===JSON.stringify(canonicalJson(b))}
function unpackJson(v,fallback){
 if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.prototype.hasOwnProperty.call(v,FIELD)){
  try{return JSON.parse(v[FIELD])}catch(e){return null}
 }
 return v==null?fallback:v;
}
function matchesRecord(raw,d){
 if(!raw||claimKey(raw.claim)!==claimKey(d.claim)||!!raw.eliminada!==!!d.eliminada)return false;
 const prevComp=Array.isArray(raw.compensaciones)&&raw.compensaciones.length===1
  ?unpackJson(raw.compensaciones[0],[]):raw.compensaciones;
 return equalData(unpackJson(raw.registro,null),d.registro??null)
  &&equalData(unpackJson(raw.edicion,{}),d.edicion??{})
  &&equalData(prevComp??[],d.compensaciones??[]);
}
function verifyExistingHistory(current,p){
 // El historial protegido ya fue sincronizado con el V124. No es necesario
 // sobrescribirlo ni dejarlo expuesto en GitHub.
 const item=current.colecciones[SEED_COLLECTION].find(d=>d.id==='HIST');
 if(!item)throw Error('Falta el historial HIST protegido en Firebase. No se cambió ningún expediente.');
 let hist;
 try{hist=JSON.parse(item.data.json)}catch(e){throw Error('El historial protegido HIST no se puede leer. No se cambió ningún expediente.')}
 if(!Array.isArray(hist)||hist.length!==p.hist.length)
  throw Error('El historial protegido no contiene las 48 filas requeridas. No se cambiaron expedientes.');
 const keys=['claim','solped','po','file','code','unique','uniqueAmount','amount','status','supplier','observations','defect'];
 for(let i=0;i<hist.length;i++)for(const key of keys)
  if(!equalData(hist[i]?.[key]??null,p.hist[i]?.[key]??null))
   throw Error('Diferencia en historial protegido: fila '+(i+1)+' campo '+key+'. Operación detenida sin cambios.');
}
function planChanges(p,current){
 verifyExistingHistory(current,p);
 const old=current.colecciones[COLLECTION];
 const oldMap=new Map(old.map(x=>[x.id,x.data]));
 const expected=new Set(p.docs.map(d=>d.claim));
 const extras=old.filter(x=>!expected.has(x.id)&&!x.data.eliminada&&!x.data.archivadoV124);
 if(extras.length)throw Error('Firebase contiene expedientes adicionales fuera del respaldo V124: '+
   extras.map(x=>x.id).join(', ')+'. No se sustituirán ni borrarán automáticamente.');
 const changes=p.docs.filter(d=>!matchesRecord(oldMap.get(d.claim),d));
 const creating=changes.filter(d=>!oldMap.has(d.claim));
 const recovering=changes.filter(d=>oldMap.get(d.claim)?.eliminada&&!d.eliminada);
 return {changes,creating,recovering,unchanged:p.docs.length-changes.length,oldMap};
}
async function commitImport(db,p,current){
 const plan=planChanges(p,current);
 // Los datos del navegador no se publican en GitHub; se envían a Firestore
 // usando la sesión de Administrador y los mismos campos que el guardado normal.
 // Una transacción POR EXPEDIENTE evita la denegación de una transacción grande
 // en reglas con límite de lecturas (auth/usuarios).
 const currentUser=firebase.auth().currentUser;
 if(!currentUser)throw Error('La sesión ha expirado; no se cambió el expediente en curso.');
 const time=firebase.firestore.FieldValue.serverTimestamp;
 let confirmed=0,created=0,recovered=0;
 for(const d of plan.changes){
  if(!checkLoggedAdmin())throw Error('La sesión o el estado de sincronización cambió. No se modificaron los expedientes restantes.');
  const ref=db.collection(COLLECTION).doc(d.claim);
  const baseline=plan.oldMap.get(d.claim);
  // Firestore transaction reintenta de forma segura si otro usuario cambió
  // el documento. Siempre se comprueba la versión concreta respaldada.
  try{
   await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const live=snap.exists?snap.data():null;
    if(matchesRecord(live,d))return; // recuperación reanudable e idempotente
    if((!baseline&&snap.exists)||(baseline&&!snap.exists)
       ||(baseline&&!equalData(live,baseline))){
      const e=Error('El expediente '+d.claim+' fue modificado por otro usuario desde el respaldo. Se detuvo la carga sin sobrescribir esos cambios.');
      e.code='sole/concurrent-change';throw e;
    }
    const revision='restore-v124-'+dateSuffix();
    tx.set(ref,{...toFirestore(d),revision,version:126,autor:currentUser.uid,actualizado:time()});
   });
   const checked=await ref.get({source:'server'});
   if(!checked.exists||!matchesRecord(checked.data(),d))
    throw Error('La escritura de '+d.claim+' no coincide con el respaldo V124 al leer Firebase.');
   confirmed++;
   if(!baseline)created++;
   if(baseline?.eliminada&&!d.eliminada)recovered++;
   setProgress('Restaurados '+confirmed+' de '+plan.changes.length+' expedientes. Actual: '+d.claim);
  }catch(e){
   const error=Error('RESTAURACIÓN PARCIAL: '+confirmed+' de '+plan.changes.length+
    ' expedientes confirmados. Falló '+d.claim+
    ' ('+(e.code||'sin código')+'): '+(e.message||e)+
    '. La copia anterior ya está descargada. Puedes volver a iniciar la misma restauración: se omitirán los expedientes correctos.');
   error.code=e.code;throw error;
  }
 }
 return {guardados:confirmed,archivados:0,creados:created,recuperados:recovered,omitidos:plan.unchanged};
}
async function performMigration(file,button){
 if(working||!file)return;
 working=true;button.disabled=true;
 try{
  if(!checkLoggedAdmin())throw Error('Solo el administrador, sin cambios pendientes, puede realizar esta operación.');
  setProgress('Validando que el archivo contiene exactamente las liquidaciones reales...');
  if(file.size>3500000)throw Error('El archivo seleccionado es demasiado grande.');
  const p=preflight(JSON.parse(await file.text()));
  const auth=firebase.auth(),db=firebase.firestore(),user=auth.currentUser;
  if(!user)throw Error('Tu sesión ha expirado.');
  const userDoc=await db.collection('usuarios').doc(user.uid).get({source:'server'});
  if(userDoc.data()?.rol!=='Administrador')throw Error('Tu cuenta ya no tiene permisos de administrador.');
  setProgress('Descargando copia completa de los datos actuales de Firebase...');
  const current=await retrieveCurrent(db);
  const changesPreview=planChanges(p,current);
  const name=saveBackup(current);
  const backedUp=confirm('ARCHIVO VALIDADO: '+p.products+' liquidaciones de producto, '+p.boxes+' de cajas.'+
    '\nActualmente necesitan cambios '+changesPreview.changes.length+' de '+p.docs.length+' documentos:'+
    '\nNuevos: '+changesPreview.creating.length+' · Recuperados: '+changesPreview.recovering.length+
    ' · Ya correctos: '+changesPreview.unchanged+
    '\nSolicitado: USD '+p.sum.toFixed(2)+' · Recuperado: USD '+p.rec.toFixed(2)+
    '\n\nRESPALDO OBLIGATORIO\n\nSe solicitó descargar:\n'+name+
    '\n\nVerifica en Descargas que el archivo JSON se guardó correctamente y que no está vacío.\n\n'+
    'ACEPTAR: Confirmo que ya tengo el respaldo descargado y autorizo la sustitución.\n'+
    'CANCELAR: No modificar Firebase.');
  if(!backedUp){setProgress('Restauración cancelada después de descargar el respaldo. Firebase quedó sin cambios.');return;}
  if(!checkLoggedAdmin())throw Error('Hay cambios pendientes: migración detenida sin modificar Firebase.');
  setProgress('Respaldo confirmado. Restaurando solo los expedientes que faltan o difieren...');
  const result=await commitImport(db,p,current);
  const verify=await db.collection(COLLECTION).get({source:'server'});
  const ids=new Set(p.docs.map(d=>d.claim));
  const unexpected=verify.docs.filter(d=>!ids.has(d.id)&&!d.data().eliminada&&!d.data().archivadoV124);
  const missing=p.docs.filter(d=>!verify.docs.some(v=>v.id===d.claim));
  const bad=p.docs.filter(d=>!matchesRecord(verify.docs.find(v=>v.id===d.claim)?.data(),d));
  if(unexpected.length||missing.length||bad.length)
   throw Error('Firebase respondió, pero hay diferencias de verificación. Extras: '+unexpected.length+', faltantes: '+missing.length+', distintos: '+bad.length+'. Conserva el respaldo y el error.');
  setProgress('✅ Firebase confirmó los 33 documentos y el historial de 48 filas. Actualizando la vista...');
  alert('Migración V124 confirmada en Firebase.\nProductos: '+p.products+' · Cajas: '+p.boxes+
    '\nDocumentos restaurados: '+result.guardados+' · nuevos: '+result.creados+
    ' · recuperados: '+result.recuperados+' · ya correctos: '+result.omitidos+
    '\nNo se borró ningún documento.\nLa página se actualizará con la sincronización en vivo.');
 }catch(e){
  setProgress('No se aplicó la restauración: '+(e.message||e),true);
  alert('NO SE COMPLETÓ LA RESTAURACIÓN V124: '+(e.message||e)+'\nEl respaldo de Firebase se mantiene en Descargas.');
  console.error('Migración V124:',e);
 }finally{
  working=false;button.disabled=false;
  const input=$('soleV124File');if(input)input.value='';
 }
}
function setProgress(message,isError){
 const el=$('soleV124Progress');
 if(el){el.textContent=message;el.style.color=isError?'#9b2626':'#14506b'}
 let status=$('soleV124FixedStatus');
 if(!status){
  status=document.createElement('div');status.id='soleV124FixedStatus';
  status.setAttribute('role','status');
  status.style.cssText='position:fixed;bottom:68px;right:12px;z-index:2147483644;max-width:min(480px,calc(100vw - 24px));padding:12px 15px;border-radius:10px;background:#e8f3f8;color:#123b50;border:1px solid #a1c4d4;box-shadow:0 4px 20px #123b5033;font:13px/1.4 Arial,sans-serif;';
  document.body.appendChild(status);
 }
 status.style.background=isError?'#fff1ee':'#e8f3f8';
 status.style.color=isError?'#9b2626':'#123b50';
 status.textContent=message;
 status.hidden=false;
}
function liveCount(){
 try {return typeof productClaimData==='function'?productClaimData().length:null}
 catch(e){return null}
}
function setup(){
 if($('soleV124Import'))return;
 const tools=$('soleUserTools');
 if(!tools)return;
 const btn=document.createElement('button');
 btn.id='soleV124Import';btn.type='button';
 btn.textContent='Restaurar 37 reales · V124';
 btn.title='Respaldo obligatorio antes de restaurar las liquidaciones reales';
 btn.style.cssText='background:#124d64;color:#fff;border:1px solid #87aab7;border-radius:6px;padding:8px 11px;cursor:pointer;';
 const file=document.createElement('input');
 file.id='soleV124File';file.type='file';file.accept='.json,application/json';file.hidden=true;
 tools.insertBefore(btn,$('soleLogout')||null);tools.appendChild(file);
 const panel=document.createElement('section');
 panel.id='soleV124Panel';
 panel.setAttribute('aria-label','Restauración de liquidaciones V124');
 panel.style.cssText='position:fixed;top:78px;right:14px;width:min(440px,calc(100vw - 28px));z-index:2147483635;display:none;background:#fff;border:2px solid #225c75;border-radius:14px;padding:18px;color:#1b3446;font:14px/1.4 Arial,sans-serif;box-shadow:0 16px 38px #112c4640;box-sizing:border-box;';
 panel.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">'
  +'<strong style="font-size:17px">Restauración protegida de las liquidaciones</strong>'
  +'<button id="soleV124Close" type="button" aria-label="Cerrar aviso" style="padding:4px 9px;cursor:pointer">×</button></div>'
  +'<p id="soleV124Count" style="margin:10px 0">La página todavía está leyendo la base anterior de Firebase.</p>'
  +'<p style="margin:8px 0">La publicación en GitHub <b>no modifica automáticamente Firebase</b>. Para cargar los 37 expedientes de productos y 1 de cajas, importa el <b>JSON original V124 de aprox. 413 KB</b>, no el JSON de respaldo de Firebase de aprox. 236 KB.</p>'
  +'<button id="soleV124Select" type="button" style="width:100%;background:#12546d;color:white;border:0;border-radius:9px;padding:12px 9px;font-weight:700;cursor:pointer">Elegir archivo original V124 (413 KB)</button>'
  +'<p style="font-size:12px;margin:9px 0 0"><b>Identificación segura:</b> el archivo original incluye un bloque "resumen" con "productosDespuesDeSepararSN": 37. El archivo que se descarga durante la copia de seguridad dice "sole-firestore-respaldo-completo-antes-v124-v1". Se descargará una copia de la base actual antes de sustituirla. No se borrarán registros de Firebase ni archivos de GitHub.</p>'
  +'<p id="soleV124Progress" role="status" style="font-size:12px;font-weight:bold;margin:8px 0 0"></p>';
 document.body.appendChild(panel);
 let dismissed=false;
 $('soleV124Close').addEventListener('click',()=>{dismissed=true;panel.style.display='none'});
 const requestFile=()=>{
  if(!checkLoggedAdmin()){
   alert('Para restaurar, debes iniciar sesión como Administrador y esperar a que Firebase termine de sincronizar.');return;
  }
  file.click();
 };
 btn.addEventListener('click',requestFile);
 $('soleV124Select').addEventListener('click',requestFile);
 file.addEventListener('change',()=>performMigration(file.files[0],btn));
 let wasAllowed=false;
 const update=()=>{
  const st=window.soleV126Online?.estado;
  const admin=st?.rol==='Administrador'&&st?.ready;
  const count=liveCount();
  if(admin&&!wasAllowed)dismissed=false;
  wasAllowed=!!admin;
  btn.style.display=admin?'inline-block':'none';
  btn.disabled=working||!!st?.dirty||!!st?.busy||!!st?.conflict;
  const needsRestore= count===null?st?.cantidad<33:count!==37;
  const show=!!admin&&needsRestore&&!dismissed;
  panel.style.display=show?'block':'none';
  const ct=$('soleV124Count');
  if(ct && count!==null)ct.textContent='Liquidaciones de productos visibles: '+count+' de 37. Falta aplicar el respaldo V124 en Firebase.';
 };
 update();setInterval(update,1000);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();