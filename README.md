# Tandem（协动）· 人机协同研发平台 — 方案沉淀与原型

部门技术团队内部生产落地方案的调研沉淀 + 高保真可交互原型。

**正式入口：**

- 产品方案：`docs/01-产品方案-Tandem人机协同研发平台.md`
- 技术设计：`docs/02-技术设计-Tandem平台.md`
- 用户场景故事：`docs/03-用户场景故事-一次结算规则变更.md`（信号澄清与团队协作）
- 用户故事演示：`prototype/index.html?view=board&tenant=pay-settle&task=PAY-2048`（任务板积压卡与协作面板）
- 设计原点：`docs/00-项目定位-核心目标与一等公民.md`

评审和实施以以上文档为准，架构图和流程时序图作为配套附录。

## 目录

```
cooperation/
├── README.md
├── docs/
│   ├── 00-项目定位-核心目标与一等公民.md      # 设计原点
│   ├── 01-产品方案-Tandem人机协同研发平台.md  # 正式产品方案
│   ├── 02-技术设计-Tandem平台.md              # 正式技术设计
│   ├── 03-用户场景故事-一次结算规则变更.md   # 团队协同场景
│   ├── 05-产品架构图.md                       # 架构附录
│   └── 06-流程时序图.md                       # 流程附录
└── prototype/
    ├── index.html      # 打开即用（推荐本地起服务，见下）
    ├── styles.css      # 设计系统（暗色导航 + 亮色内容区）
    ├── data.js         # 演示数据与通用任务执行脚本
    ├── views.js        # 7 个产品视图（协同故事在任务面板内演练）
    ├── engine.js       # 模拟执行引擎（派发→执行→待验收→人验收）+ 交互（抽屉/拖拽/深链/流程放行）
    └── smoke-test.html # 端到端回归测试（见下）
```

> 图表：`docs/05-产品架构图.md`（全景/分层/域模型/部署）、`docs/06-流程时序图.md`（核心时序）。图表是附录，不承载独立产品或技术决策。

## 方案一句话

**任务是唯一一等公民，上下文是一等服务。** 开源组件负责任务与执行，自研 Context（一等）与 Artifact（支撑）服务负责上下文复利，接入薄层负责受理与治理：

- **任务源**：dashi-taskboard（Apache-2.0）——任务板 + `in_review` 人验收门
- **执行面**：OpenHands Agent Canvas（MIT, 91k★）——ACP 多 Agent（Claude Code / Codex / OpenHands / OpenCode）、Automations
- **上下文服务（自研一等服务）**：任务拉取型项目记忆——分层、治理、检索、注入、命中度量
- **产物服务（自研支撑服务）**：可引用资料的登记、摘要、索引与引用；代码仍在 Git
- **接入薄层**：信号接入/受理（生成积压卡 → 待办）+ 调度/回写 + SSO + 审计聚合 + 通知
- **治理**：oauth2-proxy（SSO）+ 按团队多实例（租户隔离）+ LiteLLM（预算）+ Langfuse（成本/trace）
- **编排**：Phase 1 用 Automations；Phase 2 引入 Temporal
- **执行侧流程**：项目容器 + DoR/验收双门 + 拉取式认领（原子租约）+ 调度器，详见 `docs/03`
- **双回路**：任务回路回答"这次交付是否成立"；上下文回路回答"下次是否更容易成立"
- 评估口径：历史材料中的 78% 仅覆盖任务/执行/治理/自动化，不能代表完整平台；当前方案要求 Phase 0 重新核验版本、许可证、能力与工期。

## 原型体验（覆盖完整闭环）

原型为**零依赖静态页面**（原生 HTML/CSS/JS，无需构建），打开方式任选：

```bash
# 方式一：本地起服务（推荐）
cd prototype && python3 -m http.server 8080
# 浏览器访问 http://localhost:8080

# 方式二：直接双击 index.html（file:// 亦可运行）
```

### 建议体验路径（5 分钟）

1. **任务驱动协作**：打开 `index.html?view=board&tenant=pay-settle`，点击业务信号横幅生成 PAY-2048 积压卡。按林琳受理、团队在卡片内提出并答复澄清、周明确认任务契约与上下文后派发、陈工验收的职责完成演练；澄清未答复时任务不能进入待办或执行。具体业务规则与验证项由演练者现场填写。
2. **工作台**：查看待验收聚焦区与全局指标
3. **任务板**：点待办任务卡 → 详情抽屉 →「派发给 Agent」（选 Claude Code / Codex / OpenHands）
4. **会话台**：自动生成会话并模拟执行（终端输出 / 文件 diff / 测试结果），期间观察进度
5. **回到任务板**：任务已自动进入「待验收」（Agent 只能推到这一步）
6. **人验收**：详情抽屉里「通过验收 → 已完成」或「打回」；观察顶部通知铃铛变化
7. **审计中心**：查看刚才全链路的审计事件（人与 Agent 动作、关联会话 ID）
8. **成本治理**：会话产生的模型成本按人/任务/模型归因
9. **自动化**：页内「工作流实例」点开「等待人审」的流程（如 WD-2041）→ 抽屉查看事件历史 → 「审批通过 · 放行流程」→ 流程续跑并完成，审计中心可回看流程放行留痕；右上「新建触发规则 / 新建工作流」均可直接创建（模板 + 关联任务）
10. 附加：任务板支持积压、待办、进行中、审核中、已阻塞、完成、已取消七态；可在详情选择合法状态，或拖拽任务卡跨列、切换租户（顶部团队切换器）、触发规则开关、会话事件里的「打开 MR」快照、接入设置里测试 Agent 连接

角色切换为单浏览器协同模拟；当前原型不连接真实多人服务，刷新页面会恢复演示数据。

### 深链参数（便于评审时直达页面）

```
index.html?view=dashboard|board|sessions|automations|costs|audit|settings
index.html?tenant=trade-core|pay-settle|platform     # 切换租户
index.html?session=S-1041                            # 直开会话详情
index.html?task=ORD-1855                             # 直开任务抽屉（可叠加 &session=）
index.html?wf=WD-2041                                # 直开流程抽屉（事件历史 / 审批放行）
# 示例：index.html?view=board&task=ORD-1855
# 场景：index.html?view=board&tenant=pay-settle&task=PAY-2048（自动生成信号积压卡并打开任务面板）
```

### 端到端回归测试（smoke-test.html）

无头验证核心闭环：派发 → 执行流转 → 自动 `in_review` → 成本归因 → 审计 +3 → 通知 +1 → 人验收 → `done`；流程放行续跑（历史 +4 / 审计 +1）；新建工作流入列（审计 +1）；验收阶段防重复派发（无派发入口 + 派发被拦截）；MR 弹窗含关联任务；新建触发规则（触发方式↔配置区联动 + 组合配置创建）。

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --disable-gpu --virtual-time-budget=30000 \
  --dump-dom "file://$PWD/prototype/smoke-test.html" | grep -o 'data-smoke="[^"]*"'
# 期望输出 20 个 "PASS"
```

### 原型中的映射标注

- 侧边栏底部「组件状态」与页头标签标注了每页形态的开源来源（dashi / OpenHands / Langfuse…）
- P1 工作台、P6 审计中心为接入薄层**只读视图**（不构成任务门户）
- P9 执行仪表、P10 上下文健康、P11 产物索引为后续视图，随 Context/Artifact 服务上线补齐
- 所有数据为前端 mock，交互逻辑按《02-技术设计》的真实集成语义实现（如状态映射表、验收门铁律、审计事件 Schema）；上下文注入与产物沉淀暂以数据字段示意
