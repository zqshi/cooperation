const sv = (p) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;

const I = {
  grid: sv('<rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/>'),
  board: sv('<rect x="2" y="2" width="3.6" height="12" rx="1"/><rect x="6.2" y="2" width="3.6" height="8" rx="1"/><rect x="10.4" y="2" width="3.6" height="10" rx="1"/>'),
  chat: sv('<path d="M2.5 3.5h11v7h-5.8l-3.2 2.6v-2.6H2.5z"/>'),
  zap: sv('<path d="M8.8 1.8 3.6 9h3.4l-.8 5.2L12.4 7H9z"/>'),
  chart: sv('<path d="M2.5 13.5h11"/><path d="M4.5 11V8"/><path d="M8 11V4.5"/><path d="M11.5 11V6.5"/>'),
  shield: sv('<path d="M8 1.8 3 3.6v4c0 3.1 2.1 5.5 5 6.6 2.9-1.1 5-3.5 5-6.6v-4z"/><path d="m5.8 7.8 1.6 1.6 2.8-3"/>'),
  gear: sv('<path d="M3 4.5h10M3 8h10M3 11.5h10"/><circle cx="6" cy="4.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="10.5" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="11.5" r="1.4" fill="currentColor" stroke="none"/>'),
  search: sv('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>'),
  bell: sv('<path d="M8 2.2a3.6 3.6 0 0 0-3.6 3.6c0 3-1.3 4-1.3 4h9.8s-1.3-1-1.3-4A3.6 3.6 0 0 0 8 2.2z"/><path d="M6.8 12.6a1.3 1.3 0 0 0 2.4 0"/>'),
  chevron: sv('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
  plus: sv('<path d="M8 3.5v9M3.5 8h9"/>'),
  check: sv('<path d="m3 8.5 3.4 3.4L13 5"/>'),
  x: sv('<path d="m4 4 8 8M12 4l-8 8"/>'),
  arrow: sv('<path d="M3 8h10M9.5 4.5 13 8l-3.5 3.5"/>'),
  clock: sv('<circle cx="8" cy="8" r="5.5"/><path d="M8 5.2V8l2 1.4"/>'),
  coin: sv('<circle cx="8" cy="8" r="5.5"/><path d="M8 5.4v5.2M6.4 6.6h3.2M6.4 9.4h3.2"/>'),
  branch: sv('<circle cx="4.5" cy="3.5" r="1.7"/><circle cx="4.5" cy="12.5" r="1.7"/><circle cx="11.5" cy="6" r="1.7"/><path d="M4.5 5.2v5.6M11.5 7.7c0 2.3-2.5 2.7-4.4 3.1"/>'),
  sparkle: sv('<path d="M8 2.5 9.3 6l3.2 1.3L9.3 8.6 8 12.1 6.7 8.6 3.5 7.3 6.7 6z"/>'),
  refresh: sv('<path d="M13.2 8a5.2 5.2 0 1 1-1.5-3.7"/><path d="M13.4 2.6v2.9h-2.9"/>'),
  alert: sv('<path d="M8 2.8 14 12.6H2z"/><path d="M8 6.8v2.6M8 11.2v.1"/>'),
  play: sv('<path d="M5 3.8v8.4L12.4 8z"/>'),
  pause: sv('<path d="M5.5 3.5v9M10.5 3.5v9" stroke-width="2"/>'),
  doc: sv('<path d="M4 2.5h5.5L12.5 5.5v8h-8.5z"/><path d="M9.3 2.7v3h3"/>'),
  flow: sv('<circle cx="4.2" cy="4.2" r="1.7"/><circle cx="11.8" cy="11.8" r="1.7"/><path d="M4.2 5.9v3.3a2.6 2.6 0 0 0 2.6 2.6h3.3"/>'),
};

const AGENTS = {
  'claude-code': { name: 'Claude Code', glyph: 'CC', color: '#b45309', model: 'Claude Sonnet 4.5' },
  'codex': { name: 'Codex', glyph: 'CX', color: '#334155', model: 'GPT-5.1-Codex' },
  'openhands': { name: 'OpenHands', glyph: 'OH', color: '#e11d48', model: 'OpenHands-GLM-4.6' },
  'opencode': { name: 'OpenCode', glyph: 'OC', color: '#7c3aed', model: 'DeepSeek-V4' },
};

const TENANTS = [
  { id: 'trade-core', name: '交易核心团队', short: '交易', glyph: '交', members: 12 },
  { id: 'pay-settle', name: '支付结算团队', short: '支付', glyph: '支', members: 9 },
  { id: 'platform', name: '平台架构团队', short: '平台', glyph: '平', members: 7 },
];

const MEMBERS = {
  'trade-core': [{ name: '秦越', role: '平台管理员' }, { name: '林远', role: '研发' }, { name: '苏晚', role: '研发' }, { name: '陈望', role: '测试' }],
  'pay-settle': [{ name: '周泽', role: '负责人' }, { name: '何青', role: '研发' }, { name: '秦越', role: '平台管理员' }],
  'platform': [{ name: '王启', role: '负责人' }, { name: '李澄', role: 'SRE' }, { name: '秦越', role: '平台管理员' }],
};

const STATUS = { backlog: { label: '积压事项' }, confirming: { label: '确认中' }, todo: { label: '待办事项' }, in_progress: { label: '进行中' }, in_review: { label: '审核中' }, blocked: { label: '已阻塞' }, done: { label: '完成' }, canceled: { label: '已取消' } };
const ME = { name: '秦越', role: '平台管理员' };
const now = Date.now();
const minute = 60 * 1000, hour = 60 * minute, day = 24 * hour;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel) => document.querySelector(sel);
const uidSeq = (() => { let n = 0; return (p) => p + (++n); })();

