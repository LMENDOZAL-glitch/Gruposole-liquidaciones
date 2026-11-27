/* Consolidado general de repuestos: edición a nivel liquidación, no altera costos */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const choices={SOLICITADO:'Solicitado para este reproceso',UTILIZADO:'Utilizado en este reproceso',DEFECTUOSO:'Defectuoso identificado'};
let rows=[];
function clean(r){
 return {code:String(r?.code||'').trim().slice(0,120),description:String(r?.description||'').trim().slice(0,420),
 qty:Number(r?.qty||0),status:choices[r?.status]?r.status:'SOLICITADO',
 defect:String(r?.defect||'').trim().slice(0,450),note:String(r?.note||'').trim().slice(0,500)};
}
function get(){return rows.map(clean)}
function set(data){rows=Array.isArray(data)?data.slice(0,300).map(clean):[];render()}
function counts(){let c={SOLICITADO:0,UTILIZADO:0,DEFECTUOSO:0};for(const r of rows)if(Number.isInteger(r.qty)&&r.qty>0)c[r.status]+=r.qty;return c}
function updateCount(){const p=$('soleSpareCount');if(!p)return;const c=counts();p.textContent=rows.length+' referencias · Solicitados: '+c.SOLICITADO+' · Utilizados: '+c.UTILIZADO+' · Defectuosos: '+c.DEFECTUOSO}
function render(){
 const body=$('soleSpareBody');if(!body)return;body.replaceChildren();
 rows.forEach((r,i)=>{
  const tr=document.createElement('tr');
  function input(prop,tag='input'){
   const td=document.createElement('td'),control=document.createElement(tag);
   control.style.cssText='width:100%;min-width:'+(prop==='qty'?'74px':'135px')+';border:1px solid #c6d5e0;border-radius:7px;padding:8px;font:inherit;background:var(--u-surface,#fff);color:var(--u-ink,#24394e)';
   if(tag==='select')for(const [value,label] of Object.entries(choices)){
    let opt=document.createElement('option');opt.value=value;opt.textContent=label;control.appendChild(opt);
   }
   if(prop==='qty'){control.type='number';control.min='1';control.step='1'}
   control.value=r[prop]??'';
   control.setAttribute('aria-label',prop+' repuesto '+(i+1));
   control.addEventListener('input',()=>{r[prop]=prop==='qty'?Number(control.value):control.value;updateCount()});
   td.appendChild(control);tr.appendChild(td);
  }
  input('code');input('description');input('qty');input('status','select');input('defect');input('note');
  const td=document.createElement('td'),btn=document.createElement('button');btn.type='button';btn.className='btn ghost';btn.textContent='Quitar';
  btn.onclick=()=>{rows.splice(i,1);render()};td.appendChild(btn);tr.appendChild(td);
  body.appendChild(tr);
 });
 updateCount();
}
function add(){
 if(rows.length>=300){alert('Límite de 300 registros de repuestos por liquidación.');return}
 rows.push({code:'',description:'',qty:1,status:'SOLICITADO',defect:'',note:''});render();
 $('soleSpareBody')?.lastElementChild?.querySelector('input')?.focus();
}
function fromCodes(){
 if(typeof productClaimLines==='undefined'||!Array.isArray(productClaimLines)){alert('No se encontraron productos cargados.');return}
 let found=[];
 for(const line of productClaimLines){
  for(const [field,status] of [['spareParts','SOLICITADO'],['defectiveSpareParts','DEFECTUOSO']]){
   for(const raw of Array.isArray(line[field])?line[field]:[]){
    const x=typeof raw==='string'?{code:raw}:raw||{};
    const code=String(x.code||x.partCode||x.reference||'').trim(),description=String(x.description||x.detail||x.name||'').trim();
    const qty=Number(x.qty??x.quantity??x.cantidad??0);
    if((code||description)&&Number.isInteger(qty)&&qty>0)
     found.push(clean({code,description,qty,status,defect:status==='DEFECTUOSO'?'Repuesto con defecto':'',note:'Código origen: '+String(line.code||'')}));
   }
  }
 }
 if(!found.length){alert('No se encontraron repuestos con referencia y cantidad en los códigos. Puedes ingresarlos directamente en esta tabla.');return}
 if(!confirm('¿Consolidar '+found.length+' registros existentes por código? Se mantendrán los originales y no se modificarán los costos.'))return;
 const keys=new Set(rows.map(r=>JSON.stringify(clean(r))));
 let added=0;
 for(const r of found){let k=JSON.stringify(r);if(!keys.has(k)){rows.push(r);keys.add(k);added++}}
 render();alert(added+' repuestos añadidos al consolidado general.');
}
function mount(){
 if($('soleSpareCard'))return true;
 const anchor=$('pcLinesBody')?.closest('.card');if(!anchor)return false;
 const card=document.createElement('div');card.className='card';card.id='soleSpareCard';
 card.innerHTML='<div class="card-title"><div><h3>Consolidado general de repuestos</h3>'+
 '<div class="muted">Una sola relación para toda la liquidación. Indica qué repuestos se solicitan, cuáles se utilizaron y cuáles presentan defectos; no es necesario repetirlos por código.</div></div>'+
 '<div class="actions"><button type="button" class="btn ghost" id="soleSpareImport">Consolidar desde códigos</button>'+
 '<button type="button" class="btn primary" id="soleSpareAdd">+ Agregar repuesto</button></div></div>'+
 '<div class="table-wrap"><table style="width:100%;min-width:1070px"><thead><tr>'+
 '<th>REFERENCIA</th><th>REPUESTO / DESCRIPCIÓN</th><th>CANTIDAD</th><th>DESTINO</th><th>DEFECTO ENCONTRADO</th><th>OBSERVACIÓN</th><th></th></tr></thead>'+
 '<tbody id="soleSpareBody"></tbody></table></div><div id="soleSpareCount" style="padding:10px 0;font-size:12px;font-weight:700"></div>'+
 '<div class="hint">Este consolidado describe repuestos para el proveedor. No aumenta automáticamente el importe solicitado ni modifica el detalle ya ingresado por producto. Se guarda junto con la liquidación y aparece en Registro y en el PDF oficial.</div>';
 anchor.insertAdjacentElement('afterend',card);
 $('soleSpareAdd').onclick=add;$('soleSpareImport').onclick=fromCodes;
 render();return true;
}
const LANG={
 EN:['GENERAL SPARE PARTS CONSOLIDATION','REFERENCE','PART / DESCRIPTION','QTY','PURPOSE','DEFECT','NOTES',
     'REQUESTED FOR THIS REWORK','USED IN THIS REWORK','IDENTIFIED AS DEFECTIVE'],
 ES:['CONSOLIDADO GENERAL DE REPUESTOS','REFERENCIA','REPUESTO / DESCRIPCIÓN','CANT.','DESTINO','DEFECTO','OBSERVACIONES',
     'SOLICITADO PARA ESTE REPROCESO','UTILIZADO EN ESTE REPROCESO','IDENTIFICADO COMO DEFECTUOSO'],
 PT:['CONSOLIDADO GERAL DE PEÇAS','REFERÊNCIA','PEÇA / DESCRIÇÃO','QTD.','FINALIDADE','DEFEITO','OBSERVAÇÕES',
     'SOLICITADO PARA ESTE RETRABALHO','UTILIZADO NESTE RETRABALHO','IDENTIFICADO COMO DEFEITUOSO'],
 IT:['RIEPILOGO GENERALE RICAMBI','RIFERIMENTO','RICAMBIO / DESCRIZIONE','Q.TÀ','DESTINAZIONE','DIFETTO','NOTE',
     'RICHIESTO PER LA RILAVORAZIONE','UTILIZZATO NELLA RILAVORAZIONE','IDENTIFICATO COME DIFETTOSO']
};
function valid(input){return Array.isArray(input)?input.map(clean).filter(r=>(r.code||r.description)&&Number.isInteger(r.qty)&&r.qty>0):[]}
function docSection(data,lang){
 let arr=valid(data);if(!arr.length)return '';
 let labels=LANG[String(lang||'EN').toUpperCase()]||LANG.EN;
 let out='<div style="margin:18px 0;break-inside:auto;font-family:Arial,sans-serif;color:#24405b">'+
 '<div style="background:#4d6183;color:white;font-weight:bold;padding:8px 10px;font-size:12px">'+esc(labels[0])+'</div>'+
 '<table style="width:100%;border-collapse:collapse;font-size:9px"><thead><tr>'+
 labels.slice(1,7).map(x=>'<th style="background:#e7edf5;border:1px solid #c5d2df;padding:6px;text-align:left">'+esc(x)+'</th>').join('')+
 '</tr></thead><tbody>';
 for(const r of arr){
  const state=r.status==='UTILIZADO'?labels[8]:r.status==='DEFECTUOSO'?labels[9]:labels[7];
  out+='<tr>'+[r.code,r.description,r.qty,state,r.defect,r.note].map(v=>'<td style="border:1px solid #d3dfe9;padding:6px;overflow-wrap:anywhere;vertical-align:top">'+esc(v)+'</td>').join('')+'</tr>';
 }
 return out+'</tbody></table></div>';
}
function appendToDocument(doc,lang){
 const section=docSection(get(),lang);if(!section)return doc;
 const at=doc.lastIndexOf('</body>');
 return at<0?doc+section:doc.slice(0,at)+section+doc.slice(at);
}
function registry(c){
 const arr=valid(c?.consolidatedSpareParts||c?.builderSnapshot?.consolidatedSpareParts);
 if(!arr.length)return '';
 let out='<div class="card" style="margin-top:12px;padding:12px"><h3 style="font-size:13px">Consolidado general de repuestos ('+arr.length+')</h3><div class="table-wrap">'+
 '<table class="claim-detail-table"><thead><tr><th>REFERENCIA</th><th>REPUESTO</th><th>CANT.</th><th>DESTINO</th><th>DEFECTO</th><th>OBSERVACIÓN</th></tr></thead><tbody>';
 for(const r of arr)out+='<tr>'+[r.code,r.description,r.qty,choices[r.status],r.defect,r.note].map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>';
 return out+'</tbody></table></div></div>';
}
window.soleSpareGet=get;
window.soleSpareSet=set;
window.soleSpareAppendPdf=appendToDocument;
window.soleSpareRegistry=registry;
window.soleSpareValidate=function(){
 const invalid=rows.find(r=>!(String(r.code||'').trim()||String(r.description||'').trim())||
  !Number.isInteger(Number(r.qty))||Number(r.qty)<=0);
 if(invalid){alert('Completa la referencia o descripción y una cantidad válida en el consolidado de repuestos antes de guardar.');return false}
 return true;
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
