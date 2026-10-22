const menuState = { tenantOpen: false, notifOpen: false };

function renderShell() {
  const reviewCount = tenantTasks().filter((t) => t.status === 'in_review').length;
  const t = TENANTS.find((x) => x.id === state.tenant);
  const unread = state.notifs.filter((n) => n.tenant === state.tenant && n.unread).length;
  $('#sidebar').innerHTML = `
    <div class="logo">
      <div class="logo-mark">T</div>
      <div><div class="logo-title">Tandem · 协动</div><div class="logo-sub">Human-Agent R&amp;D Platform</div></div>
    </div>
    <nav class="nav">
      <div class="nav-label">协作工作区</div>
      ${NAV.slice(0, 3).map((n) => navItem(n, n.id === 'board' ? reviewCount : 0)).join('')}
      <div class="nav-label">平台治理</div>
      ${NAV.slice(3).map((n) => navItem(n, 0)).join('')}
    </nav>
    <div class="sidebar-foot">
      <div class="comp-status">开源组件状态</div>
      <div class="comp-row"><span class="comp-dot ok"></span>OpenHands Agent Canvas<span class="comp-ver">v1.16</span></div>
      <div class="comp-row"><span class="comp-dot ok"></span>dashi-taskboard<span class="comp-ver">fork</span></div>
      <div class="comp-row"><span class="comp-dot ok"></span>LiteLLM Gateway<span class="comp-ver">ok</span></div>
      <div class="comp-row"><span class="comp-dot warn"></span>Langfuse<span class="comp-ver">v3.2</span></div>
    </div>`;
  $('#topbar').innerHTML = `
    <button class="tenant-switch" data-action="toggle-tenant-menu">
      <span class="t-glyph">${t.glyph}</span>${t.name}${I.chevron}
    </button>
    <span class="env-chip">内网 · 生产</span>
    <div class="top-search">${I.search}<input placeholder="搜索任务 / 会话 / 成员…（演示项）" data-role="global-search"><kbd>⌘K</kbd></div>
    <div class="top-right">
      <button class="icon-btn" data-action="toggle-notif">${I.bell}${unread ? `<span class="dot-badge">${unread}</span>` : ''}</button>
      <div class="avatar" title="${ME.name} · ${ME.role}">秦</div>
    </div>`;
}

const navItem = (n, badge) => `
  <button class="nav-item ${state.view === n.id ? 'active' : ''}" data-action="nav" data-view="${n.id}">
    ${I[n.icon]}<span>${n.name}</span>${badge ? `<span class="nav-badge amber">${badge}</span>` : ''}
  </button>`;

function renderTenantMenu() {
  const el = $('#tenantMenu');
  el.className = 'dropdown' + (menuState.tenantOpen ? ' open' : '');
  el.innerHTML = `
    <div class="dd-head">切换租户域<span class="spacer"></span><span style="font-size:10.5px;color:var(--text-3);font-weight:500">实例级隔离</span></div>
    ${TENANTS.map((t) => `
      <div class="dd-item ${t.id === state.tenant ? 'active' : ''}" data-action="select-tenant" data-id="${t.id}">
        <span class="dd-check">${t.id === state.tenant ? I.check : ''}</span>
        <div class="dd-main"><div class="dd-name">${t.name}</div><div class="dd-sub">${t.members} 名成员 · ns-${t.id}</div></div>
      </div>`).join('')}
    <div class="dd-foot">多租户由网关 + 独立实例实现（开源组件无原生租户）</div>`;
}

function renderNotifMenu() {
  const list = state.notifs.filter((n) => n.tenant === state.tenant);
  const el = $('#notifMenu');
  el.className = 'dropdown' + (menuState.notifOpen ? ' open' : '');
  el.innerHTML = `
    <div class="dd-head">通知<span class="spacer"></span><button class="btn btn-xs btn-ghost" data-action="mark-notifs">全部已读</button></div>
    ${list.length ? list.map((n) => `
      <div class="notif-item" data-action="notif-open" data-id="${n.taskId || ''}">
        <div class="notif-icon">${n.kind === 'budget' ? I.alert : I.check}</div>
        <div class="notif-main">
          <div class="notif-title">${n.taskId ? `<b>${n.taskId}</b> ` : ''}${esc(n.text)}</div>
          <div class="notif-time">${timeAgo(n.ts)}${n.unread ? ' · <span style="color:var(--accent);font-weight:600">未读</span>' : ''}</div>
        </div>
      </div>`).join('') : '<div class="empty">暂无通知</div>'}
    <div class="dd-foot">验收提醒同步经 IM 推送（企微 / 钉钉）</div>`;
}

function render() {
  renderShell();
  renderTenantMenu();
  renderNotifMenu();
  const v = $('#view');
  if (state.view === 'dashboard') v.innerHTML = viewDashboard();
  else if (state.view === 'board') v.innerHTML = viewBoard();
  else if (state.view === 'sessions') v.innerHTML = viewSessions();
  
  else if (state.view === 'automations') v.innerHTML = viewAutomations();
  else if (state.view === 'costs') v.innerHTML = viewCosts();
  else if (state.view === 'audit') v.innerHTML = viewAudit();
  else if (state.view === 'settings') v.innerHTML = viewSettings();
  if (state.view === 'board') bindBoardDnD();
  if (state.drawerTask) renderDrawer();
  if (state.drawerWf) renderWfDrawer();
}

