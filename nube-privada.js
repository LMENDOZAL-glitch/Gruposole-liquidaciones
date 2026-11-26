/* SOLE V130: acceso privado con email/contrasena y roles Firestore. */
(function () {
 'use strict';
 const $=id=>document.getElementById(id);
 const boot=$('soleNubeBoot'),msg=$('soleNubeBootMensaje'),state=$('soleNubeAviso');
 const KEYS=new Set(['SOLE_QA_LOCAL_CLAIMS_V1','SOLE_QA_CLAIM_EDITS_V13','SOLE_QA_COMP_V1','SOLE_QA_CLAIM_DELETED_V16']);
 const COLLECTION='v126_demo_abierto';
 const RECOVERY_KEY='SOLE_V126_DEMO_RECUPERACION_PENDIENTE_V1';
 const SEEDS_COLLECTION='sole_seed_privado';
 const SEEDS=['HIST','SEED_PL','SEED_STRAPS','SEED_PUR','SEED_OP','SEED_WH','SEED_CONS','BOX_SEED','QA_SEED','CODE_CATALOG_SEED_V124'];
 let role=null,seedUnsub=null,claimsReady=false,seedsReady=false;
 const SERIALIZED_FIELD='sole_v126_contenido_json_v2';
 let auth=null,db=null,user=null,unsub=null,ready=false,applying=false,busy=false,dirty=false,conflict=false,timer=null;
 let saved=new Map(),pending=null,initialSnapshot=true,recovery=new Map();
 let syncError=null,lastRemoteAt=null;
 function norm(v){return String(v??'').trim().toUpperCase()}
 function copy(v){return JSON.parse(JSON.stringify(v))}
 // CORRECCION: V126 usa matrices anidadas y algunos nombres internos reservados.
 // Firestore no admite esos formatos directamente. Serializamos el contenido
 // del registro, manteniendo los tipos superiores exigidos por las reglas.
 // El motor y sus calculos siguen usando los objetos originales.
 function toFirestore(data){
  return {
   claim:data.claim,
   registro:data.registro==null?null:{[SERIALIZED_FIELD]:JSON.stringify(data.registro)},
   edicion:{[SERIALIZED_FIELD]:JSON.stringify(data.edicion||{})},
   compensaciones:[{[SERIALIZED_FIELD]:JSON.stringify(data.compensaciones||[])}],
   eliminada:!!data.eliminada
  };
 }
 function fromFirestore(doc){
  if(!doc||typeof doc!=='object')return doc;
  const unpack=(x,fallback)=>{
   if(x&&typeof x==='object'&&!Array.isArray(x)
     &&Object.prototype.hasOwnProperty.call(x,SERIALIZED_FIELD)){
    return JSON.parse(x[SERIALIZED_FIELD]);
   }
   return x==null?fallback:x;
  };
  let comp=doc.compensaciones;
  if(Array.isArray(comp)&&comp.length===1&&comp[0]
     &&typeof comp[0]==='object'
     &&Object.prototype.hasOwnProperty.call(comp[0],SERIALIZED_FIELD)){
   comp=JSON.parse(comp[0][SERIALIZED_FIELD]);
  }
  return {...doc,registro:unpack(doc.registro,null),
   edicion:unpack(doc.edicion,{}),compensaciones:Array.isArray(comp)?comp:[]};
 }
 function recoveryButton(){
  let btn=$('soleV126Recuperar');
  if(!recovery.size){if(btn)btn.remove();return;}
  if(!btn){btn=document.createElement('button');btn.id='soleV126Recuperar';btn.type='button';btn.style.cssText='position:fixed;bottom:65px;left:12px;z-index:2147483001;padding:12px 16px;max-width:calc(100vw - 24px);font:700 13px Arial,sans-serif;background:#174e66;color:white;border:2px solid white;border-radius:10px;box-shadow:0 5px 24px #18394b55;cursor:pointer';btn.addEventListener('click',restoreRecovery);document.body.appendChild(btn)}
  btn.textContent='RECUPERAR Y GUARDAR '+recovery.size+' LIQUIDACION(ES) PENDIENTE(S)';
 }
 function captureRecovery(cloud){
  if(!initialSnapshot)return;
  initialSnapshot=false;
  const local=getLocal();
  const already=new Map();
  try{for(const [id,v] of JSON.parse(localStorage.getItem(RECOVERY_KEY)||'[]'))already.set(id,v)}catch(e){}
  for(const [id,v] of local){
   if(!v.registro&&!Object.keys(v.edicion||{}).length&&!(v.compensaciones||[]).length&&!v.eliminada)continue;
   // Los documentos existentes no se restauran automáticamente: pueden contener ediciones de otra persona.
   // Si aún no existen en la nube, preservamos el registro local no sincronizado.
   if(!cloud.has(id))already.set(id,copy(v));
  }
  for(const [id,v] of already)if(!cloud.has(id))recovery.set(id,v);
  if(recovery.size){
   try{localStorage.setItem(RECOVERY_KEY,JSON.stringify([...recovery]))}catch(e){console.warn('No se pudo persistir el rescate local',e)}
   recoveryButton();
  }
 }
 async function restoreRecovery(){
  if(!ready||busy||!recovery.size)return;
  if(!confirm('Se encontraron '+recovery.size+' liquidacion(es) pendientes guardadas solo en este navegador. ¿Deseas intentar guardarlas ahora en Firestore?'))return;
  try{
   const current=await db.collection(COLLECTION).get({source:'server'});
   const existing=new Set(current.docs.map(d=>norm(d.id)));
   const toRestore=[...recovery].filter(([id])=>!existing.has(id));
   if(!toRestore.length){label('Los registros de rescate ya existen en la nube. No se sobrescribieron.','error');return}
   applying=true;
   try{
    for(const [id,v] of toRestore){
     if(v.registro)localClaims.push(copy(v.registro));
     if(Object.keys(v.edicion||{}).length)claimEdits[id]=copy(v.edicion);
     if(Array.isArray(v.compensaciones))compensations.push(...copy(v.compensaciones));
     if(v.eliminada)deletedClaims.add(id);
    }
    localStorage.setItem('SOLE_QA_LOCAL_CLAIMS_V1',JSON.stringify(localClaims));
    localStorage.setItem('SOLE_QA_CLAIM_EDITS_V13',JSON.stringify(claimEdits));
    localStorage.setItem('SOLE_QA_COMP_V1',JSON.stringify(compensations));
    localStorage.setItem('SOLE_QA_CLAIM_DELETED_V16',JSON.stringify([...deletedClaims]));
   }finally{applying=false}
   repaint();dirty=true;
   const success=await upload();
   if(success){
    for(const [id] of toRestore)recovery.delete(id);
    localStorage.setItem(RECOVERY_KEY,JSON.stringify([...recovery]));
    recoveryButton();
   }
  }catch(e){label('ERROR AL RECUPERAR: '+(e.message||e),'error');console.error(e)}
 }

 function retryButton(){
  let btn=$('soleV126Reintentar');
  if(!dirty || conflict || busy || !syncError){if(btn)btn.remove();return;}
  if(!btn){btn=document.createElement('button');btn.id='soleV126Reintentar';btn.type='button';btn.textContent='REINTENTAR GUARDADO EN NUBE';btn.style.cssText='position:fixed;bottom:8px;right:12px;z-index:2147483000;padding:10px 14px;background:#a33727;color:#fff;border:1px solid white;border-radius:8px;font:700 12px Arial,sans-serif;cursor:pointer';btn.addEventListener('click',()=>{syncError=null;retryButton();upload()});document.body.appendChild(btn)}
 }
 function message(t){msg.textContent=t;state.textContent=t}
 function label(t,level=''){state.className=level;state.textContent=t}
 function showProblem(t){ready=false;message(t);label('ERROR DE CONEXION: '+t,'error');boot.hidden=false}
 function validate(x){return {claim:norm(x.claim),registro:x.registro??null,edicion:x.edicion??{},compensaciones:x.compensaciones??[],eliminada:!!x.eliminada}}
 function stamp(x){return JSON.stringify(validate(x))}
 function getLocal(){
  const map=new Map(),add=id=>{id=norm(id);if(!id||id.length>120)return null;if(!map.has(id))map.set(id,{claim:id,registro:null,edicion:{},compensaciones:[],eliminada:false});return map.get(id)};
  (localClaims||[]).forEach(c=>{const x=add(c?.claim);if(x)x.registro=copy(c)});
  Object.entries(claimEdits||{}).forEach(([id,edit])=>{const x=add(id);if(x)x.edicion=copy(edit||{})});
  (compensations||[]).forEach(c=>{const x=add(c?.claim);if(x)x.compensaciones.push(copy(c))});
  for(const id of deletedClaims||[]){const x=add(id);if(x)x.eliminada=true}
  return map;
 }
 function repaint(){
  for(const n of ['renderClaims','renderHome','soleRefreshOverview','renderOverview']){
   try{if(typeof window[n]==='function')window[n]()}catch(e){console.warn('V126 render '+n,e)}
  }
  try{if(typeof renderClaims==='function')renderClaims()}catch(e){}
  try{if(typeof renderHome==='function')renderHome()}catch(e){}
  try{if(typeof renderOverview==='function')renderOverview()}catch(e){}
 }
 function receive(snap){
  // Si no hay realmente cambios locales, el aviso 'dirty' no debe bloquear
  // la recepción en vivo. Si hay cambios sin confirmar, NO se descartan.
  if(dirty && !busy && !conflict){
   const local=getLocal();
   const differs=[...local].some(([id,v])=>!saved.has(id)||stamp(v)!==stamp(saved.get(id)));
   if(!differs){dirty=false;syncError=null;retryButton()}
  }
  if(dirty||busy||conflict){
   pending=snap;
   if(conflict)label('⚠ Hay un conflicto con cambios sin guardar. No se reemplazaron tus datos locales.','error');
   else if(syncError)label('⚠ No se pudo guardar; los cambios remotos están en espera. Pulsa REINTENTAR.','error');
   return;
  }
  pending=null;
  lastRemoteAt=new Date().toISOString();
  const rows=[],edit={},comps=[],deleted=new Set(),next=new Map();
  snap.docs.forEach(d=>{if(d.data()?.archivadoV124)return;const v=fromFirestore(d.data());if(!v?.claim)return;const k=norm(v.claim);next.set(k,v);if(v.eliminada){deleted.add(k);return}if(v.registro)rows.push(copy(v.registro));if(v.edicion)edit[k]=copy(v.edicion);if(Array.isArray(v.compensaciones))comps.push(...copy(v.compensaciones))});
  captureRecovery(next);
  applying=true;
  try{
   localClaims=rows;claimEdits=edit;compensations=comps;deletedClaims=deleted;
   localStorage.setItem('SOLE_QA_LOCAL_CLAIMS_V1',JSON.stringify(rows));
   localStorage.setItem('SOLE_QA_CLAIM_EDITS_V13',JSON.stringify(edit));
   localStorage.setItem('SOLE_QA_COMP_V1',JSON.stringify(comps));
   localStorage.setItem('SOLE_QA_CLAIM_DELETED_V16',JSON.stringify([...deleted]));
   saved=next;repaint();
  }finally{applying=false}
  if(!ready){ready=true;boot.hidden=true;}
  claimsReady=true;unlockWhenReady();
  syncError=null;retryButton();
  label('☁ Firestore EN VIVO · '+rows.length+' liquidación(es) · RECIBIDO DESDE LA NUBE','ok');
 }
 function mark(){
  if(!ready||applying||conflict)return;
  syncError=null;retryButton();
  dirty=true;label('☁ Cambios pendientes de guardar…');clearTimeout(timer);timer=setTimeout(upload,750)
 }
 const nativeSet=Storage.prototype.setItem;
 Storage.prototype.setItem=function(k,v){const res=nativeSet.apply(this,arguments);if(this===localStorage&&KEYS.has(String(k)))mark();return res};
 async function upload(){
  if(!ready||busy||!dirty||conflict)return;
  dirty=false;busy=true;syncError=null;retryButton();
  const items=[...getLocal()].filter(([id,v])=>!saved.has(id)||stamp(v)!==stamp(saved.get(id)));
  try{
   for(const [id,v] of items){
    if(!/^[A-Z0-9._-]{1,120}$/.test(id))throw Error('Identificador de liquidación no válido para la prueba: '+id);
    const ref=db.collection(COLLECTION).doc(id);
    const expected=saved.has(id)?String(saved.get(id).revision||''):null;
    const data=validate(v);
    if(JSON.stringify(data).length>500000)throw Error('La liquidación '+id+' excede 500.000 caracteres. Usa vínculos para archivos grandes.');
    const revision=(self.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2));
    await db.runTransaction(async tx=>{
     const last=await tx.get(ref);
     if((expected===null&&last.exists)||(expected!==null&&(!last.exists||String(last.data().revision||'')!==expected))) {
      const e=Error('Otro usuario modificó la liquidación '+id+'. Detenido para evitar sobrescritura. Exporta el respaldo local antes de recargar.');e.code='sole/conflict';throw e;
     }
     tx.set(ref,{...toFirestore(data),revision,version:126,autor:user.uid,actualizado:firebase.firestore.FieldValue.serverTimestamp()});
    });
    saved.set(id,{...data,revision});
   }
   label('☁ Guardado confirmado: '+items.length+' liquidación(es)','ok');
   const fresh=await db.collection(COLLECTION).get({source:'server'});
   busy=false;
   if(dirty){mark();return}
   // No perder actualizaciones remotas recibidas mientras se guardaba.
   pending=null;receive(fresh);return true;
  }catch(e){
   busy=false;dirty=true;syncError=(e.message||String(e));
   if(e.code==='sole/conflict')conflict=true;
   label('ERROR AL GUARDAR: '+syncError+' · Los datos de esta ventana NO se han sincronizado.','error');
   retryButton();console.error(e);
   return false;
  }
 }

 // Los roles los decide Firestore; esconder la interfaz no reemplaza las reglas.
 function lock(){document.documentElement.classList.remove('sole-authorized','sole-is-admin')}
 function authMessage(text,error=false){
  const el=$('soleAuthError'),status=$('soleAuthStatus');
  if(el){el.style.display=error?'block':'none';el.textContent=error?text:''}
  if(status)status.textContent=error?'No se ha abierto el acceso.':text;
 }
 function unlockWhenReady(){
  if(!user||!role||!claimsReady||!seedsReady)return;
  document.documentElement.classList.add('sole-authorized');
  document.documentElement.classList.toggle('sole-is-admin',role==='Administrador');
  $('soleSignedAs').textContent=(user.email||'Usuario')+' · '+role;
  boot.hidden=true;
  habilitarRestauracion018();
  habilitarImportacionBasesV124();
  label('☁ Acceso autorizado · '+(saved.size||0)+' expediente(s) en la nube','ok');
 }
 function loadSeeds(snapshot){
  const raw={};
  snapshot.forEach(doc=>{
   if(!SEEDS.includes(doc.id))return;
   try{raw[doc.id]=JSON.parse(doc.data().json)}catch(e){console.error('Dato privado invalido:',doc.id,e)}
  });
  applying=true;
  try{
   if(Array.isArray(raw.HIST))HIST=raw.HIST;
   if(Array.isArray(raw.SEED_PL))SEED_PL=raw.SEED_PL;
   if(Array.isArray(raw.SEED_STRAPS))SEED_STRAPS=raw.SEED_STRAPS;
   if(Array.isArray(raw.SEED_PUR))SEED_PUR=raw.SEED_PUR;
   if(Array.isArray(raw.SEED_OP))SEED_OP=raw.SEED_OP;
   if(Array.isArray(raw.SEED_WH))SEED_WH=raw.SEED_WH;
   if(Array.isArray(raw.SEED_CONS))SEED_CONS=raw.SEED_CONS;
   if(raw.BOX_SEED && Array.isArray(raw.BOX_SEED.rows)){
    BOX_SEED=raw.BOX_SEED;
    // Los datos editados en este dispositivo tienen prioridad sobre un semillero.
    if(!boxDb?.rows?.length)boxDb=copy(BOX_SEED);
   }
   if(raw.QA_SEED && Array.isArray(raw.QA_SEED.pt)){
    QA_SEED=raw.QA_SEED;
    if(!qaData?.pt?.length)qaData=copy(QA_SEED);
   }
   if(Array.isArray(raw.CODE_CATALOG_SEED_V124)) {
    CODE_CATALOG_SEED_V124=raw.CODE_CATALOG_SEED_V124;
    try{mergeFullCodeCatalogV124(false)}catch(e){console.warn('Catálogo protegido:',e)}
   }
   repaint();
  }finally{applying=false}
  seedsReady=true;unlockWhenReady();
 }
 async function authChanged(u){
  lock();user=u;role=null;ready=false;busy=false;dirty=false;conflict=false;syncError=null;
  pending=null;saved=new Map();claimsReady=false;seedsReady=false;initialSnapshot=true;
  retryButton();
  if(unsub){unsub();unsub=null}
  if(seedUnsub){seedUnsub();seedUnsub=null}
  if(!u){boot.hidden=true;authMessage('Ingresa con tu cuenta autorizada de SOLE.');return}
  boot.hidden=false;
  message('Verificando permisos del usuario…');
  try{
   const userDoc=await db.collection('usuarios').doc(u.uid).get({source:'server'});
   if(!userDoc.exists||!['Administrador','Editor'].includes(userDoc.data()?.rol)){
    await auth.signOut();authMessage('Esta cuenta no tiene un rol autorizado. Comunícate con el administrador.',true);return;
   }
   // La coleccion de usuarios solo puede cambiarse desde Firebase Console por un responsable autorizado.
   role=userDoc.data().rol;
   authMessage('Cuenta reconocida. Descargando las liquidaciones autorizadas…');
   message('Sincronizando expedientes y bases de datos protegidas…');
   seedUnsub=db.collection(SEEDS_COLLECTION).onSnapshot(loadSeeds,e=>{
    showProblem('No se puede consultar el historial protegido: '+e.message);
    authMessage('Error de permisos al leer el historial. Mantén Firestore bloqueado hasta revisar las reglas.',true)
   });
   unsub=db.collection(COLLECTION).onSnapshot({includeMetadataChanges:true},s=>{
    if(s.metadata.hasPendingWrites)return;
    if(s.metadata.fromCache){label('☁ Esperando confirmar conexión con Firestore…');return}
    receive(s);
   },e=>{
    showProblem('No se puede consultar las liquidaciones: '+e.message);
    authMessage('No hay permiso para leer liquidaciones. Verifica las reglas de Firestore.',true)
   });
  }catch(e){showProblem('No se pudieron verificar permisos: '+e.message);
   authMessage('No se pudo verificar tu rol. Primero publica las reglas seguras de Firestore.',true)}
 }
 async function importSeeds(file){
  if(role!=='Administrador'||!user||!file)return;
  if(file.size>3500000){alert('Archivo demasiado grande.');return}
  try{
   const data=JSON.parse(await file.text());
   if(data.formato!=='sole-v130-respaldo-confidencial-v1'||!data.colecciones)throw Error('El respaldo no corresponde a esta version.');
   const items=SEEDS.map(k=>[k,data.colecciones[k]]).filter(([k,x])=>x!=null);
   if(!items.length)throw Error('No se encontraron registros para importar.');
   if(!confirm('El respaldo contiene datos REALES de SOLE. Se guardarán en tu proyecto Firebase actual bajo reglas de acceso por rol. No se publicará dentro del HTML. ¿Continuar?'))return;
   let created=0,skipped=0;
   for(const [key,val] of items){
    const json=JSON.stringify(val);
    if(new TextEncoder().encode(json).length>800000)throw Error('El bloque '+key+' supera el limite seguro de tamaño; los bloques anteriores, si se guardaron, permanecen.');
    const ref=db.collection(SEEDS_COLLECTION).doc(key);
    const current=await ref.get({source:'server'});
    if(current.exists){skipped++;continue} // Nunca se sobreescribe un respaldo ya importado.
    await ref.set({json,formato:'sole-v130',actualizado:firebase.firestore.FieldValue.serverTimestamp(),autor:user.uid});
    created++;
   }
   alert('Importación terminada. Bloques creados: '+created+'. Ya existentes (NO reemplazados): '+skipped+'. Las liquidaciones de la nube no fueron borradas.');
  }catch(e){alert('No se pudo terminar la importacion: '+(e.message||e));console.error(e)}
  finally{$('soleImportFile').value=''}
 }

 function habilitarRestauracion018(){
  if(role!=='Administrador'||!ready||$('soleRestaurar018'))return;
  const parent=$('soleAdminImport')?.parentElement;
  if(!parent)return;
  const button=document.createElement('button');
  button.type='button';button.id='soleRestaurar018';button.textContent='Restaurar detalle 2026-018';
  button.title='Recuperar exclusivamente series, repuestos y datos técnicos del PDF de la liquidación 2026-018';
  const picker=document.createElement('input');picker.type='file';picker.accept='.json,application/json';picker.hidden=true;
  parent.insertBefore(button,$('soleAdminImport'));parent.appendChild(picker);
  button.addEventListener('click',()=>{if(!busy&&!dirty&&!conflict)picker.click();else alert('Primero confirma el guardado de los cambios pendientes.');});
  picker.addEventListener('change',async()=>{
   const file=picker.files&&picker.files[0];if(!file)return;
   button.disabled=true;
   try{
    if(role!=='Administrador'||!user||!ready||busy||dirty||conflict)throw Error('No hay una sesión administradora lista para restaurar.');
    if(file.size>30000)throw Error('Archivo de restauración demasiado grande.');
    const data=JSON.parse(await file.text());
    if(data.schema!=='SOLE_REPARAR_DETALLE_2026-018_V1'||data.claim!=='2026-018'||!Array.isArray(data.lines)||data.lines.length!==2)
      throw Error('El archivo no corresponde a la ficha de recuperación 2026-018.');
    const byCode=Object.fromEntries(data.lines.map(x=>[x.code,x]));
    const a=byCode['3120SOLCO060'],b=byCode['3120SOLCO066'];
    if(!a||!b||a.importedBadQty!==17||b.importedBadQty!==5||a.serials?.length!==26||b.serials?.length!==5||a.defectiveSpareParts?.length!==4||b.defectiveSpareParts?.length!==3)
      throw Error('Las cantidades, series o repuestos no coinciden con el PDF original.');
    const id='2026-018',ref=db.collection(COLLECTION).doc(id);
    const prior=await ref.get({source:'server'});
    const raw=prior.exists?prior.data():null;
    const existing=raw?fromFirestore(raw):{claim:id,registro:null,edicion:{},compensaciones:[],eliminada:false};
    if(existing.eliminada)throw Error('La liquidación fue eliminada en Firebase. No se restaurará automáticamente.');
    const live=typeof claimDataByNo==='function'?claimDataByNo(id):null;
    const amount=Number(existing.edicion?.amount??live?.amount??existing.registro?.amount??0);
    if(!Number.isFinite(amount)||amount<=0)throw Error('No se pudo determinar el monto vigente. No se cambiarán montos.');
    const status=existing.edicion?.status||live?.status||existing.registro?.status||'PENDIENTE';
    const base=existing.registro||{};
    const priorLines=base.builderSnapshot?.lines||base.rows||[];
    if(priorLines.some(x=>x.serials?.length||x.defectiveSpareParts?.length)){
      if(!confirm('La liquidación ya tiene series o repuestos guardados. ¿Deseas reemplazar SOLO el detalle técnico con el PDF, conservando montos, seguimientos y compensaciones?'))return;
    }
    const backup={formato:'SOLE-RESPALDO-2026-018',fecha:new Date().toISOString(),id,
      anterior:raw,importeVigente:amount};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='SOLE_2026-018_RESPALDO_ANTES_RESTAURAR.json';document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    if(!confirm('Se solicitó la descarga del respaldo de 2026-018. COMPRUEBA que está guardado en Descargas. ¿Restaurar ahora las 31 series y 7 referencias de repuestos SIN modificar el monto USD '+amount.toFixed(2)+'?'))return;
    const lines=data.lines.map(x=>copy(x));
    const meta=data.metadata||{};
    const s={...(base.builderSnapshot||{}),mode:'REPROCESO',claim:id,
      documentLanguage:'EN',preparedBy:base.preparedBy||meta.preparedBy||'',
      supplier:base.supplier||meta.supplier||'CHINABEST / VATTI',brand:base.brand||meta.brand||'S-COLLECTION',
      date:base.date||meta.date||'',status,problem:base.problem||meta.problem||'',
      notes:base.builderSnapshot?.notes||base.observations||meta.notes||'',
      warehouse:base.builderSnapshot?.warehouse||'121',chargeTransport:'NO',
      lines,oldFormat:true,manualHistoricalAmount:amount};
    const rows=lines.map(x=>({...copy(x),claim:id,lotQty:x.qty,warehouse:x.warehouse||'121',
      spareParts:copy(x.spareParts||[]),defectiveSpareParts:copy(x.defectiveSpareParts||[]),serials:copy(x.serials||[])}));
    const registro={...base,claim:id,claimType:'PRODUCTO',supplier:s.supplier,brand:s.brand,
      status,amount,preparedBy:s.preparedBy,date:s.date,problem:s.problem,
      observations:base.observations||live?.observations||('LIQUIDACIÓN PRODUCTO · '+s.notes),
      rows,builderSnapshot:s,oldFormat:true,manualHistoricalAmount:amount,
      reworkChargeTotal:base.reworkChargeTotal??meta.sourceReprocessingUsd,
      productChargeTotal:base.productChargeTotal??meta.sourceProductUsd};
    const next={claim:id,registro,edicion:copy(existing.edicion||{}),
      compensaciones:copy(existing.compensaciones||[]),eliminada:false};
    await db.runTransaction(async tx=>{
      const current=await tx.get(ref);
      if(current.exists!==prior.exists||(current.exists&&String(current.data().revision||'')!==String(raw.revision||'')))
        throw Error('La liquidación cambió mientras se preparaba la restauración. Vuelve a intentarlo.');
      tx.set(ref,{...toFirestore(next),revision:(self.crypto?.randomUUID?.()||Date.now()+'-018'),
        version:126,autor:user.uid,actualizado:firebase.firestore.FieldValue.serverTimestamp()});
    });
    label('Restauración de 2026-018 guardada: 31 series y 7 referencias de repuestos. Importe y seguimientos conservados.','ok');
    alert('Liquidación 2026-018 restaurada. Abre «Editar liquidación» para verificar las series y los repuestos.');
   }catch(e){label('Error al restaurar 2026-018: '+(e.message||e),'error');alert('No se restauró la liquidación: '+(e.message||e));console.error(e)}
   finally{picker.value='';button.disabled=false}
  });
 }

 // Herramientas de recuperación de las bases originales V124: los datos NO se publican en GitHub.
 function soleLeerLiteralV124(html,nombre){
   const m=new RegExp('\\b'+nombre+'\\s*=\\s*([\\[{])').exec(html);
   if(!m)throw Error('No existe la base '+nombre+' dentro de este HTML.');
   const i=m.index+m[0].length-1;
   const stack=[];let quoted=false,slash=false;
   for(let j=i;j<html.length;j++){
     const c=html[j];
     if(quoted){if(slash)slash=false;else if(c==='\\')slash=true;else if(c==='"')quoted=false;continue}
     if(c==='"'){quoted=true;continue}
     if(c==='{'||c==='['){stack.push(c);continue}
     if(c==='}'||c===']'){
       const opening=stack.pop();
       if((c==='}'&&opening!=='{')||(c===']'&&opening!=='['))throw Error('Estructura inesperada en '+nombre);
       if(!stack.length)return JSON.parse(html.slice(i,j+1));
     }
   }
   throw Error('No se pudo leer el bloque '+nombre);
 }
 function habilitarImportacionBasesV124(){
   if(role!=='Administrador'||!ready||$('soleImportarBasesV124'))return;
   const original=$('soleAdminImport'),parent=original&&original.parentElement;
   if(!parent)return;
   const btn=document.createElement('button');
   btn.id='soleImportarBasesV124';btn.type='button';btn.textContent='Recuperar bases del HTML V124';
   btn.title='Restaurar solo las tablas técnicas, muestreos, cajas y catálogos; NO reemplaza liquidaciones.';
   const input=document.createElement('input');input.type='file';input.accept='.html,text/html';input.hidden=true;
   parent.insertBefore(btn,original);parent.appendChild(input);
   btn.addEventListener('click',()=>{if(!busy&&!dirty&&!conflict)input.click();else alert('Primero termina los cambios pendientes de guardar.');});
   input.addEventListener('change',async()=>{
     const file=input.files&&input.files[0];if(!file)return;
     btn.disabled=true;
     try{
       if(role!=='Administrador'||!user||!ready||busy||dirty||conflict)throw Error('Es necesario iniciar sesión como Administrador y guardar los cambios pendientes.');
       if(file.size>5000000)throw Error('El HTML seleccionado es demasiado grande.');
       const html=await file.text();
       if(!html.includes('Liquidaciones de Calidad V124'))throw Error('Selecciona el archivo original SOLE_LIQUIDACIONES_V124.html.');
       const bases=SEEDS.filter(k=>k!=='HIST');
       const data={};
       for(const name of bases)data[name]=soleLeerLiteralV124(html,name);
       const counts={cajas:data.BOX_SEED?.rows?.length||0,muestreos:data.QA_SEED?.pt?.length||0,
         catalogo:data.CODE_CATALOG_SEED_V124?.length||0,planillas:data.SEED_PL?.length||0};
       if(counts.cajas<1400||counts.muestreos<70||counts.catalogo<500||counts.planillas<20)
         throw Error('Las bases no corresponden al respaldo original completo: '+JSON.stringify(counts));
       for(const name of bases){
         if(new TextEncoder().encode(JSON.stringify(data[name])).length>800000)
           throw Error('El bloque '+name+' supera el tamaño seguro para Firebase.');
       }
       if(!confirm('Se detectaron '+counts.cajas+' filas de cajas, '+counts.muestreos+' muestreos, '+counts.catalogo+' códigos y '+bases.length+' bases originales. Se conservarán TODAS las liquidaciones, montos, compensaciones y seguimientos de Firebase.\n\n¿Descargar el respaldo de las bases online y preparar la restauración?'))return;
       const snapshot=await db.collection(SEEDS_COLLECTION).get({source:'server'});
       const previous={formato:'SOLE-RESPALDO-BASES-FIREBASE-V124',fecha:new Date().toISOString(),
         bases:snapshot.docs.map(d=>({id:d.id,contenido:d.data()}))};
       const blob=new Blob([JSON.stringify(previous,null,2)],{type:'application/json'});
       const url=URL.createObjectURL(blob),a=document.createElement('a');
       a.href=url;a.download='SOLE_BASES_FIREBASE_RESPALDO_ANTES_V124.json';document.body.appendChild(a);a.click();a.remove();
       setTimeout(()=>URL.revokeObjectURL(url),60000);
       if(!confirm('Comprueba que se descargó el respaldo SOLE_BASES_FIREBASE_RESPALDO_ANTES_V124.json.\n\n¿Reemplazar solo las '+bases.length+' bases técnicas con los datos del HTML original V124? No se tocarán las liquidaciones de la nube.'))return;
       const batch=db.batch();
       for(const name of bases){
         batch.set(db.collection(SEEDS_COLLECTION).doc(name),{
           json:JSON.stringify(data[name]),formato:'sole-v130',autor:user.uid,
           actualizado:firebase.firestore.FieldValue.serverTimestamp()
         });
       }
       await batch.commit();
       label('Bases V124 restauradas en Firebase: '+counts.cajas+' filas de cajas, '+counts.muestreos+' muestreos y '+counts.catalogo+' códigos. Liquidaciones intactas.','ok');
       alert('Bases recuperadas correctamente. Las liquidaciones NO se modificaron. Actualiza con Ctrl + F5 para ver las tablas.');
     }catch(e){label('No se pudo recuperar bases V124: '+(e.message||e),'error');alert('No se cambiaron las bases: '+(e.message||e));console.error(e)}
     finally{input.value='';btn.disabled=false}
   });
 }
 // Las fichas antiguas tienen un total histórico manual que antes ignoraba el checkbox COBRAR PRODUCTO.
 // Al cambiar el concepto, preservar el costo restante y descontar solamente el subtotal de producto.
 function habilitarCorreccionCobroProducto(){
   if(window.__soleCorreccionCobroProducto||typeof window.pcUpdateAction!=='function')return;
   const previa=window.pcUpdateAction;
   window.pcUpdateAction=function(i,k,on){
     if(k!=='chargeProduct')return previa(i,k,on);
     const legacy=$('pcAmountMode')?.value==='ANTERIOR';
     const prevTotal=+($('pcLegacyAmount')?.value||0);
     const totalProductos=()=>productClaimLines.reduce((a,l)=>a+pcLineSubtotal(l),0);
     const antes=legacy?totalProductos():0;
     const result=previa(i,k,on);
     if(legacy){
       const despues=totalProductos(),delta=despues-antes;
       if(Math.abs(delta)>0.0001){
         const nuevo=Math.max(0,prevTotal+delta);
         if($('pcLegacyAmount'))$('pcLegacyAmount').value=nuevo.toFixed(2);
         if($('pcLegacyAmountQuick'))$('pcLegacyAmountQuick').value=nuevo.toFixed(2);
         window.pcEditingSavedAmount=nuevo;
         calcProductClaim(false);
       }else if(!on){
         alert('No se puede descontar el producto porque faltan cantidades o precios en esta ficha histórica. Primero recupera sus series y repuestos usando el respaldo original; no se modificó el importe.');
       }
     }
     return result;
   };
   window.__soleCorreccionCobroProducto=true;
 }

 function wireControls(){
  $('soleLoginForm').addEventListener('submit',async e=>{
   e.preventDefault();
   const email=$('soleAuthEmail').value.trim(),pass=$('soleAuthPassword').value;
   $('soleLoginSubmit').disabled=true;authMessage('Verificando credenciales…');
   try{await auth.signInWithEmailAndPassword(email,pass);$('soleAuthPassword').value=''}
   catch(err){authMessage('No se pudo iniciar sesión. Revisa el correo y la contraseña o el estado de tu cuenta.',true);console.error(err)}
   finally{$('soleLoginSubmit').disabled=false}
  });
  $('solePasswordReset').addEventListener('click',async ()=>{
   const email=$('soleAuthEmail').value.trim();
   if(!email||!email.includes('@')){authMessage('Escribe primero tu correo corporativo.',true);return}
   try{await auth.sendPasswordResetEmail(email);authMessage('Si la cuenta puede recuperarse, se enviará un correo para cambiar la contraseña. Revisa Outlook y la carpeta de spam.');}
   catch(e){authMessage('No se pudo enviar la recuperación. Verifica que el correo y el dominio estén autorizados.',true);console.error(e)}
  });
  $('soleLogout').addEventListener('click',async ()=>{
   if(dirty||busy||conflict){alert('Hay cambios pendientes o en conflicto. Resuelve el guardado antes de cerrar sesión.');return}
   if(!confirm('¿Cerrar tu sesión de SOLE Liquidaciones?'))return;
   lock();
   try{await auth.signOut();for(const k of KEYS)localStorage.removeItem(k);
    localStorage.removeItem(RECOVERY_KEY);
    location.reload();
   }catch(e){authMessage('No se pudo cerrar sesión: '+e.message,true)}
  });
  $('soleAdminImport').addEventListener('click',()=>$('soleImportFile').click());
  $('soleImportFile').addEventListener('change',e=>importSeeds(e.target.files[0]));
 }

 try{
  const cfg=window.SOLE_FIREBASE_CONFIG;
  if(!cfg||!/^AIza[\w-]{20,}$/.test(String(cfg.apiKey||''))){showProblem('Falta configurar firebase-config.js.');return}
  if(typeof firebase==='undefined')throw Error('No se pudo cargar el SDK de Firebase');
  firebase.initializeApp(cfg);auth=firebase.auth();db=firebase.firestore();
  auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch(e=>console.warn('Persistencia:',e));
  wireControls();
  habilitarCorreccionCobroProducto();
  auth.onAuthStateChanged(authChanged,e=>showProblem('Error Firebase Auth: '+e.message));
  window.soleV126Online={get estado(){return{ready,acceso:'privado_corporativo',rol:role,email:user?.email||null,dirty,busy,conflict,error:syncError,cambiosRemotosEnEspera:!!pending,cantidad:saved.size,ultimaRecepcion:lastRemoteAt}},guardar:()=>{dirty=true;return upload()}};
 }catch(e){showProblem('Error de inicialización: '+e.message)}
})();