function timeAgo(ts) {
  const d = Date.now() - ts;
  if (d < minute) return '刚刚';
  if (d < hour) return Math.floor(d / minute) + ' 分钟前';
  if (d < day) return Math.floor(d / hour) + ' 小时前';
  return Math.floor(d / day) + ' 天前';
}
const fmtClock = (ts) => { const t = new Date(ts); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
const fmtFull = (ts) => { const t = new Date(ts); return (t.getMonth() + 1) + '-' + String(t.getDate()).padStart(2, '0') + ' ' + fmtClock(ts); };
const money = (v) => '$' + v.toFixed(2);

function agentChip(id) {
  const a = AGENTS[id];
  if (!a) return '<span class="pill">未派发</span>';
  return '<span class="agent-chip" style="background:' + a.color + '14;color:' + a.color + '"><span class="a-glyph" style="background:' + a.color + '">' + a.glyph + '</span>' + a.name + '</span>';
}
const statusPill = (s) => '<span class="pill status-' + s + '"><span class="p-dot" style="background:currentColor"></span>' + STATUS[s].label + '</span>';
const prioPill = (p) => '<span class="pill prio-' + p + '">' + p + '</span>';
const tagPills = (tags) => tags.map((t) => '<span class="pill tag">' + esc(t) + '</span>').join('');

function mkTask(o) {
  return Object.assign({
    accepted:true, dorReady: !['backlog','confirming','blocked'].includes(o.status), dor: ['backlog','confirming','blocked'].includes(o.status) ? [false,false,false] : [true,true,true], clarifications:[], owner:o.owner || o.by || '秦越', contextConfirmed:true,
    status: 'todo', priority: 'P2', tags: [], repo: 'trade/order-service', branch: null,
    by: '秦越', agent: null, sessionId: null, cost: 0, pr: null, comments: [], activity: [],
  }, o);
}

const taskSeq = {};
function nextTaskId(tenant) {
  const prefix = { 'trade-core': 'ORD', 'pay-settle': 'PAY', 'platform': 'INF' }[tenant];
  if (!taskSeq[tenant]) {
    const nums = state.tasks.filter((t) => t.tenant === tenant).map((t) => parseInt(t.id.split('-')[1], 10));
    taskSeq[tenant] = (nums.length ? Math.max.apply(null, nums) : 1000) + 1;
  }
  return prefix + '-' + taskSeq[tenant]++;
}

const nextWfId = (() => {
  let n = 0;
  return () => {
    if (!n) n = Math.max.apply(null, state.workflows.map((w) => parseInt(w.id.split('-')[1], 10))) + 1;
    return 'WD-' + n++;
  };
})();

const nextAutoId = (() => {
  let n = 0;
  return () => {
    if (!n) n = Math.max.apply(null, state.automations.map((a) => parseInt(a.id.split('-')[1], 10))) + 1;
    return 'AU-' + String(n++).padStart(2, '0');
  };
})();

const state = {
  view: 'dashboard', tenant: 'trade-core', sessStage: 'all', sessSearch: '', sessShowAllStages: false,
  boardQ: '', boardPriority: 'all',
  currentSession: null, drawerTask: null, drawerWf: null,
  auditQ: '', auditAction: 'all',
  sessionSeq: 1046, hintDismissed: false,
  storyContextInjected: false, storyContextApproved: false,
  tasks: [], sessions: [], audits: [], notifs: [], automations: [], workflows: [], costs: {},
};

const tenantTasks = () => state.tasks.filter((t) => t.tenant === state.tenant);
const tenantSessions = () => state.sessions.filter((s) => s.tenant === state.tenant);
const getTask = (id) => state.tasks.find((t) => t.id === id);
const getSession = (id) => state.sessions.find((s) => s.id === id);
const tenantWfs = () => state.workflows.filter((w) => w.tenant === state.tenant);
const getWf = (id) => state.workflows.find((w) => w.id === id);

state.tasks = [
  mkTask({
    id: 'ORD-1855', tenant: 'trade-core', title: '行情推送断线重连优化', priority: 'P1', status: 'todo',
    tags: ['perf', 'gateway'], repo: 'trade/quote-gateway', by: '林远',
    desc: '当前行情网关断线后重连采用固定退避，网络抖动场景下会触发重连风暴（实测 QPS 掉 40%）。\n\n要求：\n· 改为指数退避 + 随机抖动，上限 30s\n· 重连期间降级为快照拉取，避免行情空洞\n· 补充抖动参数的单测',
    comments: [{ by: '林远', text: '压测环境已复现：弱网 2 分钟后 QPS 从 12k 掉到 7.2k', ts: now - 3 * hour }],
    activity: [
      { ts: now - 6 * hour, text: '林远 创建了任务', kind: 'human' },
      { ts: now - 3 * hour, text: '林远 补充了压测数据评论', kind: 'human' },
      { ts: now - 2 * hour, text: '指派范围调整：限定 quote-gateway 仓库', kind: 'human' },
    ],
  }),
  mkTask({
    id: 'ORD-1820', tenant: 'trade-core', title: '库存同步重试逻辑修复', priority: 'P1',
    tags: ['bugfix', 'sync'], repo: 'trade/order-service', by: '苏晚',
    desc: '库存同步在 Kafka 分区重平衡时会丢失重试消息，导致部分 SKU 库存长时间不收敛。',
    comments: [{ by: 'Codex', text: '会话失败：测试环境缺少 KAFKA_BROKER 配置，无法完成单测验证。已回退任务状态，请补齐环境变量后重新派发。', ts: now - 1 * day, agent: true }],
    activity: [
      { ts: now - 2 * day, text: '苏晚 创建了任务', kind: 'human' },
      { ts: now - 1 * day, text: '派发 Codex，会话 S-1033', kind: 'agent' },
      { ts: now - 1 * day + 8 * minute, text: '会话失败，任务回退至待办', kind: 'sys' },
    ],
  }),
  mkTask({
    id: 'ORD-1847', tenant: 'trade-core', title: '对账文件解析性能优化', priority: 'P1',
    tags: ['perf', 'recon'], repo: 'trade/recon-service', by: '苏晚',
    desc: '每日清算对账文件解析耗时 22 分钟（目标 < 8 分钟），大文件场景内存峰值 3.2G。',
    activity: [{ ts: now - 7 * hour, text: '苏晚 创建了任务', kind: 'human' }],
  }),
  mkTask({
    id: 'ORD-1851', tenant: 'trade-core', title: '网关限流规则可视化配置', priority: 'P2',
    tags: ['feature', 'gateway'], repo: 'trade/quote-gateway', by: '林远',
    desc: '限流规则目前靠配置文件 + 发版维护，需要提供可视化配置界面与热更新能力（QPS 阈值、路径维度、白名单）。',
    activity: [{ ts: now - 5 * hour, text: '林远 创建了任务', kind: 'human' }],
  }),
  mkTask({
    id: 'ORD-1839', tenant: 'trade-core', title: '订单状态机异常流转修复', priority: 'P0', status: 'in_review',
    tags: ['bugfix', 'core'], repo: 'trade/order-service', branch: 'agent/ord-1839', by: '秦越',
    agent: 'claude-code', sessionId: 'S-1041', cost: 0.86, pr: 'MR-281',
    desc: '部分订单在「支付中」状态下可被重复触发发货流程，产生重复出库单。\n\n要求：状态机加互斥锁 + 幂等键校验，补充回归单测。',
    comments: [{ by: 'Claude Code', text: '实现完成：增加状态迁移互斥校验与幂等键，单测 48/48 通过。请验收。', ts: now - 4 * hour, agent: true }],
    activity: [
      { ts: now - 5 * hour, text: '秦越 创建了任务', kind: 'human' },
      { ts: now - 4.5 * hour, text: '派发 Claude Code，会话 S-1041', kind: 'agent' },
      { ts: now - 4 * hour, text: '实现完成，提交待验收', kind: 'agent' },
    ],
  }),
  mkTask({
    id: 'ORD-1833', tenant: 'trade-core', title: '交易日志脱敏（合规整改）', priority: 'P1', status: 'in_review',
    tags: ['security', 'compliance'], repo: 'trade/order-service', branch: 'agent/ord-1833', by: '秦越',
    agent: 'codex', sessionId: 'S-1043', cost: 1.24, pr: 'MR-276',
    desc: '审计反馈：交易日志中 11 位手机号与证件号未脱敏。要求对所有日志出口统一脱敏，并补充检测用例。',
    comments: [
      { by: 'Codex', text: '已完成统一脱敏通道，覆盖 3 类敏感字段，回归单测通过。', ts: now - 1 * day, agent: true },
      { by: '秦越', text: '脱敏规则需要对齐合规基线 V2.3，确认下证件号是否覆盖港澳台格式', ts: now - 20 * hour },
    ],
    activity: [
      { ts: now - 1.2 * day, text: '秦越 创建了任务', kind: 'human' },
      { ts: now - 1.1 * day, text: '派发 Codex，会话 S-1043', kind: 'agent' },
      { ts: now - 1 * day, text: '实现完成，提交待验收', kind: 'agent' },
      { ts: now - 20 * hour, text: '秦越 提出合规基线确认意见', kind: 'human' },
    ],
  }),
  mkTask({
    id: 'ORD-1828', tenant: 'trade-core', title: 'SKU 批量导入接口', priority: 'P2', status: 'done',
    tags: ['feature', 'import'], repo: 'trade/order-service', branch: 'agent/ord-1828', by: '林远',
    agent: 'openhands', cost: 0.55, pr: 'MR-259',
    desc: '支持 10 万行 SKU 异步批量导入，返回任务 ID 供轮询进度。',
    comments: [{ by: '秦越', text: '验收通过，压测 12 万行 4m18s，符合预期。', ts: now - 3 * day }],
    activity: [
      { ts: now - 4 * day, text: '林远 创建了任务', kind: 'human' },
      { ts: now - 3.5 * day, text: '派发 OpenHands', kind: 'agent' },
      { ts: now - 3.2 * day, text: '秦越 验收通过', kind: 'pass' },
    ],
  }),
  mkTask({
    id: 'PAY-0724', tenant: 'pay-settle', title: '渠道路由权重热更新', priority: 'P1',
    tags: ['feature', 'routing'], repo: 'pay/payment-core', by: '周泽',
    desc: '渠道路由权重需要支持不重启发版的热更新，变更需审计留痕。',
    activity: [{ ts: now - 4 * hour, text: '周泽 创建了任务', kind: 'human' }],
  }),
  mkTask({
    id: 'PAY-0721', tenant: 'pay-settle', title: '清算批次重跑工具', priority: 'P1',
    tags: ['tooling', 'settle'], repo: 'pay/settlement', by: '何青',
    desc: '清算批次失败后目前需要手工 SQL 修复。提供受控重跑工具：指定批次 ID 重跑、自动对账校验、操作审计。',
    activity: [{ ts: now - 9 * hour, text: '何青 创建了任务', kind: 'human' }],
  }),
  mkTask({
    id: 'PAY-0718', tenant: 'pay-settle', title: '支付回调验签升级 SM2', priority: 'P0', status: 'in_progress',
    tags: ['security', 'protocol'], repo: 'pay/payment-core', branch: 'agent/pay-0718', by: '周泽',
    agent: 'codex', sessionId: 'S-1045',
    desc: '渠道通知验签从 MD5 升级为 SM2，需兼容灰度期双验签。',
    activity: [
      { ts: now - 3 * hour, text: '周泽 创建了任务', kind: 'human' },
      { ts: now - 45 * minute, text: '派发 Codex，会话 S-1045（运行中）', kind: 'agent' },
    ],
  }),
  mkTask({
    id: 'PAY-0712', tenant: 'pay-settle', title: '对账差错自动补偿', priority: 'P1', status: 'in_review',
    tags: ['feature', 'recon'], repo: 'pay/settlement', branch: 'agent/pay-0712', by: '何青',
    agent: 'claude-code', sessionId: 'S-1038', cost: 0.42, pr: 'MR-268',
    desc: '对账差错目前人工补偿，需要自动化补偿流水与差错台账。',
    comments: [{ by: 'Claude Code', text: '补偿流水与台账已实现，含补偿幂等键。请验收。', ts: now - 5 * hour, agent: true }],
    activity: [
      { ts: now - 7 * hour, text: '何青 创建了任务', kind: 'human' },
      { ts: now - 6 * hour, text: '派发 Claude Code，会话 S-1038', kind: 'agent' },
      { ts: now - 5 * hour, text: '实现完成，提交待验收', kind: 'agent' },
    ],
  }),
  mkTask({
    id: 'PAY-0705', tenant: 'pay-settle', title: '结算单导出 xlsx 流式化', priority: 'P2', status: 'done',
    tags: ['perf', 'export'], repo: 'pay/settlement', branch: 'agent/pay-0705', by: '何青',
    agent: 'openhands', cost: 0.38, pr: 'MR-255',
    desc: '大商户结算单导出内存溢出（>800MB），改为流式生成。',
    comments: [{ by: '周泽', text: '验收通过，峰值内存降至 90MB。', ts: now - 5 * day }],
    activity: [
      { ts: now - 6 * day, text: '何青 创建了任务', kind: 'human' },
      { ts: now - 5.5 * day, text: '周泽 验收通过', kind: 'pass' },
    ],
  }),
  mkTask({
    id: 'INF-3304', tenant: 'platform', title: '日志采集 Agent 资源治理', priority: 'P1',
    tags: ['sre', 'cost'], repo: 'platform/infra-operator', by: '李澄',
    desc: '日志采集 DaemonSet 在大节点上 CPU 峰值 4.2 核，需限制并改为自适应采集。',
    activity: [{ ts: now - 6 * hour, text: '李澄 创建了任务', kind: 'human' }],
  }),
  mkTask({
    id: 'INF-3301', tenant: 'platform', title: 'CI 构建缓存策略优化', priority: 'P1',
    tags: ['ci', 'perf'], repo: 'platform/ci-toolchain', by: '王启',
    desc: 'Monorepo 全量构建 34 分钟，目标是基于影响面分析的增量构建（< 10 分钟）。',
    activity: [{ ts: now - 8 * hour, text: '王启 创建了任务', kind: 'human' }],
  }),
  mkTask({
    id: 'INF-3296', tenant: 'platform', title: 'K8s 节点池自动扩缩容', priority: 'P1', status: 'in_review',
    tags: ['sre', 'autoscaling'], repo: 'platform/infra-operator', branch: 'agent/inf-3296', by: '王启',
    agent: 'openhands', sessionId: 'S-1036', cost: 0.77, pr: 'MR-263',
    desc: '业务低峰期节点池缩容滞后 25 分钟，需要基于预测负载的主动扩缩容策略。',
    comments: [{ by: 'OpenHands', text: '已实现基于 7 日负载预测的预缩容策略，dry-run 验证通过。请验收。', ts: now - 2 * day, agent: true }],
    activity: [
      { ts: now - 3 * day, text: '王启 创建了任务', kind: 'human' },
      { ts: now - 2.5 * day, text: '派发 OpenHands，会话 S-1036', kind: 'agent' },
      { ts: now - 2 * day, text: '实现完成，提交待验收', kind: 'agent' },
    ],
  }),
  mkTask({
    id: 'INF-3288', tenant: 'platform', title: '配置中心灰度发布修复', priority: 'P0', status: 'done',
    tags: ['bugfix', 'config'], repo: 'platform/config-center', branch: 'agent/inf-3288', by: '李澄',
    agent: 'claude-code', cost: 0.31, pr: 'MR-247',
    desc: '灰度发布时全量实例收到了新配置，配置监听器未校验灰度标签。',
    comments: [{ by: '王启', text: '验收通过，灰度流量 5% 复现验证无误。', ts: now - 2 * day }],
    activity: [
      { ts: now - 3 * day, text: '李澄 创建了任务', kind: 'human' },
      { ts: now - 2.2 * day, text: '王启 验收通过', kind: 'pass' },
    ],
  }),
];

function diffFor(task) {
  const slug = task.id.toLowerCase();
  if (task.tags.includes('perf')) return {
    file: 'internal/' + (task.tags[0] || 'core') + '/' + slug + '.ts', stats: '+34 −12',
    lines: [
      ['ctx', 'export async function fetchBatch(ids: string[]) {'],
      ['del', '  const results = [];'],
      ['del', '  for (const id of ids) results.push(await fetchOne(id));'],
      ['add', '  const CHUNK = 64;'],
      ['add', '  const tasks = chunks(ids, CHUNK).map(fetchChunk);'],
      ['add', '  const results = (await Promise.all(tasks)).flat();'],
      ['add', '  metrics.observe("batch.size", ids.length);'],
      ['add', '  return dedupe(results);'],
      ['ctx', '}'],
    ],
  };
  if (task.tags.includes('security') || task.tags.includes('compliance')) return {
    file: 'internal/' + task.tags[0] + '/' + slug + '.ts', stats: '+52 −9',
    lines: [
      ['ctx', 'function verifySignature(payload: Buffer, sig: string) {'],
      ['del', '  return md5(payload) === sig;'],
      ['add', '  const algo = process.env.SIGN_ALGORITHM ?? "SM2withSM3";'],
      ['add', '  const digest = sm3(payload);'],
      ['add', '  const cert = loadCert(algo);'],
      ['add', '  return sm2Verify(cert, digest, sig, algo);'],
      ['ctx', '}'],
      ['ctx', ''],
      ['add', 'function maskPII(log: string) {'],
      ['add', '  return log.replace(PHONE_RE, (m) => m.slice(0, 3) + "****" + m.slice(-4));'],
      ['add', '}'],
    ],
  };
  return {
    file: 'internal/' + (task.tags[0] || 'core') + '/' + slug + '.ts', stats: '+42 −8',
    lines: [
      ['ctx', 'import { validate } from "./validator";'],
      ['ctx', ''],
      ['del', '// TODO: 边界处理'],
      ['add', 'export function apply(input: Input): Result {'],
      ['add', '  const normalized = normalize(input);'],
      ['add', '  if (!validate(normalized)) throw new InvalidInputError(input.id);'],
      ['add', '  return { ok: true, data: normalized };'],
      ['add', '}'],
    ],
  };
}

function buildScript(s, phase, reason) {
  const t = getTask(s.taskId);
  const agent = AGENTS[s.agent];
  if (phase === 'revise') {
    const d = diffFor(t);
    return [
      { type: 'user', text: reason || '请根据反馈继续修改', delay: 500 },
      { type: 'think', text: '收到反馈，重新分析调整点：「' + (reason || '评审意见').slice(0, 60) + '」', delay: 1000 },
      { type: 'term', cmd: '检查任务相关变更', out: '已根据任务反馈更新演示变更', exit: 0, delay: 900 },
      { type: 'think', text: '按反馈调整实现与测试用例…', delay: 1100 },
      { type: 'diff', file: d.file, stats: '+17 −6', lines: d.lines.slice(3, 11), delay: 1300 },
      { type: 'term', cmd: '执行任务约定的验证', out: '验证完成（模拟结果，实际检查项由任务契约决定）', exit: 0, delay: 1200 },
      { type: 'summary', text: '已按反馈更新演示变更。实际实现、验证结果和交付方式以团队确认的任务契约为准。', pr: t.pr || null, delay: 1100 },
      { type: 'done', delay: 600 },
    ];
  }
  const d = diffFor(t);
  return [
    { type: 'system', text: '会话已创建 · ' + agent.name + ' · 仓库 ' + t.repo + ' · 分支 agent/' + t.id.toLowerCase(), delay: 550 },
    { type: 'think', text: '读取任务 ' + t.id + '「' + t.title + '」，加载仓库 AGENTS.md 与编码规范…', delay: 1100 },
    { type: 'term', cmd: 'git checkout -b agent/' + t.id.toLowerCase(), out: "Switched to a new branch 'agent/" + t.id.toLowerCase() + "'", exit: 0, delay: 900 },
    { type: 'think', text: '定位相关模块（' + t.tags.join(' / ') + '），梳理调用链与既有测试…', delay: 1200 },
    { type: 'term', cmd: '检查任务相关变更', out: '发现需进一步确认的内容', exit: 1, delay: 1350 },
    { type: 'diff', file: d.file, stats: d.stats, lines: d.lines, delay: 1400 },
    { type: 'think', text: '实现核心变更，补充边界条件单测…', delay: 1150 },
    { type: 'term', cmd: '执行任务约定的验证', out: '验证完成（模拟结果，实际检查项由任务契约决定）', exit: 0, delay: 1250 },
    { type: 'summary', text: '变更摘要：\n· ' + t.title + ' 已完成演示实现（' + d.stats + '）\n· 验证过程仅为界面演示，真实检查项和结果以项目为准', pr: t.pr, delay: 1150 },
    { type: 'done', delay: 650 },
  ];
}

function histEvents(taskId, agentId) {
  return buildScript({ taskId: taskId, agent: agentId }, 'initial')
    .filter((e) => e.type !== 'done')
    .map((e) => Object.assign({}, e));
}

state.sessions = [
  { id: 'S-1045', taskId: 'PAY-0718', tenant: 'pay-settle', agent: 'codex', status: 'running', startedAt: now - 45 * minute, cost: 0.18, current: '分析支付回调验签调用链…', events: [
    { type: 'system', text: '会话已创建 · Codex · 仓库 pay/payment-core · 分支 agent/pay-0718' },
    { type: 'think', text: '读取任务 PAY-0718「支付回调验签升级 SM2」，加载渠道协议文档…' },
    { type: 'term', cmd: 'rg "function verify" src/ -n', out: 'src/callback/verify.ts:14\nsrc/callback/legacy.ts:41\nsrc/gateway/sign.ts:88', exit: 0 },
    { type: 'think', text: '梳理双验签兼容路径，确认灰度开关位置…' },
  ] },
  { id: 'S-1041', taskId: 'ORD-1839', tenant: 'trade-core', agent: 'claude-code', status: 'completed', startedAt: now - 5 * hour, endedAt: now - 4 * hour, cost: 0.86, current: '已完成', events: histEvents('ORD-1839', 'claude-code') },
  { id: 'S-1043', taskId: 'ORD-1833', tenant: 'trade-core', agent: 'codex', status: 'completed', startedAt: now - 1.1 * day, endedAt: now - 1 * day, cost: 1.24, current: '已完成', events: histEvents('ORD-1833', 'codex') },
  { id: 'S-1038', taskId: 'PAY-0712', tenant: 'pay-settle', agent: 'claude-code', status: 'completed', startedAt: now - 6 * hour, endedAt: now - 5 * hour, cost: 0.42, current: '已完成', events: histEvents('PAY-0712', 'claude-code') },
  { id: 'S-1036', taskId: 'INF-3296', tenant: 'platform', agent: 'openhands', status: 'completed', startedAt: now - 2.5 * day, endedAt: now - 2 * day, cost: 0.77, current: '已完成', events: histEvents('INF-3296', 'openhands') },
  { id: 'S-1033', taskId: 'ORD-1820', tenant: 'trade-core', agent: 'codex', status: 'failed', startedAt: now - 1 * day, endedAt: now - 1 * day + 8 * minute, cost: 0.31, current: '失败', events: [
    { type: 'system', text: '会话已创建 · Codex · 仓库 trade/order-service' },
    { type: 'think', text: '读取任务 ORD-1820「库存同步重试逻辑修复」，定位 consumer 重试逻辑…' },
    { type: 'term', cmd: 'npm test -- --run test/sync.spec.ts', out: 'Error: KAFKA_BROKER env is required', exit: 1 },
    { type: 'error', text: '会话失败：测试环境缺少 KAFKA_BROKER 配置，无法完成单测验证。任务已回退至待办状态。' },
  ] },
];

state.audits = [
  { ts: now - 45 * minute, tenant: 'pay-settle', actor: { type: 'agent', id: 'codex', name: 'Codex' }, action: 'session.start', object: { type: 'task', id: 'PAY-0718' }, session: 'S-1045', trace: 'lf_9123', detail: '派发来源：任务板手动派发' },
  { ts: now - 3 * hour, tenant: 'trade-core', actor: { type: 'human', id: 'linyuan', name: '林远' }, action: 'task.create', object: { type: 'task', id: 'ORD-1855' }, detail: '创建任务「行情推送断线重连优化」' },
  { ts: now - 4 * hour, tenant: 'trade-core', actor: { type: 'agent', id: 'claude-code', name: 'Claude Code' }, action: 'session.complete', object: { type: 'task', id: 'ORD-1839' }, session: 'S-1041', trace: 'lf_88c2', detail: '产出 MR-281，成本 $0.86' },
  { ts: now - 4 * hour + 2 * minute, tenant: 'trade-core', actor: { type: 'system', id: 'dispatcher', name: '派发器' }, action: 'task.status_change', object: { type: 'task', id: 'ORD-1839' }, session: 'S-1041', detail: 'in_progress → in_review（等待人工验收）' },
  { ts: now - 5 * hour, tenant: 'pay-settle', actor: { type: 'agent', id: 'claude-code', name: 'Claude Code' }, action: 'session.complete', object: { type: 'task', id: 'PAY-0712' }, session: 'S-1038', trace: 'lf_7731', detail: '产出 MR-268，成本 $0.42' },
  { ts: now - 20 * hour, tenant: 'trade-core', actor: { type: 'human', id: 'qinyue', name: '秦越' }, action: 'comment.add', object: { type: 'task', id: 'ORD-1833' }, detail: '提出合规基线 V2.3 确认意见' },
  { ts: now - 1 * day, tenant: 'trade-core', actor: { type: 'system', id: 'dispatcher', name: '派发器' }, action: 'task.status_change', object: { type: 'task', id: 'ORD-1820' }, session: 'S-1033', detail: 'in_progress → todo（会话失败回退）' },
  { ts: now - 1 * day + 8 * minute, tenant: 'trade-core', actor: { type: 'agent', id: 'codex', name: 'Codex' }, action: 'session.failed', object: { type: 'task', id: 'ORD-1820' }, session: 'S-1033', trace: 'lf_6650', detail: '环境缺少 KAFKA_BROKER 配置' },
  { ts: now - 1 * day, tenant: 'platform', actor: { type: 'system', id: 'litellm', name: 'LiteLLM' }, action: 'budget.warn', object: { type: 'tenant', id: 'platform' }, detail: '平台架构团队本月预算使用达 82%' },
  { ts: now - 2 * day, tenant: 'platform', actor: { type: 'human', id: 'wangqi', name: '王启' }, action: 'approval.grant', object: { type: 'task', id: 'INF-3288' }, session: 'S-1030', detail: '验收通过，灰度 5% 复现验证无误' },
  { ts: now - 2 * day, tenant: 'platform', actor: { type: 'agent', id: 'openhands', name: 'OpenHands' }, action: 'session.complete', object: { type: 'task', id: 'INF-3296' }, session: 'S-1036', trace: 'lf_5518', detail: '产出 MR-263，成本 $0.77' },
  { ts: now - 6 * day, tenant: 'pay-settle', actor: { type: 'human', id: 'zhouze', name: '周泽' }, action: 'approval.grant', object: { type: 'task', id: 'PAY-0705' }, detail: '验收通过，峰值内存降至 90MB' },
];

state.notifs = [
  { id: uidSeq('n'), tenant: 'trade-core', taskId: 'ORD-1839', text: 'Claude Code 已完成「订单状态机异常流转修复」，等待验收', ts: now - 4 * hour, unread: true, kind: 'review' },
  { id: uidSeq('n'), tenant: 'trade-core', taskId: 'ORD-1833', text: 'Codex 已完成「交易日志脱敏」，等待验收', ts: now - 1 * day, unread: true, kind: 'review' },
  { id: uidSeq('n'), tenant: 'pay-settle', taskId: 'PAY-0712', text: 'Claude Code 已完成「对账差错自动补偿」，等待验收', ts: now - 5 * hour, unread: true, kind: 'review' },
  { id: uidSeq('n'), tenant: 'platform', taskId: 'INF-3296', text: 'OpenHands 已完成「K8s 节点池自动扩缩容」，等待验收', ts: now - 2 * day, unread: true, kind: 'review' },
  { id: uidSeq('n'), tenant: 'platform', taskId: null, text: '平台架构团队本月预算使用达 82%，请关注', ts: now - 1 * day, unread: false, kind: 'budget' },
];

state.automations = [
  { id: 'AU-01', tenant: 'trade-core', name: 'GitHub issue 自动派发', trigger: 'github', triggerText: 'issue 携带 ai-agent 标签', action: '创建任务并派发 Claude Code', agent: 'claude-code', enabled: true, runs: 34, okRate: 94, last: now - 2 * hour },
  { id: 'AU-02', tenant: 'trade-core', name: '每日逾期任务扫描', trigger: 'schedule', triggerText: '每天 09:30', action: '汇总逾期任务并推送企微提醒', agent: null, enabled: true, runs: 12, okRate: 100, last: now - 9 * hour },
  { id: 'AU-03', tenant: 'trade-core', name: 'CI 失败自动诊断', trigger: 'webhook', triggerText: 'pipeline.failed 事件', action: '启动 Codex 分析日志并评论 MR', agent: 'codex', enabled: true, runs: 8, okRate: 88, last: now - 1 * day },
  { id: 'AU-04', tenant: 'pay-settle', name: '值班问答机器人', trigger: 'slack', triggerText: '#pay-ops 频道 @值班Agent', action: 'OpenHands 检索知识库并回复', agent: 'openhands', enabled: false, runs: 21, okRate: 81, last: now - 3 * day },
  { id: 'AU-05', tenant: 'trade-core', name: '周五周报生成', trigger: 'schedule', triggerText: '每周五 17:00', action: '汇总本周任务与成本生成周报草稿', agent: null, enabled: true, runs: 3, okRate: 100, last: now - 5 * day },
];

state.workflows = [
  {
    id: 'WD-2041', tenant: 'trade-core', name: '上线发布：ORD-1855 行情推送断线重连优化',
    type: 'ReleaseWorkflow', wfVersion: 'v1.4', runId: 'a3f9c2e1',
    status: 'waiting', startedAt: now - 26 * hour, endedAt: null,
    taskId: 'ORD-1855', sessionId: null,
    steps: ['收集验收证据', '构建镜像', '发布审批', '部署预发', '冒烟测试', '部署生产'],
    stepIndex: 2,
    history: [
      { ts: now - 26 * hour, kind: 'started', name: 'WorkflowExecutionStarted', detail: 'ReleaseWorkflow v1.4 · 触发源：任务 ORD-1855 人验收通过（自动签发）' },
      { ts: now - 25.8 * hour, kind: 'activity', name: 'Activity: 收集验收证据', detail: '变更 diff + 单测记录 + 关联 MR 归档（1.2s）' },
      { ts: now - 25.6 * hour, kind: 'activity', name: 'Activity: 构建镜像', detail: 'registry/quote-gateway:2.1.7-rc1 构建并推送（4m12s）' },
      { ts: now - 25.5 * hour, kind: 'wait', name: '等待 Signal · approve-release', detail: '已等待 25 小时 · 超时 72 小时自动提醒（未触发）' },
    ],
  },
  {
    id: 'WD-2039', tenant: 'trade-core', name: '需求全流程：ORD-1839 订单状态机异常流转修复',
    type: 'FeatureWorkflow', wfVersion: 'v2.1', runId: '77bd0e4a',
    status: 'running', startedAt: now - 4.25 * day, endedAt: null,
    taskId: 'ORD-1839', sessionId: 'S-1041',
    steps: ['需求分析', '方案设计', '编码实现', 'CI 回归测试', '人工验收', '合并入主干', '灰度观察 7 天'],
    stepIndex: 3,
    history: [
      { ts: now - 4.25 * day, kind: 'started', name: 'WorkflowExecutionStarted', detail: 'FeatureWorkflow v2.1 · 触发源：需求评审通过' },
      { ts: now - 4 * day, kind: 'activity', name: 'Activity: 需求分析', detail: '产出影响面清单（3 模块 / 6 调用方）' },
      { ts: now - 3.5 * day, kind: 'activity', name: 'Activity: 方案设计', detail: '状态机互斥 + 幂等键方案评审通过' },
      { ts: now - 5 * hour, kind: 'activity', name: 'Activity: 编码实现', detail: '会话 S-1041 完成（Claude Code · 成本 $0.86）· 产出 MR-281' },
      { ts: now - 3 * hour, kind: 'activity', name: 'Activity: CI 回归测试', detail: '进行中 · 用例 182/240（已运行 5m32s）' },
    ],
  },
  {
    id: 'WD-2038', tenant: 'trade-core', name: '版本发布：config-center v2.4 灰度',
    type: 'DeployWorkflow', wfVersion: 'v1.2', runId: 'c91d55f0',
    status: 'running', startedAt: now - 2.5 * hour, endedAt: null,
    taskId: null, sessionId: null,
    steps: ['构建', '部署灰度 10%', '指标观测', '部署生产', '清理'],
    stepIndex: 1,
    history: [
      { ts: now - 2.5 * hour, kind: 'started', name: 'WorkflowExecutionStarted', detail: 'DeployWorkflow v1.2 · 触发源：发布窗口（定时）' },
      { ts: now - 2.2 * hour, kind: 'activity', name: 'Activity: 构建', detail: 'platform/config-center:2.4.0 构建完成' },
      { ts: now - 1.5 * hour, kind: 'retry', name: 'Activity 失败 → 重试（attempt 1/3）', detail: '部署灰度探针超时 · 退避 20s 后自动重试（策略：指数退避）' },
      { ts: now - 1.4 * hour, kind: 'activity', name: 'Activity: 部署灰度 10%（attempt 2）', detail: '进行中 · 2/20 实例完成' },
    ],
  },
  {
    id: 'WD-2036', tenant: 'trade-core', name: '每日对账巡检',
    type: 'ReconWorkflow', wfVersion: 'v1.0', runId: 'f2a0b7c3',
    status: 'completed', startedAt: now - 3.4 * hour, endedAt: now - 2.98 * hour,
    taskId: null, sessionId: null,
    steps: ['拉取对账文件', '差异核验', '生成差异台账', '通知'],
    stepIndex: 4,
    history: [
      { ts: now - 3.4 * hour, kind: 'started', name: 'WorkflowExecutionStarted', detail: 'ReconWorkflow v1.0 · 触发源：定时任务「每日 05:00」' },
      { ts: now - 3.3 * hour, kind: 'activity', name: 'Activity: 拉取对账文件', detail: 'chinapay / unionpay 共 4 份（加载 96MB）' },
      { ts: now - 3.1 * hour, kind: 'activity', name: 'Activity: 差异核验', detail: '差异 3 笔（低于阈值 10），无需人工介入' },
      { ts: now - 3 * hour, kind: 'activity', name: 'Activity: 生成差异台账', detail: '台账 #R-20931 已归档' },
      { ts: now - 2.98 * hour, kind: 'completed', name: 'WorkflowExecutionCompleted', detail: '耗时 24m · 事件历史 11 条 · 可回放' },
    ],
  },
  {
    id: 'WD-2033', tenant: 'trade-core', name: '故障修复：KAFKA 消费积压（含补偿）',
    type: 'IncidentWorkflow', wfVersion: 'v1.1', runId: 'd8e1f209',
    status: 'failed', startedAt: now - 2 * day, endedAt: now - 2 * day + 42 * minute,
    taskId: 'ORD-1820', sessionId: 'S-1033',
    steps: ['扩容消费者', '重启消费组', '积压核对', '上报'],
    stepIndex: 1,
    history: [
      { ts: now - 2 * day, kind: 'started', name: 'WorkflowExecutionStarted', detail: 'IncidentWorkflow v1.1 · 触发源：告警「消费积压 > 50w」' },
      { ts: now - 2 * day + 10 * minute, kind: 'activity', name: 'Activity: 扩容消费者', detail: '副本 6 → 12 完成' },
      { ts: now - 2 * day + 22 * minute, kind: 'retry', name: 'Activity 失败 → 重试（attempt 1/3）', detail: '消费组重启超时 · 退避 30s' },
      { ts: now - 2 * day + 30 * minute, kind: 'failed', name: 'Activity 持续失败', detail: '消费组状态异常（rebalance 卡死）· 重试耗尽' },
      { ts: now - 2 * day + 38 * minute, kind: 'compensation', name: 'CompensateActivity: 回滚扩容', detail: '副本恢复 12 → 6 · 根因：KAFKA_BROKER 配置缺失' },
      { ts: now - 2 * day + 42 * minute, kind: 'failed', name: 'WorkflowExecutionFailed（已补偿）', detail: '系统已恢复原状，无残留变更 · 已转人工处理' },
    ],
  },
  {
    id: 'WD-2031', tenant: 'pay-settle', name: '上线发布：PAY-0718 支付回调验签升级 SM2',
    type: 'ReleaseWorkflow', wfVersion: 'v1.4', runId: 'b5c6d708',
    status: 'waiting', startedAt: now - 9 * hour, endedAt: null,
    taskId: 'PAY-0718', sessionId: 'S-1045',
    steps: ['收集验收证据', '构建镜像', '发布审批', '部署预发', '冒烟测试', '部署生产'],
    stepIndex: 2,
    history: [
      { ts: now - 9 * hour, kind: 'started', name: 'WorkflowExecutionStarted', detail: 'ReleaseWorkflow v1.4 · 触发源：任务 PAY-0718 编码完成' },
      { ts: now - 8.6 * hour, kind: 'activity', name: 'Activity: 收集验收证据', detail: '灰度双验签兼容性报告归档' },
      { ts: now - 8.4 * hour, kind: 'activity', name: 'Activity: 构建镜像', detail: 'registry/payment-core:3.2.0-rc2 构建并推送' },
      { ts: now - 8.3 * hour, kind: 'wait', name: '等待 Signal · approve-release', detail: '已等待 8 小时 · 超时 72 小时自动提醒（未触发）' },
    ],
  },
  {
    id: 'WD-2027', tenant: 'pay-settle', name: '资金归集日终流程（跨天）',
    type: 'SettlementWorkflow', wfVersion: 'v3.0', runId: 'e0f1a2b3',
    status: 'running', startedAt: now - 19 * hour, endedAt: null,
    taskId: null, sessionId: null,
    steps: ['清算文件生成', '银行渠道分发', '回执核对', '差错补偿', '日终归档'],
    stepIndex: 2,
    history: [
      { ts: now - 19 * hour, kind: 'started', name: 'WorkflowExecutionStarted', detail: 'SettlementWorkflow v3.0 · 触发源：定时任务「工作日 22:00」' },
      { ts: now - 18.5 * hour, kind: 'activity', name: 'Activity: 清算文件生成', detail: '批次 B-20261016 共 12 文件（2.1GB）' },
      { ts: now - 18 * hour, kind: 'wait', name: '等待 Signal · bank-ack', detail: '银行渠道回执到达后由外部系统发送唤醒信号（已等待 18 小时）' },
      { ts: now - 2 * hour, kind: 'signal', name: 'SignalReceived · bank-ack', detail: '渠道回执到达（外部系统自动信号，非人工）· 流程继续' },
      { ts: now - 1.8 * hour, kind: 'activity', name: 'Activity: 回执核对', detail: '进行中 · 已核对 9/12 文件' },
    ],
  },
  {
    id: 'WD-2022', tenant: 'platform', name: '证书轮换巡检（Cron Schedule）',
    type: 'CertRotationWorkflow', wfVersion: 'v1.0', runId: 'a1b2c3d4',
    status: 'completed', startedAt: now - 1.2 * day, endedAt: now - 1.1 * day,
    taskId: null, sessionId: null,
    steps: ['扫描到期证书', '预演轮换', '执行轮换', '验证'],
    stepIndex: 4,
    history: [
      { ts: now - 1.2 * day, kind: 'started', name: 'WorkflowExecutionStarted', detail: 'CertRotationWorkflow v1.0 · 触发源：定时任务「每日 03:00」' },
      { ts: now - 1.18 * day, kind: 'activity', name: 'Activity: 扫描到期证书', detail: '30 天内到期 2 张（网关 / 内部 CA 各 1）' },
      { ts: now - 1.15 * day, kind: 'activity', name: 'Activity: 预演轮换', detail: 'staging 预演通过' },
      { ts: now - 1.12 * day, kind: 'activity', name: 'Activity: 执行轮换 + 验证', detail: '2 张证书轮换完成 · 握手验证通过' },
      { ts: now - 1.1 * day, kind: 'completed', name: 'WorkflowExecutionCompleted', detail: '下次巡检：明日 03:00（定时任务自动）' },
    ],
  },
];

state.costs = {
  'trade-core': {
    monthBudget: 900,
    sessions: 214,
    daily: [42, 55, 38, 61, 47, 52, 30, 44, 58, 66, 49, 71, 63, 57],
    byModel: [
      { name: 'Claude Sonnet 4.5', cost: 182.4 },
      { name: 'GPT-5.1-Codex', cost: 96.1 },
      { name: 'OpenHands-GLM-4.6', cost: 34.5 },
      { name: 'DeepSeek-V4', cost: 12.8 },
    ],
    byMember: [
      { name: '秦越', cost: 121.4, limit: 200 },
      { name: '林远', cost: 88.2, limit: 200 },
      { name: '苏晚', cost: 61.7, limit: 150 },
      { name: '陈望', cost: 43.9, limit: 150 },
    ],
  },
  'pay-settle': {
    monthBudget: 700,
    sessions: 168,
    daily: [28, 33, 41, 26, 38, 44, 51, 36, 29, 47, 42, 55, 48, 39],
    byModel: [
      { name: 'GPT-5.1-Codex', cost: 141.2 },
      { name: 'Claude Sonnet 4.5', cost: 87.5 },
      { name: 'DeepSeek-V4', cost: 9.4 },
    ],
    byMember: [
      { name: '周泽', cost: 96.4, limit: 200 },
      { name: '何青', cost: 87.1, limit: 200 },
    ],
  },
  'platform': {
    monthBudget: 500,
    sessions: 129,
    daily: [18, 24, 21, 29, 33, 27, 31, 36, 41, 38, 44, 52, 49, 58],
    byModel: [
      { name: 'OpenHands-GLM-4.6', cost: 118.3 },
      { name: 'Claude Sonnet 4.5', cost: 66.2 },
      { name: 'GPT-5.1-Codex', cost: 41.8 },
    ],
    byMember: [
      { name: '王启', cost: 95.3, limit: 150 },
      { name: '李澄', cost: 88.6, limit: 150 },
    ],
  },
};

const NAV = [
  { id: 'dashboard', name: '工作台', icon: 'grid' },
  { id: 'board', name: '任务板', icon: 'board' },
  { id: 'sessions', name: '会话台', icon: 'chat' },
  { id: 'automations', name: '自动化', icon: 'zap' },
  { id: 'costs', name: '成本治理', icon: 'chart' },
  { id: 'audit', name: '审计中心', icon: 'shield' },
  { id: 'settings', name: '接入设置', icon: 'gear' },
];

const ACTION_TEXT = {
  'session.start': '启动会话',
  'session.complete': '会话完成',
  'session.failed': '会话失败',
  'task.create': '创建任务',
  'task.status_change': '任务状态变更',
  'comment.add': '添加评论',
  'approval.grant': '验收通过',
  'approval.reject': '打回重做',
  'budget.warn': '预算预警',
  'workflow.signal': '流程放行',
  'workflow.start': '流程启动',
  'automation.create': '自动化创建',
};
const actionText = (a) => ACTION_TEXT[a.action] || a.action;
