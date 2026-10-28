'use strict';
const $ = selector => document.querySelector(selector);
const state = {datasets: {left: null, right: null}, files: {}, projects: ['p1','p2'], projectNames: {}, nextId: 3, report: null, tab: 'differences', page: 0, busy: false, revision: 0, activeModule: null, views: {bank: {}, projects: {}}};
const fields = {date:'日期 *', debit:'借方 / 收入金额', credit:'贷方 / 支出金额', amount:'带正负号的金额 *', reference:'参考号（凭证号 / 流水号）', description:'摘要（手续费识别依据）', currency:'币种（未选默认 CNY）', account:'账户', project:'本方项目列（可选，优先于填写名称）', counterparty:'对方项目列 *'};
const tabNames = {differences:'待核实差异', ambiguous:'重复 / 冲突', invalid:'无效数据', matched:'已匹配', fees:'疑似手续费'};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => n === null || n === undefined ? '—' : (n / 100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const isProjects = () => state.activeModule === 'projects';
const ids = () => isProjects() ? state.projects : ['left','right'];
const ready = () => isProjects() ? state.projects.some(id=>state.datasets[id]) : !!state.datasets.left && !!state.datasets.right;
function notice(message='') { $('#notice').textContent=message; $('#notice').classList.toggle('hidden',!message); }
async function api(path,payload) {
  const response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || '请求失败，请重试');
  return data;
}
function invalidate() { state.revision++; state.report=null; $('#results').classList.add('hidden'); $('#run').disabled=state.busy || !ready(); }
function infer(headers) {
  const patterns={date:/^(日期|业务日期|交易日期|记账日期|发生日期|date)$/i,debit:/^(借方|借方金额|收入|收入金额|收款金额|贷记金额)$/i,credit:/^(贷方|贷方金额|支出|支出金额|付款金额|借记金额)$/i,amount:/^(金额|交易金额|发生额|amount)$/i,reference:/^(参考号|流水号|交易流水号|凭证号|凭证编号|reference)$/i,description:/^(摘要|交易摘要|备注|用途|description)$/i,currency:/^(币种|货币|currency)$/i,account:/^(账户|账号|银行账号|银行账户|account)$/i,project:/^(本方项目|所属项目|本项目|项目名称)$/i,counterparty:/^(对方项目|往来项目|往来单位|对方单位|对方项目名称)$/i};
  const mapping={mode:'split'};
  for(const [key,re] of Object.entries(patterns)) mapping[key]=headers.find(h=>re.test(h)) || '';
  if(!mapping.debit && !mapping.credit && mapping.amount) mapping.mode='signed';
  return mapping;
}
function selectOptions(headers,value) { return '<option value="">请选择 / 不使用</option>'+headers.map(h=>`<option value="${esc(h)}" ${h===value?'selected':''}>${esc(h)}</option>`).join(''); }
function configureWorkflow() {
  const projectMode=isProjects();
  $('#bank-workflow').classList.toggle('hidden',projectMode);
  $('#demo').classList.toggle('hidden',projectMode);
  $('#project-demo').classList.toggle('hidden',!projectMode);
  $('#direction').disabled=projectMode;
  if(projectMode) $('#direction').value='reverse';
  $('#project-actions').classList.toggle('hidden',!projectMode);
  $('#project-aliases').classList.toggle('hidden',!projectMode);
  $('#account-rule').classList.toggle('hidden',projectMode);
  $('#fee-rule').classList.toggle('hidden',projectMode);
  $('#import-help').textContent=projectMode ? '批量导入各项目往来明细：最多 20 份、合计 60,000 行。只按互为对方的项目配对，双方借贷相反。' : '请导出同一项目、同一期间的银行存款明细。支持 Excel / CSV，每份最多 10 MB、30,000 条。';
  $('#scope-help').textContent=projectMode ? 'ⓘ 本方 A → 对方 B，只核对 B → A 的反向记录；缺少对方账簿和净额相等但逐笔不符均会提示。' : 'ⓘ 手续费单列后仍保留差异，不自动补账；普通交易不会与手续费混合配平。';
}
function renderUploads() {
  configureWorkflow();
  $('#uploads').innerHTML=ids().map((id,index)=>{
    const data=state.datasets[id];
    const title=isProjects() ? `项目文件 ${index+1}` : ($('#workflow').value==='bank' ? ['账簿明细','银行流水'] : ['内账明细','外账明细'])[index];
    return `<article class="upload-card"><div class="upload-label"><strong>${esc(title)}</strong>${isProjects()?`<button class="remove-file" data-remove="${id}" aria-label="移除项目文件 ${index+1}">移除</button>`:`<span class="tag">${index===0?'左侧 A':'右侧 B'}</span>`}</div>${isProjects()?`<label class="project-name-label">本方项目名称（无本方项目列时必填）<input type="text" data-project-name="${id}" value="${esc(state.projectNames[id]||'')}" placeholder="例如：项目A"></label>`:''}<input class="file-input" type="file" id="file-${id}" data-id="${id}" accept=".xlsx,.xls,.csv"><label class="dropzone" for="file-${id}" data-id="${id}" tabindex="0"><span class="file-icon">▧</span><b>${data?esc(data.name):'点击选择文件，或拖放至此'}</b><small>${data?`${data.rows.length.toLocaleString()} 行已读取 · 点击可替换`:'Excel / CSV · 最大 10 MB'}</small></label>${data?renderMapping(data,id):''}</article>`;
  }).join('');
  document.querySelectorAll('.file-input[data-id]').forEach(el=>el.addEventListener('change',()=>loadFile(el.dataset.id,el.files[0])));
  document.querySelectorAll('.dropzone').forEach(el=>{
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$(`#file-${el.dataset.id}`).click();}});
    el.addEventListener('dragover',event=>{event.preventDefault();el.classList.add('drag');});
    el.addEventListener('dragleave',()=>el.classList.remove('drag'));
    el.addEventListener('drop',event=>{event.preventDefault();el.classList.remove('drag');loadFile(el.dataset.id,event.dataTransfer.files[0]);});
  });
  document.querySelectorAll('[data-map]').forEach(el=>el.addEventListener('change',()=>{state.datasets[el.dataset.id].mapping[el.dataset.map]=el.value;invalidate();if(el.dataset.map==='mode')renderUploads();}));
  document.querySelectorAll('[data-reparse]').forEach(el=>el.addEventListener('change',()=>reparse(el.dataset.id)));
  document.querySelectorAll('[data-project-name]').forEach(el=>el.addEventListener('input',()=>{state.projectNames[el.dataset.projectName]=el.value;invalidate();}));
  document.querySelectorAll('[data-remove]').forEach(el=>el.addEventListener('click',()=>{if(state.busy)return;const id=el.dataset.remove;state.projects=state.projects.filter(p=>p!==id);delete state.datasets[id];delete state.files[id];delete state.projectNames[id];invalidate();renderUploads();}));
  $('#run').disabled=state.busy || !ready();
}
function renderMapping(data,id) {
  const keys=['date',...(data.mapping.mode==='signed'?['amount']:['debit','credit']),'reference','description','currency',...(isProjects()?['project','counterparty']:['account'])];
  return `<div class="mapping">${state.files[id]?`<div class="wide sheet-options"><label>工作表<select data-reparse="sheet" data-id="${id}" id="sheet-${id}" ${data.sheets.length?'':'disabled'}>${data.sheets.map(s=>`<option ${s===data.sheet?'selected':''}>${esc(s)}</option>`).join('')||'<option>CSV</option>'}</select></label><label>表头所在行<input type="number" min="1" max="50" value="${data.firstRow-1}" data-reparse="header" data-id="${id}" id="header-${id}"></label></div>`:''}<label class="wide">金额列格式<select data-id="${id}" data-map="mode"><option value="split" ${data.mapping.mode==='split'?'selected':''}>两列：借方 / 收入，贷方 / 支出</option><option value="signed" ${data.mapping.mode==='signed'?'selected':''}>一列：正数借方 / 收入，负数贷方 / 支出</option></select></label>${keys.map(key=>`<label>${fields[key]}<select data-id="${id}" data-map="${key}">${selectOptions(data.headers,data.mapping[key])}</select></label>`).join('')}</div><div class="mini-preview">前 3 行预览<div class="table-wrap"><table><thead><tr>${data.headers.slice(0,4).map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${data.rows.slice(0,3).map(row=>`<tr>${data.headers.slice(0,4).map((_,i)=>`<td>${esc(row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>${data.warnings.map(w=>`<div class="warning">${esc(w)}</div>`).join('')}`;
}
function fileBase64(file) { return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(new Error('无法读取文件'));reader.readAsDataURL(file);}); }
async function loadFile(id,file) {
  if(!file || state.busy) return;
  if(file.size>10*1024*1024){notice('文件超过 10 MB，请拆分后上传。');return;}
  if(!/\.(xlsx|xls|csv)$/i.test(file.name)){notice('请选择 .xlsx、.xls 或 .csv 文件。');return;}
  state.busy=true;invalidate();notice('正在读取文件…');
  let success=false;
  try {
    const content=await fileBase64(file);
    const data=await api('/api/parse',{name:file.name,content});
    state.datasets[id]={...data,id,name:file.name,mapping:infer(data.headers)};
    state.files[id]={name:file.name,content};
    success=true;notice();
  } catch(error) { notice(error.message); }
  finally {state.busy=false;renderUploads();}
  return success;
}
async function reparse(id) {
  if(state.busy)return;
  const sheet=$(`#sheet-${id}`).value;
  const headerRow=Number($(`#header-${id}`).value);
  state.busy=true;invalidate();
  try {
    const data=await api('/api/parse',{...state.files[id],sheet,headerRow});
    state.datasets[id]={...data,id,name:state.files[id].name,mapping:infer(data.headers)};
    notice();
  } catch(error) {state.datasets[id]=null;notice(error.message+'；请重新选择文件。');}
  finally {state.busy=false;renderUploads();}
}
function addProject() {
  if(state.projects.length>=20){notice('最多添加 20 份文件。');return null;}
  const id='p'+state.nextId++;state.projects.push(id);return id;
}
function recordCells(record,components) {
  if(!record) return '<td>—</td><td>—</td><td class="numeric">—</td>';
  const rows=components || [record];
  return `<td>${rows.map(r=>`<div class="subrecord">${r.project?`<b>${esc(r.project)} → ${esc(r.counterparty)}</b><br>`:''}${esc(r.source)}${r.sheet?' / '+esc(r.sheet):''}<small>第 ${esc(r.row)} 行 · ${esc(r.date)}</small></div>`).join('')}</td><td>${rows.map(r=>`<div class="subrecord">${esc(r.description)||'—'}<small>${esc(r.reference)||'无参考号'}${r.account?' · '+esc(r.account):''}</small></div>`).join('')}</td><td class="numeric">${rows.map(r=>`<div class="subrecord">${fmt(r.amount)}<small>${esc(r.currency)}</small></div>`).join('')}${rows.length>1?`<b>合计 ${fmt(record.amount)}</b>`:''}</td>`;
}
function renderFeeSummary(report) {
  const area=$('#fee-summary');
  area.classList.toggle('hidden',report.mode==='projects' || !report.options.separateFees);
  area.innerHTML=`<div class="panel-heading"><div><h2>手续费单独统计</h2><p>依据摘要关键词识别，均为疑似手续费。支出与退款分列；未配对项仍需核实，不会自动补账。</p></div></div><div class="table-wrap"><table class="summary-table"><thead><tr><th>币种</th><th>左侧笔数</th><th class="numeric">左侧支出 / 退款</th><th>右侧笔数</th><th class="numeric">右侧支出 / 退款</th><th class="numeric">疑似左侧漏记支出 / 退款</th><th class="numeric">疑似右侧漏记支出 / 退款</th></tr></thead><tbody>${report.feeSummary.length?report.feeSummary.map(t=>`<tr><td>${esc(t.currency)}</td><td>${t.leftCount}</td><td class="numeric">${fmt(t.leftExpense)} / ${fmt(t.leftRefund)}</td><td>${t.rightCount}</td><td class="numeric">${fmt(t.rightExpense)} / ${fmt(t.rightRefund)}</td><td class="numeric">${fmt(t.missingLeftExpense)} / ${fmt(t.missingLeftRefund)}<small>${t.missingLeftCount} 笔单边记录</small></td><td class="numeric">${fmt(t.missingRightExpense)} / ${fmt(t.missingRightRefund)}<small>${t.missingRightCount} 笔单边记录</small></td></tr>`).join(''):'<tr><td colspan="7" class="empty">未识别到疑似手续费。请确认摘要映射及关键词，零统计不代表没有手续费。</td></tr>'}</tbody></table></div>`;
}
function renderProjectSummary(report) {
  const area=$('#project-summary');area.classList.toggle('hidden',report.mode!=='projects');
  if(report.mode!=='projects')return;
  area.innerHTML=`<div class="panel-heading"><div><h2>项目两两往来汇总</h2><p>双方净发生额相加为差额。只比较本次导入期间发生额；净额为零仍可能存在逐笔差异。</p></div></div><div class="table-wrap"><table class="summary-table"><thead><tr><th>项目 A</th><th>项目 B</th><th>币种</th><th class="numeric">A 方净发生额</th><th class="numeric">B 方净发生额</th><th class="numeric">反向差额</th><th>待核实项</th><th>状态</th></tr></thead><tbody>${report.projectPairs.map(pair=>`<tr><td>${esc(pair.projectA)}<small>${pair.leftCount} 条</small></td><td>${esc(pair.projectB)}<small>${pair.rightCount} 条</small></td><td>${esc(pair.currency)}</td><td class="numeric">${fmt(pair.left)}</td><td class="numeric">${fmt(pair.right)}</td><td class="numeric">${fmt(pair.delta)}</td><td>${pair.outstanding}</td><td>${esc(pair.status)}${pair.missingProject?`<small>缺少 ${esc(pair.missingProject)} 账簿</small>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">没有有效项目往来记录，请检查字段和项目名称。</td></tr>'}</tbody></table></div>`;
}
function renderReport() {
  const report=state.report;if(!report)return;
  $('#results').classList.remove('hidden');
  const feePending=report.fees.filter(entry=>entry.feeStatus!=='matched').length;
  const clean=report.matched.length+report.fees.length>0 && !report.differences.length && !report.ambiguous.length && !report.invalid.length && !feePending;
  $('#result-summary').textContent=(report.mode==='projects'?`${report.counts.files} 份文件 · ${report.counts.projects} 个本方项目 · ${report.counts.rows} 条明细。`:`左侧 ${report.counts.left} 条 · 右侧 ${report.counts.right} 条。`)+(clean?'所有有效明细均已按当前规则配对，请结合原始凭证确认。':'待核实项、重复候选及无效数据请逐项确认，合计相等不代表逐笔一致。');
  const stats=[['matched','green','组普通记录配对（含组合）'],['differences','red','项普通记录待核实'],['ambiguous','amber','条普通记录需人工配对'],['invalid','','条未参与金额比较']];
  if(report.mode!=='projects')stats.push(['fees','amber',`${feePending} 项尚待核实，单独列示`]);
  $('#stats').innerHTML=stats.map(([key,color,hint])=>`<div class="stat ${color}"><span class="stat-label">${tabNames[key]}</span><strong>${report[key].length.toLocaleString()}</strong><small>${hint}</small></div>`).join('');
  $('#report-warnings').textContent=[...new Set(report.warnings)].join('\n');$('#report-warnings').classList.toggle('hidden',!report.warnings.length);
  $('#totals').classList.toggle('hidden',report.mode==='projects');
  $('#totals').innerHTML=report.totals.length?report.totals.map(t=>`<div class="total-line"><span>${esc(t.currency)} 全部有效明细净额（含手续费）</span><span>左侧 <b>${fmt(t.left)}</b></span><span>右侧 <b>${fmt(t.right)}</b></span><span>规则调整后差额 <b>${fmt(t.delta)}</b></span></div>`).join(''):'没有有效明细可计算合计，请检查无效数据。';
  renderFeeSummary(report);renderProjectSummary(report);
  $('#tabs').innerHTML=Object.keys(tabNames).filter(key=>key!=='fees'||report.mode!=='projects').map(key=>`<button data-tab="${key}" class="${state.tab===key?'active':''}">${tabNames[key]} ${report[key].length}</button>`).join('');
  document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>{state.tab=el.dataset.tab;state.page=0;renderReport();}));renderRows();
}
function renderRows() {
  if(!state.report)return;
  const query=$('#search').value.trim().toLowerCase();
  const rows=state.report[state.tab].filter(r=>JSON.stringify(r).toLowerCase().includes(query));
  const pages=Math.max(1,Math.ceil(rows.length/50));state.page=Math.min(state.page,pages-1);
  $('#report-body').innerHTML=rows.slice(state.page*50,(state.page+1)*50).map(r=>`<tr><td class="reason">${r.pair?`<b>${esc(r.pair)}</b><br>`:''}${esc(r.reason)}${r.feeStatus?`<small>${({matched:'已按规则配对',differences:'手续费差异待核实',ambiguous:'手续费候选冲突'})[r.feeStatus]}</small>`:''}</td>${recordCells(r.left,r.leftRows)}${recordCells(r.right,r.rightRows)}<td class="numeric">${fmt(r.delta)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">当前分类没有记录</td></tr>';
  $('#page-info').textContent=`共 ${rows.length.toLocaleString()} 项 · 第 ${state.page+1} / ${pages} 页`;$('#prev').disabled=state.page===0;$('#next').disabled=state.page>=pages-1;
}
function getAliases() {
  const result={};
  for(const line of $('#aliases').value.split('\n')) {
    if(!line.trim())continue;
    const separator=line.indexOf('=');
    if(separator<1 || !line.slice(separator+1).trim())throw new Error('项目名称对照格式应为：别名=标准名称，每行一项');
    const key=line.slice(0,separator).trim(), value=line.slice(separator+1).trim();
    if(Object.hasOwn(result,key)&&result[key]!==value)throw new Error('同一个项目别名不能对应多个标准名称');
    Object.defineProperty(result,key,{value,enumerable:true,configurable:true});
  }
  return result;
}
function options() { return {direction:$('#direction').value,days:Number($('#days').value),strictReference:$('#strictReference').checked,matchAccount:$('#matchAccount').checked,oneToMany:$('#oneToMany').checked,maxParts:Number($('#maxParts').value),separateFees:!isProjects()&&$('#separateFees').checked,feeKeywords:$('#feeKeywords').value}; }
$('#run').addEventListener('click',async()=>{
  if(state.busy)return;
  state.busy=true;$('#run').disabled=true;$('#run').textContent='正在核对…';notice();
  const revision=state.revision;
  try {
    const projectMode=isProjects();
    const payload=projectMode?{datasets:state.projects.filter(id=>state.datasets[id]).map(id=>({...state.datasets[id],projectName:state.projectNames[id]||''})),aliases:getAliases(),options:options()}:{left:state.datasets.left,right:state.datasets.right,options:options()};
    const report=await api(projectMode?'/api/projects':'/api/reconcile',payload);
    if(revision!==state.revision){notice('核对期间规则发生变化，请按新规则重新核对。');return;}
    state.report=report;state.tab='differences';state.page=0;$('#search').value='';renderReport();$('#results').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error) {notice(error.message);}
  finally {state.busy=false;$('#run').disabled=!ready();$('#run').innerHTML='开始核对 <span>→</span>';}
});
$('#workflow').addEventListener('change',()=>{invalidate();renderUploads();});
['#direction','#days','#strictReference','#matchAccount','#oneToMany','#maxParts','#separateFees','#feeKeywords','#aliases'].forEach(id=>$(id).addEventListener('input',invalidate));
$('#add-project').addEventListener('click',()=>{if(state.busy)return;if(addProject()){invalidate();renderUploads();}});
$('#project-batch').addEventListener('change',async event=>{
  const files=[...event.target.files];
  if(state.busy)return;
  if(files.length+state.projects.filter(id=>state.datasets[id]).length>20){notice('最多上传 20 份项目文件。');return;}
  const failures=[];
  for(const file of files){let id=state.projects.find(key=>!state.datasets[key]);if(!id)id=addProject();if(!id)break;renderUploads();if(!await loadFile(id,file))failures.push(file.name);}
  if(failures.length)notice('以下文件未成功读取，请逐个检查后重新上传：'+failures.join('、'));
  event.target.value='';
});
$('#search').addEventListener('input',()=>{state.page=0;renderRows();});$('#prev').addEventListener('click',()=>{state.page--;renderRows();});$('#next').addEventListener('click',()=>{state.page++;renderRows();});
function download(blob,filename){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('#export-excel').addEventListener('click',async()=>{
  const report=state.report;if(!report)return;$('#export-excel').disabled=true;
  try{const response=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)});if(!response.ok){const error=await response.json();throw new Error(error.error||'导出失败');}download(await response.blob(),`完整核对报告_${new Date().toISOString().slice(0,10)}.xlsx`);}catch(error){notice(error.message);}finally{$('#export-excel').disabled=false;}
});
$('#export').addEventListener('click',()=>{
  const report=state.report;if(!report)return;
  const safe=value=>{let s=String(value??'');if(/^[\s]*[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const columns=['文件','工作表','原始行','本方项目','对方项目','日期','摘要','参考号','账户','币种','金额'];
  const values=r=>r?[r.source,r.sheet,r.row,r.project,r.counterparty,r.date,r.description,r.reference,r.account,r.currency,r.amount===null?'':(r.amount/100).toFixed(2)]:Array(columns.length).fill('');
  const lines=[['分类','组号','项目组合','说明','配对类型','手续费核对状态',...columns.map(c=>'左侧'+c),...columns.map(c=>'右侧'+c),'组金额差额','方向规则','日期容差天数','严格参考号','按账户核对','一笔对多笔上限']];
  for(const [key,label] of Object.entries(tabNames))report[key].forEach((entry,index)=>{
    const left=entry.leftRows || (entry.left?[entry.left]:[]), right=entry.rightRows || (entry.right?[entry.right]:[]);
    for(let row=0;row<Math.max(left.length,right.length);row++)lines.push([label,index+1,entry.pair||'',entry.reason,entry.matchType||'',entry.feeStatus||'',...values(left[row]),...values(right[row]),row===0&&entry.delta!==undefined?(entry.delta/100).toFixed(2):'',report.options.direction==='same'?'同向':'反向',report.options.days,report.options.strictReference?'是':'否',report.options.matchAccount?'是':'否',report.options.oneToMany?report.options.maxParts:'未启用']);
  });
  download(new Blob(['\uFEFF'+lines.map(line=>line.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}),`核对明细_${new Date().toISOString().slice(0,10)}.csv`);
});
function demoDataset(id,name,headers,rows,projectName='') {state.datasets[id]={id,name,headers,rows,firstRow:2,sheets:[],sheet:'',warnings:[],mapping:infer(headers)};delete state.files[id];if(projectName)state.projectNames[id]=projectName;}
function resetDemoOptions() {$('#days').value='0';$('#strictReference').checked=false;$('#matchAccount').checked=false;$('#oneToMany').checked=true;$('#maxParts').value='5';$('#separateFees').checked=true;$('#aliases').value='';}
$('#demo').addEventListener('click',()=>{
  if(state.busy)return;
  const headers=['日期','摘要','借方金额','贷方金额','参考号'];
  demoDataset('left','示例_内账.csv',headers,[['2026-01-05','项目启动款','100000','','A001'],['2026-01-06','设备采购','','25000','A002'],['2026-01-07','材料付款','','8800','A003'],['2026-01-08','仅内账记录','','1200','A004'],['2026-01-09','同日同额付款一','','500',''],['2026-01-09','同日同额付款二','','500',''],['日期待确认','缺失日期','','200','A008'],['2026-01-11','分批材料款','','1500','G001']]);
  demoDataset('right','示例_外账.csv',headers,[['2026-01-05','项目启动款','100000','','A001'],['2026-01-06','设备采购','','25000','A002'],['2026-01-07','材料付款','','8600','A003'],['2026-01-10','仅外账记录','3000','','B001'],['2026-01-09','待确认付款','','500',''],['2026-01-11','材料付款第一笔','','1000','G001'],['2026-01-11','材料付款第二笔','','500','G001'],['2026-01-12','银行转账手续费','','12','F001'],['2026-01-13','手续费退回','2','','F002']]);
  resetDemoOptions();$('#workflow').value='books';$('#direction').value='same';invalidate();renderUploads();notice('虚构银行示例：包括一笔对两笔、手续费支出与退款、金额差异及重复记录。点击「开始核对」。');
});
$('#project-demo').addEventListener('click',()=>{
  if(state.busy)return;
  for(const id of state.projects){delete state.datasets[id];delete state.files[id];delete state.projectNames[id];}
  state.projects=['p1','p2','p3'];state.nextId=4;
  const headers=['日期','对方项目','摘要','借方金额','贷方金额','参考号'];
  demoDataset('p1','项目A往来.xlsx',headers,[['2026-01-05','项目B','拨付B项目','1000','','AB1'],['2026-01-06','项目C','拨付C项目','500','','AC1'],['2026-01-07','项目D','对方账簿未提供','80','','AD1']],'项目A');
  demoDataset('p2','项目B往来.xlsx',headers,[['2026-01-05','项目A','收到A第一笔','','600','AB1'],['2026-01-05','项目A','收到A第二笔','','400','AB1'],['2026-01-08','项目C','拨付C项目','200','','BC1']],'项目B');
  demoDataset('p3','项目C往来.xlsx',headers,[['2026-01-06','项目A','收到A项目','','490','AC1'],['2026-01-08','项目B','收到B项目','','200','BC1']],'项目C');
  resetDemoOptions();$('#direction').value='reverse';invalidate();renderUploads();notice('虚构多项目示例：A↔B 一笔对两笔一致，A↔C 差 10 元，B↔C 一致，缺少 D 项目账簿。点击「开始核对」。');
});
const RULE_IDS = ['#workflow','#direction','#days','#strictReference','#matchAccount','#oneToMany','#maxParts','#separateFees','#feeKeywords','#aliases'];
function saveView() {
  if(!state.activeModule)return;
  const controls={};
  for(const id of RULE_IDS){const el=$(id);controls[id]=el.type==='checkbox'?el.checked:el.value;}
  state.views[state.activeModule]={controls,report:state.report,tab:state.tab,page:state.page,search:$('#search').value,notice:$('#notice').textContent};
}
function activateModule(module, updateAddress=false) {
  if(!['bank','projects'].includes(module))module='bank';
  if(module===state.activeModule)return true;
  if(state.busy){notice('正在处理明细，请稍候再切换功能。');return false;}
  saveView();state.revision++;state.activeModule=module;
  const view=state.views[module];
  if(view.controls){
    for(const [id,value] of Object.entries(view.controls)){const el=$(id);if(el.type==='checkbox')el.checked=value;else el.value=value;}
  } else {
    resetDemoOptions();$('#workflow').value='books';$('#direction').value=module==='projects'?'reverse':'same';
    $('#feeKeywords').value='手续费,汇划费,结算费,账户管理费,网银服务费,银行工本费';
  }
  state.report=view.report||null;state.tab=view.tab||'differences';state.page=view.page||0;$('#search').value=view.search||'';
  const title=module==='projects'?'项目往来核对':'银行资金内外账核对';
  $('#feature-title').textContent=title;$('#breadcrumb-title').textContent=title;
  $('#feature-eyebrow').textContent=module==='projects'?'INTERPROJECT RECONCILIATION':'BANK RECONCILIATION';
  $('#feature-description').textContent=module==='projects'?'批量导入各项目往来账，核对互为对方的借贷记录，定位项目之间的差异。':'比较内外账银行资金收支，单独统计手续费，支持一笔对多笔审核。';
  document.title=title+' · 中国港湾账目核对平台';
  for(const el of document.querySelectorAll('[data-module]')){const active=el.dataset.module===module;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}
  $('#results').classList.add('hidden');renderUploads();if(state.report)renderReport();notice(view.notice||'');
  if(updateAddress)history.pushState(null,'','#'+module);
  window.scrollTo({top:0,behavior:'instant'});
  return true;
}
for(const el of document.querySelectorAll('[data-module],.brand'))el.addEventListener('click',event=>{event.preventDefault();activateModule(el.dataset.module||'bank',true);});
window.addEventListener('hashchange',()=>{if(!activateModule(location.hash.slice(1)))history.replaceState(null,'','#'+state.activeModule);});
activateModule(location.hash==='#projects'?'projects':'bank');
if(!['#projects','#bank'].includes(location.hash))history.replaceState(null,'','#'+state.activeModule);
