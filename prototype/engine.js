function createSignalTask() {
  if (!getTask('PAY-2048')) {
    const ts = Date.now();
    state.tasks.unshift(mkTask({ id: 'PAY-2048', tenant: 'pay-settle', title: '处理退款结算反馈', status: 'backlog', priority: 'P1', repo: 'pay/settlement', tags: ['settlement', 'refund'], by: '林琳', dorReady: false, attempt: 0,
      desc: '来源：业务群反馈。业务目标与验收口径待团队澄清；任务范围、责任人与执行约束由团队在此卡片中协商确认。',
      activity: [{ ts, text: '林琳从业务信号生成积压卡片，等待团队受理', kind: 'human' }] }));
    state.audits.unshift({ ts, tenant: 'pay-settle', actor: { type: 'human', id: 'linlin', name: '林琳' }, action: 'task.create', object: { type: 'task', id: 'PAY-2048' }, detail: '业务信号生成积压卡片，尚未就绪' });
  }
  state.tenant = 'pay-settle';
  go('board');
  openTaskDrawer('PAY-2048');
}

function taskCollaboration(t) {
  const roles = ['林琳', '周明', '陈工'];
  const checks = ['目标与范围已明确', '验收标准已确认', '依赖、风险与执行约束已记录'];
  const clarificationList = state.storyClarifications.map((item, i) => `<div class="story-clarification"><b>待澄清 ${i + 1}</b><div>${esc(item.question)}</div>${item.answer ? `<p><b>${esc(item.by)} 回复：</b>${esc(item.answer)}</p>` : `<form data-form="clarification-reply" data-clarification-index="${i}"><input name="answer" placeholder="补充此问题的答复" required><button class="btn btn-xs" type="submit">提交答复</button></form>`}</div>`).join('');
  const sessions = state.sessions.filter(s => s.taskId === t.id);
  return `<div class="dsec"><div class="dsec-title">团队协作 · 同一任务面板</div>
    <div class="story-callout">项目承载任务与共享产物；团队在任务面板澄清并确认契约，再协同执行与验收。身份切换仅用于原型演练。</div>
    <label>演练身份 <select id="collabActor" class="agent-select">${roles.map(r => `<option ${state.collabActor === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    ${!t.accepted ? `<p>信号形成积压卡，先判断是否受理。信息不完整时可留在本卡澄清。</p><button class="btn btn-sm" data-action="story-accept">确认受理</button>` : ''}
    ${t.accepted && t.status === 'backlog' ? `<div class="story-checklist">${checks.map((x,i) => `<label><input type="checkbox" data-story-dor="${i}" ${state.storyDor[i] ? 'checked' : ''} ${t.dorReady ? 'disabled' : ''}>${x}</label>`).join('')}</div>${clarificationList}<form data-form="clarification"><input name="question" placeholder="提出需要业务或团队澄清的问题" required><button class="btn btn-xs" type="submit">请求澄清</button></form>${!t.dorReady ? `<button class="btn btn-sm" data-action="story-ready" ${state.storyDor.every(Boolean) && state.storyClarifications.every(x => x.answer) ? '' : 'disabled'}>确认任务契约并移入待办</button>` : '<span class="pill">任务契约已确认</span>'}
    <div class="story-callout">项目上下文：任务验收后可将可复用的产物与结论登记到项目，经治理后供后续任务检索。</div>
    ${t.dorReady && !state.storyContextInjected ? '<button class="btn btn-sm" data-action="story-context">确认上下文包</button>' : ''}` : ''}
    ${t.status === 'in_review' ? `<div class="story-callout">待验收证据：${esc(t.evidence?.commit)} · ${esc(t.evidence?.ci)} · 累计 ${money(t.cost)}。验收人依据任务中团队确认的标准检查。</div>` : ''}
    ${sessions.map(s => `<button class="btn btn-xs" data-action="open-session" data-id="${s.id}">attempt ${s.attempt} · ${s.id} · ${money(s.cost)}</button>`).join(' ')}
    ${t.status === 'done' ? `<div class="story-callout">任务产物可登记到所属项目；经来源、权限与有效性审核后，成为后续任务可引用的上下文。</div><button class="btn btn-sm" data-action="story-context-approve" ${state.storyContextApproved ? 'disabled' : ''}>${state.storyContextApproved ? '项目经验已登记' : '登记可复用经验'}</button>` : ''}
    </div>`;
}

function toast(msg, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'toast';
  const glyph = opts.icon === 'alert' ? I.alert : opts.icon === 'info' ? I.sparkle : I.check;
  el.innerHTML = '<span class="t-glyph">' + glyph + '</span><div class="t-body">' + msg + '</div>' +
    (opts.action ? '<button class="t-action">' + esc(opts.actionLabel || '查看') + '</button>' : '');
  $('#toasts').appendChild(el);
  const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 320); };
  if (opts.action && opts.onAction) el.querySelector('.t-action').onclick = () => { opts.onAction(); remove(); };
  setTimeout(remove, opts.ttl || 5200);
}

function pushNotif(tenant, taskId, text, kind) {
  state.notifs.unshift({ id: uidSeq('n'), tenant: tenant, taskId: taskId, text: text, ts: Date.now(), unread: true, kind: kind || 'review' });
}

function addCost(tenant, usd, member, model) {
  const c = state.costs[tenant];
  c.daily[c.daily.length - 1] = +(c.daily[c.daily.length - 1] + usd).toFixed(2);
  let m = c.byModel.find((x) => x.name === model);
  if (!m) { m = { name: model, cost: 0 }; c.byModel.push(m); }
  m.cost = +(m.cost + usd).toFixed(2);
  const mem = c.byMember.find((x) => x.name === member);
  if (mem) mem.cost = +(mem.cost + usd).toFixed(2);
}

function openTaskDrawer(id) {
  if (!getTask(id)) return;
  closeModal();
  state.drawerTask = id;
  state.drawerWf = null;
  renderDrawer();
  $('#drawer').classList.add('open');
}
function closeDrawer() {
  state.drawerTask = null;
  state.drawerWf = null;
  $('#drawer').classList.remove('open');
}

function renderDrawer() {
  const t = getTask(state.drawerTask);
  if (!t) { closeDrawer(); return; }
  const s = t.sessionId ? getSession(t.sessionId) : null;
  const running = s && s.status === 'running';
  $('#drawer').innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="drawer-id">${t.id} <span class="pill prio-${t.priority}" style="margin-left:6px">${t.priority}</span></div>
        <div class="drawer-title">${esc(t.title)}</div>
      </div>
      <span class="spacer" style="flex:1"></span>
      <button class="icon-btn" data-action="close-drawer">${I.x}</button>
    </div>
    <div class="drawer-body">
      <dl class="meta-grid">
        <dt>状态</dt><dd>${statusPill(t.status)}</dd>
        <dt>标签</dt><dd>${tagPills(t.tags)}</dd>
        <dt>仓库</dt><dd style="font-family:var(--mono);font-size:11.5px">${esc(t.repo)}</dd>
        <dt>分支</dt><dd style="font-family:var(--mono);font-size:11.5px">${t.branch ? esc(t.branch) : '—'}</dd>
        <dt>派发 Agent</dt><dd>${t.agent ? agentChip(t.agent) : '<span style="color:var(--text-3)">未派发</span>'}</dd>
        <dt>创建人</dt><dd>${esc(t.by)}</dd>
        ${t.id === 'PAY-2048' ? `<dt>任务负责人</dt><dd>周明</dd><dt>验收人</dt><dd>陈工</dd><dt>执行准入</dt><dd>${t.dorReady ? '任务契约已确认' : '任务契约待确认'}</dd><dt>项目上下文</dt><dd>${state.storyContextInjected ? '已按权限整理引用' : '待检索'}</dd>` : ''}
      </dl>
      <div class="action-bar"><label>状态流转 <select class="agent-select" data-role="task-status" data-id="${t.id}"><option value="">选择操作…</option>${(TASK_TRANSITIONS[t.status] || []).map(status => `<option value="${status}">${STATUS[status].label}</option>`).join('')}</select></label></div>
      ${t.id === 'PAY-2048' ? taskCollaboration(t) : ''}
      <div class="action-bar">
        ${(t.status === 'todo' || t.status === 'in_progress') && !running && (t.id !== 'PAY-2048' || (t.dorReady && state.storyContextInjected)) ? `
          <select class="agent-select" id="drawerAgentSelect">
            <option value="claude-code">Claude Code</option>
            <option value="codex">Codex</option>
            <option value="openhands">OpenHands</option>
            <option value="opencode">OpenCode（未连接）</option>
          </select>
          <button class="btn btn-primary btn-sm" data-action="dispatch" data-id="${t.id}">${I.play} 派发给 Agent</button>` : ''}
        ${t.status === 'in_review' ? `
          <button class="btn btn-green btn-sm" data-action="approve" data-id="${t.id}">${I.check} 通过验收 → 已完成</button>
          <button class="btn btn-danger btn-sm" data-action="reject" data-id="${t.id}">打回重做</button>` : ''}
        ${t.status === 'done' ? `<button class="btn btn-sm" data-action="reopen" data-id="${t.id}">${I.refresh} 重新打开</button>` : ''}
        ${running ? '<span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--blue);font-weight:600"><span class="pulse-dot"></span>Agent 执行中 · 可在会话台观察</span>' : ''}
      </div>
      <div class="dsec"><div class="dsec-title">任务描述</div><div class="dsec-text">${esc(t.desc)}</div></div>
      <div class="dsec">
        <div class="dsec-title">关联会话</div>
        ${s ? `
        <div class="session-link-card" data-action="open-session" data-id="${s.id}">
          ${s.status === 'running' ? '<span class="pulse-dot"></span>' : `<span class="conn-dot ${s.status === 'failed' ? 'off' : 'on'}"></span>`}
          <div class="sl-main">
            <div class="sl-title">${s.id} · ${AGENTS[s.agent].name}</div>
            <div class="sl-sub">${s.status === 'running' ? '执行中 · ' + esc(s.current) : s.status === 'failed' ? '失败 · 可重新派发' : '已完成 · 耗时 ' + Math.max(1, Math.round(((s.endedAt || Date.now()) - s.startedAt) / minute)) + ' 分钟'}${s.cost ? ' · ' + money(s.cost) : ''}</div>
          </div>
          ${I.arrow}
        </div>` : '<div style="font-size:12px;color:var(--text-3)">尚未派发过 Agent</div>'}
      </div>
      <div class="dsec">
        <div class="dsec-title">评论（${t.comments.length}）</div>
        ${t.comments.map((c) => `
          <div class="comment">
            <span class="avatar sm" style="${c.agent ? 'background:linear-gradient(135deg,#7c3aed,#4f46e5)' : 'background:linear-gradient(135deg,#f59e0b,#ef4444)'}">${c.agent ? 'AI' : esc(c.by[0])}</span>
            <div class="c-body">
              <div class="c-head"><span class="c-name">${esc(c.by)}</span><span class="c-time">${timeAgo(c.ts)}</span></div>
              <div class="c-text">${esc(c.text)}</div>
            </div>
          </div>`).join('')}
        <form class="comment-box" data-form="comment" data-id="${t.id}">
          ${t.id === 'PAY-2048' ? `<span class="source-tag">${esc(state.collabActor)}</span>` : ''}<input placeholder="添加评论、@成员补充信息（不自动派发）…" data-role="comment-input">
          <button class="btn btn-sm" type="submit">评论</button>
        </form>
      </div>
      <div class="dsec">
        <div class="dsec-title">活动时间线</div>
        <div class="timeline">
          ${t.activity.slice().reverse().map((a) => `
            <div class="tl-item ${a.kind || ''}">
              <div class="tl-time">${fmtFull(a.ts)} · ${timeAgo(a.ts)}</div>
              <div class="tl-text">${esc(a.text)}</div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
}

function openWfDrawer(id) {
  if (!getWf(id)) return;
  closeModal();
  state.drawerTask = null;
  state.drawerWf = id;
  renderWfDrawer();
  $('#drawer').classList.add('open');
}

function wfKindBadge(kind) {
  const map = {
    started: ['启动', 'k-start'], activity: ['活动', 'k-act'], signal: ['信号', 'k-signal'],
    wait: ['等待', 'k-wait'], timer: ['计时器', 'k-timer'], retry: ['重试', 'k-retry'],
    failed: ['失败', 'k-fail'], compensation: ['补偿', 'k-comp'], completed: ['完成', 'k-done'],
  };
  const m = map[kind] || ['事件', 'k-act'];
  return '<span class="wh-kind ' + m[1] + '">' + m[0] + '</span>';
}

function renderWfDrawer() {
  const w = getWf(state.drawerWf);
  if (!w) { closeDrawer(); return; }
  const t = w.taskId ? getTask(w.taskId) : null;
  const statusNote = w.status === 'waiting'
    ? `<button class="btn btn-green btn-sm" data-action="wf-signal" data-id="${w.id}">${I.play} 审批通过 · 放行流程</button>
       <span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--amber);font-weight:600">等待发布审批 · 超时 72 小时自动提醒</span>`
    : w.status === 'running'
      ? `<span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--blue);font-weight:600"><span class="pulse-dot"></span>流程执行中 · 引擎心跳正常</span>`
      : w.status === 'completed'
        ? `<span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--green);font-weight:600">${I.check} 流程完成 · 事件历史可回放</span>`
        : `<span style="display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--red);font-weight:600">${I.alert} 执行失败 · 已补偿回滚（无残留变更）</span>`;
  $('#drawer').innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="drawer-id">${w.id} ${wfStatusPill(w.status)}</div>
        <div class="drawer-title">${esc(w.name)}</div>
      </div>
      <span class="spacer" style="flex:1"></span>
      <button class="icon-btn" data-action="close-drawer">${I.x}</button>
    </div>
    <div class="drawer-body">
      <dl class="meta-grid">
        <dt>类型</dt><dd>${w.type} · ${w.wfVersion}</dd>
        <dt>所属租户</dt><dd>${TENANTS.find((t) => t.id === w.tenant).name}</dd>
        <dt>运行 ID</dt><dd style="font-family:var(--mono);font-size:11.5px">${w.runId}</dd>
        <dt>关联任务</dt><dd>${t ? `<button class="task-link" data-action="open-task" data-id="${t.id}">${t.id} · ${esc(t.title)}</button>` : '<span style="color:var(--text-3)">—</span>'}</dd>
        <dt>关联会话</dt><dd style="font-family:var(--mono);font-size:11.5px">${w.sessionId || '—'}</dd>
        <dt>已运行</dt><dd>${wfElapsed(w)}</dd>
      </dl>
      <div class="action-bar">${statusNote}</div>
      <div class="dsec"><div class="dsec-title">步骤进度</div><div class="wf-steps">${w.steps.map((s, i) => {
        const cls = w.status === 'completed' || i < w.stepIndex ? 'done' : i === w.stepIndex ? 'current' : '';
        return '<span class="wf-step ' + cls + '">' + (cls === 'done' ? '✓ ' : '') + esc(s) + '</span>';
      }).join('')}</div></div>
      <div class="dsec"><div class="dsec-title">事件历史（不可变 · 可回放）</div>
        <div class="wf-hist">${w.history.map((h) => `
          <div class="wh-item">${wfKindBadge(h.kind)}<span class="wh-ts">${fmtFull(h.ts)}</span>
            <div class="wh-main"><div class="wh-name">${esc(wfEventLabel(h.name))}</div><div class="wh-detail">${esc(h.detail)}</div></div>
          </div>`).join('')}</div>
      </div>
    </div>`;
}

function signalWf(id) {
  const w = getWf(id);
  if (!w || w.status !== 'waiting') return;
  const ts = Date.now();
  w.history.push({ ts: ts, kind: 'signal', name: 'SignalReceived · approve-release', detail: ME.name + ' 审批通过 · 流程从等待点继续' });
  w.history.push({ ts: ts + 1, kind: 'activity', name: 'Activity: 部署预发', detail: 'staging 部署完成 · 健康检查通过' });
  w.history.push({ ts: ts + 2, kind: 'activity', name: 'Activity: 冒烟测试', detail: '用例 32/32 通过' });
  w.history.push({ ts: ts + 3, kind: 'completed', name: 'WorkflowExecutionCompleted', detail: '流程产物已归档 · 事件历史可回放' });
  w.status = 'completed';
  w.endedAt = ts;
  w.stepIndex = w.steps.length;
  state.audits.unshift({ ts: ts, tenant: w.tenant, actor: { type: 'human', id: 'me', name: ME.name }, action: 'workflow.signal', object: { type: 'workflow', id: w.id }, session: w.sessionId || null, detail: '发布审批放行 → 流程继续执行并完成' });
  toast('审批已放行 · <b>' + w.id + '</b> 流程续跑并完成', { action: true, actionLabel: '查看审计', onAction: () => go('audit') });
  render();
}

function openModal(html) { $('#modal').innerHTML = html; $('#modalScrim').classList.add('open'); }
function closeModal() { $('#modalScrim').classList.remove('open'); }

const REPOS = {
  'trade-core': ['trade/order-service', 'trade/quote-gateway', 'trade/recon-service'],
  'pay-settle': ['pay/payment-core', 'pay/settlement'],
  'platform': ['platform/infra-operator', 'platform/ci-toolchain', 'platform/config-center'],
};

function openNewTaskModal() {
  const repos = REPOS[state.tenant];
  const tenantName = TENANTS.find((t) => t.id === state.tenant).name;
  openModal(`
    <div class="modal-head"><span class="modal-title">新建任务</span><span class="spacer" style="flex:1"></span><button class="icon-btn" data-action="close-modal">${I.x}</button></div>
    <div class="modal-body">
      <div class="form-row"><label>标题</label><input type="text" id="ntTitle" placeholder="例如：订单导出接口超时优化"></div>
      <div class="form-row"><label>描述</label><textarea id="ntDesc" placeholder="背景、目标、验收标准…"></textarea></div>
      <div class="form-2col">
        <div class="form-row"><label>仓库</label><select id="ntRepo">${repos.map((r) => `<option>${r}</option>`).join('')}</select></div>
        <div class="form-row"><label>优先级</label><select id="ntPrio"><option>P1</option><option selected>P2</option><option>P0</option></select></div>
      </div>
      <div class="form-row"><label>标签（逗号分隔）</label><input type="text" id="ntTags" placeholder="feature, perf"></div>
      <div class="form-hint">${I.shield} 任务将进入「${tenantName}」任务板，Agent 只能推进到「待验收」</div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-action="close-modal">取消</button>
      <button class="btn btn-primary" data-action="confirm-new-task">创建任务</button>
    </div>`);
}

function confirmNewTask() {
  const title = $('#ntTitle').value.trim();
  if (!title) { toast('请填写任务标题', { icon: 'alert' }); return; }
  const t = mkTask({
    id: nextTaskId(state.tenant), tenant: state.tenant, title: title,
    desc: $('#ntDesc').value.trim() || '（无描述）',
    repo: $('#ntRepo').value, priority: $('#ntPrio').value,
    tags: $('#ntTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean).slice(0, 4),
    by: ME.name,
    activity: [{ ts: Date.now(), text: ME.name + ' 创建了任务', kind: 'human' }],
  });
  state.tasks.unshift(t);
  state.audits.unshift({ ts: Date.now(), tenant: state.tenant, actor: { type: 'human', id: 'me', name: ME.name }, action: 'task.create', object: { type: 'task', id: t.id }, detail: '创建任务「' + t.title + '」' });
  closeModal();
  toast('任务 <b>' + t.id + '</b> 已创建');
  go('board');
}

const WF_TEMPLATES = {
  ReleaseWorkflow: ['收集验收证据', '构建镜像', '发布审批', '部署预发', '冒烟测试', '部署生产'],
  FeatureWorkflow: ['需求分析', '方案设计', '编码实现', 'CI 回归测试', '人工验收', '合并入主干'],
  SettlementWorkflow: ['清算文件生成', '银行渠道分发', '回执核对', '差错补偿', '日终归档'],
  ReconWorkflow: ['拉取对账文件', '差异核验', '生成差异台账', '通知'],
};

function openNewWorkflowModal() {
  const tasks = state.tasks.filter((x) => x.tenant === state.tenant && x.status !== 'done');
  openModal(`
    <div class="modal-head"><span class="modal-title">新建工作流</span><span class="spacer" style="flex:1"></span><button class="icon-btn" data-action="close-modal">${I.x}</button></div>
    <div class="modal-body">
      <div class="form-row"><label>名称</label><input type="text" id="nwfName" placeholder="例如：上线发布：ORD-1839 状态机修复"></div>
      <div class="form-2col">
        <div class="form-row"><label>模板</label><select id="nwfTemplate">
          <option value="ReleaseWorkflow">ReleaseWorkflow · 上线发布</option>
          <option value="FeatureWorkflow">FeatureWorkflow · 需求全流程</option>
          <option value="SettlementWorkflow">SettlementWorkflow · 资金归集</option>
          <option value="ReconWorkflow">ReconWorkflow · 对账巡检</option>
        </select></div>
        <div class="form-row"><label>关联任务（可选）</label><select id="nwfTask">
          <option value="">不关联任务</option>
          ${tasks.map((x) => `<option value="${x.id}">${x.id} · ${esc(x.title)}</option>`).join('')}
        </select></div>
      </div>
      <div class="form-hint">${I.shield} 工作流将以「运行中」状态启动；失败自动补偿回滚，关键节点可设人审放行</div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-action="close-modal">取消</button>
      <button class="btn btn-primary" data-action="confirm-new-wf">启动工作流</button>
    </div>`);
}

function confirmNewWorkflow() {
  const name = $('#nwfName').value.trim();
  if (!name) { toast('请填写工作流名称', { icon: 'alert' }); return; }
  const type = $('#nwfTemplate').value;
  const taskId = $('#nwfTask').value || null;
  const id = nextWfId();
  const ts = Date.now();
  state.workflows.unshift({
    id: id, tenant: state.tenant, name: name, type: type, wfVersion: 'v1.0',
    runId: Math.random().toString(16).slice(2, 10).padEnd(8, '0'),
    status: 'running', startedAt: ts, endedAt: null, taskId: taskId, sessionId: null,
    steps: WF_TEMPLATES[type] || WF_TEMPLATES.ReleaseWorkflow, stepIndex: 0,
    history: [{ ts: ts, kind: 'started', name: 'WorkflowExecutionStarted', detail: type + ' v1.0 · 触发源：手动创建（' + ME.name + '）' }],
  });
  state.audits.unshift({ ts: ts, tenant: state.tenant, actor: { type: 'human', id: 'me', name: ME.name }, action: 'workflow.start', object: { type: 'workflow', id: id }, detail: '手动启动工作流「' + name + '」' });
  closeModal();
  toast('工作流 <b>' + id + '</b> 已启动');
  go('automations');
}

function openMrModal(mrId) {
  const t = state.tasks.find((x) => x.pr === mrId);
  const s = t && t.sessionId ? getSession(t.sessionId) : null;
  const num = parseInt((mrId.match(/\d+/) || [0])[0], 10);
  const merged = t && t.status === 'done';
  const adds = 120 + (num % 160);
  const dels = 18 + (num % 42);
  const files = [
    ['src/main/**（核心实现）', Math.round(adds * 0.55), Math.round(dels * 0.7)],
    ['src/test/**（回归用例）', Math.round(adds * 0.35), Math.round(dels * 0.2)],
    ['config/** 与 docs/**', Math.round(adds * 0.1) + 2, Math.max(1, Math.round(dels * 0.1))],
  ];
  const maxAdd = files[0][1];
  openModal(`
    <div class="modal-head"><span class="modal-title">合并请求 ${esc(mrId)}<span class="mr-state ${merged ? 'mr-merged' : 'mr-open'}">${merged ? '已合并' : '开放中 · 等待验收'}</span></span><span class="spacer" style="flex:1"></span><button class="icon-btn" data-action="close-modal">${I.x}</button></div>
    <div class="modal-body">
      ${t ? `
      <dl class="meta-grid">
        <dt>标题</dt><dd>${esc(t.title)}</dd>
        <dt>仓库</dt><dd style="font-family:var(--mono);font-size:11.5px">${esc(t.repo)}</dd>
        <dt>源分支</dt><dd style="font-family:var(--mono);font-size:11.5px">${t.branch ? esc(t.branch) : '—'}</dd>
        <dt>目标分支</dt><dd style="font-family:var(--mono);font-size:11.5px">main</dd>
        <dt>作者</dt><dd>${t.agent && AGENTS[t.agent] ? agentChip(t.agent) : '<span style="color:var(--text-3)">—</span>'}</dd>
        <dt>CI 流水线</dt><dd><span class="mr-ci">${I.check} 通过</span><span style="font-size:11px;color:var(--text-3);margin-left:8px">单测 48/48 · lint 无告警</span></dd>
      </dl>
      <div class="dsec"><div class="dsec-title">变更规模（+${adds} / −${dels}）</div>
        <div class="mr-files">
          ${files.map((f) => `
          <div class="mr-file"><span class="mr-path">${esc(f[0])}</span>
            <span class="mr-bar"><i style="width:${Math.max(6, Math.round((f[1] / maxAdd) * 100))}%"></i></span>
            <span class="mr-add">+${f[1]}</span><span class="mr-del">−${f[2]}</span>
          </div>`).join('')}
        </div>
      </div>` : '<div class="empty">未找到与该 MR 关联的任务记录</div>'}
    </div>
    <div class="modal-foot">
      <button class="btn" data-action="close-modal">关闭</button>
      ${s ? `<button class="btn" data-action="open-session" data-id="${s.id}">查看会话 ${s.id}</button>` : ''}
      ${t ? `<button class="btn btn-primary" data-action="open-task" data-id="${t.id}">打开关联任务 ${t.id}</button>` : ''}
    </div>`);
}

const TRIGGER_OPTIONS = [
  ['github', 'GitHub issue 标签'],
  ['webhook', 'Webhook 事件'],
  ['schedule', '定时触发'],
  ['slack', 'IM 群聊消息'],
];

const AUTO_SOURCES = ['CI 流水线', '监控告警', '代码评审', '外部系统'];

function autoCfgHtml(trigger) {
  if (trigger === 'github') return `
    <div class="form-2col">
      <div class="form-row"><label>仓库范围</label><select id="acRepo"><option value="">任意仓库</option>${REPOS[state.tenant].map((r) => `<option>${r}</option>`).join('')}</select></div>
      <div class="form-row"><label>标签过滤</label><input type="text" id="acLabel" value="ai-agent" placeholder="例如：ai-agent"></div>
    </div>`;
  if (trigger === 'webhook') return `
    <div class="form-2col">
      <div class="form-row"><label>事件名称</label><input type="text" id="acEvent" placeholder="例如：pipeline.failed"></div>
      <div class="form-row"><label>触发来源</label><select id="acSource">${AUTO_SOURCES.map((s) => `<option>${s}</option>`).join('')}</select></div>
    </div>`;
  if (trigger === 'schedule') return `
    <div class="form-2col">
      <div class="form-row"><label>执行频率</label><select id="acFreq"><option>每天</option><option>工作日</option><option>每周五</option></select></div>
      <div class="form-row"><label>触发时间</label><input type="time" id="acTime" value="09:30"></div>
    </div>`;
  return `
    <div class="form-2col">
      <div class="form-row"><label>监听频道</label><input type="text" id="acChannel" placeholder="例如：#trade-ops"></div>
      <div class="form-row"><label>触发关键词（可选）</label><input type="text" id="acKeyword" placeholder="例如：@值班Agent"></div>
    </div>`;
}

function renderAutoCfg() {
  const box = $('#naCfg');
  if (!box) return;
  const trigger = $('#naTrigger').value;
  box.innerHTML = '<div class="cfg-area"><div class="cfg-area-title">' + TRIGGER_OPTIONS.find((o) => o[0] === trigger)[1] + ' · 触发配置</div>' + autoCfgHtml(trigger) + '</div>';
}

function openNewAutomationModal() {
  const tenantName = TENANTS.find((x) => x.id === state.tenant).name;
  openModal(`
    <div class="modal-head"><span class="modal-title">新建触发规则</span><span class="spacer" style="flex:1"></span><button class="icon-btn" data-action="close-modal">${I.x}</button></div>
    <div class="modal-body">
      <div class="form-row"><label>名称</label><input type="text" id="naName" placeholder="例如：MR 冲突自动诊断"></div>
      <div class="form-2col">
        <div class="form-row"><label>触发方式</label><select id="naTrigger">${TRIGGER_OPTIONS.map((o) => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select></div>
        <div class="form-row"><label>执行 Agent</label><select id="naAgent"><option value="">不指定（仅创建/通知）</option><option value="claude-code">Claude Code</option><option value="codex">Codex</option><option value="openhands">OpenHands</option></select></div>
      </div>
      <div id="naCfg"></div>
      <div class="form-row"><label>动作</label><input type="text" id="naAction" placeholder="例如：创建任务并派发 Claude Code"></div>
      <div class="form-hint">${I.shield} 自动化在「${tenantName}」内生效；创建后默认启用，可在列表中随时开关</div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-action="close-modal">取消</button>
      <button class="btn btn-primary" data-action="confirm-new-auto">创建规则</button>
    </div>`);
  renderAutoCfg();
}

function confirmNewAutomation() {
  const name = $('#naName').value.trim();
  if (!name) { toast('请填写规则名称', { icon: 'alert' }); return; }
  const trigger = $('#naTrigger').value;
  let triggerText = '';
  if (trigger === 'github') {
    const label = $('#acLabel').value.trim();
    if (!label) { toast('请填写标签过滤', { icon: 'alert' }); return; }
    const repo = $('#acRepo').value;
    triggerText = 'issue 携带 ' + label + ' 标签' + (repo ? ' · ' + repo : '');
  } else if (trigger === 'webhook') {
    const evt = $('#acEvent').value.trim();
    if (!evt) { toast('请填写事件名称', { icon: 'alert' }); return; }
    triggerText = evt + ' 事件 · 来源：' + $('#acSource').value;
  } else if (trigger === 'schedule') {
    const time = $('#acTime').value;
    if (!time) { toast('请选择触发时间', { icon: 'alert' }); return; }
    triggerText = $('#acFreq').value + ' ' + time;
  } else {
    const ch = $('#acChannel').value.trim();
    if (!ch) { toast('请填写监听频道', { icon: 'alert' }); return; }
    const kw = $('#acKeyword').value.trim();
    triggerText = ch + ' 频道' + (kw ? ' ' + kw : '');
  }
  const a = {
    id: nextAutoId(), tenant: state.tenant, name: name, trigger: trigger,
    triggerText: triggerText,
    action: $('#naAction').value.trim() || '（待配置动作）',
    agent: $('#naAgent').value || null,
    enabled: true, runs: 0, okRate: null, last: null,
  };
  state.automations.unshift(a);
  state.audits.unshift({ ts: Date.now(), tenant: state.tenant, actor: { type: 'human', id: 'me', name: ME.name }, action: 'automation.create', object: { type: 'automation', id: a.id }, detail: '创建自动化「' + name + '」' });
  closeModal();
  toast('触发规则 <b>' + a.id + '</b> 已创建并启用');
  go('automations');
}

function openRejectModal(id) {
  const t = getTask(id);
  if (!t) return;
  openModal(`
    <div class="modal-head"><span class="modal-title">打回重做 · ${t.id}</span><span class="spacer" style="flex:1"></span><button class="icon-btn" data-action="close-modal">${I.x}</button></div>
    <div class="modal-body">
      <div class="form-row"><label>返工反馈（保留在同一卡片，作为下一次执行依据）</label><textarea id="rjReason" placeholder="例如：脱敏规则需对齐合规基线 V2.3，补充港澳台证件号格式…"></textarea></div>
    </div>
    <div class="modal-foot">
      <button class="btn" data-action="close-modal">取消</button>
      <button class="btn btn-danger" data-action="confirm-reject" data-id="${id}">确认驳回返工</button>
    </div>`);
}

function approveTask(id) {
  const t = getTask(id);
  if (!t || t.status === 'done') return;
  if (id === 'PAY-2048' && state.collabActor !== '陈工') { toast('请切换为验收人陈工后确认', { icon: 'alert' }); return; }
  if (t.status !== 'in_review') { toast('仅待验收任务允许人工确认完成', { icon: 'alert' }); return; }
  t.status = 'done';
  if (id === 'PAY-2048') state.storyContextApproved = false;
  const ts = Date.now();
  t.activity.push({ ts: ts, text: (id === 'PAY-2048' ? '陈工' : ME.name) + ' 验收通过', kind: 'pass' });
  state.audits.unshift({ ts: ts, tenant: t.tenant, actor: { type: 'human', id: 'me', name: id === 'PAY-2048' ? '陈工' : ME.name }, action: 'approval.grant', object: { type: 'task', id: t.id }, session: t.sessionId, detail: '验收通过，任务完成' });
  state.notifs = state.notifs.filter((n) => n.taskId !== t.id);
  toast('已验收通过 · <b>' + t.id + '</b> 流转为已完成');
  render();
}

function rejectTask(id, reason) {
  const t = getTask(id);
  if (!t) return;
  if (t.status !== 'in_review') return;
  if (!reason || !reason.trim()) { toast('请填写可执行的打回理由', { icon: 'alert' }); return; }
  if (id === 'PAY-2048') {
    if (state.collabActor !== '陈工') { toast('请切换为验收人陈工后打回', { icon: 'alert' }); return; }
    if (t.status !== 'in_review') return;
    if (!reason || !reason.trim()) { toast('请填写可执行的打回理由', { icon: 'alert' }); return; }
    state.storyFeedback = reason;
    t.status = 'in_progress';
    closeModal();
    t.comments.push({ by: '陈工', text: reason, ts: Date.now() });
    t.activity.push({ ts: Date.now(), text: '陈工驳回：任务回到进行中，等待负责人派发返工 attempt', kind: 'human' });
    state.audits.unshift({ ts: Date.now(), tenant: t.tenant, actor: { type: 'human', id: 'me', name: '陈工' }, action: 'approval.reject', object: { type: 'task', id: t.id }, session: t.sessionId, detail: '打回重做：' + reason.slice(0, 50) });
    render();
    toast('反馈已附加到任务，等待派发返工 attempt');
    return;
  }
  closeModal();
  const s = t.sessionId ? getSession(t.sessionId) : null;
  const agent = (s && s.agent) || t.agent || 'claude-code';
  t.comments.push({ by: ME.name, text: reason, ts: Date.now() });
  t.activity.push({ ts: Date.now(), text: ME.name + ' 打回重做：' + reason.slice(0, 40), kind: 'human' });
  state.audits.unshift({ ts: Date.now(), tenant: t.tenant, actor: { type: 'human', id: 'me', name: ME.name }, action: 'approval.reject', object: { type: 'task', id: t.id }, session: t.sessionId, detail: '打回重做：' + reason.slice(0, 50) });
  startSession(t, agent, 'revise', reason);
  toast('已打回，Agent 正在按反馈修改…', { icon: 'info' });
}

function reopenTask(id) {
  const t = getTask(id);
  if (!t) return;
  t.status = 'in_progress';
  const ts = Date.now();
  t.activity.push({ ts: ts, text: ME.name + ' 重新打开任务', kind: 'human' });
  state.audits.unshift({ ts: ts, tenant: t.tenant, actor: { type: 'human', id: 'me', name: ME.name }, action: 'task.status_change', object: { type: 'task', id: t.id }, detail: 'done → in_progress（重新打开）' });
  toast('<b>' + t.id + '</b> 已重新打开');
  render();
}

function startSession(t, agent, phase, reason) {
  if (['backlog', 'blocked', 'canceled', 'done', 'in_review'].includes(t.status)) { toast('当前状态不能派发，请先按状态流程处理', { icon: 'alert' }); return; }
  if (t.id === 'PAY-2048' && (!t.dorReady || !state.storyContextInjected)) { toast('任务必须通过 DoR 并锁定上下文包后才能执行', { icon: 'alert' }); return; }
  if (t.id === 'PAY-2048' && (!['todo', 'in_progress'].includes(t.status) || state.sessions.some((s) => s.taskId === t.id && s.status === 'running'))) { toast('请先完成验收或打回，当前任务不能重复执行', { icon: 'alert' }); return; }
  closeDrawer();
  const s = {
    id: 'S-' + (state.sessionSeq++),
    taskId: t.id, tenant: t.tenant, agent: agent, status: 'running',
    startedAt: Date.now(), cost: 0, events: [], current: '初始化会话…', phase: phase,
  };
  state.sessions.unshift(s);
  t.status = 'in_progress';
  t.agent = agent;
  t.sessionId = s.id;
  if (t.id === 'PAY-2048') {
    t.attempt += 1;
    s.attempt = t.attempt;
    s.contextPack = '项目上下文（按任务范围检索）';
    s.events.push({ type: 'think', text: `PAY-2048 · attempt=${t.attempt} · 按任务契约与项目上下文执行` });
  }
  if (!t.branch) t.branch = 'agent/' + t.id.toLowerCase();
  const ts = Date.now();
  state.audits.unshift({ ts: ts, tenant: t.tenant, actor: { type: 'agent', id: agent, name: AGENTS[agent].name }, action: 'session.start', object: { type: 'task', id: t.id }, session: s.id, detail: phase === 'revise' ? '打回重做派发' : '任务板手动派发' });
  t.activity.push({ ts: ts, text: '派发 ' + AGENTS[agent].name + '，会话 ' + s.id + (phase === 'revise' ? '（按反馈重做）' : ''), kind: 'agent' });
  state.currentSession = s.id;
  state.sessFilter = 'all';
  go('sessions');
  runScript(s, buildScript(s, phase, reason));
}

function dispatchTask(id, phase, reason) {
  const t = getTask(id);
  if (!t) return;
  if (id === 'PAY-2048' && state.collabActor !== '周明') { toast('请切换为任务负责人周明后派发', { icon: 'alert' }); return; }
  if (t.status === 'in_review') { toast('任务处于「待验收」，请先验收或打回重做，不能重复派发', { icon: 'alert' }); return; }
  if (t.status === 'done') { toast('任务已完成，如需返工请先「重新打开」', { icon: 'alert' }); return; }
  if (state.sessions.some((s) => s.taskId === t.id && s.status === 'running')) { toast('该任务已有运行中的会话，不能重复派发', { icon: 'alert' }); return; }
  if (id === 'PAY-2048' && t.attempt > 0) { phase = 'revise'; reason = state.storyFeedback || t.comments.slice().reverse().find((c) => c.by === '陈工')?.text; }
  const sel = $('#drawerAgentSelect');
  const agent = sel ? sel.value : (t.agent || 'claude-code');
  if (agent === 'opencode') { toast('OpenCode 当前未连接（可在接入设置中启用）', { icon: 'alert' }); return; }
  startSession(t, agent, phase || 'initial', reason);
}

const stepLabel = (ev) => ev.type === 'think' ? '思考中…' : ev.type === 'term' ? '执行 ' + ev.cmd : ev.type === 'diff' ? '生成变更 ' + ev.file : ev.type === 'summary' ? '整理变更摘要…' : ev.type === 'user' ? '接收补充指令…' : '处理中…';

function runScript(s, script) {
  let i = 0;
  const step = () => {
    if (s.status !== 'running' || i >= script.length) return;
    const ev = script[i++];
    if (ev.type === 'done') { completeSession(s); return; }
    s.events.push(ev);
    s.current = stepLabel(ev);
    s.cost = +(s.cost + 0.03 + Math.random() * 0.05).toFixed(3);
    if (state.view === 'sessions' && state.currentSession === s.id) appendEvent(ev, s);
    setTimeout(step, ev.delay || 950);
  };
  setTimeout(step, 500);
}

function appendEvent(ev, s) {
  const box = $('#sessEvents');
  if (!box) return;
  const div = document.createElement('div');
  div.innerHTML = renderEvent(ev, s);
  const node = div.firstElementChild;
  if (node) box.appendChild(node);
  box.scrollTop = box.scrollHeight;
  const st = $('#sessStatus');
  if (st) st.innerHTML = '<span class="pulse-dot"></span><span>正在执行：</span><span class="mono">' + esc(s.current) + '</span><span class="caret"></span>';
}

function completeSession(s) {
  if (s.status !== 'running') return;
  s.status = 'completed';
  s.endedAt = Date.now();
  s.current = '已完成';
  s.cost = +(s.cost + 0.1 + Math.random() * 0.2).toFixed(2);
  const t = getTask(s.taskId);
  if (t.id === 'PAY-2048') {
    s.cost = s.attempt === 1 ? 4.80 : 2.40;
    t.pr = '演示变更';
    s.evidence = { commit: s.attempt === 1 ? 'a81f204' : 'b92e305', ci: '自动化检查通过（演示数据）' };
    t.evidence = s.evidence;
  }
  t.status = 'in_review';
  t.cost = +((t.cost || 0) + s.cost).toFixed(2);
  const ts = Date.now();
  t.activity.push({ ts: ts, text: '会话 ' + s.id + ' 完成，产出提交待验收', kind: 'agent' });
  t.comments.push({ by: AGENTS[s.agent].name, text: s.phase === 'revise' ? '已按反馈完成修改，请重新验收。' : '实现完成，请验收变更与测试结果。', ts: ts, agent: true });
  state.audits.unshift({ ts: ts, tenant: t.tenant, actor: { type: 'agent', id: s.agent, name: AGENTS[s.agent].name }, action: 'session.complete', object: { type: 'task', id: t.id }, session: s.id, trace: 'lf_' + (1000 + Math.floor(Math.random() * 9000)), detail: (AGENTS[s.agent].model) + ' · 成本 ' + money(s.cost) });
  state.audits.unshift({ ts: ts + 1, tenant: t.tenant, actor: { type: 'system', id: 'dispatcher', name: '派发器' }, action: 'task.status_change', object: { type: 'task', id: t.id }, session: s.id, detail: 'in_progress → in_review（等待人工验收）' });
  addCost(t.tenant, s.cost, ME.name, AGENTS[s.agent].model);
  pushNotif(t.tenant, t.id, AGENTS[s.agent].name + ' 已完成「' + t.title + '」，等待验收');
  toast('<b>' + t.id + '</b> 已进入待验收 · ' + AGENTS[s.agent].name + ' 产出 ' + money(s.cost));
  render();
}

const TASK_TRANSITIONS = { backlog: ['todo','canceled'], todo: ['in_progress','canceled'], in_progress: ['in_review','blocked','canceled'], in_review: ['done','in_progress','canceled'], blocked: ['in_progress','canceled'], done: ['in_progress','todo','canceled'], canceled: ['todo'] };

function moveTask(id, status, beforeId) {
  const t = getTask(id);
  if (!t) return;
  if (t.status === status) { reorderTask(t, beforeId); render(); return; }
  if (!TASK_TRANSITIONS[t.status]?.includes(status)) { toast('不允许从「' + STATUS[t.status].label + '」流转到「' + STATUS[status].label + '」', { icon: 'alert' }); return; }
  if (t.sessionId && getSession(t.sessionId)?.status === 'running') { toast('请先在会话台中断执行，再调整状态', { icon: 'alert' }); return; }
  if (t.status === 'in_review' && status === 'in_progress') { openRejectModal(id); return; }
  if (t.id === 'PAY-2048' && status === 'todo' && !t.dorReady) { openTaskDrawer(id); toast('请先在任务面板完成受理与 DoR', { icon: 'alert' }); return; }
  if (status === 'in_review' && !t.evidence && !t.pr) { toast('请先执行任务并提交验收证据', { icon: 'alert' }); return; }
  if (status === 'done') {
    if (t.status !== 'in_review') {
      toast('平台护栏：Agent 产出必须经人工验收后才能完成（拖拽被拦截）', { icon: 'alert' });
      const card = document.querySelector('.task-card[data-id="' + id + '"]');
      if (card) { card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 450); }
      return;
    }
    approveTask(id);
    return;
  }
  const from = t.status;
  t.status = status;
  reorderTask(t, beforeId);
  const ts = Date.now();
  t.activity.push({ ts: ts, text: ME.name + ' 手动调整为「' + STATUS[status].label + '」', kind: 'human' });
  state.audits.unshift({ ts: ts, tenant: t.tenant, actor: { type: 'human', id: 'me', name: ME.name }, action: 'task.status_change', object: { type: 'task', id: t.id }, detail: from + ' → ' + status + '（手动拖拽）' });
  toast('<b>' + t.id + '</b> 已移至「' + STATUS[status].label + '」');
  render();
}

function reorderTask(task, beforeId) {
  const list = state.tasks.filter(t => t.tenant === task.tenant && t.status === task.status && t.id !== task.id).sort((a,b) => (a.order || 0) - (b.order || 0));
  const index = list.findIndex(t => t.id === beforeId);
  list.splice(index < 0 ? list.length : index, 0, task);
  list.forEach((t,i) => t.order = i);
}

document.addEventListener('contextmenu', e => {
  const card = e.target.closest('.task-card');
  if (!card) return;
  e.preventDefault();
  openTaskDrawer(card.dataset.id);
  $('#drawer').querySelector('[data-role=task-status]').focus();
});

function bindBoardDnD() {
  document.querySelectorAll('.board-col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const target = e.target.closest('.task-card');
      moveTask(id, col.dataset.status, target && target.dataset.id !== id ? target.dataset.id : null);
    });
  });
  document.querySelectorAll('.task-card').forEach((c) => {
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
  });
}

document.addEventListener('click', (e) => {
  const toggleTenant = e.target.closest('[data-action="toggle-tenant-menu"]');
  const toggleNotif = e.target.closest('[data-action="toggle-notif"]');
  const insideDropdown = e.target.closest('.dropdown');
  if (toggleTenant) {
    menuState.tenantOpen = !menuState.tenantOpen;
    menuState.notifOpen = false;
    renderTenantMenu(); renderNotifMenu();
    return;
  }
  if (toggleNotif) {
    menuState.notifOpen = !menuState.notifOpen;
    menuState.tenantOpen = false;
    renderTenantMenu(); renderNotifMenu();
    return;
  }
  if (!insideDropdown && (menuState.tenantOpen || menuState.notifOpen)) {
    menuState.tenantOpen = false;
    menuState.notifOpen = false;
    renderTenantMenu(); renderNotifMenu();
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;
  if (action === 'signal-task') return createSignalTask();
  if (action === 'story-accept') {
    const t = getTask('PAY-2048');
    if (!t || t.status !== 'backlog' || state.collabActor !== '林琳') { toast('请由林琳在积压列受理该任务', { icon: 'alert' }); return; }
    const ts = Date.now();
    t.activity.push({ ts: ts, text: '林琳确认受理业务信号，开始团队澄清', kind: 'human' });
    state.audits.unshift({ ts: ts, tenant: t.tenant, actor: { type: 'human', id: 'me', name: '林琳' }, action: 'task.accept', object: { type: 'task', id: t.id }, detail: '业务信号受理，任务保持积压以便澄清' });
    t.accepted = true;
    render();
    return;
  }
  if (action === 'story-ready') {
    const t = getTask('PAY-2048');
    if (!t || !t.accepted || t.dorReady || state.collabActor !== '周明' || !state.storyDor.every(Boolean) || !state.storyClarifications.every(x => x.answer)) { toast('请先完成任务契约并处理待澄清问题', { icon: 'alert' }); return; }
    t.dorReady = true;
    t.status = 'todo';
    t.activity.push({ ts: Date.now(), text: '周明确认团队任务契约，任务进入可执行状态', kind: 'human' });
    state.audits.unshift({ ts: Date.now(), tenant: t.tenant, actor: { type: 'human', id: 'me', name: '周明' }, action: 'task.ready', object: { type: 'task', id: t.id }, detail: 'DoR 完整性确认通过' });
    render();
    return;
  }
  if (action === 'story-context') {
    const t = getTask('PAY-2048');
    if (!t.dorReady || state.collabActor !== '周明') { toast('任务契约就绪后由周明确认上下文包', { icon: 'alert' }); return; }
    state.storyContextInjected = true;
    t.activity.push({ ts: Date.now(), text: '按项目、任务范围与权限整理上下文引用', kind: 'system' });
    state.audits.unshift({ ts: Date.now(), tenant: t.tenant, actor: { type: 'system', id: 'context-service', name: 'Context Service' }, action: 'context.inject', object: { type: 'task', id: t.id }, detail: '任务级上下文引用已整理' });
    render();
    return;
  }
  if (action === 'story-context-approve') {
    const t = getTask('PAY-2048');
    if (t.status !== 'done' || state.collabActor !== '周明') { toast('任务完成后由周明审批经验提议', { icon: 'alert' }); return; }
    state.storyContextApproved = true;
    state.audits.unshift({ ts: Date.now(), tenant: t.tenant, actor: { type: 'human', id: 'me', name: '周明' }, action: 'context.approve', object: { type: 'task', id: t.id }, detail: '审核并登记任务产物/经验到所属项目' });
    render();
    return;
  }
  if (action === 'nav') return go(el.dataset.view);
  if (action === 'open-task') return openTaskDrawer(id);
  if (action === 'open-wf') return openWfDrawer(id);
  if (action === 'wf-signal') return signalWf(id);
  if (action === 'close-drawer') return closeDrawer();
  if (action === 'dispatch') return dispatchTask(id);
  if (action === 'approve') return approveTask(id);
  if (action === 'reject') return openRejectModal(id);
  if (action === 'reopen') return reopenTask(id);
  if (action === 'new-task') return openNewTaskModal();
  if (action === 'new-wf') return openNewWorkflowModal();
  if (action === 'confirm-new-wf') return confirmNewWorkflow();
  if (action === 'new-auto') return openNewAutomationModal();
  if (action === 'confirm-new-auto') return confirmNewAutomation();
  if (action === 'open-mr') return openMrModal(id);
  if (action === 'close-modal') return closeModal();
  if (action === 'confirm-new-task') return confirmNewTask();
  if (action === 'confirm-reject') {
    const reason = $('#rjReason').value.trim() || '请根据评审意见调整实现';
    return rejectTask(id, reason);
  }
  if (action === 'open-session') {
    state.currentSession = id;
    closeModal();
    closeDrawer();
    if (state.view !== 'sessions') go('sessions'); else render();
    return;
  }
  if (action === 'sess-tab') { state.sessFilter = id; return render(); }
  if (action === 'select-tenant') {
    state.tenant = id;
    state.currentSession = null;
    closeDrawer();
    menuState.tenantOpen = false;
    toast('已切换至「' + TENANTS.find((t) => t.id === id).name + '」租户域 · 数据已隔离');
    return render();
  }
  if (action === 'mark-notifs') {
    state.notifs.forEach((n) => { if (n.tenant === state.tenant) n.unread = false; });
    render(); return;
  }
  if (action === 'notif-open') {
    if (id) {
      state.notifs.forEach((n) => { if (n.taskId === id) n.unread = false; });
      openTaskDrawer(id);
    }
    menuState.notifOpen = false;
    renderNotifMenu(); renderShell();
    return;
  }
  if (action === 'dismiss-hint') { state.hintDismissed = true; return render(); }
  if (action === 'fake-link') { return toast('演示原型：' + esc(id || '该入口') + ' 为示意占位', { icon: 'info' }); }
  if (action === 'ping-agent') {
    const a = AGENTS[id];
    el.disabled = true;
    el.textContent = '测试中…';
    setTimeout(() => {
      el.disabled = false;
      el.textContent = '测试连接';
      toast(esc(a.name) + ' 连接正常 · ACP 握手成功（延迟 ' + (20 + Math.floor(Math.random() * 60)) + 'ms）');
    }, 900);
    return;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.dataset.role === 'task-status') { const target = e.target.value; if (target) moveTask(e.target.dataset.id, target); renderDrawer(); return; }
  if (e.target.id === 'collabActor') { state.collabActor = e.target.value; renderDrawer(); return; }
  const dor = e.target.closest('[data-story-dor]');
  if (dor) {
    state.storyDor[Number(dor.dataset.storyDor)] = dor.checked;
    renderDrawer();
    return;
  }
  if (e.target.id === 'naTrigger') { renderAutoCfg(); return; }
  const auto = e.target.closest('[data-action="toggle-auto"]');
  if (auto) {
    const a = state.automations.find((x) => x.id === auto.dataset.id);
    if (a) { a.enabled = auto.checked; toast(esc(a.name) + (a.enabled ? ' 已启用' : ' 已停用')); render(); }
    return;
  }
  const auditAction = e.target.closest('[data-role="audit-action"]');
  if (auditAction) {
    state.auditAction = auditAction.value;
    const rows = $('#auditRows');
    if (rows) rows.innerHTML = renderAuditRows();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.matches('[data-role="audit-q"]')) {
    state.auditQ = e.target.value;
    const rows = $('#auditRows');
    if (rows) rows.innerHTML = renderAuditRows();
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  if (form.dataset.form === 'comment') {
    const input = form.querySelector('[data-role="comment-input"]');
    const text = input.value.trim();
    if (!text) return;
    const t = getTask(form.dataset.id);
    if (!t) return;
    const author = t.id === 'PAY-2048' ? state.collabActor : ME.name;
    t.comments.push({ by: author, text: text, ts: Date.now() });
    t.activity.push({ ts: Date.now(), text: author + ' 添加了评论', kind: 'human' });
    state.audits.unshift({ ts: Date.now(), tenant: t.tenant, actor: { type: 'human', id: 'me', name: author }, action: 'comment.add', object: { type: 'task', id: t.id }, detail: text.slice(0, 50) });
    renderDrawer();
    return;
  }
  if (form.dataset.form === 'clarification') {
    const question = form.elements.question.value.trim();
    if (!question) return;
    const item = { question, answer: '', by: state.collabActor, ts: Date.now() };
    state.storyClarifications.push(item);
    const t = getTask('PAY-2048');
    t.comments.push({ by: state.collabActor, text: '请求澄清：' + question, ts: item.ts });
    t.activity.push({ ts: item.ts, text: state.collabActor + ' 提出澄清问题，任务保持积压', kind: 'human' });
    form.reset(); renderDrawer(); return;
  }
  if (form.dataset.form === 'clarification-reply') {
    const answer = form.elements.answer.value.trim();
    const index = Number(form.dataset.clarificationIndex);
    const item = state.storyClarifications[index];
    if (!answer || !item || item.answer) return;
    item.answer = answer;
    item.by = state.collabActor;
    const ts = Date.now();
    const t = getTask('PAY-2048');
    t.comments.push({ by: state.collabActor, text: '澄清补充：' + answer, ts });
    t.activity.push({ ts, text: state.collabActor + ' 补充澄清信息', kind: 'human' });
    form.reset(); renderDrawer(); return;
  }
  if (form.dataset.form === 'composer') {
    const s = getSession(form.dataset.id);
    if (!s) return;
    const input = form.querySelector('[data-role="composer-input"]');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (s.status === 'running') {
      s.events.push({ type: 'user', text: text });
      s.events.push({ type: 'think', text: '收到补充指令，将在当前步骤完成后纳入处理…' });
      if (state.view === 'sessions' && state.currentSession === s.id) {
        appendEvent(s.events[s.events.length - 2], s);
        appendEvent(s.events[s.events.length - 1], s);
      }
      toast('指令已送达 Agent');
    } else {
      const t = getTask(s.taskId);
      if (!t) return;
      t.comments.push({ by: ME.name, text: text, ts: Date.now() });
      startSession(t, s.agent, 'revise', text);
      toast('已向 Agent 发送修改指令…', { icon: 'info' });
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#modalScrim').classList.contains('open')) return closeModal();
    if (state.drawerWf || state.drawerTask) return closeDrawer();
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const inp = document.querySelector('[data-role="global-search"]');
    if (inp) inp.focus();
  }
  if (e.key === 'Enter' && e.target.matches('[data-role="global-search"]')) {
    toast('演示原型：全局搜索将聚合任务 / 会话 / 审计（待接入）', { icon: 'info' });
  }
});

$('#modalScrim').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

const params = new URLSearchParams(location.search);
if (params.get('tenant') && TENANTS.some((t) => t.id === params.get('tenant'))) state.tenant = params.get('tenant');
if (params.get('view') && NAV.some((n) => n.id === params.get('view'))) state.view = params.get('view');
if (params.get('view') === 'story') { state.view = 'board'; state.tenant = 'pay-settle'; }
if (params.get('session')) state.currentSession = params.get('session');
if (params.get('task')) state.drawerTask = params.get('task');
if (params.get('wf')) state.drawerWf = params.get('wf');
if (params.get('view') === 'story' || params.get('task') === 'PAY-2048') createSignalTask();

render();
if (state.drawerTask || state.drawerWf) $('#drawer').classList.add('open');
