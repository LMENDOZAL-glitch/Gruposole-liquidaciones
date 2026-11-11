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
  snap.docs.forEach(d=>{const v=fromFirestore(d.data());if(!v?.claim)return;const k=norm(v.claim);next.set(k,v);if(v.eliminada){deleted.add(k);return}if(v.registro)rows.push(copy(v.registro));if(v.edicion)edit[k]=copy(v.edicion);if(Array.isArray(v.compensaciones))comps.push(...copy(v.compensaciones))});
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
  auth.onAuthStateChanged(authChanged,e=>showProblem('Error Firebase Auth: '+e.message));
  window.soleV126Online={get estado(){return{ready,acceso:'privado_corporativo',rol:role,email:user?.email||null,dirty,busy,conflict,error:syncError,cambiosRemotosEnEspera:!!pending,cantidad:saved.size,ultimaRecepcion:lastRemoteAt}},guardar:()=>{dirty=true;return upload()}};
 }catch(e){showProblem('Error de inicialización: '+e.message)}
})();
