'use strict';
const $ = selector => document.querySelector(selector);
const state = {datasets: {left: null, right: null}, files: {}, projects: ['p1','p2'], projectNames: {}, accountNames: {}, accountScope: '', nextId: 3, report: null, tab: 'differences', page: 0, busy: false, revision: 0, activeModule: null, projectFilters:{pair:'',currency:'',project:''}, views: {bank: {}, projects: {}}};
const fields = {date:'日期 *', debit:'借方 / 收入金额', credit:'贷方 / 支出金额', amount:'带正负号的金额 *', reference:'参考号（凭证号 / 流水号）', description:'摘要（手续费识别依据）', currency:'币种（未选默认 CNY）', account:'账户', project:'本方项目列（可选，优先于填写名称）', counterparty:'对方项目列 *'};
const tabNames = {differences:'待核实差异', ambiguous:'重复 / 冲突', invalid:'无效数据', matched:'已匹配', fees:'疑似手续费',translationDifferences:'本币金额差异',ledgerExcluded:'未纳入记录'};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => n === null || n === undefined ? '—' : (n / 100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const isProjects = () => state.activeModule === 'projects';
const ids = () => isProjects() ? state.projects : ['left','right'];
const ready = () => isProjects() ? state.projects.some(id=>state.datasets[id])&&state.projects.filter(id=>state.datasets[id]).every(id=>!projectSetupIssues(state.datasets[id],id).length) : !!state.datasets.left && !!state.datasets.right;
function notice(message='') { $('#notice').textContent=message; $('#notice').classList.toggle('hidden',!message); }
async function api(path,payload) {
  const response = await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || '请求失败，请重试');
  return data;
}
function invalidate() { state.revision++; state.report=null; $('#results').classList.add('hidden'); $('#run').disabled=state.busy || !ready(); }
function infer(headers) {
  const patterns={date:/^(日期|业务日期|交易日期|记账日期|发生日期|date)$/i,debit:/^(借方|借方金额|收入|收入金额|收款金额|贷记金额)$/i,credit:/^(贷方|贷方金额|支出|支出金额|付款金额|借记金额)$/i,amount:/^(金额|交易金额|发生额|amount)$/i,reference:/^(参考号|流水号|交易流水号|凭证号|凭证编号|reference)$/i,description:/^(摘要|交易摘要|备注|用途|description)$/i,currency:/^(币种|货币|currency)$/i,account:/^(账户|账号|银行账号|银行账户|本方账号|account)$/i,project:/^(本方项目|所属项目|本项目|项目名称|project)$/i,counterparty:/^(对方项目|往来项目|往来单位|对方单位|对方项目名称)$/i};
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
  $('#project-period').classList.toggle('hidden',!projectMode);
  $('#project-import-check').classList.toggle('hidden',!projectMode);
  if(projectMode)configureProjectDateRange();else $('#unit-ledger-discovery').classList.add('hidden');
  $('#account-rule').classList.toggle('hidden',projectMode);
  $('#fee-rule').classList.toggle('hidden',projectMode);
  $('#import-help').textContent=projectMode ? '可一次导入单位三栏账，自动从账簿名称识别内部单位；也支持分项目文件。按内部单位、往来单位和原币币种核对。' : '请导出同一项目、同一期间的银行存款明细。支持 Excel / CSV，每份最多 10 MB、30,000 条。';
  $('#scope-help').textContent=projectMode ? 'ⓘ 本方 A → 对方 B，只核对 B → A 的反向记录；只比较原币发生额；本币差异单列。双方凭证号通常不同，不建议未经确认就强制一致。' : 'ⓘ 手续费单列后仍保留差异，不自动补账；普通交易不会与手续费混合配平。';
}
function renderUploads() {
  configureWorkflow();
  $('#uploads').innerHTML=ids().map((id,index)=>{
    const data=state.datasets[id];
    const title=isProjects() ? (data?.ledgerFormat?'全部账簿总表':`项目文件 ${index+1}`) : ($('#workflow').value==='bank' ? ['账簿明细','银行流水'] : ['内账明细','外账明细'])[index];
    return `<article class="upload-card"><div class="upload-label"><strong>${esc(title)}</strong>${isProjects()?`<button class="remove-file" data-remove="${id}" aria-label="移除项目文件 ${index+1}">移除</button>`:`<span class="tag">${index===0?'左侧 A':'右侧 B'}</span>`}</div>${isProjects()&&!data?.ledgerFormat?`<label class="project-name-label">本方项目名称（无本方项目列时必填）<input type="text" data-project-name="${id}" value="${esc(state.projectNames[id]||'')}" placeholder="例如：项目A"></label>`:isProjects()?'<p>已从账簿名称列识别本方项目，按各行归属自动拆分。</p>':`<label class="project-name-label">本文件所属银行账户（无账户列时填写）<input type="text" data-account-name="${id}" value="${esc(state.accountNames[id]||'')}" placeholder="例如：银行账号或统一账户名称"></label>`}<input class="file-input" type="file" id="file-${id}" data-id="${id}" accept=".xlsx,.xls,.csv"><label class="dropzone" for="file-${id}" data-id="${id}" tabindex="0"><span class="file-icon">▧</span><b>${data?esc(data.name):'点击选择文件，或拖放至此'}</b><small>${data?`${data.rows.length.toLocaleString()} 行已读取 · 点击可替换`:'Excel / CSV · 最大 10 MB'}</small></label>${data?renderMapping(data,id):''}</article>`;
  }).join('');
  document.querySelectorAll('.file-input[data-id]').forEach(el=>el.addEventListener('change',()=>loadFile(el.dataset.id,el.files[0])));
  document.querySelectorAll('.dropzone').forEach(el=>{
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();$(`#file-${el.dataset.id}`).click();}});
    el.addEventListener('dragover',event=>{event.preventDefault();el.classList.add('drag');});
    el.addEventListener('dragleave',()=>el.classList.remove('drag'));
    el.addEventListener('drop',event=>{event.preventDefault();el.classList.remove('drag');loadFile(el.dataset.id,event.dataTransfer.files[0]);});
  });
  document.querySelectorAll('[data-map]').forEach(el=>el.addEventListener('change',()=>{state.datasets[el.dataset.id].mapping[el.dataset.map]=el.value;invalidate();if(isProjects()){state.datasets[el.dataset.id].originalConfirmed=false;renderUploads();}else if(el.dataset.map==='mode')renderUploads();else if(el.dataset.map==='account')refreshAccountScope();}));
  document.querySelectorAll('[data-reparse]').forEach(el=>el.addEventListener('change',()=>reparse(el.dataset.id)));
  document.querySelectorAll('[data-project-name]').forEach(el=>el.addEventListener('input',()=>{state.projectNames[el.dataset.projectName]=el.value;invalidate();renderProjectImportCheck();}));
  document.querySelectorAll('[data-remove]').forEach(el=>el.addEventListener('click',()=>{if(state.busy)return;const id=el.dataset.remove;state.projects=state.projects.filter(p=>p!==id);delete state.datasets[id];delete state.files[id];delete state.projectNames[id];invalidate();renderUploads();}));
  document.querySelectorAll('[data-account-name]').forEach(el=>el.addEventListener('input',()=>{state.accountNames[el.dataset.accountName]=el.value;refreshAccountScope();invalidate();}));
  document.querySelectorAll('[data-project-setting]').forEach(el=>el.addEventListener('input',()=>{const d=state.datasets[el.dataset.id];d[el.dataset.projectSetting]=el.type==='checkbox'?el.checked:el.value;invalidate();renderProjectImportCheck();}));
  document.querySelectorAll('[data-project-apply]').forEach(el=>el.addEventListener('click',()=>{if(state.busy)return;const id=el.dataset.projectApply,source=state.datasets[id];if(projectSetupIssues(source,id).length){notice('请先完成本文件的原币字段与币种确认，再批量应用。');return;}let count=0;for(const other of state.projects){const target=state.datasets[other];if(other!==id&&target&&JSON.stringify(target.headers)===JSON.stringify(source.headers)){target.mapping={...source.mapping};target.currencyName=source.currencyName;target.baseCurrencyName=source.baseCurrencyName;target.originalConfirmed=source.originalConfirmed;count++;}}if(count){invalidate();renderUploads();}notice(`已应用到 ${count} 份相同表头文件。本方项目名称保持各自归属，请确认单一币种设置适用于这些文件。`);}));
  if(isProjects())renderProjectImportCheck();else refreshAccountScope();
  $('#run').disabled=state.busy || !ready();
}
function refreshAccountScope(){
  const accounts=new Set();
  for(const id of ['left','right']){const d=state.datasets[id];if(!d)continue;const col=d.mapping.account;if(col){const index=d.headers.indexOf(col);for(const row of d.rows){const value=String(row[index]??'').trim();if(value)accounts.add(value);}}else if((state.accountNames[id]||'').trim())accounts.add(state.accountNames[id].trim());}
  if(!accounts.has(state.accountScope))state.accountScope=accounts.size===1?[...accounts][0]:'';
  $('#accountScope').innerHTML='<option value="">选择一个银行账户</option>'+[...accounts].sort().map(a=>`<option value="${esc(a)}" ${a===state.accountScope?'selected':''}>${esc(a)}</option>`).join('');
}
function renderMapping(data,id) {
  const keys=['date',...(data.mapping.mode==='signed'?['amount']:['debit','credit']),'reference','description','currency',...(isProjects()?['project','counterparty']:['account'])];
  const labels=isProjects()?{...fields,debit:'原币借方发生额 *',credit:'原币贷方发生额 *',amount:'带正负号的原币发生额 *',currency:'原币币种列 *',description:'摘要'}:fields;
  return `<div class="mapping">${state.files[id]?`<div class="wide sheet-options"><label>工作表<select data-reparse="sheet" data-id="${id}" id="sheet-${id}" ${data.sheets.length?'':'disabled'}>${data.sheets.map(s=>`<option ${s===data.sheet?'selected':''}>${esc(s)}</option>`).join('')||'<option>CSV</option>'}</select></label>${data.ledgerFormat?'<p>已适配双层表头；保留原 Excel 行号。</p>':`<label>表头所在行<input type="number" min="1" max="50" value="${data.firstRow-1}" data-reparse="header" data-id="${id}" id="header-${id}"></label>`}</div>`:''}<label class="wide">金额列格式<select data-id="${id}" data-map="mode"><option value="split" ${data.mapping.mode==='split'?'selected':''}>两列：借方 / 收入，贷方 / 支出</option><option value="signed" ${data.mapping.mode==='signed'?'selected':''}>一列：正数借方 / 收入，负数贷方 / 支出</option></select></label>${keys.map(key=>`<label>${labels[key]}<select data-id="${id}" data-map="${key}">${selectOptions(data.headers,data.mapping[key])}</select></label>`).join('')}</div>${isProjects()?projectAmountControls(data,id):''}<div class="mini-preview">前 3 行预览<div class="table-wrap"><table><thead><tr>${data.headers.slice(0,4).map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${data.rows.slice(0,3).map(row=>`<tr>${data.headers.slice(0,4).map((_,i)=>`<td>${esc(row[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>${data.warnings.map(w=>`<div class="warning">${esc(w)}</div>`).join('')}`;
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
    const projectFile=state.projects.includes(id);
    const data=await api('/api/parse',{name:file.name,content,...(projectFile?{autoHeader:true}:{})});
    const previous=state.datasets[id];
    const fileProjectName=file.name.replace(/\.(xlsx|xls|csv)$/i,'');
    if(projectFile&&(!state.projectNames[id]||state.projectNames[id]===previous?.fileProjectName))state.projectNames[id]=fileProjectName;
    state.datasets[id]={...data,id,name:file.name,fileProjectName,mapping:projectFile?inferProject(data.headers):infer(data.headers),originalConfirmed:false,currencyName:'',baseCurrencyName:''};
    state.files[id]={name:file.name,content};
    if(data.ledgerFormat){if(!state.projects.some(key=>key!==id&&state.datasets[key]))state.projects=[id];$('#days').value='unlimited';$('#project-date-range').value='unlimited';configureProjectDateRange();}
    success=true;notice();
  } catch(error) { notice(error.message); }
  finally {state.busy=false;renderUploads();}
  return success;
}
async function reparse(id) {
  if(state.busy)return;
  const sheet=$(`#sheet-${id}`).value;
  const headerInput=$(`#header-${id}`);const headerRow=headerInput?Number(headerInput.value):undefined;
  state.busy=true;invalidate();
  try {
    const data=await api('/api/parse',{...state.files[id],sheet,headerRow,autoHeader:state.projects.includes(id)});
    state.datasets[id]={...state.datasets[id],ledgerFormat:null,ledgerBooks:[],ledgerBookStats:[],ledgerSummaryRows:[],ledgerZeroOriginalRows:[],rowNumbers:undefined,ledgerCounts:null,...data,id,name:state.files[id].name,mapping:state.projects.includes(id)?inferProject(data.headers):infer(data.headers),originalConfirmed:false};
    notice();
  } catch(error) {state.datasets[id]=null;notice(error.message+'；请重新选择文件。');}
  finally {state.busy=false;renderUploads();}
}
function addProject() {
  if(state.projects.length>=20){notice('最多添加 20 份文件。');return null;}
  const id='p'+state.nextId++;state.projects.push(id);return id;
}
function recordCells(record,components,countOnly=false) {
  if(!record) return '<td>—</td><td>—</td><td class="numeric">—</td>';
  if(countOnly){
    const rows=components||[record];
    const amounts=new Map();rows.forEach(r=>amounts.set(r.amount,(amounts.get(r.amount)||0)+1));
    const breakdown=[...amounts].sort((a,b)=>a[0]-b[0]).map(([amount,count])=>`${fmt(amount)} × ${count}`).join('；');
    return `<td><b>${rows.length} 笔 · 按金额数量匹配</b>${record.project?`<small>${esc(record.project)} → ${esc(record.counterparty)}</small>`:''}${record.account?`<small>${esc(record.account)}</small>`:''}<details class="count-members"><summary>查看全部来源行</summary>${rows.map(r=>`<div class="subrecord">${esc(r.source)}${r.sheet?' / '+esc(r.sheet):''}<small>第 ${esc(r.row)} 行 · ${esc(r.date)}</small></div>`).join('')}</details></td><td>组内未指定逐笔对应${record.baseAmount!==undefined&&record.baseAmount!==null?`<small>本币合计 ${esc(record.baseCurrency)} ${fmt(record.baseAmount)}</small>`:''}<details class="count-members"><summary>查看摘要与参考号</summary>${rows.map(r=>`<div class="subrecord">${esc(r.description)}<small>${esc(r.reference)||'无参考号'} · ${fmt(r.amount)} ${esc(r.currency)}</small></div>`).join('')}</details></td><td class="numeric"><b>合计 ${fmt(record.amount)}</b><small>${esc(record.currency)}</small><small>${breakdown}</small></td>`;
  }
  const rows=components || [record];
  return `<td>${rows.map(r=>`<div class="subrecord">${r.project?`<b>${esc(r.project)} → ${esc(r.counterparty)}</b><br>`:''}${esc(r.source)}${r.sheet?' / '+esc(r.sheet):''}<small>第 ${esc(r.row)} 行 · ${esc(r.date)}</small></div>`).join('')}</td><td>${rows.map(r=>`<div class="subrecord">${esc(r.description)||'—'}<small>${esc(r.reference)||'无参考号'}${r.account?' · '+esc(r.account):''}</small>${r.subjectCode||r.subjectName?`<small>${esc(r.subjectCode)} ${esc(r.subjectName)}</small>`:''}${r.baseAmount!==null&&r.baseAmount!==undefined?`<small>本币 ${esc(r.baseCurrency)} ${fmt(r.baseAmount)}</small>`:''}${r.baseError?`<small>${esc(r.baseError)}</small>`:''}</div>`).join('')}</td><td class="numeric">${rows.map(r=>`<div class="subrecord">${fmt(r.amount)}<small>${esc(r.currency)}</small></div>`).join('')}${rows.length>1?`<b>合计 ${fmt(record.amount)}</b>`:''}</td>`;
}
function renderFeeSummary(report) {
  const area=$('#fee-summary');
  area.classList.toggle('hidden',report.mode==='projects' || !report.options.separateFees);
  area.innerHTML=`<div class="panel-heading"><div><h2>手续费单独统计</h2><p>依据摘要关键词识别，均为疑似手续费。支出与退款分列；未配对项仍需核实，不会自动补账。</p></div></div><div class="table-wrap"><table class="summary-table"><thead><tr><th>币种</th><th>左侧笔数</th><th class="numeric">左侧支出 / 退款</th><th>右侧笔数</th><th class="numeric">右侧支出 / 退款</th><th class="numeric">疑似左侧漏记支出 / 退款</th><th class="numeric">疑似右侧漏记支出 / 退款</th></tr></thead><tbody>${report.feeSummary.length?report.feeSummary.map(t=>`<tr><td>${esc(t.currency)}</td><td>${t.leftCount}</td><td class="numeric">${fmt(t.leftExpense)} / ${fmt(t.leftRefund)}</td><td>${t.rightCount}</td><td class="numeric">${fmt(t.rightExpense)} / ${fmt(t.rightRefund)}</td><td class="numeric">${fmt(t.missingLeftExpense)} / ${fmt(t.missingLeftRefund)}<small>${t.missingLeftCount} 笔单边记录</small></td><td class="numeric">${fmt(t.missingRightExpense)} / ${fmt(t.missingRightRefund)}<small>${t.missingRightCount} 笔单边记录</small></td></tr>`).join(''):'<tr><td colspan="7" class="empty">未识别到疑似手续费。请确认摘要映射及关键词，零统计不代表没有手续费。</td></tr>'}</tbody></table></div>`;
}
function renderProjectSummary(report) {
  const area=$('#project-summary');area.classList.toggle('hidden',report.mode!=='projects');
  if(report.mode!=='projects')return;
  area.innerHTML=`<div class="panel-heading"><div><h2>项目两两原币往来汇总</h2><p>原币净发生额相加为差额；本币金额不同单列，不影响原币结果。只比较本次导入期间发生额；净额为零仍可能存在逐笔差异。</p></div></div><div class="table-wrap"><table class="summary-table"><thead><tr><th>项目 A</th><th>项目 B</th><th>币种</th><th class="numeric">A 方净发生额</th><th class="numeric">B 方净发生额</th><th class="numeric">反向差额</th><th>待核实项</th><th>状态</th></tr></thead><tbody>${projectFiltered(report.projectPairs).map(pair=>`<tr><td>${esc(pair.projectA)}<small>${pair.leftCount} 条</small></td><td>${esc(pair.projectB)}<small>${pair.rightCount} 条</small></td><td>${esc(pair.currency)}</td><td class="numeric">${fmt(pair.left)}</td><td class="numeric">${fmt(pair.right)}</td><td class="numeric">${fmt(pair.delta)}</td><td>${pair.outstanding}</td><td>${esc(pair.status)}${pair.baseDifferenceCount?`<small>${pair.baseDifferenceCount} 项本币金额差异</small>`:''}${pair.missingProject?`<small>缺少 ${esc(pair.missingProject)} 账簿</small>`:''}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">没有有效项目往来记录，请检查字段和项目名称。</td></tr>'}</tbody></table></div>`;
}
function renderReport() {
  const report=state.report;if(!report)return;
  $('#results').classList.remove('hidden');
  const feePending=report.fees.filter(entry=>entry.feeStatus!=='matched').length;
  const countGroups=(report.duplicateAmountChecks||[]).filter(c=>c.status==='matched').length;
  const splitGroups=[...report.matched,...report.fees].filter(e=>e.matchType==='repeated_split').length;
  const clean=report.matched.length+report.fees.length>0 && !report.differences.length && !report.ambiguous.length && !report.invalid.length && !feePending;
  $('#result-summary').textContent=(report.mode==='projects'?`${report.counts.files} 份文件 · ${report.counts.projects} 个本方项目 · ${report.counts.rows} 条明细。`:`左侧 ${report.counts.left} 条 · 右侧 ${report.counts.right} 条 · 银行账户：${report.accountScope||'未选择'}。`)+(clean?'所有有效明细均已按当前规则配对，请结合原始凭证确认。':'待核实项、重复候选及无效数据请逐项确认，合计相等不代表逐笔一致。')+(countGroups?` 含 ${countGroups} 组金额数量匹配，未指定组内逐笔对应关系。`:'')+(splitGroups?` 含 ${splitGroups} 组重复一对多按组匹配，未指定组内逐笔对应关系。`:'');
  const stats=[['matched','green','组记录匹配（含金额数量、拆分匹配）'],['differences','red','项普通记录待核实'],['ambiguous','amber','条普通记录需人工配对'],['invalid','','条未参与金额比较']];
  if(report.mode==='projects'&&report.ledgerExcluded?.length)stats.push(['ledgerExcluded','','汇总、待确认单位和零原币记录']);
  if(report.mode==='projects')stats.push(['translationDifferences','','项不影响原币匹配结论']);
  if(report.mode!=='projects')stats.push(['fees','amber',`${feePending} 项尚待核实，单独列示`]);
  $('#stats').innerHTML=stats.map(([key,color,hint])=>`<div class="stat ${color}"><span class="stat-label">${tabNames[key]}</span><strong>${(report[key]||[]).length.toLocaleString()}</strong><small>${hint}</small></div>`).join('');
  $('#report-warnings').textContent=[...new Set(report.warnings)].join('\n');$('#report-warnings').classList.toggle('hidden',!report.warnings.length);
  $('#totals').classList.toggle('hidden',report.mode==='projects');
  $('#totals').innerHTML=report.totals.length?report.totals.map(t=>`<div class="total-line"><span>${esc(t.currency)} 全部有效明细净额（含手续费）</span><span>左侧 <b>${fmt(t.left)}</b></span><span>右侧 <b>${fmt(t.right)}</b></span><span>规则调整后差额 <b>${fmt(t.delta)}</b></span></div>`).join(''):'没有有效明细可计算合计，请检查无效数据。';
  renderDuplicateCountSummary(report);renderFeeSummary(report);renderProjectSummary(report);renderProjectFilter(report);renderUnitProjectOverview(report);
  $('#tabs').innerHTML=Object.keys(tabNames).filter(key=>key==='fees'?report.mode!=='projects':(key==='translationDifferences'||key==='ledgerExcluded')?report.mode==='projects':true).map(key=>`<button data-tab="${key}" class="${state.tab===key?'active':''}">${tabNames[key]} ${(report[key]||[]).length}</button>`).join('');
  document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>{state.tab=el.dataset.tab;state.page=0;renderReport();}));renderRows();
}
function renderRows() {
  if(!state.report)return;
  const query=$('#search').value.trim().toLowerCase();
  const rows=projectFiltered(state.report[state.tab]||[]).filter(r=>JSON.stringify(r).toLowerCase().includes(query));
  const pages=Math.max(1,Math.ceil(rows.length/50));state.page=Math.min(state.page,pages-1);
  $('#report-body').innerHTML=rows.slice(state.page*50,(state.page+1)*50).map(r=>`<tr><td class="reason">${r.pair?`<b>${esc(r.pair)}</b><br>`:''}${esc(r.reason)}${r.baseDelta!==undefined?`<small>${esc(r.baseCurrency)} 本币差额 ${fmt(r.baseDelta)}</small>`:''}${r.feeStatus?`<small>${({matched:'已按规则配对',differences:'手续费差异待核实',ambiguous:'手续费候选冲突'})[r.feeStatus]}</small>`:''}</td>${recordCells(r.left,r.leftRows,r.statisticalMatch||r.matchType==='amount_count')}${recordCells(r.right,r.rightRows,r.statisticalMatch||r.matchType==='amount_count')}<td class="numeric">${fmt(r.delta)}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">当前分类没有记录</td></tr>';
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
function options() { return {direction:$('#direction').value,days:$('#days').value==='unlimited'?'unlimited':Number($('#days').value),strictReference:$('#strictReference').checked,matchAccount:!isProjects(),accountScope:state.accountScope,matchDuplicateCounts:$('#duplicate-counts').checked,oneToMany:$('#oneToMany').checked,maxParts:Number($('#maxParts').value),separateFees:!isProjects()&&$('#separateFees').checked,feeKeywords:$('#feeKeywords').value,...(isProjects()?{dateRangeMode:$('#project-date-range').value,startDate:$('#project-start').value,endDate:$('#project-end').value,additionalInternalUnits:$('#additional-internal-units').value.split('\n').map(n=>n.trim()).filter(Boolean)}:{})}; }
$('#run').addEventListener('click',async()=>{
  if(state.busy)return;
  state.busy=true;$('#run').disabled=true;$('#run').textContent='正在核对…';notice();
  const revision=state.revision;
  try {
    const projectMode=isProjects();
    const payload=projectMode?{datasets:state.projects.filter(id=>state.datasets[id]).map(id=>({...state.datasets[id],projectName:state.projectNames[id]||''})),aliases:getAliases(),options:options()}:{left:{...state.datasets.left,accountName:state.accountNames.left||''},right:{...state.datasets.right,accountName:state.accountNames.right||''},options:options()};
    const report=await api(projectMode?'/api/projects':'/api/reconcile',payload);
    if(revision!==state.revision){notice('核对期间规则发生变化，请按新规则重新核对。');return;}
    state.projectFilters={pair:'',currency:'',project:''};state.report=report;state.tab='differences';state.page=0;$('#search').value='';renderReport();$('#results').scrollIntoView({behavior:'smooth',block:'start'});
  } catch(error) {notice(error.message);}
  finally {state.busy=false;$('#run').disabled=!ready();$('#run').innerHTML='开始核对 <span>→</span>';}
});
$('#accountScope').addEventListener('change',()=>{state.accountScope=$('#accountScope').value;invalidate();});
$('#workflow').addEventListener('change',()=>{invalidate();renderUploads();});
['#direction','#days','#strictReference','#matchAccount','#accountScope','#oneToMany','#duplicate-counts','#maxParts','#separateFees','#feeKeywords','#aliases','#project-start','#project-end','#project-date-range','#additional-internal-units'].forEach(id=>$(id).addEventListener('input',invalidate));
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
  const columns=['文件','工作表','原始行','本方项目','对方项目','日期','摘要','参考号','账户','币种','金额','科目编码','科目名称','本币币种','本币金额','本币说明'];
  const values=r=>r?[r.source,r.sheet,r.row,r.project,r.counterparty,r.date,r.description,r.reference,r.account,r.currency,r.amount===null?'':(r.amount/100).toFixed(2),r.subjectCode,r.subjectName,r.baseCurrency,r.baseAmount===null||r.baseAmount===undefined?'':(r.baseAmount/100).toFixed(2),r.baseError]:Array(columns.length).fill('');
  const lines=[['分类','组号','项目组合','说明','配对类型','手续费核对状态',...columns.map(c=>'左侧'+c),...columns.map(c=>'右侧'+c),'组金额差额','本币金额差额','差额本币币种','方向规则','日期容差天数','严格参考号','按账户核对','一笔对多笔上限']];
  for(const [key,label] of Object.entries(tabNames))(report[key]||[]).forEach((entry,index)=>{
    const left=entry.leftRows || (entry.left?[entry.left]:[]), right=entry.rightRows || (entry.right?[entry.right]:[]);
    const members=entry.statisticalMatch||entry.matchType==='amount_count'?[...left.map(r=>[r,null]),...right.map(r=>[null,r])]:Array.from({length:Math.max(left.length,right.length)},(_,i)=>[left[i],right[i]]);
    for(let row=0;row<members.length;row++)lines.push([label,index+1,entry.pair||'',entry.reason,entry.matchType||'',entry.feeStatus||'',...values(members[row][0]),...values(members[row][1]),row===0&&entry.delta!==undefined?(entry.delta/100).toFixed(2):'',row===0&&entry.baseDelta!==undefined?(entry.baseDelta/100).toFixed(2):'',entry.baseCurrency||'',report.options.direction==='same'?'同向':'反向',report.options.days,report.options.strictReference?'是':'否',report.options.matchAccount?'是':'否',report.options.oneToMany?report.options.maxParts:'未启用']);
  });
  download(new Blob(['\uFEFF'+lines.map(line=>line.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8;'}),`核对明细_${new Date().toISOString().slice(0,10)}.csv`);
});
function demoDataset(id,name,headers,rows,projectName='') {state.datasets[id]={id,name,headers,rows,firstRow:2,sheets:[],sheet:'',warnings:[],mapping:projectName?inferProject(headers):infer(headers),originalConfirmed:!!projectName,currencyName:projectName?'CNY':''};delete state.files[id];if(projectName)state.projectNames[id]=projectName;}
function resetDemoOptions() {$('#days').value='0';$('#strictReference').checked=false;$('#matchAccount').checked=false;$('#oneToMany').checked=true;$('#duplicate-counts').checked=true;$('#maxParts').value='5';$('#separateFees').checked=true;$('#aliases').value='';$('#project-start').value='';$('#project-end').value='';$('#project-date-range').value='unlimited';$('#additional-internal-units').value='';}
$('#demo').addEventListener('click',()=>{
  if(state.busy)return;
  const headers=['日期','摘要','借方金额','贷方金额','参考号'];
  demoDataset('left','示例_内账.csv',headers,[['2026-01-05','项目启动款','100000','','A001'],['2026-01-06','设备采购','','25000','A002'],['2026-01-07','材料付款','','8800','A003'],['2026-01-08','仅内账记录','','1200','A004'],['2026-01-09','同日同额付款一','','500',''],['2026-01-09','同日同额付款二','','500',''],['日期待确认','缺失日期','','200','A008'],['2026-01-11','分批材料款','','1500','G001']]);
  demoDataset('right','示例_外账.csv',headers,[['2026-01-05','项目启动款','100000','','A001'],['2026-01-06','设备采购','','25000','A002'],['2026-01-07','材料付款','','8600','A003'],['2026-01-10','仅外账记录','3000','','B001'],['2026-01-09','待确认付款','','500',''],['2026-01-11','材料付款第一笔','','1000','G001'],['2026-01-11','材料付款第二笔','','500','G001'],['2026-01-12','银行转账手续费','','12','F001'],['2026-01-13','手续费退回','2','','F002']]);
  state.accountNames.left='示例银行账户001';state.accountNames.right='示例银行账户001';state.accountScope='示例银行账户001';
  resetDemoOptions();$('#workflow').value='books';$('#direction').value='same';invalidate();renderUploads();notice('虚构银行示例：包括一笔对两笔、手续费支出与退款、金额差异及重复记录。点击「开始核对」。');
});
$('#project-demo').addEventListener('click',()=>{
  if(state.busy)return;
  for(const id of state.projects){delete state.datasets[id];delete state.files[id];delete state.projectNames[id];}
  state.projects=['p1','p2','p3'];state.nextId=4;
  const headers=['记账日期','对方项目','摘要','原币币种','原币借方发生额','原币贷方发生额','本币币种','本币借方发生额','本币贷方发生额','凭证号','科目编码','科目名称'];
  demoDataset('p1','项目A.xlsx',headers,[['2026-01-05','项目B','拨付B项目','USD','1000','','CNY','7300','','A1','1221','其他应收款'],['2026-01-06','项目C','拨付C项目','USD','500','','CNY','3600','','AC1','1221','其他应收款'],['2026-01-07','项目D','对方账簿未提供','USD','80','','CNY','576','','A3','1221','其他应收款']],'项目A');
  demoDataset('p2','项目B.xlsx',headers,[['2026-01-05','项目A','收到A第一笔','USD','','600','CNY','','4300','B1','2241','其他应付款'],['2026-01-05','项目A','收到A第二笔','USD','','400','CNY','','2900','B2','2241','其他应付款'],['2026-01-08','项目C','拨付C项目','USD','200','','CNY','1440','','B3','1221','其他应收款']],'项目B');
  demoDataset('p3','项目C.xlsx',headers,[['2026-01-06','项目A','收到A项目','USD','','490','CNY','','3528','AC1','2241','其他应付款'],['2026-01-08','项目B','收到B项目','USD','','200','CNY','','1440','C2','2241','其他应付款']],'项目C');
  resetDemoOptions();$('#direction').value='reverse';invalidate();renderUploads();notice('虚构多项目示例：A↔B 原币 USD 1000 对 600＋400 一致，本币相差 CNY 100；A↔C 原币差 USD 10，缺少 D 项目账簿。点击「开始核对」。');
});
const RULE_IDS = ['#workflow','#direction','#days','#strictReference','#matchAccount','#accountScope','#oneToMany','#duplicate-counts','#maxParts','#separateFees','#feeKeywords','#aliases','#project-start','#project-end','#project-date-range','#additional-internal-units'];
function saveView() {
  if(!state.activeModule||state.activeModule==='cashflow')return;
  const controls={};
  for(const id of RULE_IDS){const el=$(id);controls[id]=el.type==='checkbox'?el.checked:el.value;}
  state.views[state.activeModule]={controls,report:state.report,tab:state.tab,page:state.page,search:$('#search').value,notice:$('#notice').textContent};
}
function activateModule(module, updateAddress=false) {
  if(!['bank','projects','cashflow'].includes(module))module='bank';
  if(module===state.activeModule)return true;
  if(state.busy||window.CashflowUI?.busy){notice('正在处理明细，请稍候再切换功能。');return false;}
  saveView();state.revision++;state.activeModule=module;
  const cash=module==='cashflow';
  $('#reconciliation-workspace').classList.toggle('hidden',cash);$('#cashflow-workspace').classList.toggle('hidden',!cash);$('#cashflow-demo').classList.toggle('hidden',!cash);
  if(cash){
    $('#feature-title').textContent='项目现金流统计';$('#breadcrumb-title').textContent='项目现金流统计';$('#feature-eyebrow').textContent='PROJECT CASH FLOW';$('#feature-description').textContent='按 project 列归属项目，从手工期初情况出发，逐月汇总银行收入、支出与余额。';document.title='项目现金流统计 · 中国港湾账目核对平台';
    $('#demo').classList.add('hidden');$('#project-demo').classList.add('hidden');
    for(const el of document.querySelectorAll('[data-module]')){const active=el.dataset.module===module;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');}
    if(updateAddress)history.pushState(null,'','#cashflow');window.scrollTo({top:0,behavior:'instant'});return true;
  }
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
activateModule(['#projects','#cashflow'].includes(location.hash)?location.hash.slice(1):'bank');
if(!['#projects','#bank','#cashflow'].includes(location.hash))history.replaceState(null,'','#'+state.activeModule);

function inferProject(headers){
  const mapping=infer(headers);
  const clean=h=>h.replace(/\s+/g,'').replace(/（/g,'(').replace(/）/g,')');
  const original=h=>/(原币|外币)/.test(h)&&!/(本币|本位币|折合|余额)/.test(h);
  const base=h=>/(本币|本位币|折合)/.test(h)&&!h.includes('余额');
  const find=test=>headers.find(h=>test(clean(h)))||'';
  mapping.debit=find(h=>original(h)&&h.includes('借方'))||mapping.debit;
  mapping.credit=find(h=>original(h)&&h.includes('贷方'))||mapping.credit;
  const signedOriginal=find(h=>original(h)&&!/(借方|贷方)/.test(h)&&/(金额|发生额)/.test(h));
  mapping.amount=signedOriginal||mapping.amount;
  if(signedOriginal&&!find(h=>original(h)&&/(借方|贷方)/.test(h))){mapping.mode='signed';mapping.debit='';mapping.credit='';}
  if(!mapping.debit&&!mapping.credit&&mapping.amount)mapping.mode='signed';
  mapping.currency=find(h=>/^(原币币种|原币币别|外币币种|交易币种|币种|币别|币种名称|币种编码|币别名称|货币|currency)$/i.test(h))||mapping.currency;
  mapping.project=find(h=>/^(本方项目|本方账套|账套名称|账簿名称|所属项目|本项目|项目名称|project)$/i.test(h))||mapping.project;
  mapping.counterparty=find(h=>/^(对方项目|对方项目名称|往来项目|往来单位|往来单位名称|对方单位|辅助核算对象|客户名称|供应商名称)$/i.test(h))||mapping.counterparty;
  mapping.baseDebit=find(h=>base(h)&&h.includes('借方'));
  mapping.baseCredit=find(h=>base(h)&&h.includes('贷方'));
  mapping.baseAmount=find(h=>base(h)&&!/(借方|贷方)/.test(h)&&/(金额|发生额)/.test(h));
  mapping.baseCurrency=find(h=>/^(本币币种|本币币别|本位币币种|记账本位币)$/.test(h));
  mapping.subjectCode=find(h=>/^(科目编码|科目代码|科目编号|会计科目编码)$/.test(h));
  mapping.subjectName=find(h=>/^(科目名称|会计科目|会计科目名称)$/.test(h));
  return mapping;
}
function projectOriginalNames(d){return (d.mapping.mode==='signed'?[d.mapping.amount]:[d.mapping.debit,d.mapping.credit]).filter(Boolean);}
function projectSetupIssues(d,id){
  const issues=[],names=projectOriginalNames(d);
  if(!d.mapping.date)issues.push('日期列未选择');
  if(!names.length)issues.push('原币金额列未选择');
  if(names.some(n=>/(本币|本位币|折合|余额)/.test(n)))issues.push('所选金额不是原币发生额');
  if(names.length&&!names.every(n=>/(原币|外币)/.test(n))&&!d.originalConfirmed)issues.push('请确认金额为原币');
  if(!d.mapping.currency&&!String(d.currencyName||'').trim())issues.push('原币币种未指定');
  if(d.mapping.currency&&/(本币|本位币)/.test(d.mapping.currency))issues.push('原币币种误选本币列');
  if(!d.mapping.counterparty)issues.push('对方项目列未选择');
  if(!d.mapping.project&&!String(state.projectNames[id]||'').trim())issues.push('本方项目未填写');
  return issues;
}
function projectAmountControls(d,id){
  const explicit=projectOriginalNames(d).length&&projectOriginalNames(d).every(n=>/(原币|外币)/.test(n)&&!/(本币|本位币|折合|余额)/.test(n));
  const additional={baseDebit:'本币借方发生额（可选）',baseCredit:'本币贷方发生额（可选）',baseAmount:'单列本币金额（可选，优先于本币借贷列）',baseCurrency:'本币币种列（可选）',subjectCode:'科目编码（可选）',subjectName:'科目名称（可选）'};
  return `<div class="project-amount-note"><strong>核对口径：原币发生额</strong><p>金额列：${esc(projectOriginalNames(d).join(' / '))||'待选择'}。原币一致时，本币金额不同不会被算作原币往来差异。</p>${!explicit?`<label class="checkbox"><input type="checkbox" data-id="${id}" data-project-setting="originalConfirmed" ${d.originalConfirmed?'checked':''}>我确认所选金额列是原币发生额</label>`:'<p>已识别明确标注的原币金额列，请确认对应导出报表。</p>'}${!d.mapping.currency?`<label class="project-name-label">此文件为单一原币币种时填写（必填）<input type="text" data-id="${id}" data-project-setting="currencyName" value="${esc(d.currencyName||'')}" placeholder="例如 USD、CNY；多币种必须选择币种列"></label>`:''}</div><details class="project-base-details"><summary>本币辅助比较与科目资料（可选）</summary><div class="mapping">${Object.entries(additional).map(([key,label])=>`<label>${label}<select data-id="${id}" data-map="${key}">${selectOptions(d.headers,d.mapping[key])}</select></label>`).join('')}<label class="wide">单一本币币种（未映射本币币种列时填写）<input type="text" data-id="${id}" data-project-setting="baseCurrencyName" value="${esc(d.baseCurrencyName||'')}" placeholder="例如 CNY；未指定时不比较本币"></label></div></details><button type="button" class="button secondary project-apply" data-project-apply="${id}">将字段设置应用到相同表头文件</button><p>批量应用前，请确认这些文件的金额口径与单一币种设置相同；本方项目名称不会被覆盖。</p>`;
}
function renderProjectImportCheck(){
  if(!isProjects())return;
  const datasets=state.projects.filter(id=>state.datasets[id]);
  const pending=datasets.filter(id=>projectSetupIssues(state.datasets[id],id).length).length;
  renderUnitDiscovery();
  $('#project-import-check').innerHTML=`<div class="project-check-heading"><strong>${datasets.length} 份文件已导入 · ${pending} 份待确认</strong><span>从文件名预填本方项目；如文件名带日期或报表名称，请修改为标准项目名。</span></div>${datasets.length?`<div class="table-wrap"><table class="summary-table"><thead><tr><th>文件 / 本方项目</th><th>所选原币金额列</th><th>原币币种来源</th><th>条数</th><th>导入状态</th></tr></thead><tbody>${datasets.map(id=>{const d=state.datasets[id],issues=projectSetupIssues(d,id);return `<tr><td>${esc(d.name)}<small>${d.mapping.project?'按 '+esc(d.mapping.project)+' 列':esc(state.projectNames[id])}</small></td><td>${esc(projectOriginalNames(d).join(' / '))||'未选择'}</td><td>${esc(d.mapping.currency||d.currencyName||'未指定')}</td><td>${d.rows.length}</td><td class="reason">${issues.length?issues.map(esc).join('；'):'原币字段已确认，可参与核对'}</td></tr>`;}).join('')}</tbody></table></div>`:''}`;
}
function projectFiltered(rows){
  if(!state.report||state.report.mode!=='projects')return rows;
  return rows.filter(r=>{const pair=r.pair||(r.projectA?`${r.projectA} ↔ ${r.projectB}`:'');const currency=r.currency||(r.left||r.right)?.currency;const unit=state.projectFilters.project;const involves=!unit||r.project===unit||r.projectA===unit||r.projectB===unit||[r.left?.project,r.left?.counterparty,r.right?.project,r.right?.counterparty].includes(unit);return involves&&(!state.projectFilters.pair||state.projectFilters.pair===pair)&&(!state.projectFilters.currency||state.projectFilters.currency===currency);});
}
function renderProjectFilter(report){
  $('#project-result-filter').classList.toggle('hidden',report.mode!=='projects');
  if(report.mode!=='projects')return;
  $('#project-unit-filter').innerHTML='<option value="">全部项目</option>'+[...new Set((report.unitDiscovery||report.projects||[]))].map(p=>`<option ${p===state.projectFilters.project?'selected':''}>${esc(p)}</option>`).join('');
  const pairs=[...new Set(report.projectPairs.map(r=>`${r.projectA} ↔ ${r.projectB}`))],currencies=[...new Set(report.projectPairs.map(r=>r.currency))];
  $('#project-pair-filter').innerHTML='<option value="">全部组合</option>'+pairs.map(p=>`<option ${p===state.projectFilters.pair?'selected':''}>${esc(p)}</option>`).join('');
  $('#project-currency-filter').innerHTML='<option value="">全部币种</option>'+currencies.map(c=>`<option ${c===state.projectFilters.currency?'selected':''}>${esc(c)}</option>`).join('');
}
$('#project-pair-filter').addEventListener('change',()=>{state.projectFilters.pair=$('#project-pair-filter').value;state.page=0;renderReport();});
$('#project-currency-filter').addEventListener('change',()=>{state.projectFilters.currency=$('#project-currency-filter').value;state.page=0;renderReport();});

function configureProjectDateRange(){const unlimited=$('#project-date-range').value==='unlimited';$('#project-start').disabled=unlimited;$('#project-end').disabled=unlimited;}
$('#project-date-range').addEventListener('change',()=>{configureProjectDateRange();invalidate();});
$('#project-unit-filter').addEventListener('change',()=>{state.projectFilters.project=$('#project-unit-filter').value;state.projectFilters.pair='';state.page=0;renderReport();});
$('#project-consolidated').addEventListener('change',async event=>{const file=event.target.files[0];if(!file||state.busy){event.target.value='';return;}if(state.projects.some(key=>state.datasets[key])){notice('当前已有项目文件。为避免与总表重复，请先移除已有文件或刷新后再上传；替换同一总表也可点击已有文件卡片更换。');event.target.value='';return;}let id=state.projects.find(key=>!state.datasets[key]);if(!id)id=addProject();if(id){renderUploads();await loadFile(id,file);}event.target.value='';});
function renderUnitDiscovery(){
 const datasets=state.projects.map(id=>state.datasets[id]).filter(d=>d?.ledgerFormat);
 const area=$('#unit-ledger-discovery');area.classList.toggle('hidden',!datasets.length||!isProjects());if(!datasets.length)return;
 const books=new Map();for(const d of datasets)for(const b of d.ledgerBookStats||[])books.set(b.project,b);
 area.innerHTML=`<div class="panel-heading"><div><h2>已从账簿名称识别 ${books.size} 个内部单位</h2><p>自动比对这些账簿与同名往来单位。未命中名称的明细先列为归属待确认；可通过名称对照或补充内部单位调整。</p></div></div><details><summary>查看内部单位清单及导入分类</summary><div class="table-wrap"><table class="summary-table"><thead><tr><th>内部单位 / 项目</th><th>逐笔明细</th><th>名称命中的内部明细</th><th>单位归属待确认</th></tr></thead><tbody>${[...books.values()].map(b=>`<tr><td>${esc(b.project)}</td><td>${b.count}</td><td>${b.internalCount}</td><td>${b.unconfirmedCount}</td></tr>`).join('')}</tbody></table></div><p>此处按导入名称精确匹配预览；最终以名称对照及核对结果为准。期初、累计、合计行单独保留，不混入发生额。</p></details>`;
}
function renderUnitProjectOverview(report){
 const area=$('#unit-project-overview');area.classList.toggle('hidden',report.mode!=='projects'||!report.unitOverview?.length);if(report.mode!=='projects')return;
 const rows=(report.unitOverview||[]).filter(r=>(!state.projectFilters.project||r.project===state.projectFilters.project)&&(!state.projectFilters.currency||r.currency===state.projectFilters.currency));
 area.innerHTML=`<div class="panel-heading"><div><h2>按项目列示核对结果</h2><p>每个项目按原币币种独立列示，原币差额 = 本方发生净额 + 对方账簿对应净额。各项目差额含同一往来的双方视角，不应再相加作为总差额。</p></div></div><div class="table-wrap"><table class="summary-table"><thead><tr><th>项目 / 内部单位</th><th>原币</th><th>本方明细</th><th>已匹配笔数</th><th>待核实记录</th><th class="numeric">本方发生净额</th><th class="numeric">对方对应净额</th><th class="numeric">原币差额</th><th>状态</th></tr></thead><tbody>${rows.map(r=>`<tr><td><button class="project-link" data-open-unit="${esc(r.project)}">${esc(r.project)}</button></td><td>${esc(r.currency)||'无有效明细'}</td><td>${r.count}</td><td>${r.matchedCount}</td><td>${r.pendingCount}</td><td class="numeric">${fmt(r.ownAmount)}</td><td class="numeric">${fmt(r.reciprocalAmount)}</td><td class="numeric">${fmt(r.delta)}</td><td>${esc(r.status)}</td></tr>`).join('')||'<tr><td colspan="9" class="empty">当前筛选无项目</td></tr>'}</tbody></table></div>`;
 area.querySelectorAll('[data-open-unit]').forEach(el=>el.addEventListener('click',()=>{state.projectFilters.project=el.dataset.openUnit;state.projectFilters.pair='';state.tab='differences';state.page=0;renderReport();$('.report-panel').scrollIntoView({behavior:'smooth'});}));
}

function renderDuplicateCountSummary(report){
 const checks=(report.duplicateAmountChecks||[]).filter(c=>(!state.projectFilters?.pair||report.mode!=='projects'||c.pair===state.projectFilters.pair)&&(!state.projectFilters?.currency||report.mode!=='projects'||c.currency===state.projectFilters.currency)&&(!state.projectFilters?.project||report.mode!=='projects'||(c.pair||'').split(' ↔ ').includes(state.projectFilters.project)));
 const area=$('#duplicate-count-summary');area.classList.toggle('hidden',!checks.length);if(!checks.length)return;
 const labels={matched:'金额及数量一致，按组匹配',quantity_mismatch:'数量不一致，人工复核',conditions_not_met:'数量一致，日期/参考号条件待核实'};
 area.innerHTML=`<div class="panel-heading"><div><h2>重复金额数量核对</h2><p>先保留已确定的一对一关系，再核对同一项目组合、币种、方向和账户下的重复金额。余项数量一致且满足所选日期、严格参考号规则时按组标记，不指定逐笔对应。</p></div></div><div class="table-wrap"><table class="summary-table"><thead><tr><th>项目组合 / 账户</th><th>分类 / 原币</th><th class="numeric">对齐方向后的单笔金额</th><th>原始左 / 右笔数</th><th>余项左 / 右笔数</th><th>余项数量差</th><th>日期 / 参考号规则</th><th>结论</th></tr></thead><tbody>${checks.map(c=>`<tr><td>${esc(c.pair||c.account||report.accountScope||'当前范围')}</td><td>${esc(c.category)}<small>${esc(c.currency)}</small></td><td class="numeric">${fmt(c.amount)}</td><td>${c.originalLeftCount} / ${c.originalRightCount}</td><td>${c.leftCount} / ${c.rightCount}</td><td>${c.quantityDelta}</td><td>${c.dateRule==='unlimited'?'无限制':c.dateRule+' 天'}<small>${c.reference?'参考号 '+esc(c.reference):report.options.strictReference?'严格参考号为空':'未强制参考号相同'}</small></td><td>${labels[c.status]}<small>${esc(c.reason)}</small></td></tr>`).join('')}</tbody></table></div>`;
}
