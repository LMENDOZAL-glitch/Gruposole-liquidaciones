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
 if(!p || p.formato!==EXPECTED_FORMAT)throw Error('Usa el archivo SOLE_V124_REEMPLAZO_FIREBASE_PRIVADO_VERIFICADO.json, sin modificar.');
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
async function commitImport(db,p,current){
 // Se vuelven a consultar las dos colecciones para detectar cambios posteriores al respaldo.
 const latest=await db.collection(COLLECTION).get({source:'server'});
 const seedLatest=await db.collection(SEED_COLLECTION).get({source:'server'});
 if(!matchSnapshot(current,latest,seedLatest))
  throw Error('Alguien modificó Firebase después del respaldo. No se sustituyó nada. Vuelve a descargar un respaldo actualizado.');
 const expected=new Set(p.docs.map(d=>d.claim));
 const old=current.colecciones[COLLECTION];
 const extra=old.filter(d=>!expected.has(d.id));
 const refs=[];
 for(const d of p.docs)refs.push({ref:db.collection(COLLECTION).doc(d.claim),kind:'target',payload:d});
 for(const d of extra)refs.push({ref:db.collection(COLLECTION).doc(d.id),kind:'archive',payload:d});
 const historicRef=db.collection(SEED_COLLECTION).doc('HIST');
 refs.push({ref:historicRef,kind:'hist'});
 // Transacción: todas las lecturas antes de escribir. Firestore cancela si cambió un documento.
 await db.runTransaction(async tx=>{
  const before=[];
  for(const item of refs)before.push(await tx.get(item.ref));
  for(let i=0;i<refs.length;i++){
   const item=refs[i],snap=before[i];
   const backupEntry=item.kind==='hist'
    ? current.colecciones[SEED_COLLECTION].find(d=>d.id==='HIST')
    : old.find(d=>d.id===item.ref.id);
   if(!!backupEntry!==snap.exists || (snap.exists&&JSON.stringify(backupEntry.data)!==JSON.stringify(snap.data())))
    throw Error('El registro '+item.ref.id+' cambió durante la migración. No se aplicó la transacción.');
  }
  const time=firebase.firestore.FieldValue.serverTimestamp();
  for(const item of refs){
   if(item.kind==='target'){
    tx.set(item.ref,{...toFirestore(item.payload),revision:'migracion-v124-'+dateSuffix(),
     version:126,autor:firebase.auth().currentUser.uid,actualizado:time});
   }else if(item.kind==='archive'){
    // No se elimina el documento: se conserva completo y se excluye de la lista activa.
    tx.update(item.ref,{archivadoV124:true,fechaArchivoV124:time});
   }else{
    tx.set(item.ref,{json:JSON.stringify(p.hist),formato:'sole-v124',
      actualizado:time,autor:firebase.auth().currentUser.uid});
   }
  }
 });
 return {guardados:p.docs.length,archivados:extra.length};
}
async function performMigration(file,button){
 if(working||!file)return;
 working=true;button.disabled=true;
 try{
  if(!checkLoggedAdmin())throw Error('Solo el administrador, sin cambios pendientes, puede realizar esta operación.');
  if(file.size>3500000)throw Error('El archivo seleccionado es demasiado grande.');
  const p=preflight(JSON.parse(await file.text()));
  const ok=confirm(
   'VALIDACIÓN DEL RESPALDO V124\n\n'+
   'Liquidaciones de productos: '+p.products+'\n'+
   'Liquidaciones de cajas: '+p.boxes+'\n'+
   'Total solicitado (USD): '+p.sum.toFixed(2)+'\n'+
   'Total recuperado (USD): '+p.rec.toFixed(2)+'\n'+
   'Registros para Firestore: '+p.docs.length+'\n\n'+
   'Primero se descargará una copia COMPLETA de las colecciones actuales. Solo después podrás confirmar la sustitución.\n\n¿Continuar?'
  );
  if(!ok)return;
  const auth=firebase.auth(),db=firebase.firestore(),user=auth.currentUser;
  if(!user)throw Error('Tu sesión ha expirado.');
  const userDoc=await db.collection('usuarios').doc(user.uid).get({source:'server'});
  if(userDoc.data()?.rol!=='Administrador')throw Error('Tu cuenta ya no tiene permisos de administrador.');
  const current=await retrieveCurrent(db);
  const name=saveBackup(current);
  const backedUp=confirm('RESPALDO OBLIGATORIO\n\nSe solicitó descargar:\n'+name+
    '\n\nVerifica en Descargas que el archivo JSON se guardó correctamente y que no está vacío.\n\n'+
    'ACEPTAR: Confirmo que ya tengo el respaldo descargado y autorizo la sustitución.\n'+
    'CANCELAR: No modificar Firebase.');
  if(!backedUp)return;
  if(!checkLoggedAdmin())throw Error('Hay cambios pendientes: migración detenida sin modificar Firebase.');
  const result=await commitImport(db,p,current);
  const verify=await db.collection(COLLECTION).get({source:'server'});
  const ids=new Set(p.docs.map(d=>d.claim));
  const unexpected=verify.docs.filter(d=>!ids.has(d.id)&&!d.data().archivadoV124);
  const missing=p.docs.filter(d=>!verify.docs.some(v=>v.id===d.claim));
  if(unexpected.length||missing.length)throw Error('La operación terminó, pero quedan diferencias: '+unexpected.length+' extras visibles, '+missing.length+' faltantes. Conserva el respaldo y comunica el problema.');
  alert('Migración V124 confirmada en Firebase.\nProductos: '+p.products+' · Cajas: '+p.boxes+
    '\nDocumentos actualizados: '+result.guardados+'\nDocumentos anteriores conservados y archivados: '+result.archivados+
    '\nNo se borró ningún documento.\nLa página se actualizará con la sincronización en vivo.');
 }catch(e){
  alert('NO SE COMPLETÓ LA MIGRACIÓN: '+(e.message||e)+'\nRevisa el estado antes de volver a intentarlo.');
  console.error('Migración V124:',e);
 }finally{
  working=false;button.disabled=false;
  const input=$('soleV124File');if(input)input.value='';
 }
}
function setup(){
 if($('soleV124Import'))return;
 const userTools=$('soleUserTools');if(!userTools)return;
 const btn=document.createElement('button');
 btn.id='soleV124Import';btn.type='button';btn.textContent='Restaurar 37 liquidaciones V124';
 btn.title='Administrador: validar, descargar respaldo completo y actualizar Firestore sin eliminar documentos';
 btn.style.cssText='display:none;background:#124d64;color:white;border:1px solid #87aab7;border-radius:6px;padding:8px 11px;cursor:pointer;';
 const file=document.createElement('input');file.id='soleV124File';file.type='file';file.accept='.json,application/json';file.hidden=true;
 userTools.insertBefore(btn,$('soleLogout')||null);userTools.appendChild(file);
 btn.addEventListener('click',()=>{if(!checkLoggedAdmin()){alert('Inicia sesión como administrador y espera la sincronización completa.');return}file.click()});
 file.addEventListener('change',()=>performMigration(file.files[0],btn));
 const update=()=>{const st=window.soleV126Online?.estado;btn.style.display=(st?.rol==='Administrador'&&st?.ready)?'inline-block':'none';btn.disabled=working||!!st?.dirty||!!st?.busy||!!st?.conflict};
 update();setInterval(update,1200);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();