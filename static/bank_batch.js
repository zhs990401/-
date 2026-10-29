'use strict';
const BB={left:[],right:[],busy:false,report:null,tab:'differences',page:0};
window.BankBatchUI={get busy(){return BB.busy;}};
const bbLabels={differences:'普通交易待核实',ambiguous:'重复/组合冲突',matched:'普通交易已匹配',fees:'手续费（含透支利息）',adjustments:'外账余额调节项',excluded:'未纳入/期间外'};
function bbNotice(text=''){ $('#bb-notice').textContent=text;$('#bb-notice').classList.toggle('hidden',!text); }
function bbInvalidate(){BB.report=null;$('#bb-results').classList.add('hidden');$('#bb-run').disabled=BB.busy||!BB.left.length||!BB.right.length;}
function bbRenderImports(){
 for(const side of ['left','right']){
  $('#bb-'+side+'-files').innerHTML=BB[side].map((f,i)=>`<p>${esc(f.name)} · ${f.accounts.length} 个账户/币种 <button class="remove-file" data-bb-remove="${side}:${i}">移除</button></p>`).join('');
 }
 const accounts=['left','right'].flatMap(side=>BB[side].flatMap(f=>f.accounts.map(g=>({...g,side}))));
 $('#bb-import-check').innerHTML=accounts.length?`<div class="panel-heading"><div><h3>已识别账户与余额来源</h3><p>请确认完整账号、币种和期间。手续费支持在核对结果明细中更正分类，再重新核对。</p></div></div><div class="table-wrap"><table><thead><tr><th>内外账</th><th>文件 / Sheet</th><th>账号 / 原币</th><th>期初日期</th><th>期初余额</th><th>数据覆盖至</th><th>交易数</th><th>余额调节项</th></tr></thead><tbody>${accounts.map(g=>`<tr><td>${g.side==='left'?'内账':'外账'}</td><td>${esc(g.source)}<small>${esc(g.sheet)}</small></td><td>${esc(g.account)}<small>${esc(g.currency)}</small></td><td>${esc(g.openingDate)||'未识别'}</td><td>${fmt(g.opening)}</td><td>${esc(g.coverageEnd)||'未识别'}</td><td>${g.transactions.length}</td><td>${g.adjustments.length}</td></tr>`).join('')}</tbody></table></div>`:'';
 document.querySelectorAll('[data-bb-remove]').forEach(b=>b.addEventListener('click',()=>{if(BB.busy)return;const [side,i]=b.dataset.bbRemove.split(':');BB[side].splice(Number(i),1);bbInvalidate();bbRenderImports();}));
}
for(const side of ['left','right'])$('#bb-'+side).addEventListener('change',async event=>{
 const files=[...event.target.files];event.target.value='';if(BB.busy)return;
 if(BB[side].length+files.length>20){bbNotice('每侧最多20份文件');return;}
 BB.busy=true;bbInvalidate();const errors=[];
 for(const f of files){try{
  if(f.size>10*1024*1024)throw new Error('每份文件最多10 MB');
  bbNotice('正在读取 '+f.name+'…');const parsed=await api('/api/bank-batch/parse',{name:f.name,content:await fileBase64(f)});
  const keys=new Set(BB[side].flatMap(f=>f.accounts.map(g=>JSON.stringify([g.account,g.currency]))));
  if(parsed.accounts.some(g=>keys.has(JSON.stringify([g.account,g.currency]))))throw new Error('同侧账号/币种重复，请删除旧文件后替换');
  if([...BB[side],parsed].reduce((n,f)=>n+f.accounts.reduce((k,g)=>k+g.transactions.length+g.adjustments.length,0),0)>60000)throw new Error('每侧最多60,000条');
  BB[side].push(parsed);
  if(side==='right'){
   const all=BB.right.flatMap(f=>f.accounts);const starts=all.map(g=>g.openingDate).filter(Boolean).sort();const ends=all.map(g=>g.coverageEnd).filter(Boolean).sort();
   if(!$('#bb-start').value&&starts.length)$('#bb-start').value=starts.at(-1);
   if(!$('#bb-end').value&&ends.length)$('#bb-end').value=ends[0];
  }
 }catch(e){errors.push(f.name+'：'+e.message);}}
 BB.busy=false;bbRenderImports();bbInvalidate();bbNotice(errors.join('\n'));
});
for(const id of ['#bb-start','#bb-end','#bb-days'])$(id).addEventListener('change',bbInvalidate);
$('#bb-run').addEventListener('click',async()=>{
 if(BB.busy)return;if(!$('#bb-start').value||!$('#bb-end').value){bbNotice('请填写统一核对开始和截止日期');return;}
 BB.busy=true;bbInvalidate();bbNotice('正在按账号与币种核对全部账户…');
 const controls=[...$('#bankbatch-workspace').querySelectorAll('input,select,button')];const disabled=controls.map(e=>e.disabled);controls.forEach(e=>e.disabled=true);
 try{BB.report=await api('/api/bank-batch/reconcile',{left:BB.left,right:BB.right,startDate:$('#bb-start').value,endDate:$('#bb-end').value,days:$('#bb-days').value});BB.page=0;BB.tab='differences';$('#bb-status').value='';$('#bb-search').value='';$('#bb-account').innerHTML='<option value="">全部账户</option>'+BB.report.accounts.map((a,i)=>`<option value="${i}">${esc(a.account)} / ${esc(a.currency)}</option>`).join('');bbRender();bbNotice();$('#bb-results').scrollIntoView({behavior:'smooth'});}catch(e){bbNotice(e.message);}finally{BB.busy=false;controls.forEach((e,i)=>e.disabled=disabled[i]);$('#bb-run').disabled=!BB.left.length||!BB.right.length;}
});
function bbAccounts(){if(!BB.report)return [];const index=$('#bb-account').value,status=$('#bb-status').value;return BB.report.accounts.filter((a,i)=>(index===''||i===Number(index))&&(!status||a.status===status));}
function bbRender(){
 const r=BB.report;if(!r)return;$('#bb-results').classList.remove('hidden');
 const stats=[['账户 / 币种',r.accounts.length],['普通已匹配',r.matched.length],['普通待核实',r.differences.length+r.ambiguous.length],['手续费明细',r.fees.length],['余额调节项',r.adjustments.length]];
 $('#bb-stats').innerHTML=stats.map(([label,n])=>`<div class="stat"><span>${label}</span><strong>${n}</strong></div>`).join('');
 $('#bb-warnings').textContent=r.warnings.join('\n');$('#bb-warnings').classList.toggle('hidden',!r.warnings.length);
 const accounts=bbAccounts();$('#bb-summary').innerHTML=accounts.map(a=>`<tr><td>${esc(a.account)}<small>${esc(a.currency)}</small></td>${[a.left?.opening,a.right?.opening,a.openingDelta,a.left?.closing,a.right?.closing,a.closingDelta,a.adjustedClosingDelta,a.feeNetDelta,a.normalNetDelta].map(v=>`<td class="numeric">${fmt(v)}</td>`).join('')}<td>${a.pending}</td><td>${esc(a.status)}</td></tr>`).join('')||'<tr><td colspan="12">没有符合筛选条件的账户</td></tr>';
 $('#bb-fees-summary').innerHTML=accounts.flatMap(a=>['left','right'].filter(side=>a[side]).map(side=>{const v=a[side];return `<tr><td>${esc(a.account)}<small>${esc(a.currency)}</small></td><td>${side==='left'?'内账':'外账'}</td><td>${v.feeCount}</td>${[v.feeExpense,v.feeRefund,v.feeNet,v.adjustedClosing,v.sourceClosing].map(x=>`<td class="numeric">${fmt(x)}</td>`).join('')}<td>${v.balanceCheck?'一致':'待核实'}</td><td>${fmt(v.bankClosing)}</td></tr>`;})).join('');
 $('#bb-tabs').innerHTML=Object.entries(bbLabels).map(([key,label])=>`<button data-bb-tab="${key}" class="${BB.tab===key?'active':''}">${label} ${r[key].length}</button>`).join('');
 document.querySelectorAll('[data-bb-tab]').forEach(b=>b.addEventListener('click',()=>{BB.tab=b.dataset.bbTab;BB.page=0;bbRender();}));bbRows();
}
function bbRows(){
 if(!BB.report)return;const keys=new Set(bbAccounts().map(a=>JSON.stringify([a.account,a.currency]))),q=$('#bb-search').value.trim().toLowerCase();
 let rows=[];for(const [i,e] of BB.report[BB.tab].entries()){
  if(['matched','differences','ambiguous'].includes(BB.tab)){
   for(const side of ['left','right'])for(const r of e[side+'Rows']||(e[side]?[e[side]]:[]))rows.push({...r,side,reason:`组${i+1} · ${e.reason}`});
  }else rows.push(e);
 }
 rows=rows.filter(r=>(keys.has(JSON.stringify([r.account,r.currency]))||(!r.account&&$('#bb-account').value===''&&$('#bb-status').value===''))&&(!q||JSON.stringify(r).toLowerCase().includes(q)));
 const pages=Math.max(1,Math.ceil(rows.length/50));BB.page=Math.min(BB.page,pages-1);
 $('#bb-details').innerHTML=rows.slice(BB.page*50,BB.page*50+50).map(r=>`<tr><td>${esc(r.account)}<small>${esc(r.currency)}</small></td><td>${esc(r.feeType||r.reason||'普通交易')}${r.reason&&r.feeType?`<small>${esc(r.reason)}</small>`:''}${r.amount!==undefined&&r.side&&BB.tab!=='adjustments'&&BB.tab!=='excluded'?`<button class="remove-file" data-bb-classify="${esc(JSON.stringify([r.side,r.source,r.sheet,r.row,r.account,r.currency]))}">${r.feeType?'改为普通交易':'改为手续费'}</button>`:''}</td><td>${r.side==='left'?'内账':r.side==='right'?'外账':'—'}<small>${esc(r.date)}</small></td><td>${esc(r.source)}<small>${esc(r.sheet)} · 第${esc(r.row)}行</small></td><td>${esc(r.description)}<small>${esc(r.reference)}</small></td><td class="numeric">${fmt(r.amount)}</td></tr>`).join('')||'<tr><td colspan="6">当前分类没有记录</td></tr>';
 $('#bb-page-info').textContent=`${rows.length} 条来源明细 · 第 ${BB.page+1} / ${pages} 页（组合成员逐行列示）`;$('#bb-prev').disabled=BB.page===0;$('#bb-next').disabled=BB.page>=pages-1;
 document.querySelectorAll('[data-bb-classify]').forEach(b=>b.addEventListener('click',()=>{if(BB.busy)return;const [side,source,sheet,row,account,currency]=JSON.parse(b.dataset.bbClassify);for(const f of BB[side])for(const g of f.accounts)for(const r of g.transactions)if(r.source===source&&r.sheet===sheet&&r.row===row&&r.account===account&&r.currency===currency){r.feeType=r.feeType?'':'人工确认手续费';r.classification='人工调整';}bbInvalidate();bbNotice('已更正分类，请点击“批量核对全部账户”重新计算余额和交易结果。');}));
}
for(const id of ['#bb-account','#bb-status'])$(id).addEventListener('change',()=>{BB.page=0;bbRender();});
$('#bb-search').addEventListener('input',()=>{BB.page=0;bbRows();});$('#bb-prev').addEventListener('click',()=>{BB.page--;bbRows();});$('#bb-next').addEventListener('click',()=>{BB.page++;bbRows();});
$('#bb-export').addEventListener('click',async()=>{if(!BB.report||BB.busy)return;try{const response=await fetch('/api/bank-batch/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(BB.report)});if(!response.ok)throw new Error((await response.json()).error||'导出失败');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download='多银行账户核对报告.xlsx';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){bbNotice(e.message);}});
