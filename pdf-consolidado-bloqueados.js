/* Documento simplificado para una NUEVA liquidación de productos bloqueados.
   Solo afecta la salida HTML/PDF del consolidado; nunca escribe en Firebase. */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>Number(v)||0;
const amt=v=>n(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const qty=v=>n(v).toLocaleString('en-US',{maximumFractionDigits:0});
const text=v=>String(v??'').trim()||'—';
window.soleGenerateBlockedCompactDoc=function(asPdf=false){
  const lines=Array.isArray(productClaimLines)?productClaimLines:[];
  if(!lines.length){alert('Agrega productos al consolidado.');return false}
  const lang=$('pcLanguage')?.value||'EN',es=lang==='ES';
  const claim=String($('pcClaimNo')?.value||'').trim();
  const supplier=$('pcSupplier')?.value||'',brand=$('pcBrand')?.value||'';
  const prepared=$('pcPreparedBy')?.value||'',date=$('pcDate')?.value||'';
  const issue=$('pcProblem')?.value||'';
  const rw=pcManualReworkCosts();
  const extra=n($('pcExtraUsd')?.value);
  const productTotal=lines.reduce((a,l)=>a+(l.chargeProduct?n(l.unitCost)*n(l.importedBadQty):0),0);
  const extraStorage=lines.reduce((a,l)=>a+(l.chargeStorage?n(l.storageUsd):0),0);
  const total=rw.totalUsd+extra+productTotal+extraStorage;
  const totalQty=lines.reduce((a,l)=>a+n(l.qty),0);
  const files=[...new Set(lines.map(l=>String(l.file||'').trim()).filter(Boolean))];
  const codes=[...new Set(lines.map(l=>String(l.code||'').trim()).filter(Boolean))];
  const rows=lines.map(l=>'<tr><td><b>'+e(text(l.code))+'</b></td><td>'+e(text(l.file))+'</td><td>'+e(text(l.solped))+'</td><td>'+e(text(l.po))+'</td><td class="right strong">'+qty(l.qty)+'</td></tr>').join('');
  const costItems=[
    [es?'Traslado interno':'Internal handling / transfer',rw.forkliftUsd],
    [es?'Supervisión de calidad':'Quality supervision',rw.qualityUsd],
    [es?'Almacenamiento adicional':'Additional storage',rw.storageUsd],
    [es?'Mano de obra e indirectos':'Rework labor & overhead',rw.directReworkUsd],
    [es?'Insumos':'Consumables',rw.consumablesUsd]
  ];
  if(n(rw.externalTransportUsd))costItems.unshift([es?'Transporte externo':'External transport',rw.externalTransportUsd]);
  const costs=costItems.filter(x=>Math.abs(n(x[1]))>=.005).map(x=>
    '<tr><td>'+e(x[0])+'</td><td class="right">'+amt(x[1])+'</td></tr>').join('');
  let spares=[];
  if(typeof window.soleSpareGet==='function'){
    try{spares=window.soleSpareGet()||[]}catch(_){}
  }
  const spareMap=new Map();
  for(const p of spares){
    const code=String(p.code||'').trim(),description=String(p.description||p.detail||'').trim(),q=n(p.qty);
    if(!code&&!description||q<=0)continue;
    const k=[code,description,String(p.status||'')].join('|');
    const x=spareMap.get(k)||{code,description,qty:0};
    x.qty+=q;spareMap.set(k,x);
  }
  const spareRows=[...spareMap.values()].map(p=>
    '<tr><td>'+e(p.code||'—')+'</td><td>'+e(p.description||'—')+'</td><td class="right strong">'+qty(p.qty)+'</td></tr>').join('');
  const additional=(productTotal||extraStorage||extra)
    ?'<div class="other">'+(productTotal?'<div>'+(es?'Productos / reposición':'Product / replacement')+': <b>USD '+amt(productTotal)+'</b></div>':'')+
       (extraStorage?'<div>'+(es?'Almacenamiento por producto':'Product-specific storage')+': <b>USD '+amt(extraStorage)+'</b></div>':'')+
       (extra?'<div>'+e($('pcExtraConcept')?.value||'Additional cost')+': <b>USD '+amt(extra)+'</b></div>':'')+'</div>':'';
  const title=es?'LIQUIDACIÓN CONSOLIDADA DE PRODUCTOS BLOQUEADOS':'CONSOLIDATED CLAIM — BLOCKED PRODUCTS';
  const html='<!doctype html><html lang="'+(es?'es':'en')+'"><head><meta charset="utf-8"><title>'+e(claim)+' · '+e(supplier)+'</title>'+
  '<style>'+
  '@page{size:A4 portrait;margin:11mm 12mm}*{box-sizing:border-box}body{margin:0;color:#203448;font:10px Arial,sans-serif;background:white}'+
  '.print{position:fixed;right:15px;top:10px;background:#214e74;color:white;padding:9px 14px;border:0;border-radius:5px;cursor:pointer}'+
  '.head{display:grid;grid-template-columns:118px 1fr 100px;align-items:stretch;border:1px solid #265276;min-height:58px}.logo{background:#edf3f9;color:#244c71;padding:13px 9px;font-weight:900;font-size:16px}.logo small{display:block;font-size:8px;font-weight:500}.ttl{display:flex;align-items:center;justify-content:center;text-align:center;background:#214e74;color:#fff;padding:8px;font-size:14px;font-weight:900}.number{padding:10px;text-align:center;color:#234666;font-size:9px}.number b{display:block;font-size:16px;color:#1a324d}'+
  '.meta{display:grid;grid-template-columns:1fr 1fr;gap:7px 14px;margin:13px 0 9px}.meta div{display:flex;gap:8px}.meta strong{color:#385774;min-width:88px}.problem{padding:9px 11px;background:#f3f6f9;border-left:3px solid #214e74;margin:8px 0 10px}.section{margin:13px 0 5px;padding:7px 9px;background:#214e74;color:white;font-size:10px;font-weight:900;letter-spacing:.3px}'+
  '.stats{display:flex;gap:10px;margin:9px 0}.stat{flex:1;padding:9px 12px;background:#eff5f9;border:1px solid #d7e2eb;border-radius:5px}.stat b{display:block;font-size:17px;color:#16496c;margin-top:3px}.stat small{color:#5a7084;font-size:9px;text-transform:uppercase;font-weight:700}'+
  'table{width:100%;border-collapse:collapse;font-size:9px}th{background:#e4eef6;text-align:left;color:#224b6b;font-size:9px}td,th{border-bottom:1px solid #dce4ec;padding:6px 7px}tbody tr:nth-child(even){background:#f8fafc}.right{text-align:right}.strong{font-weight:800}.cols{display:grid;grid-template-columns:1fr 1fr;gap:15px}.costs td{padding:7px}.total{background:#e6eff8;border-top:2px solid #214e74;font-weight:900}.total td{font-size:11px}.pay{margin-top:9px;background:#fff0a2;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;border-radius:4px;font-weight:900;font-size:13px}.pay b{font-size:20px;color:#1b344b}.notes{margin-top:10px;color:#52677b;font-size:9px;line-height:1.45}.other{margin-top:7px;display:flex;gap:16px;flex-wrap:wrap}.foot{margin-top:14px;padding-top:6px;border-top:1px solid #d7e1e9;color:#697e91;font-size:8px}'+
  '@media print{.print{display:none}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}table,tr,.section,.cols,.stats,.pay{break-inside:avoid}.foot{break-inside:avoid}}'+
  '</style></head><body><button class="print" onclick="window.print()">'+(es?'Imprimir / Guardar PDF':'Print / Save PDF')+'</button>'+
  '<div class="head"><div class="logo">Grupo Sole<small>Rinnai Corporation</small></div><div class="ttl">'+title+'</div><div class="number">N°<b>'+e(claim)+'</b></div></div>'+
  '<div class="meta"><div><strong>'+(es?'PROVEEDOR':'SUPPLIER')+'</strong>'+e(supplier)+'</div><div><strong>'+(es?'FECHA':'DATE')+'</strong>'+e(date)+'</div><div><strong>'+(es?'MARCA':'BRAND')+'</strong>'+e(brand)+'</div><div><strong>'+(es?'ELABORADO POR':'PREPARED BY')+'</strong>'+e(prepared)+'</div></div>'+
  '<div class="problem"><b>'+(es?'MOTIVO':'REASON')+': </b>'+e(issue|| (es?'Productos bloqueados para reproceso':'Blocked products for rework'))+'</div>'+
  '<div class="stats"><div class="stat"><small>'+(es?'Unidades bloqueadas':'Blocked units')+'</small><b>'+qty(totalQty)+'</b></div><div class="stat"><small>'+(es?'Códigos':'Product codes')+'</small><b>'+codes.length+'</b></div><div class="stat"><small>FILE</small><b>'+files.length+'</b></div></div>'+
  '<div class="section">'+(es?'1. PRODUCTOS BLOQUEADOS':'1. BLOCKED PRODUCTS')+'</div>'+
  '<table><thead><tr><th>'+(es?'CÓDIGO':'PRODUCT CODE')+'</th><th>FILE</th><th>SOLPED</th><th>OC</th><th class="right">'+(es?'CANT. BLOQUEADA':'BLOCKED QTY')+'</th></tr></thead><tbody>'+rows+'<tr class="total"><td colspan="4">'+(es?'TOTAL UNIDADES BLOQUEADAS':'TOTAL BLOCKED UNITS')+'</td><td class="right">'+qty(totalQty)+'</td></tr></tbody></table>'+
  '<div class="section">'+(es?'2. RESUMEN DE COSTOS':'2. COST SUMMARY')+'</div>'+
  '<div class="cols"><table class="costs"><thead><tr><th>'+(es?'CONCEPTO':'COST ITEM')+'</th><th class="right">USD</th></tr></thead><tbody>'+costs+'<tr class="total"><td>'+(es?'TOTAL REPROCESO':'TOTAL REPROCESSING COST')+'</td><td class="right">'+amt(rw.totalUsd)+'</td></tr></tbody></table>'+
  '<div><div class="stat"><small>'+(es?'Importe solicitado':'Amount requested')+'</small><b>USD '+amt(total)+'</b></div>'+additional+
  '<div class="notes">'+(es?'El costo de insumos está incluido en el reproceso. No se cobra producto salvo que se indique un monto adicional.':'Consumables are included in the reprocessing cost. No product charge applies unless stated separately.')+'</div></div></div>'+
  (spareRows?'<div class="section">'+(es?'3. REPUESTOS SOLICITADOS':'3. REQUESTED SPARE PARTS')+'</div><table><thead><tr><th>'+(es?'REFERENCIA':'PART CODE')+'</th><th>'+(es?'DESCRIPCIÓN':'DESCRIPTION')+'</th><th class="right">'+(es?'CANTIDAD':'QTY')+'</th></tr></thead><tbody>'+spareRows+'</tbody></table>':'')+
  '<div class="pay"><span>'+(es?'TOTAL SOLICITADO':'TOTAL AMOUNT REQUESTED')+'</span><b>USD '+amt(total)+'</b></div>'+
  '<div class="notes"><b>'+(es?'OBSERVACIONES':'NOTES')+':</b> '+e($('pcNotes')?.value||'—')+'</div>'+
  '<div class="foot">'+(es?'Liquidación nueva y consolidada; referencias conservadas por FILE y orden de compra.':'New consolidated claim; references retained by FILE and purchase order.')+'</div>'+
  '</body></html>';
  const name='SETTLEMENT_'+String(supplier).replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_|_$/g,'')+'_'+String(claim).replace(/[^a-zA-Z0-9-]+/g,'')+'_CONSOLIDATED';
  if(asPdf){
    const w=window.open('','_blank');
    if(!w){alert('Habilita las ventanas emergentes para generar el PDF.');return false}
    w.document.open();w.document.write(html);w.document.close();
    setTimeout(()=>{try{w.focus();w.print()}catch(err){console.warn(err)}},500);
  }else{
    const blob=new Blob([html],{type:'text/html;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name+'.html';
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  }
  return true;
};
})();