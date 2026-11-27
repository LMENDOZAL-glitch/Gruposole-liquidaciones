/* Desglose de KPI por proveedor y liquidación. Sólo lectura: no cambia Firebase. */
(function(){
'use strict';
const $=id=>document.getElementById(id),N=x=>Math.max(Number(x)||0,0),norm=x=>String(x||'').trim().toUpperCase();
const defs={ck2:['Monto solicitado','total'],ck5:['Monto recuperado','recovered'],ck6:['Saldo pendiente','pending'],ck7:['Saldo no recuperado','unrecovered'],ck1:['Liquidaciones','count'],ck3:['Abiertas','open'],ck4:['Concluidas','closed']};
const fmt=n=>Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
let active='',timeout;
function compYear(d){const s=String(d||'');let m=s.match(/^(\d{4})[-/]/);if(m)return m[1];m=s.match(/^\d{1,2}[/-]\d{1,2}[/-](\d{4})$/);return m?m[1]:''}
function data(){
 const year=$('claimRecoveryYear')?.value||'';
 return [...document.querySelectorAll('#claimList .claim-record')].filter(el=>el.style.display!=='none'&&el.getClientRects().length).map(el=>{
 const id=el.querySelector('.claim-record-head b')?.textContent?.trim();if(!id)return null;
 let c=null;try{c=claimDataByNo(id);if(c&&typeof applyClaimEdit==='function')c=applyClaimEdit(c)}catch(e){}
 if(!c)return null;
 const all=typeof compensations==='undefined'?[]:compensations;
 const comps=(Array.isArray(all)?all:[]).filter(x=>norm(x.claim)===norm(id));
 const full=comps.reduce((a,x)=>a+N(x.value),0),inYear=comps.filter(x=>!year||compYear(x.date)===year).reduce((a,x)=>a+N(x.value),0);
 const total=N(c.amount),balance=Math.max(0,total-full),closed=['CONCLUIDO','CERRADO'].includes(norm(c.status));
 return {id,el,supplier:String(c.supplier||'SIN PROVEEDOR'),status:String(c.status||'PENDIENTE'),
 total,recovered:inYear,pending:closed?0:balance,unrecovered:closed?balance:0,count:1,open:closed?0:1,closed:closed?1:0};
 }).filter(Boolean);
}
function amount(kind,value){return ['count','open','closed'].includes(kind)?String(value):'USD '+fmt(value)}
function show(){
 const panel=$('soleKpiPanel');if(!panel||!active||panel.hidden)return;
 const [name,kind]=defs[active];const rows=data().filter(r=>r[kind]>0.000001);
 const grouped=new Map();
 rows.forEach(r=>{if(!grouped.has(r.supplier))grouped.set(r.supplier,[]);grouped.get(r.supplier).push(r)});
 const total=rows.reduce((a,r)=>a+r[kind],0);
 panel.querySelector('[data-title]').textContent=name+' · '+rows.length+' liquidación(es)';
 panel.querySelector('[data-info]').textContent=grouped.size+' proveedor(es) · '+amount(kind,total);
 const results=panel.querySelector('[data-results]');results.replaceChildren();
 [...grouped.entries()].sort((a,b)=>b[1].reduce((v,r)=>v+r[kind],0)-a[1].reduce((v,r)=>v+r[kind],0)).forEach(([supplier,items])=>{
  const box=document.createElement('details');box.className='sole-kpi-provider';
  const summary=document.createElement('summary');
  const a=document.createElement('span');a.textContent=supplier+' · '+items.length+' liquidación(es)';
  const b=document.createElement('strong');b.textContent=amount(kind,items.reduce((v,r)=>v+r[kind],0));summary.append(a,b);box.append(summary);
  const table=document.createElement('table');table.innerHTML='<thead><tr><th>LIQUIDACIÓN</th><th>ESTADO</th><th>IMPORTE</th><th></th></tr></thead>';
  const tbody=document.createElement('tbody');
  items.sort((x,y)=>y[kind]-x[kind]).forEach(item=>{
   const tr=document.createElement('tr');
   [item.id,item.status,amount(kind,item[kind])].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});
   const td=document.createElement('td'),btn=document.createElement('button');btn.type='button';btn.textContent='Ver liquidación';
   btn.onclick=()=>{const match=[...document.querySelectorAll('#claimList .claim-record')].find(r=>norm(r.querySelector('.claim-record-head b')?.textContent)===norm(item.id));if(!match||match.style.display==='none')return;match.classList.add('open');match.scrollIntoView({behavior:'smooth',block:'center'});match.classList.add('sole-kpi-focus');setTimeout(()=>match.classList.remove('sole-kpi-focus'),1800)};
   td.append(btn);tr.append(td);tbody.append(tr);
  });table.append(tbody);box.append(table);results.append(box);
 });
 if(!rows.length){const p=document.createElement('p');p.textContent='No hay liquidaciones con importe en este indicador y los filtros seleccionados.';results.append(p)}
}
function toggle(id){
 const panel=$('soleKpiPanel');if(!panel)return;
 if(active===id&&!panel.hidden){close();return}
 active=id;panel.hidden=false;
 Object.keys(defs).forEach(k=>$(k)?.parentElement?.classList.toggle('sole-kpi-active',k===id));
 show();panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function close(){active='';$('soleKpiPanel').hidden=true;Object.keys(defs).forEach(k=>$(k)?.parentElement?.classList.remove('sole-kpi-active'))}
function install(){
 const cards=$('ck2')?.closest('.kpis'),list=$('claimList');if(!cards||!list)return;
 const el=document.createElement('section');el.id='soleKpiPanel';el.hidden=true;
 el.className='sole-kpi-panel';
 const head=document.createElement('div');head.className='sole-kpi-head';
 const title=document.createElement('b');title.dataset.title='1';
 const back=document.createElement('button');back.type='button';back.textContent='Ver todas / Cerrar detalle';back.onclick=close;
 head.append(title,back);
 const info=document.createElement('p');info.dataset.info='1';
 const results=document.createElement('div');results.dataset.results='1';
 el.append(head,info,results);cards.insertAdjacentElement('afterend',el);
 Object.keys(defs).forEach(id=>{
  const k=$(id)?.parentElement;if(!k)return;
  k.dataset.soleKpi='1';k.setAttribute('role','button');k.tabIndex=0;k.title='Mostrar proveedores y liquidaciones de este indicador';
  k.onclick=()=>toggle(id);k.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(id)}};
 });
 const css=document.createElement('style');
 css.textContent='.kpis [data-sole-kpi]{cursor:pointer}.kpis [data-sole-kpi]:hover,.kpis [data-sole-kpi]:focus-visible{outline:2px solid #446b8c;outline-offset:2px}.kpis [data-sole-kpi]:after{content:"Ver proveedores";display:block;margin-top:5px;font-size:10px;color:#54728a;font-weight:700}.kpis .sole-kpi-active{outline:2px solid #244f75;outline-offset:2px}.sole-kpi-panel{border:1px solid #cedfe9;background:#f7fafc;padding:15px;border-radius:12px;margin-top:12px;color:#23445c}.sole-kpi-panel[hidden]{display:none!important}.sole-kpi-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}.sole-kpi-head b{font-size:15px}.sole-kpi-panel button{cursor:pointer;border:1px solid #bdd0df;background:#fff;border-radius:7px;padding:7px 10px;color:#244a68;font-weight:700}.sole-kpi-panel [data-info]{font-size:12px;color:#637b8b;margin:10px 0}.sole-kpi-provider{background:#fff;border:1px solid #dce6ed;border-radius:8px;margin:8px 0;overflow:hidden}.sole-kpi-provider summary{display:flex;justify-content:space-between;gap:12px;padding:12px;background:#ecf3f8;font-weight:800;cursor:pointer}.sole-kpi-provider table{width:100%;border-collapse:collapse;font-size:12px}.sole-kpi-provider th,.sole-kpi-provider td{padding:8px;border-bottom:1px solid #e3ebf1;text-align:left}.sole-kpi-provider td:nth-child(3){font-weight:800}.sole-kpi-focus{box-shadow:0 0 0 3px #5b8db6!important}';
 document.head.append(css);
 new MutationObserver(()=>{if(active){clearTimeout(timeout);timeout=setTimeout(show,170)}}).observe(list,{childList:true});
 ['claimSearch','claimSupplier','claimStatus','claimBrand','claimYear','claimRecoveryYear'].forEach(id=>$(id)?.addEventListener(id==='claimSearch'?'input':'change',()=>{if(active){clearTimeout(timeout);timeout=setTimeout(show,270)}}));
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