function go(view) {
  state.view = view === 'story' ? 'board' : view;
  if (view === 'story') state.tenant = 'pay-settle';
  menuState.tenantOpen = false;
  menuState.notifOpen = false;
  render();
}

function viewDashboard() {
  const tasks = tenantTasks();
  const inProg = tasks.filter((t) => t.status === 'in_progress').length;
  const review = tasks.filter((t) => t.status === 'in_review');
  const running = tenantSessions().filter((s) => s.status === 'running');
  const c = state.costs[state.tenant];
  const monthUsed = c.daily.reduce((a, b) => a + b, 0);
  const week = c.daily.slice(-7).reduce((a, b) => a + b, 0);
  const prevWeek = c.daily.slice(-14, -7).reduce((a, b) => a + b, 0);
  const delta = prevWeek ? Math.round(((week - prevWeek) / prevWeek) * 100) : 0;
  const audits = state.audits.filter((a) => a.tenant === state.tenant).slice(0, 6);
  return `
  ${state.hintDismissed ? '' : `
  <div class="hint-banner">
    <span class="hb-icon">${I.sparkle}</span>
    <span><b>多人协同演示</b>：任务板生成积压卡片 → 打开任务面板 → 受理与讨论 → 准备 → 执行 → 验收</span>
    <button class="btn btn-xs" data-action="nav" data-view="story">进入结算团队任务板</button>
    <span class="spacer"></span>
    <button class="hb-close" data-action="dismiss-hint">${I.x}</button>
  </div>`}
  <div class="kpi-grid">
    <div class="kpi-card" data-action="nav" data-view="board">
      <div class="kpi-label">进行中任务</div>
      <div class="kpi-value">${inProg}<span class="unit">个</span></div>
      <div class="kpi-foot">${running.length ? `<span class="pulse-dot"></span>${running.length} 个 Agent 正在执行` : '暂无 Agent 在执行'}</div>
    </div>
    <div class="kpi-card" data-action="nav" data-view="board">
      <div class="kpi-label">待验收</div>
      <div class="kpi-value" style="color:var(--amber)">${review.length}<span class="unit">个</span></div>
      <div class="kpi-foot">Agent 产出需人工确认后才完成</div>
    </div>
    <div class="kpi-card" data-action="nav" data-view="sessions">
      <div class="kpi-label">运行中的会话</div>
      <div class="kpi-value">${running.length}<span class="unit">个</span></div>
      <div class="kpi-foot">${running.length ? running.map((s) => AGENTS[s.agent].name).join(' · ') : '所有 Agent 空闲'}</div>
    </div>
    <div class="kpi-card" data-action="nav" data-view="costs">
      <div class="kpi-label">本月模型成本</div>
      <div class="kpi-value">${money(monthUsed)}</div>
      <div class="kpi-foot"><span class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)}%</span> 环比上周 · 预算 ${Math.round((monthUsed / c.monthBudget) * 100)}%</div>
    </div>
  </div>
  <div class="grid-2">
    <div class="card">
      <div class="card-head">${I.check}<span class="card-title">待验收队列</span><span class="spacer"></span><span style="font-size:11px;color:var(--text-3)">平台护栏：Agent 止步于此</span></div>
      <div class="card-body tight">
        ${review.length ? review.map((t) => `
          <div class="review-item" data-action="open-task" data-id="${t.id}">
            <div class="review-main">
              <div class="review-title"><span class="tc-id">${t.id}</span>&nbsp; ${esc(t.title)}</div>
              <div class="review-meta">${agentChip(t.agent)}<span>${timeAgo(t.activity[t.activity.length - 1].ts)}提交</span>${t.cost ? `<span>${money(t.cost)}</span>` : ''}</div>
            </div>
            <button class="btn btn-sm btn-green" data-action="approve" data-id="${t.id}">通过验收</button>
            <button class="btn btn-sm" data-action="open-task" data-id="${t.id}">查看</button>
          </div>`).join('') : '<div class="empty">当前没有待验收任务</div>'}
      </div>
    </div>
    <div class="card">
      <div class="card-head">${I.zap}<span class="card-title">Agent 运行状态</span><span class="spacer"></span><span style="font-size:11px;color:var(--text-3)">OpenHands Agent Server</span></div>
      <div class="card-body tight">
        ${running.length ? running.map((s) => {
          const t = getTask(s.taskId);
          return `
          <div class="session-mini" data-action="open-session" data-id="${s.id}">
            <span class="pulse-dot"></span>
            <div class="sm-main">
              <div class="sm-title">${t.id} · ${esc(t.title)}</div>
              <div class="sm-step">${AGENTS[s.agent].name} · ${esc(s.current)}</div>
            </div>
            ${agentChip(s.agent)}
          </div>`;
        }).join('') : '<div class="empty">暂无运行中的会话<br>到任务板派发一个任务试试</div>'}
      </div>
    </div>
  </div>
  <div class="grid-2 even">
    <div class="card">
      <div class="card-head">${I.shield}<span class="card-title">最近审计事件</span><span class="spacer"></span><button class="btn btn-xs" data-action="nav" data-view="audit">全部记录</button></div>
      <div class="card-body tight">${audits.map(auditMini).join('')}</div>
    </div>
    <div class="card">
      <div class="card-head">${I.chart}<span class="card-title">成本趋势（14 天）</span><span class="spacer"></span><span style="font-family:var(--mono);font-size:11.5px;color:var(--text-2)">${money(monthUsed)}</span></div>
      <div class="chart-wrap">${barChart(c.daily)}</div>
    </div>
  </div>`;
}

