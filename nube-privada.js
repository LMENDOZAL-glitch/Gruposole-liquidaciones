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
  const raw={},dates={};
  snapshot.forEach(doc=>{
   if(!SEEDS.includes(doc.id))return;
   try{
    raw[doc.id]=JSON.parse(doc.data().json);
    dates[doc.id]=doc.data().actualizado?.toMillis?.()||0;
   }catch(e){console.error('Dato privado invalido:',doc.id,e)}
  });
  applying=true;
  try{
   if(Array.isArray(raw.HIST))HIST=raw.HIST;
   for(const name of ['SEED_PL','SEED_STRAPS','SEED_PUR','SEED_OP','SEED_WH','SEED_CONS']){
    if(Array.isArray(raw[name])){
     if(name==='SEED_PL')SEED_PL=raw[name];
     if(name==='SEED_STRAPS')SEED_STRAPS=raw[name];
     if(name==='SEED_PUR')SEED_PUR=raw[name];
     if(name==='SEED_OP')SEED_OP=raw[name];
     if(name==='SEED_WH')SEED_WH=raw[name];
     if(name==='SEED_CONS')SEED_CONS=raw[name];
    }
   }
   if(raw.BOX_SEED&&Array.isArray(raw.BOX_SEED.rows))BOX_SEED=raw.BOX_SEED;
   if(raw.QA_SEED&&Array.isArray(raw.QA_SEED.pt))QA_SEED=raw.QA_SEED;
   if(Array.isArray(raw.CODE_CATALOG_SEED_V124)){
    CODE_CATALOG_SEED_V124=raw.CODE_CATALOG_SEED_V124;
    try{mergeFullCodeCatalogV124(false)}catch(e){console.warn('Catálogo protegido:',e)}
   }
   // cfg se carga inicialmente desde localStorage. Actualizar SEED_* por sí solo
   // NO actualizaba las tablas visibles. Firebase es la base maestra al restaurar V124.
   const key='SOLE_V124_SEEDS_APPLIED_REV3';
   const revision=JSON.stringify([
     '2026-11-V124',dates.SEED_PL,dates.SEED_STRAPS,dates.SEED_PUR,
     dates.SEED_OP,dates.SEED_WH,dates.SEED_CONS,dates.BOX_SEED,dates.QA_SEED,
     dates.CODE_CATALOG_SEED_V124
   ]);
   if(raw.BOX_SEED?.rows?.length>=1400&&raw.QA_SEED?.pt?.length>=70
       &&raw.CODE_CATALOG_SEED_V124?.length>=500
       &&localStorage.getItem(key)!==revision){
    const tables=[
      ['productLines','SEED_PL'],['straps','SEED_STRAPS'],['purchases','SEED_PUR'],
      ['operators','SEED_OP'],['warehouses','SEED_WH'],['consumables','SEED_CONS']
    ];
    // Salvar la configuración anterior en el propio navegador antes de aplicar
    // las tablas originales. No afecta montos, fechas, usuarios ni liquidaciones.
    try{
      const old=localStorage.getItem('SOLE_QA_CFG_V3');
      if(old)localStorage.setItem('SOLE_V124_CFG_PREVIA_AL_RESTAURAR',old);
    }catch(e){console.warn('No se pudo respaldar la configuración local',e)}
    if(typeof cfg==='object'&&cfg){
      for(const [field,name] of tables)if(Array.isArray(raw[name]))cfg[field]=copy(raw[name]);
      try{localStorage.setItem('SOLE_QA_CFG_V3',JSON.stringify(cfg))}
      catch(e){console.warn('No se pudo persistir la configuración V124',e)}
    }
    boxDb=copy(BOX_SEED);qaData=copy(QA_SEED);
    try{if(typeof persistBoxDb==='function')persistBoxDb()}catch(e){console.warn('Cajas IndexedDB',e)}
    try{if(typeof persistQaData==='function')persistQaData()}catch(e){console.warn('Muestreos IndexedDB',e)}
    localStorage.setItem(key,revision);
    // En algunos equipos initBigDataStorage termina después del primer snapshot.
    // Reconciliar solo si la carga vieja revirtió la cantidad importada.
    setTimeout(()=>{
      if(!user||!role)return;
      const reapplyBox=boxDb?.rows?.length!==BOX_SEED.rows.length;
      const reapplyQa=qaData?.pt?.length!==QA_SEED.pt.length;
      if(reapplyBox){boxDb=copy(BOX_SEED);try{persistBoxDb()}catch(e){}}
      if(reapplyQa){qaData=copy(QA_SEED);try{persistQaData()}catch(e){}}
      if(reapplyBox||reapplyQa){
        for(const fn of ['renderBoxDatabase','renderQuality','renderUnloading','renderHome'])
          try{if(typeof window[fn]==='function')window[fn]()}catch(e){}
      }
    },900);
   }
   for(const fn of ['renderConfig','renderBoxDatabase','renderQuality','renderUnloading']){
     try{if(typeof window[fn]==='function')window[fn]()}catch(e){console.warn('Error al refrescar '+fn,e)}
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

 // Cálculo dirigido para la liquidación 2026-018:
 // al desactivar el formato anterior, TOTAL = saldo histórico no-producto
 // + cobro de los productos que permanezcan seleccionados.
 // El saldo se obtiene del expediente real guardado en Firebase, nunca
 // de importes publicados dentro de GitHub.
 function habilitarCalculoHistorico018(){
   if(window.__soleCalculoHistorico018 || typeof window.editProductClaimFull!=='function'
      || typeof window.pcManualReworkCosts!=='function')return;
   const previousEdit=window.editProductClaimFull;
   const previousNew=window.newProductClaim;
   const previousRework=window.pcManualReworkCosts;
   let active=null;
   const round2=x=>Math.round((Number(x)||0)*100)/100;
   const current=()=>{
     if(!active)return null;
     if(String($('pcClaimNo')?.value||'').trim().toUpperCase()!=='2026-018')return null;
     return active;
   };
   const recalc=()=>{if(typeof window.calcProductClaim==='function')window.calcProductClaim(false)};
   function eraseInfo(){
     $('sole018HistoricalBalance')?.remove();
     active=null;
   }
   function productSubtotal(){
     return round2(productClaimLines.reduce((sum,l)=>sum+(Number(pcLineSubtotal(l))||0),0));
   }
   window.pcManualReworkCosts=function(){
     const normal=previousRework.apply(this,arguments);
     const ctx=current();
     if(!ctx || $('pcAmountMode')?.value==='ANTERIOR'
        || $('sole018UseBalance')?.checked===false)return normal;
     const storage=productClaimLines.reduce((sum,line)=>{
       normalizeProductActions(line);
       return sum+(line.chargeStorage?(Number(line.storageUsd)||0):0);
     },0);
     const extra=Number($('pcExtraUsd')?.value)||0;
     // El saldo histórico ya incluye todos los conceptos distintos al producto.
     // Evita sumar almacenaje/otros conceptos dos veces.
     const target=round2(Math.max(0,ctx.nonProductBalance-storage-extra));
     const previous=Number(normal.totalUsd)||0;
     const diff=round2(target-previous);
     if(Math.abs(diff)>=0.005){
       const fx=Number($('pcFx')?.value)||Number(cfg.fx)||1;
       const line=['Conciliación de costo histórico 2026-018',
         'Saldo del importe original menos cobro por productos; sin modificar partidas originales',
         round2(diff*fx),diff];
       normal.rows=[...(normal.rows||[]),line];
     }
     normal.totalUsd=target;
     normal.totalPen=round2((normal.rows||[]).reduce((sum,row)=>sum+(Number(row[2])||0),0));
     return normal;
   };
   window.editProductClaimFull=function(claim){
     eraseInfo();
     const record=typeof claimDataByNo==='function'?claimDataByNo(claim):null;
     const result=previousEdit.apply(this,arguments);
     if(String(claim||'').trim().toUpperCase()!=='2026-018'||!record)return result;
     const savedAmount=Number(record.amount);
     const product=productSubtotal();
     const previouslyComputed=Number(record.reworkChargeTotal);
     if(!Number.isFinite(savedAmount)||savedAmount<0){
       console.warn('No se pudo calcular el saldo de 2026-018 sin un monto guardado');
       return result;
     }
     // Después de guardar en modo calculado, reworkChargeTotal se conserva.
     // Antes del primer guardado, el saldo se obtiene del monto histórico
     // porque la ficha técnica antigua no reproducía los gastos del expediente.
     const matched=!record.oldFormat && Number.isFinite(previouslyComputed)
       && previouslyComputed>=0 && Math.abs(savedAmount-product-previouslyComputed)<0.03;
     const base=round2(matched?previouslyComputed:Math.max(0,savedAmount-product));
     active={nonProductBalance:base,sourceAmount:savedAmount};
     const anchor=$('pcReworkCostRows')?.closest('table')||$('pcCostCard');
     if(anchor && anchor.parentNode){
       const panel=document.createElement('div');
       panel.id='sole018HistoricalBalance';
       panel.style.cssText='margin:12px 0;padding:12px;border:1px solid #c5dce8;border-radius:12px;background:#f0f8fc;color:#183e53;font:13px Segoe UI,Arial,sans-serif';
       const label=document.createElement('label');
       label.style.cssText='display:flex;align-items:center;gap:9px;font-weight:700;font-size:13px;color:#183e53';
       const checkbox=document.createElement('input');checkbox.type='checkbox';
       checkbox.id='sole018UseBalance';checkbox.checked=true;
       checkbox.style.cssText='width:18px;height:18px;margin:0;flex:none';
       const caption=document.createElement('span');
       caption.textContent='Mantener saldo de reproceso histórico: USD '+base.toFixed(2);
       label.append(checkbox,caption);
       const info=document.createElement('div');
       info.style.cssText='font-size:11px;color:#536e81;margin-top:7px;line-height:1.4';
       info.textContent='Es el importe vigente de esta liquidación menos los productos cobrados originalmente. Desmarcar «Cobrar producto» descuenta ese producto y conserva este saldo. Si desactivas esta opción, utilizarás únicamente los costos recalculados con las tablas actuales.';
       panel.append(label,info);
       anchor.insertAdjacentElement('afterend',panel);
       checkbox.addEventListener('change',recalc);
     }
     recalc();
     return result;
   };
   if(typeof previousNew==='function'){
     window.newProductClaim=function(){eraseInfo();return previousNew.apply(this,arguments)};
   }
   window.__soleCalculoHistorico018=true;
 }


 // Numeración única entre Productos/Cajas, incluye los números reservados
 // por documentos históricos, editados, eliminados y sincronizados de Firestore.
 function instalarControlCorrelativos(){
  if(window.__soleCorrelativosV1 || typeof window.nextClaim!=='function'
     || typeof window.saveConsolidatedProductClaim!=='function'
     || typeof window.saveBoxClaim!=='function')return;
  const normalize=id=>{
   const raw=String(id==null?'':id).trim().toUpperCase().replace(/\s+/g,'');
   const m=/^(\d{4})-(\d+)(SN)?$/.exec(raw);
   return m?m[1]+'-'+String(Number(m[2])).padStart(3,'0')+(m[3]||''):raw;
  };
  const missing=s=>!normalize(s) || /^(?:S\/N|SN|SINN[ÚU]MERO|SINNRO\.?|N\/A|-)$/.test(normalize(s));
  const year=date=>{
   const m=String(date||'').match(/^(20\d{2})-/);
   return m?m[1]:String(new Date().getFullYear());
  };
  function ids(){
   const set=new Set();
   const add=id=>{const x=normalize(id);if(x&&!missing(x))set.add(x)};
   for(const id of saved.keys())add(id);
   for(const c of (Array.isArray(HIST)?HIST:[]))add(c?.claim);
   for(const c of (Array.isArray(localClaims)?localClaims:[]))add(c?.claim);
   for(const id of Object.keys(claimEdits||{}))add(id);
   for(const id of (deletedClaims||[]))add(id);
   for(const c of (compensations||[]))add(c?.claim);
   return set;
  }
  function available(y,suffix=''){
   const used=ids();
   for(let i=1;i<100000;i++){
    const id=y+'-'+String(i).padStart(3,'0')+suffix;
    if(!used.has(id))return id;
   }
   throw Error('No se encontró correlativo disponible.');
  }
  let editingProduct=null;
  const oldNext=window.nextClaim;
  window.nextClaim=function(){return available(String(new Date().getFullYear()))};
  const oldNew=window.newProductClaim;
  if(typeof oldNew==='function')window.newProductClaim=function(){
   editingProduct=null;
   const output=oldNew.apply(this,arguments);
   refresh();
   return output;
  };
  const oldEdit=window.editProductClaimFull;
  if(typeof oldEdit==='function')window.editProductClaimFull=function(id){
   const output=oldEdit.apply(this,arguments);
   if($('pcClaimNo') && normalize($('pcClaimNo').value)===normalize(id))
      editingProduct=normalize(id);
   refresh();
   return output;
  };
  function review(inputId,isEditing){
   const field=$(inputId);
   if(!field)return;
   const id=normalize(field.value);
   const parent=field.parentElement;if(!parent)return;
   let hint=parent.querySelector('[data-sole-correlativo]');
   if(!hint){hint=document.createElement('small');hint.dataset.soleCorrelativo='1';
     hint.style.cssText='display:block;margin-top:4px;font-size:12px;font-weight:600';parent.appendChild(hint)}
   const used=ids();
   const currentEditing=isEditing&&editingProduct===id;
   const duplicate=used.has(id)&&!currentEditing;
   field.setCustomValidity(duplicate?'Esta liquidación ya existe.':'');
   hint.style.color=duplicate?'#af2630':'#356c53';
   if(duplicate){const origin=typeof window.soleDiagnosticarCorrelativo==='function'?window.soleDiagnosticarCorrelativo(id):'';hint.textContent='Este correlativo está reservado. '+(origin||'Revisa los registros y el histórico antes de reutilizarlo.');hint.style.whiteSpace='pre-line';}
   else if(missing(field.value))hint.textContent='Se asignará '+available(year(inputId==='pcClaimNo'?$('pcDate')?.value:$('boxPeriod')?.value),'SN')+' automáticamente.';
   else if(currentEditing)hint.textContent='Editando liquidación existente.';
   else hint.textContent='Número disponible.';
  }
  function refresh(){review('pcClaimNo',true);review('boxClaimNo',false)}
  for(const name of ['pcClaimNo','boxClaimNo']){
   const field=$(name);
   if(field){field.addEventListener('input',refresh);field.addEventListener('blur',refresh)}
  }
  function validateNew(inputId,editingId){
   if(!ready||busy||conflict||dirty){
    alert('No se puede crear otra liquidación mientras hay cambios sin sincronizar. Comprueba el guardado en Firebase.');
    return false;
   }
   const field=$(inputId);if(!field)return false;
   const raw=field.value;
   const date=inputId==='pcClaimNo'?$('pcDate')?.value:$('boxPeriod')?.value;
   const id=missing(raw)?available(year(date),'SN'):normalize(raw);
   if(!/^[A-Z0-9._-]{1,120}$/.test(id)){
    alert('Número de liquidación no válido. Usa AAAA-001 o S/N.');
    field.focus();return false;
   }
   const editing=normalize(editingId||'');
   if(editing && id!==editing){
    alert('Estás editando la liquidación '+editing+'. No cambies su correlativo desde esta pantalla: podría crear otra liquidación y dejar la original. Conserva el número y guarda.');
    field.focus();return false;
   }
   if(ids().has(id) && id!==editing){
    alert('La liquidación '+id+' ya existe. No se guardó ni se reemplazó ninguna liquidación.\nSiguiente correlativo disponible: '+available(year(date)));
    field.focus();refresh();return false;
   }
   field.value=id;
   review(inputId,inputId==='pcClaimNo');
   return true;
  }
  const oldSaveProduct=window.saveConsolidatedProductClaim;
  window.saveConsolidatedProductClaim=function(){
   if(!validateNew('pcClaimNo',editingProduct))return;
   return oldSaveProduct.apply(this,arguments);
  };
  const oldSaveBox=window.saveBoxClaim;
  window.saveBoxClaim=function(){
   if(!validateNew('boxClaimNo',null))return;
   return oldSaveBox.apply(this,arguments);
  };
  // La transacción de nube-privada.js mantiene el bloqueo definitivo
  // si dos usuarios eligen el mismo correlativo casi simultáneamente.
  window.__soleCorrelativosV1=true;
  refresh();
 }

 /* Administración confirmada de registros ocultos. No cambiar datos antes de la confirmación de Firestore. */
 function hiddenCloudReady(){
  if(role!=='Administrador'||!user||!ready||!claimsReady||!seedsReady)
   throw Error('Se requiere una sesión de Administrador con la nube totalmente cargada.');
  if(dirty||busy||conflict)throw Error('Hay cambios pendientes o un conflicto. Revisa el estado de sincronización antes de continuar.');
 }
 function hiddenSafeId(id){
  id=norm(id);
  if(!/^20\d{2}-\d{3}(?:SN)?$/.test(id))throw Error('Número de liquidación inválido.');
  return id;
 }
 function downloadHiddenBackup(id,body){
  const blob=new Blob([JSON.stringify(body,null,2)],{type:'application/json'});
  const a=document.createElement('a'),url=URL.createObjectURL(blob);
  a.href=url;a.download='SOLE_RESPALDO_PREVIO_ELIMINAR_'+id+'.json';document.body.append(a);
  a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
 }
 async function hiddenCloudAction(id,action){
  hiddenCloudReady();id=hiddenSafeId(id);
  if(action!=='restore'&&action!=='delete')throw Error('Acción inválida.');
  const ref=db.collection(COLLECTION).doc(id);
  const seedRef=db.collection(SEEDS_COLLECTION).doc('HIST');
  if(action==='restore'){
   // El botón anterior solo modificaba localStorage. Firestore devolvía el estado oculto.
   const snapshot=await ref.get({source:'server'});
   const prior=snapshot.exists?fromFirestore(snapshot.data()):null;
   if(!prior && !([...deletedClaims].some(k=>norm(k)===id)))
     throw Error('No hay una marca de ocultamiento para restaurar.');
   const historical=(Array.isArray(HIST)?HIST:[]).filter(x=>norm(x.claim)===id);
   const backupRecord=(Array.isArray(localClaims)?localClaims:[]).find(x=>norm(x.claim)===id)||null;
   const hasRecord=!!(prior?.registro||backupRecord||historical.length);
   if(!hasRecord)throw Error('Este número está oculto, pero no tiene ficha recuperable. No se ha modificado Firebase.');
   const reconstructed=prior?.registro||backupRecord||{
     claim:id,claimType:'PRODUCTO',source:'HISTÓRICO',supplier:historical.find(x=>x.supplier)?.supplier||'',
     status:historical.find(x=>x.status)?.status||'PENDIENTE',
     amount:Number(historical.find(x=>x.unique)?.uniqueAmount??historical[0]?.amount??0),
     problem:historical.find(x=>x.defect)?.defect||'',
     observations:historical.find(x=>x.observations)?.observations||'',
     rows:copy(historical),date:historical.find(x=>x.date)?.date||''
   };
   const currentRev=snapshot.exists?String(snapshot.data().revision||''):null;
   const revision=(self.crypto?.randomUUID?.()||String(Date.now()));
   busy=true;
   try{
    await db.runTransaction(async tx=>{
     const cur=await tx.get(ref);
     if((currentRev===null&&cur.exists)||(currentRev!==null&&(!cur.exists||String(cur.data()?.revision||'')!==currentRev)))
       throw Error('El expediente cambió en otro equipo. Recarga antes de restaurar.');
     const payload=cur.exists?cur.data():toFirestore({claim:id,registro:reconstructed,edicion:{},compensaciones:[],eliminada:false});
     const oldData=cur.exists?fromFirestore(cur.data()):null;
     const restoredData=oldData?.registro?payload:toFirestore({...oldData,claim:id,registro:reconstructed,
       edicion:oldData?.edicion||{},compensaciones:oldData?.compensaciones||[],eliminada:false});
     tx.set(ref,{...restoredData,claim:id,eliminada:false,revision,version:126,
       autor:user.uid,actualizado:firebase.firestore.FieldValue.serverTimestamp()});
    });
    // Refrescar desde la fuente real antes de comunicar éxito.
    const fresh=await db.collection(COLLECTION).get({source:'server'});
    busy=false;receive(fresh);
    if(deletedClaims.has(id))throw Error('La nube sigue marcando el registro como oculto. Verifica su estado.');
    return 'La liquidación '+id+' fue restaurada y confirmada en Firebase.';
   }finally{busy=false}
  }
  // Eliminar definitivamente: exige respaldo local descargado + correlativo exacto.
  const [record,seed]=await Promise.all([ref.get({source:'server'}),seedRef.get({source:'server'})]);
  const raw=record.exists?record.data():null,unpacked=raw?fromFirestore(raw):null;
  const history=seed.exists?JSON.parse(seed.data().json||'[]'):[];
  if(!Array.isArray(history))throw Error('No se puede verificar la base histórica. Cancelado.');
  const historicalRows=history.filter(x=>norm(x?.claim)===id);
  if(!record.exists&&!historicalRows.length)
    throw Error('Solo se encontró una referencia local sin documento verificable. No hay datos seguros que eliminar de Firebase.');
  const linkedComp=unpacked?.compensaciones||[];
  if(linkedComp.length||compensations.some(x=>norm(x.claim)===id))
    throw Error('Esta liquidación tiene compensaciones. Debes revisarlas antes de autorizar la eliminación definitiva.');
  if(![...deletedClaims].some(x=>norm(x)===id))
    throw Error('Solo es posible eliminar desde el listado de registros OCULTOS. Oculta primero una liquidación activa si corresponde.');
  const entered=prompt('ELIMINACIÓN DEFINITIVA DE DATOS\n\nSe borrará el expediente '+id+' de Firebase y, si existe, de la base histórica compartida. El número podrá quedar disponible y esta acción no se podrá deshacer desde la plataforma.\n\nPrimero se descargará un respaldo individual.\n\nEscribe exactamente '+id+' para continuar:');
  if(entered!==id)return 'Operación cancelada: no se borró ningún dato.';
  // Backup antes de hacer cambios: no tocar la nube si el respaldo falla.
  downloadHiddenBackup(id,{formato:'SOLE_RESPALDO_PREVIO_ELIMINACION_V1',id,
   fecha:new Date().toISOString(),documentoNube:raw,registro:unpacked,
   filasHistoricas:historicalRows,registrosRelacionados:(localClaims||[]).filter(x=>norm(x.claim)===id)});
  if(!confirm('Última confirmación: ¿eliminar DEFINITIVAMENTE '+id+' de los expedientes y del histórico de Firebase?'))
   return 'Operación cancelada: se descargó un respaldo, pero no se borró ningún dato.';
  const recordRev=record.exists?String(raw?.revision||''):null;
  const seedJson=seed.exists?String(seed.data()?.json||''):'';
  busy=true;
  try{
   await db.runTransaction(async tx=>{
    const snapshots=await Promise.all([tx.get(ref),tx.get(seedRef)]);
    const current=snapshots[0],currentSeed=snapshots[1];
    if((recordRev===null&&current.exists)||(recordRev!==null&&(!current.exists||String(current.data()?.revision||'')!==recordRev)))
      throw Error('El expediente cambió mientras lo revisabas. No se eliminó.');
    if(historicalRows.length && (!currentSeed.exists||String(currentSeed.data()?.json||'')!==seedJson))
      throw Error('El histórico cambió mientras lo revisabas. No se eliminó.');
    if(current.exists)tx.delete(ref);
    if(historicalRows.length){
     const updated=history.filter(x=>norm(x?.claim)!==id);
     tx.update(seedRef,{json:JSON.stringify(updated),actualizado:firebase.firestore.FieldValue.serverTimestamp(),autor:user.uid});
    }
   });
   // Quitar referencias locales una vez que la transacción haya sido confirmada.
   applying=true;
   try{
    localClaims=localClaims.filter(x=>norm(x.claim)!==id);
    Object.keys(claimEdits||{}).forEach(k=>{if(norm(k)===id)delete claimEdits[k]});
    compensations=compensations.filter(x=>norm(x.claim)!==id);
    [...deletedClaims].forEach(k=>{if(norm(k)===id)deletedClaims.delete(k)});
    HIST=HIST.filter(x=>norm(x.claim)!==id);
    localStorage.setItem('SOLE_QA_LOCAL_CLAIMS_V1',JSON.stringify(localClaims));
    localStorage.setItem('SOLE_QA_CLAIM_EDITS_V13',JSON.stringify(claimEdits));
    localStorage.setItem('SOLE_QA_COMP_V1',JSON.stringify(compensations));
    localStorage.setItem('SOLE_QA_CLAIM_DELETED_V16',JSON.stringify([...deletedClaims]));
   }finally{applying=false}
   const fresh=await db.collection(COLLECTION).get({source:'server'});
   busy=false;receive(fresh);repaint();
   return 'Eliminación confirmada en Firebase: '+id+'. Conserva el respaldo descargado.';
  }finally{busy=false}
 }

 const KEEP_HIDDEN = Object.freeze(['2026-001','2026-002','2026-003','2026-016']);
 // Recuperación independiente: primero las cuatro fichas completas; la limpieza va después.
 async function restoreFourWithHistory(){
   hiddenCloudReady();
   const ids=['2026-001','2026-002','2026-003','2026-016'];
   const [seed,collection]=await Promise.all([
     db.collection(SEEDS_COLLECTION).doc('HIST').get({source:'server'}),
     db.collection(COLLECTION).get({source:'server'})
   ]);
   if(!seed.exists)throw Error('No existe el histórico maestro en Firebase. No se ha modificado nada.');
   const history=JSON.parse(seed.data()?.json||'[]');
   if(!Array.isArray(history))throw Error('El histórico no es válido.');
   const cloud=new Map(collection.docs.filter(d=>!d.data()?.archivadoV124).map(d=>[norm(d.id),{raw:d.data(),data:fromFirestore(d.data())}]));
   const targets=[];
   for(const id of ids){
     const rows=history.filter(r=>norm(r.claim)===id);
     if(!rows.length)throw Error('Faltan las filas históricas de '+id+'. No se hizo ninguna modificación.');
     const suppliers=[...new Set(rows.map(r=>String(r.supplier||'').trim().toUpperCase()).filter(Boolean))];
     if(suppliers.length!==1)throw Error('La liquidación '+id+' presenta proveedores contradictorios. Se canceló.');
     const historical=rows.find(r=>r.unique)||rows[0];
     const existing=cloud.get(id)?.data;
     const existingRecord=existing?.registro||{};
     const originalNotes=[...new Set(rows.map(r=>String(r.observations||'').trim()).filter(Boolean))];
     const originalDefects=[...new Set(rows.map(r=>String(r.defect||'').trim()).filter(Boolean))];
     // La ficha histórica es la fuente de la descripción del defecto y los comentarios.
     // Las ediciones, eventos y compensaciones existentes se preservan exactamente.
     if(existingRecord.supplier && String(existingRecord.supplier).trim().toUpperCase()!==suppliers[0])
       throw Error('Conflicto de proveedor en '+id+'. No se mezclará con '+existingRecord.supplier+'.');
     const registro={
       ...existingRecord,
       claim:id,claimType:'PRODUCTO',source:existingRecord.source||'HISTÓRICO',
       supplier:historical.supplier,status:existingRecord.status||historical.status||'PENDIENTE',
       amount:Number(existingRecord.amount??historical.uniqueAmount??historical.amount??0),
       observations:existingRecord.observations && !/^LIQUIDACIÓN PRODUCTO\s*·?\s*$/i.test(String(existingRecord.observations).trim())
         ? existingRecord.observations : originalNotes.join('\n'),
       problem:existingRecord.problem||originalDefects.join(' / '),
       rows:copy(rows),date:existingRecord.date||historical.emailDate||'',
       historicalObservations:originalNotes, historicalDefects:originalDefects
     };
     const edicion=existing?.edicion||{};
     const compensaciones=existing?.compensaciones||[];
     targets.push({id,registro,edicion,compensaciones,raw:cloud.get(id)?.raw||null,notes:originalNotes});
   }
   const promptText=targets.map(x=>x.id+' · '+x.registro.supplier+' · '+x.registro.rows.length+
     ' códigos/filas · '+x.notes.length+' observación(es)').join('\n');
   if(!confirm('RECUPERACIÓN DE LAS CUATRO LIQUIDACIONES\n\n'+promptText+
      '\n\nSe restaurará su visibilidad y se conservarán los comentarios históricos, seguimientos y compensaciones existentes. No se eliminará nada. ¿Continuar?'))
     return 'Cancelado. Sin cambios.';
   downloadHiddenBackup('CUATRO_PREVIO_RESTAURAR',{formato:'SOLE_RESPALDO_RECUPERAR_CUATRO_V1',
     fecha:new Date().toISOString(),registros:targets});
   busy=true;
   try{
     await db.runTransaction(async tx=>{
       const refs=targets.map(x=>db.collection(COLLECTION).doc(x.id));
       const snapshots=await Promise.all(refs.map(ref=>tx.get(ref)));
       snapshots.forEach((snap,i)=>{
         const before=targets[i].raw;
         if(!!before!==snap.exists||
           (before&&String(before.revision||'')!==String(snap.data()?.revision||'')))
             throw Error('La liquidación '+targets[i].id+' cambió en la nube. Recarga y revisa antes de modificar.');
       });
       targets.forEach((target,i)=>{
         const payload={claim:target.id,registro:target.registro,edicion:target.edicion,
           compensaciones:target.compensaciones,eliminada:false};
         tx.set(refs[i],{...toFirestore(payload),
           revision:(self.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2)),
           version:126,autor:user.uid,actualizado:firebase.firestore.FieldValue.serverTimestamp()});
       });
     });
     const fresh=await db.collection(COLLECTION).get({source:'server'});
     busy=false;receive(fresh);
     const missed=targets.filter(x=>deletedClaims.has(x.id)||
       !localClaims.some(c=>norm(c.claim)===x.id)).map(x=>x.id);
     if(missed.length)throw Error('Firebase guardó los cambios, pero no se visualizaron: '+missed.join(', '));
     return 'RESTAURADAS Y COMPROBADAS EN FIREBASE: '+ids.join(', ')+
       '\nSe han recuperado las observaciones y defectos de las filas históricas.'+
       '\nSeguimientos anteriores: se conservaron los que existían en Firebase.';
   }finally{busy=false}
 }
 async function bulkKeepAndClean(){
  hiddenCloudReady();
  const keep=new Set(KEEP_HIDDEN);
  const seedRef=db.collection(SEEDS_COLLECTION).doc('HIST');
  // Releer todo del servidor, nunca fiarse de una lista del navegador que puede estar desactualizada.
  const [records,seed]=await Promise.all([
    db.collection(COLLECTION).get({source:'server'}),
    seedRef.get({source:'server'})
  ]);
  if(!seed.exists)throw Error('No se pudo verificar la base histórica. No se efectuaron cambios.');
  const history=JSON.parse(seed.data()?.json||'[]');
  if(!Array.isArray(history))throw Error('La base histórica no tiene formato válido.');
  const cloud=new Map();
  for(const d of records.docs){
    if(d.data()?.archivadoV124)continue;
    cloud.set(norm(d.id),{ref:d.ref,raw:d.data(),data:fromFirestore(d.data())});
  }
  // Nunca limpiar si las cuatro liquidaciones no están ya recuperadas con ficha visible.
  for(const keepId of keep){
    const inCloud=cloud.get(keepId)?.data;
    if(!inCloud?.registro||inCloud.eliminada)
      throw Error('Primero pulsa «1. Recuperar 001, 002, 003 y 016 con notas». Falta '+keepId+'. No se eliminó nada.');
  }
  const hidden=new Set([...deletedClaims].map(norm));
  for(const [id,r] of cloud)if(r.data?.eliminada)hidden.add(id);
  const remove=[...hidden].filter(id=>!keep.has(id)).sort();
  const restore=[...keep].filter(id=>hidden.has(id)).sort();
  const rejected=[];
  for(const id of remove){
    const rec=cloud.get(id);
    if((rec?.data?.compensaciones||[]).length || compensations.some(x=>norm(x.claim)===id)){
      rejected.push(id+' tiene compensaciones');continue;
    }
    if(localClaims.some(x=>norm(x.claim)===id && ![...deletedClaims].some(k=>norm(k)===id))){
      rejected.push(id+' aparece activo en esta sesión');continue;
    }
  }
  if(rejected.length)throw Error('No se pudo preparar la limpieza por seguridad: '+rejected.join('; ')+'. No se modificó nada.');
  // Para restaurar, debe haber ficha real; los números sin ficha no se publicarán como liquidaciones ficticias.
  const restoration=new Map();
  for(const id of restore){
    const c=cloud.get(id)?.data;
    const rows=history.filter(x=>norm(x.claim)===id);
    const local=localClaims.find(x=>norm(x.claim)===id);
    const record=c?.registro||local|| (rows.length?{
      claim:id,claimType:'PRODUCTO',source:'HISTÓRICO',
      supplier:rows.find(x=>x.supplier)?.supplier||'',
      status:rows.find(x=>x.status)?.status||'PENDIENTE',
      amount:Number(rows.find(x=>x.unique)?.uniqueAmount??rows[0].amount??0),
      observations:rows.find(x=>x.observations)?.observations||'',
      rows:copy(rows),date:rows.find(x=>x.date)?.date||''
    }:null);
    if(!record)throw Error('Falta la ficha de '+id+'. No se modificó nada.');
    restoration.set(id,record);
  }
  const description='RESTAURAR: '+(restore.join(', ')||'ninguna')+'\nELIMINAR DEL HISTÓRICO Y NUBE: '+(remove.join(', ')||'ninguna')+
    '\n\nCONSERVAR TODOS LOS DEMÁS REGISTROS ACTIVOS.\n\nSe hará una copia de respaldo antes de modificar Firebase.';
  if(!confirm(description+'\n\n¿Deseas continuar?'))return 'Operación cancelada. No hubo cambios.';
  const answer=prompt('CONFIRMACIÓN FINAL\n\nEscribe exactamente: LIMPIAR OCULTOS\n\nSe eliminarán los registros ocultos que no deseas conservar. No se eliminarán otras liquidaciones.');
  if(answer!=='LIMPIAR OCULTOS')return 'Operación cancelada. No hubo cambios.';
  const payload={formato:'SOLE_RESPALDO_LIMPIEZA_OCULTOS_V1',fecha:new Date().toISOString(),
    conservar:[...keep],restaurar:restore,eliminar:remove,
    documentosNube:[...cloud].filter(([id])=>remove.includes(id)||restore.includes(id)).map(([id,v])=>({id,raw:v.raw})),
    historico:history.filter(x=>remove.includes(norm(x.claim))||restore.includes(norm(x.claim))),
    notasLocales:restore.map(id=>({id,edicion:claimEdits[id]||{},registro:localClaims.find(x=>norm(x.claim)===id)||null}))};
  downloadHiddenBackup('LOTE_OCULTOS',payload);
  // La transacción es atómica: restauración de los elegidos y borrado del resto, o nada.
  const revision=new Map([...cloud].map(([id,v])=>[id,String(v.raw.revision||'')]));
  busy=true;
  try{
    await db.runTransaction(async tx=>{
      // Leer primero todos los documentos. Nunca escribir antes de terminar las lecturas.
      const allRefs=[...new Set([...restore,...remove])];
      const fetched=await Promise.all(allRefs.map(id=>tx.get(db.collection(COLLECTION).doc(id))));
      const currentSeed=await tx.get(seedRef);
      if(!currentSeed.exists || currentSeed.data()?.json!==seed.data()?.json)
        throw Error('El histórico cambió durante la operación; no se eliminó nada.');
      fetched.forEach((snap,i)=>{
        const id=allRefs[i],original=cloud.get(id);
        if(!!original !== snap.exists || (original && String(snap.data()?.revision||'')!==revision.get(id)))
          throw Error('El expediente '+id+' cambió mientras se procesaba. No se eliminó nada.');
      });
      for(const id of restore){
        const ref=db.collection(COLLECTION).doc(id),old=cloud.get(id)?.data;
        const restored={claim:id,registro:restoration.get(id),
          edicion:old?.edicion||{},compensaciones:old?.compensaciones||[],eliminada:false};
        tx.set(ref,{...toFirestore(restored),revision:(self.crypto?.randomUUID?.()||Date.now()+'-'+Math.random()),
          version:126,autor:user.uid,actualizado:firebase.firestore.FieldValue.serverTimestamp()});
      }
      for(const id of remove)if(cloud.has(id))tx.delete(db.collection(COLLECTION).doc(id));
      const keptHistory=history.filter(x=>!remove.includes(norm(x?.claim)));
      if(keptHistory.length!==history.length)
        tx.update(seedRef,{json:JSON.stringify(keptHistory),actualizado:firebase.firestore.FieldValue.serverTimestamp(),autor:user.uid});
    });
    // No dejar basura local que pueda volver a sincronizarse como un expediente nuevo.
    applying=true;
    try{
      localClaims=localClaims.filter(x=>!remove.includes(norm(x.claim)));
      for(const k of Object.keys(claimEdits||{}))if(remove.includes(norm(k)))delete claimEdits[k];
      compensations=compensations.filter(x=>!remove.includes(norm(x.claim)));
      deletedClaims=new Set([...deletedClaims].filter(x=>!remove.includes(norm(x))&&!restore.includes(norm(x))));
      HIST=history.filter(x=>!remove.includes(norm(x?.claim)));
      localStorage.setItem('SOLE_QA_LOCAL_CLAIMS_V1',JSON.stringify(localClaims));
      localStorage.setItem('SOLE_QA_CLAIM_EDITS_V13',JSON.stringify(claimEdits));
      localStorage.setItem('SOLE_QA_COMP_V1',JSON.stringify(compensations));
      localStorage.setItem('SOLE_QA_CLAIM_DELETED_V16',JSON.stringify([...deletedClaims]));
    }finally{applying=false}
    const fresh=await db.collection(COLLECTION).get({source:'server'});
    busy=false;receive(fresh);repaint();
    return 'OPERACIÓN CONFIRMADA EN FIREBASE.\nRestauradas: '+(restore.join(', ')||'ninguna')+
      '\nEliminadas: '+(remove.join(', ')||'ninguna')+
      '\nSe descargó el respaldo del lote.';
  }finally{busy=false}
 }
 async function historicalNotes001(){
  hiddenCloudReady();
  const id='2026-001';
  const [seed,doc]=await Promise.all([
    db.collection(SEEDS_COLLECTION).doc('HIST').get({source:'server'}),
    db.collection(COLLECTION).doc(id).get({source:'server'})
  ]);
  const rows=seed.exists?JSON.parse(seed.data().json||'[]'):[];
  if(!Array.isArray(rows))throw Error('Histórico no disponible.');
  const current=doc.exists?fromFirestore(doc.data()):null;
  const supplier=String(current?.registro?.supplier||cloudClaim001()?.supplier||'').trim().toUpperCase();
  const relevant=rows.filter(x=>norm(x.claim)===id && (!supplier||String(x.supplier||'').trim().toUpperCase()===supplier));
  const sources=[];
  const add=(label,x)=>{
    if(typeof x==='string'&&x.trim())sources.push([label,x.trim()]);
    if(Array.isArray(x)&&x.length)sources.push([label,x.map(v=>typeof v==='string'?v:JSON.stringify(v)).join('\n')]);
  };
  for(const x of relevant){
    for(const field of ['observations','observation','defect','problem','supplierResponse','notes','trackingNote'])
      add('Histórico '+field,x[field]);
  }
  const archived=current?.registro||{};
  for(const field of ['observations','problem','notes','trackingNote'])add('Ficha actual '+field,archived[field]);
  const ed=current?.edicion||{};
  for(const field of ['observations','trackingNote','trackingEvents','calendarEvents','notes'])
    add('Seguimiento en Firebase '+field,ed[field]);
  const recovered=recovery.get(id);
  if(recovered){
    const recoverySupplier=String(recovered.registro?.supplier||supplier).toUpperCase();
    if(!supplier||recoverySupplier===supplier){
      for(const field of ['observations','trackingNote','trackingEvents','notes'])
        add('Rescate local '+field,recovered.edicion?.[field]??recovered.registro?.[field]);
    }
  }
  const unique=[...new Map(sources.map(([name,value])=>[name+'|'+value,[name,value]])).values()];
  const report='LIQUIDACIÓN '+id+' / '+(supplier||'PROVEEDOR SIN IDENTIFICAR')+'\n'+
    'Notas y eventos recuperables: '+unique.length+'\n\n'+
    (unique.map(([label,value])=>label+':\n'+value).join('\n\n')||
      'No se encontraron notas ni seguimientos adicionales en el histórico y los respaldos locales accesibles.')+
    '\n\nNo se mezclaron notas de proveedores distintos ni se reemplazaron datos de Firebase.';
  return {report,notes:unique.map(x=>x[1])};
 }
 function cloudClaim001(){
   return localClaims.find(x=>norm(x.claim)==='2026-001')||null;
 }
 window.soleGestionOcultos={
   restaurar:id=>hiddenCloudAction(id,'restore'),
   eliminar:id=>hiddenCloudAction(id,'delete'),
   recuperarCuatro:restoreFourWithHistory,
   limpiarConservando:bulkKeepAndClean,
   notas001:historicalNotes001,
   get estado(){return {ready,rol:role,busy,dirty,conflict}}
 };
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
  habilitarCalculoHistorico018();
  instalarControlCorrelativos();
  auth.onAuthStateChanged(authChanged,e=>showProblem('Error Firebase Auth: '+e.message));
  window.soleV126Online={get estado(){return{ready,acceso:'privado_corporativo',rol:role,email:user?.email||null,dirty,busy,conflict,error:syncError,cambiosRemotosEnEspera:!!pending,cantidad:saved.size,ultimaRecepcion:lastRemoteAt}},guardar:()=>{dirty=true;return upload()}};
 }catch(e){showProblem('Error de inicialización: '+e.message)}
})();