function auditMini(a) {
  const glyph = a.actor.type === 'human' ? a.actor.name[0] : a.actor.type === 'agent' ? (AGENTS[a.actor.id] ? AGENTS[a.actor.id].glyph : 'AI') : 'SYS';
  const cls = a.actor.type === 'human' ? 'human' : a.actor.type === 'agent' ? 'agent' : 'system';
  return `
  <div class="audit-mini">
    <div class="am-icon actor-glyph ${cls}">${glyph}</div>
    <div class="am-text"><b>${esc(a.actor.name)}</b> ${actionText(a)} <span style="color:var(--text-3)">· ${a.object.id}</span></div>
    <div class="am-time">${timeAgo(a.ts)}</div>
  </div>`;
}

function barChart(daily) {
  const max = Math.max.apply(null, daily);
  return `<div class="bar-chart">${daily.map((v, i) => {
    const d = new Date(Date.now() - (daily.length - 1 - i) * day);
    const h = Math.max(6, Math.round((v / max) * 100));
    return `<div class="bar-col"><div class="bar ${i === daily.length - 1 ? 'today' : ''}" style="height:${h}%" title="${d.getMonth() + 1}/${d.getDate()} · ${money(v)}"></div><div class="bar-label">${d.getDate()}</div></div>`;
  }).join('')}</div>`;
}

function viewBoard() {
  const tasks = tenantTasks();
  const cols = [
    { id: 'backlog', name: '积压事项' },
    { id: 'todo', name: '待办事项' },
    { id: 'in_progress', name: '进行中' },
    { id: 'in_review', name: '审核中' },
    { id: 'blocked', name: '已阻塞' },
    { id: 'done', name: '完成' },
    { id: 'canceled', name: '已取消' },
  ];
  const order = { P0: 0, P1: 1, P2: 2 };
  return `
  <div class="view-head">
    <div>
      <div class="view-title">任务板</div>
      <div class="view-sub">任务唯一权威源 · Agent 只能将任务推进到「待验收」，人确认后自动完成</div>
    </div>
    <span class="source-tag"><span class="src-dot"></span>形态来源：dashi-taskboard · 验收门</span>
    <span class="spacer"></span>
    <button class="btn btn-primary" data-action="new-task">${I.plus} 新建任务</button>
  </div>
  ${state.tenant === 'pay-settle' ? `<div class="hint-banner"><span>业务信号：退款结算反馈待处理。信息不完整时可在积压卡片内发起澄清，再确认任务契约。</span><button class="btn btn-sm" data-action="signal-task">${getTask('PAY-2048') ? '打开协作卡片 PAY-2048' : '从业务信号生成积压卡片'}</button></div>` : ''}
  <div class="board">
    ${cols.map((c) => {
      const list = tasks.filter((t) => t.status === c.id).sort((a, b) => (a.order ?? order[a.priority]) - (b.order ?? order[b.priority]));
      return `
      <div class="board-col" data-status="${c.id}">
        <div class="board-col-head"><span class="col-dot"></span><span class="col-title">${c.name}</span><span class="col-count">${list.length}</span></div>
        ${list.map(taskCard).join('')}
      </div>`;
    }).join('')}
  </div>`;
}

function taskCard(t) {
  const s = t.sessionId ? getSession(t.sessionId) : null;
  const running = s && s.status === 'running';
  const last = t.activity[t.activity.length - 1];
  return `
  <div class="task-card" draggable="true" data-id="${t.id}" data-action="open-task">
    <div class="tc-top">
      <span class="tc-id">${t.id}</span>${prioPill(t.priority)}
      <span class="spacer" style="flex:1"></span>
      ${running ? '<span class="tc-live"><span class="pulse-dot"></span>执行中</span>' : (t.agent ? agentChip(t.agent) : '')}
    </div>
    <div class="tc-title">${esc(t.title)}</div>
    <div class="tc-meta">${tagPills(t.tags.slice(0, 3))}</div>
    <div class="tc-foot">
      <span>${I.branch}${esc(t.repo)}</span>
      <span>${I.chat}${t.comments.length}</span>
      ${t.cost ? `<span>${I.coin}${money(t.cost)}</span>` : ''}
      <span style="margin-left:auto">${last ? timeAgo(last.ts) : ''}</span>
    </div>
  </div>`;
}

function viewSessions() {
  const all = tenantSessions();
  const filter = state.sessFilter;
  const list = all.filter((s) => filter === 'all' || (filter === 'running' ? s.status === 'running' : s.status !== 'running'));
  let cur = state.currentSession ? all.find((s) => s.id === state.currentSession) : null;
  if (!cur) cur = list[0] || all[0] || null;
  if (cur) state.currentSession = cur.id;
  return `
  <div class="view-head">
    <div>
      <div class="view-title">会话台</div>
      <div class="view-sub">Agent 执行现场 · 支持实时观察、中断与追加指令</div>
    </div>
    <span class="source-tag"><span class="src-dot"></span>形态来源：OpenHands Agent Canvas（ACP 多 Agent）</span>
  </div>
  <div class="sessions-layout">
    <div class="sess-list">
      <div class="sess-tabs">
        ${[['all', '全部'], ['running', '运行中'], ['done', '已完成']].map(([k, label]) => `<button class="sess-tab ${filter === k ? 'active' : ''}" data-action="sess-tab" data-id="${k}">${label}</button>`).join('')}
      </div>
      <div class="sess-items">
        ${list.length ? list.map((s) => {
          const t = getTask(s.taskId);
          return `
          <div class="sess-item ${cur && s.id === cur.id ? 'active' : ''}" data-action="open-session" data-id="${s.id}">
            <div class="sess-item-top">
              <span class="sess-item-id">${s.id}</span>
              ${s.status === 'running' ? '<span class="pulse-dot"></span>' : ''}
              <span class="spacer" style="flex:1"></span>
              <span style="font-size:10.5px;color:var(--text-3)">${timeAgo(s.startedAt)}</span>
            </div>
            <div class="sess-item-title">${t.id} · ${esc(t.title)}</div>
            <div class="sess-item-meta">${agentChip(s.agent)}<span>${s.status === 'running' ? '执行中' : s.status === 'failed' ? '失败' : '已完成'}</span>${s.cost ? `<span>${money(s.cost)}</span>` : ''}</div>
          </div>`;
        }).join('') : '<div class="empty">没有符合条件的会话</div>'}
      </div>
    </div>
    ${cur ? sessionDetail(cur) : `
    <div class="sess-detail">
      <div class="empty" style="margin:auto">${I.chat}<br>选择左侧会话查看执行现场<br>或在任务板将任务派发给 Agent 创建新会话</div>
    </div>`}
  </div>`;
}

function sessionDetail(s) {
  const t = getTask(s.taskId);
  const elapsed = s.status === 'running'
    ? Math.max(1, Math.round((Date.now() - s.startedAt) / minute)) + ' 分钟（进行中）'
    : Math.max(1, Math.round(((s.endedAt || Date.now()) - s.startedAt) / minute)) + ' 分钟';
  const trace = 'lf_' + String((parseInt(s.id.replace('S-', ''), 10) * 7) % 9999).padStart(4, '0');
  return `
  <div class="sess-detail">
    <div class="sess-ctx">
      <button class="task-link" data-action="open-task" data-id="${t.id}">${t.id} · ${esc(t.title)}</button>
      <span class="ctx-meta">${esc(t.repo)}${t.branch ? ' @ ' + esc(t.branch) : ''}</span>
      ${agentChip(s.agent)}
      <span class="pill status-${s.status}"><span class="p-dot" style="background:currentColor"></span>${s.status === 'running' ? '执行中' : s.status === 'failed' ? '失败' : '已完成'}</span>
      <span class="ctx-meta">耗时 ${elapsed}</span>
      <span class="spacer" style="flex:1"></span>
      <span class="ctx-meta">trace: ${trace}</span>
    </div>
    <div class="sess-events" id="sessEvents">
      ${s.events.map((e) => renderEvent(e, s)).join('')}
    </div>
    <div class="sess-statusline" id="sessStatus">${s.status === 'running'
      ? `<span class="pulse-dot"></span><span>正在执行：</span><span class="mono">${esc(s.current || '…')}</span><span class="caret"></span>`
      : s.status === 'failed'
        ? '<span style="color:var(--red);font-weight:600">会话失败</span><span>· 任务已按策略回退，可重新派发</span>'
        : '<span style="color:var(--green);font-weight:600">会话已完成</span><span>· 产出已作为证据提交至任务待验收</span>'}
    </div>
    <form class="sess-composer" data-form="composer" data-id="${s.id}">
      <input placeholder="追加指令或反馈（例如：边界条件需补充港澳台格式）…" data-role="composer-input">
      <button class="btn btn-primary" type="submit">发送</button>
    </form>
  </div>`;
}

function renderEvent(e, s) {
  if (e.type === 'system') return `<div class="ev ev-system"><span>${esc(e.text)}</span></div>`;
  if (e.type === 'user') return `<div class="ev ev-user"><div class="bubble">${esc(e.text)}</div></div>`;
  if (e.type === 'think') return `<div class="ev ev-thought"><div class="t-icon">${I.sparkle}</div><div class="t-body">${esc(e.text)}</div></div>`;
  if (e.type === 'term') return `
    <div class="ev"><div class="terminal">
      <div class="term-head"><span class="tdot"></span><span class="tdot"></span><span class="tdot"></span><span class="term-title">agent-shell · container</span></div>
      <div class="term-body"><span class="tp">$ </span><span class="tc">${esc(e.cmd)}</span>
<span class="tout">${esc(e.out)}</span></div>
    </div>
    ${e.exit !== undefined ? `<div class="exit-tag ${e.exit === 0 ? 'ok' : 'bad'}">exit code ${e.exit}</div>` : ''}
    </div>`;
  if (e.type === 'diff') {
    const parts = String(e.stats || '').split('−');
    return `
    <div class="ev"><div class="diff-card">
      <div class="diff-head"><span class="dfile">${esc(e.file)}</span><span class="dstat"><span class="plus">${esc((parts[0] || '').trim())}</span> <span class="minus">−${esc(parts[1] || '')}</span></span></div>
      <div class="diff-body">${e.lines.map(([k, text]) => `<div class="diff-line ${k}"><span class="dl-gutter">${k === 'add' ? '+' : k === 'del' ? '−' : ' '}</span>${esc(text)}</div>`).join('')}</div>
    </div></div>`;
  }
  if (e.type === 'summary') {
    const t = getTask(s.taskId);
    const canApprove = t && t.status === 'in_review';
    return `
    <div class="ev ev-summary"><div class="sum-card">
      <div class="sum-title">${I.check} 变更摘要</div>
      <div class="sum-text">${esc(e.text)}</div>
      <div class="sum-actions">
        ${canApprove ? `<button class="btn btn-xs btn-green" data-action="approve" data-id="${t.id}">通过验收</button>` : ''}
        <button class="btn btn-xs" data-action="open-task" data-id="${t.id}">打开任务</button>
        ${e.pr ? `<button class="btn btn-xs" data-action="open-mr" data-id="${esc(e.pr)}">打开 ${esc(e.pr)}</button>` : ''}
      </div>
    </div></div>`;
  }
  if (e.type === 'error') return `<div class="ev ev-error"><div class="err-card">${I.alert} ${esc(e.text)}</div></div>`;
  return '';
}

function viewAutomations() {
  const list = state.automations.filter((a) => a.tenant === state.tenant || !a.tenant);
  const wfs = tenantWfs();
  const wfRunning = wfs.filter((w) => w.status === 'running').length;
  const wfWaiting = wfs.filter((w) => w.status === 'waiting').length;
  const wfDoneToday = wfs.filter((w) => w.status === 'completed' && w.endedAt && (Date.now() - w.endedAt) < day).length;
  const wfFailed = wfs.filter((w) => w.status === 'failed').length;
  const triggerText = { github: 'GitHub', schedule: '定时', webhook: 'Webhook', slack: 'Slack' };
  const history = [
    { ts: now - 2 * hour, name: 'GitHub issue 自动派发', ctx: 'issue #482 (ai-agent)', agent: 'claude-code', dur: '11.2s', result: 'ok' },
    { ts: now - 5 * hour, name: 'GitHub issue 自动派发', ctx: 'issue #481 (ai-agent)', agent: 'claude-code', dur: '10.8s', result: 'ok' },
    { ts: now - 9 * hour, name: '每日逾期任务扫描', ctx: '扫描 23 个任务', agent: null, dur: '2.1s', result: 'ok' },
    { ts: now - 1 * day, name: 'CI 失败自动诊断', ctx: 'pipeline #2214 failed', agent: 'codex', dur: '46.5s', result: 'ok' },
    { ts: now - 1 * day, name: 'GitHub issue 自动派发', ctx: 'issue #479 (ai-agent)', agent: 'claude-code', dur: '3.4s', result: 'fail' },
  ];
  return `
  <div class="view-head">
    <div>
      <div class="view-title">自动化</div>
      <div class="view-sub">触发规则与工作流实例统一管理 · 人审节点 · 失败自动补偿 · 事件历史可回放</div>
    </div>
    <span class="spacer"></span>
    <button class="btn" data-action="new-auto">${I.plus} 新建触发规则</button>
    <button class="btn btn-primary" data-action="new-wf">${I.plus} 新建工作流</button>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">运行中流程</div>
      <div class="kpi-value">${wfRunning}<span class="unit">个</span></div>
      <div class="kpi-foot"><span class="pulse-dot"></span>执行引擎心跳正常 · 中断自动恢复</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">等待人审</div>
      <div class="kpi-value" style="color:var(--amber)">${wfWaiting}<span class="unit">个</span></div>
      <div class="kpi-foot">发布审批等关键节点 · 等待人工放行</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">今日完成</div>
      <div class="kpi-value">${wfDoneToday}<span class="unit">个</span></div>
      <div class="kpi-foot">事件历史已归档 · 可回放</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">已补偿回滚</div>
      <div class="kpi-value" style="color:var(--red)">${wfFailed}<span class="unit">个</span></div>
      <div class="kpi-foot">失败自动补偿回滚 · 不留残留变更</div>
    </div>
  </div>
  <div class="card">
    <div class="card-head">${I.flow}<span class="card-title">工作流实例</span><span class="spacer" style="flex:1"></span><span style="font-size:11px;color:var(--text-3)">当前租户：${TENANTS.find((t) => t.id === state.tenant).name} · 点击行查看事件历史</span></div>
    <div class="table-scroll">
    <table class="data-table">
      <thead><tr><th style="width:100px">工作流 ID</th><th>名称</th><th style="width:106px">状态</th><th>当前步骤 / 进度</th><th style="width:96px">关联任务</th><th style="width:104px">已运行</th><th style="width:76px"></th></tr></thead>
      <tbody>
        ${wfs.map((w) => `
        <tr data-action="open-wf" data-id="${w.id}">
          <td class="mono" style="font-weight:700">${w.id}</td>
          <td><div style="font-weight:600">${esc(w.name)}</div><div style="font-size:10.5px;color:var(--text-3);font-family:var(--mono)">${w.type} · ${w.wfVersion}</div></td>
          <td>${wfStatusPill(w.status)}</td>
          <td style="color:var(--text-2);font-size:11.5px">${esc(wfProgressText(w))}</td>
          <td class="mono">${w.taskId || '—'}</td>
          <td class="mono" style="font-size:11px;white-space:nowrap">${wfElapsed(w)}</td>
          <td>${w.status === 'waiting' ? `<button class="btn btn-xs btn-green" data-action="wf-signal" data-id="${w.id}">审批</button>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    </div>
  </div>
  <div class="sec-head">触发规则<span class="sec-note">事件 / 定时触发 → 创建任务或启动工作流</span></div>
  <div class="auto-grid">
    ${list.map((a) => `
    <div class="card auto-card">
      <div class="auto-top">
        <span class="flow-node trigger">${triggerText[a.trigger]}</span>
        <span class="auto-name">${esc(a.name)}</span>
        <span class="spacer" style="flex:1"></span>
        <label class="switch"><input type="checkbox" data-action="toggle-auto" data-id="${a.id}" ${a.enabled ? 'checked' : ''}><span class="track"></span></label>
      </div>
      <div class="auto-flow">
        <span>${esc(a.triggerText)}</span>
        <span class="flow-arrow">→</span>
        <span>${esc(a.action)}</span>
        ${a.agent ? `<span class="flow-arrow">→</span>${agentChip(a.agent)}` : ''}
      </div>
      <div class="auto-foot">
        <span>运行 ${a.runs} 次</span><span>成功率 ${a.okRate == null ? '—' : a.okRate + '%'}</span><span>${a.last ? '最近 ' + timeAgo(a.last) : '尚未运行'}</span>
        <span class="spacer" style="flex:1"></span>
        <span class="pill" style="background:${a.enabled ? 'var(--green-soft)' : '#f2f4f7'};color:${a.enabled ? 'var(--green)' : 'var(--text-3)'}">${a.enabled ? '已启用' : '已停用'}</span>
      </div>
    </div>`).join('')}
  </div>
  <div class="card">
    <div class="card-head">${I.clock}<span class="card-title">规则运行历史</span></div>
    <table class="data-table">
      <thead><tr><th style="width:120px">时间</th><th>触发规则</th><th>触发上下文</th><th>执行 Agent</th><th style="width:80px">耗时</th><th style="width:90px">结果</th></tr></thead>
      <tbody>
        ${history.map((h) => `
        <tr>
          <td class="mono">${fmtFull(h.ts)}</td>
          <td style="font-weight:600">${esc(h.name)}</td>
          <td style="color:var(--text-2)">${esc(h.ctx)}</td>
          <td>${h.agent ? agentChip(h.agent) : '<span style="color:var(--text-3)">—</span>'}</td>
          <td class="mono">${h.dur}</td>
          <td>${h.result === 'ok' ? '<span class="pill" style="background:var(--green-soft);color:var(--green)">成功</span>' : '<span class="pill" style="background:var(--red-soft);color:var(--red)">失败</span>'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

function viewCosts() {
  const c = state.costs[state.tenant];
  const monthUsed = c.daily.reduce((a, b) => a + b, 0);
  const modelMax = Math.max.apply(null, c.byModel.map((m) => m.cost));
  const teamRatio = monthUsed / c.monthBudget;
  return `
  <div class="view-head">
    <div>
      <div class="view-title">成本治理</div>
      <div class="view-sub">LiteLLM 虚拟 Key 预算熔断 + Langfuse 全链路归因</div>
    </div>
    <span class="source-tag"><span class="src-dot"></span>形态来源：LiteLLM + Langfuse</span>
  </div>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">本月总成本</div>
      <div class="kpi-value">${money(monthUsed)}<span class="unit">/ ${money(c.monthBudget)}</span></div>
      <div class="kpi-foot">预算使用率 ${Math.round(teamRatio * 100)}%</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">会话数（本月）</div>
      <div class="kpi-value">${c.sessions}<span class="unit">个</span></div>
      <div class="kpi-foot">平均单会话成本 ${money(monthUsed / c.sessions)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">预算熔断</div>
      <div class="kpi-value" style="font-size:19px;padding-top:5px">超限即拒绝</div>
      <div class="kpi-foot">LiteLLM budget 规则，非静默超额</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">最高消耗模型</div>
      <div class="kpi-value" style="font-size:19px;padding-top:5px">${esc(c.byModel[0].name)}</div>
      <div class="kpi-foot">${money(c.byModel[0].cost)} · 占比 ${Math.round((c.byModel[0].cost / monthUsed) * 100)}%</div>
    </div>
  </div>
  <div class="grid-2 even">
    <div class="card">
      <div class="card-head">${I.chart}<span class="card-title">每日成本（14 天）</span></div>
      <div class="chart-wrap">${barChart(c.daily)}</div>
    </div>
    <div class="card">
      <div class="card-head">${I.grid}<span class="card-title">模型分布</span></div>
      <div class="card-body">
        ${c.byModel.map((m) => `
        <div class="hbar-row">
          <span class="hbar-name">${esc(m.name)}</span>
          <div class="hbar-track"><div class="hbar-fill" style="width:${Math.round((m.cost / modelMax) * 100)}%"></div></div>
          <span class="hbar-val">${money(m.cost)}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head">${I.shield}<span class="card-title">成员预算（LiteLLM Virtual Keys）</span><span class="spacer" style="flex:1"></span><span style="font-size:11px;color:var(--text-3)">每「租户 × 成员」独立配额，超限自动熔断</span></div>
    <div class="card-body tight" style="padding:6px 8px">
      <div class="budget-row">
        <span class="budget-name" style="font-weight:700">团队总预算</span>
        <div class="budget-track"><div class="budget-fill ${teamRatio > 0.9 ? 'hot' : teamRatio > 0.7 ? 'warn' : 'ok'}" style="width:${Math.min(100, Math.round(teamRatio * 100))}%"></div></div>
        <span class="budget-val">${money(monthUsed)} / ${money(c.monthBudget)}</span>
        <span class="pill ${teamRatio > 0.9 ? 'prio-P0' : teamRatio > 0.7 ? 'prio-P1' : 'status-done'}">${teamRatio > 0.9 ? '临界' : teamRatio > 0.7 ? '预警' : '正常'}</span>
      </div>
      ${c.byMember.map((m) => {
        const r = m.cost / m.limit;
        return `
        <div class="budget-row">
          <span class="budget-name">${esc(m.name)}</span>
          <div class="budget-track"><div class="budget-fill ${r > 0.9 ? 'hot' : r > 0.7 ? 'warn' : 'ok'}" style="width:${Math.min(100, Math.round(r * 100))}%"></div></div>
          <span class="budget-val">${money(m.cost)} / ${money(m.limit)}</span>
          <span class="pill ${r > 0.9 ? 'prio-P0' : r > 0.7 ? 'prio-P1' : 'status-done'}">${r > 0.9 ? '临界' : r > 0.7 ? '预警' : '正常'}</span>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function viewAudit() {
  return `
  <div class="view-head">
    <div>
      <div class="view-title">审计中心</div>
      <div class="view-sub">任务变更 + Agent 动作 + 模型调用 三源归一 · 只读视图</div>
    </div>
    <span class="source-tag gray"><span class="src-dot"></span>薄适配层：审计聚合器（只读）</span>
  </div>
  <div class="filter-bar">
    <select data-role="audit-action">
      <option value="all">全部动作</option>
      ${Object.keys(ACTION_TEXT).map((k) => `<option value="${k}" ${state.auditAction === k ? 'selected' : ''}>${ACTION_TEXT[k]}</option>`).join('')}
    </select>
    <input placeholder="搜索任务 ID / 事件详情 / 操作者…" data-role="audit-q" value="${esc(state.auditQ)}">
  </div>
  <div class="card">
    <table class="data-table">
      <thead><tr><th style="width:92px">时间</th><th style="width:150px">操作者</th><th style="width:120px">动作</th><th style="width:110px">对象</th><th>详情</th><th style="width:92px">会话</th><th style="width:84px">Trace</th></tr></thead>
      <tbody id="auditRows">${renderAuditRows()}</tbody>
    </table>
    <div class="pager-info">共 ${state.audits.filter((a) => a.tenant === state.tenant).length} 条事件（演示数据） · 保留策略：180 天</div>
  </div>`;
}

function renderAuditRows() {
  const q = state.auditQ.trim().toLowerCase();
  const list = state.audits.filter((a) => {
    if (a.tenant !== state.tenant) return false;
    if (state.auditAction !== 'all' && a.action !== state.auditAction) return false;
    if (q) {
      const hay = (a.object.id + ' ' + a.detail + ' ' + a.actor.name + ' ' + actionText(a)).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!list.length) return '<tr><td colspan="7"><div class="empty">没有匹配的审计事件</div></td></tr>';
  return list.map((a) => {
    const glyph = a.actor.type === 'human' ? a.actor.name[0] : a.actor.type === 'agent' ? (AGENTS[a.actor.id] ? AGENTS[a.actor.id].glyph : 'AI') : 'SYS';
    const cls = a.actor.type === 'human' ? 'human' : a.actor.type === 'agent' ? 'agent' : 'system';
    const acls = a.action.startsWith('task') ? 'a-task' : a.action.startsWith('session') ? 'a-session' : a.action.startsWith('approval') ? 'a-approval' : a.action.startsWith('budget') ? 'a-budget' : a.action.startsWith('workflow') ? 'a-workflow' : a.action.startsWith('automation') ? 'a-automation' : '';
    return `
    <tr>
      <td class="mono">${fmtFull(a.ts)}</td>
      <td><span class="actor-chip"><span class="actor-glyph ${cls}">${glyph}</span>${esc(a.actor.name)}</span></td>
      <td><span class="action-badge ${acls}">${actionText(a)}</span></td>
      <td class="mono" style="font-weight:600">${a.object.id}</td>
      <td style="color:var(--text-2)">${esc(a.detail)}</td>
      <td class="mono">${a.session || '—'}</td>
      <td class="mono">${a.trace || '—'}</td>
    </tr>`;
  }).join('');
}

function viewSettings() {
  const c = state.costs[state.tenant];
  const agents = [
    { id: 'claude-code', proto: 'ACP', on: true, sessions: 31, ping: '12s 前' },
    { id: 'codex', proto: 'ACP', on: true, sessions: 24, ping: '3s 前' },
    { id: 'openhands', proto: 'Native', on: true, sessions: 18, ping: '7s 前' },
    { id: 'opencode', proto: 'ACP', on: false, sessions: 2, ping: '2 天前' },
  ];
  return `
  <div class="view-head">
    <div>
      <div class="view-title">接入设置</div>
      <div class="view-sub">Agent 接入（ACP）、模型路由与成员管理</div>
    </div>
    <span class="source-tag"><span class="src-dot"></span>形态来源：OpenHands Agent Server · LiteLLM API（只读聚合）</span>
  </div>
  <div class="grid-2 even">
    <div class="card">
      <div class="card-head">${I.zap}<span class="card-title">Agent 接入（ACP 协议）</span><span class="spacer" style="flex:1"></span><span style="font-size:11px;color:var(--text-3)">多 Agent 混合是平台前提</span></div>
      <div class="card-body tight">
        ${agents.map((a) => `
        <div class="agent-conn">
          <div class="ac-icon" style="background:${AGENTS[a.id].color}">${AGENTS[a.id].glyph}</div>
          <div class="ac-main">
            <div class="ac-name">${AGENTS[a.id].name}<span class="conn-dot ${a.on ? 'on' : 'off'}"></span></div>
            <div class="ac-meta">${a.proto} · ${a.on ? '已连接' : '未连接'} · 会话 ${a.sessions} · 心跳 ${a.ping}</div>
          </div>
          <button class="btn btn-sm" data-action="ping-agent" data-id="${a.id}">测试连接</button>
        </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="card-head">${I.coin}<span class="card-title">模型路由（LiteLLM Virtual Keys）</span></div>
      <div class="card-body tight" style="padding:8px 10px">
        ${c.byMember.map((m) => `
        <div class="budget-row">
          <span class="budget-name" style="width:96px">${esc(m.name)}</span>
          <span class="mono" style="font-size:10.5px;color:var(--text-3)">vk-${state.tenant.slice(0, 5)}-${Math.abs(m.name.charCodeAt(0))}</span>
          <div class="budget-track"><div class="budget-fill ${m.cost / m.limit > 0.9 ? 'hot' : m.cost / m.limit > 0.7 ? 'warn' : 'ok'}" style="width:${Math.round((m.cost / m.limit) * 100)}%"></div></div>
          <span class="budget-val">${money(m.cost)} / ${money(m.limit)}</span>
        </div>`).join('')}
        <div style="font-size:11px;color:var(--text-3);padding:9px 4px 3px">默认路由：按 Agent 类型映射（Claude Code → Claude Sonnet 4.5 · Codex → GPT-5.1-Codex · OpenHands → GLM-4.6），可配置降级链</div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head">${I.shield}<span class="card-title">成员与租户</span><span class="spacer" style="flex:1"></span><span style="font-size:11px;color:var(--text-3)">当前租户：${TENANTS.find((t) => t.id === state.tenant).name}（ns-${state.tenant}）</span></div>
    <table class="data-table">
      <thead><tr><th>成员</th><th>角色</th><th>可用 Agent</th><th>月预算</th><th>状态</th></tr></thead>
      <tbody>
        ${MEMBERS[state.tenant].map((m) => {
          const bud = c.byMember.find((x) => x.name === m.name);
          return `
          <tr>
            <td><span class="actor-chip"><span class="actor-glyph human">${m.name[0]}</span>${esc(m.name)}</span></td>
            <td style="color:var(--text-2)">${m.role}</td>
            <td>${['claude-code', 'codex'].map(agentChip).join(' ')}</td>
            <td class="mono">${bud ? money(bud.limit) : '—'}</td>
            <td><span class="pill status-done" style="background:var(--green-soft);color:var(--green)">启用</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

function wfStatusPill(s) {
  const map = { running: 'wf-running', waiting: 'wf-waiting', completed: 'wf-completed', failed: 'wf-failed' };
  const label = { running: '运行中', waiting: '等待人审', completed: '已完成', failed: '已补偿回滚' };
  return '<span class="wf-pill ' + map[s] + '">' + (s === 'running' ? '<span class="pulse-dot" style="background:currentColor"></span>' : '') + label[s] + '</span>';
}

function wfElapsed(w) {
  const ms = (w.endedAt || Date.now()) - w.startedAt;
  const d = Math.floor(ms / day), h = Math.floor((ms % day) / hour), m = Math.floor((ms % hour) / minute);
  if (d > 0) return d + ' 天 ' + h + ' 小时';
  if (h > 0) return h + ' 小时 ' + m + ' 分';
  return m + ' 分钟';
}

function wfProgressText(w) {
  if (w.status === 'completed') return '全部完成 · ' + w.steps.length + '/' + w.steps.length + ' 步';
  if (w.status === 'failed') return '已补偿回滚 · 第 ' + (w.stepIndex + 1) + ' 步失败';
  return '第 ' + (w.stepIndex + 1) + '/' + w.steps.length + ' 步 · ' + w.steps[w.stepIndex];
}

function wfEventLabel(name) {
  return name
    .replace('WorkflowExecutionStarted', '流程已启动')
    .replace('WorkflowExecutionCompleted', '流程已完成')
    .replace('WorkflowExecutionFailed（已补偿）', '流程失败 · 已补偿回滚')
    .replace('SignalReceived · approve-release', '收到人审信号 · 发布审批')
    .replace('SignalReceived · bank-ack', '收到外部回执 · 银行渠道')
    .replace('等待 Signal · approve-release', '等待人审 · 发布审批')
    .replace('等待 Signal · bank-ack', '等待外部回执 · 银行渠道')
    .replace('CompensateActivity: 回滚扩容', '补偿步骤 · 回滚扩容')
    .replace('Activity 持续失败', '步骤持续失败')
    .replace('Activity 失败 → 重试', '步骤失败 · 自动重试')
    .replace('Activity: ', '')
    .replace(/（attempt (\d+)\/(\d+)）/g, '（第 $1/$2 次尝试）')
    .replace(/（attempt (\d+)）/g, '（第 $1 次尝试）');
}

