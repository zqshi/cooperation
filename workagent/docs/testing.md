# 测试与验证

在 WorkAgent 根目录运行，环境要求和开发启动见 [README](../README.md)。不要把历史测试数量或截图当作当前通过证明。

## 工程检查

```sh
pnpm install --frozen-lockfile
node scripts/check-boundaries.mjs
pnpm typecheck
pnpm build
pnpm audit --audit-level=high
```

边界脚本检查两个前端、固定端口、包身份、环境配置及跨应用源码导入。build 包含类型检查并构建前端，后端仍由 tsx 运行。

## 数据库与浏览器回归

使用专用 PostgreSQL 16 + pgvector 数据库，测试账号需要 CREATE SCHEMA 和安装所需扩展的权限。禁止指向客户或其他项目数据库。将 `TEST_DATABASE_URL` 设置为该隔离库连接串；可设置 `ENV_FILE` 为不存在的临时文件，避免自动读取开发配置。

```sh
TEST_PGVECTOR=1 pnpm test
pnpm exec playwright install chromium
pnpm test:browser
```

必须保留同一 shell 中的 `TEST_DATABASE_URL`。测试在随机 schema 内应用实际迁移并清理；pgcrypto/vector 扩展位于 public，扩展安装有锁。缺少数据库不是跳过成功。浏览器服务启动真实 API 与前端预览，占用 16100/16173/16174，不复用已有服务。

API/核心测试覆盖企业与平台会话、跨企业/显式项目授权、任务版本与独立验收、队列恢复/不确定工具调用、知识与存储、渠道签名、生产配置、个人资源所有权、调度和默认项目隐私。HTTP 模型/embedding 协议固定服务只证明客户端路径，不证明供应商实网兼容。

`tests/browser/` 保留登录、私人开通与编辑、自动化、项目任务/尝试/产物/审批、独立验收、默认项目及响应式导航回归。部分业务输出由隔离 schema 中的合成记录提供，不代表真实模型成功。

## 生成物与人工检查

截图统一写入忽略目录 `test-results/evidence/`；Playwright 报告、trace 和本地日志不进入公共文档。`node scripts/verify-experience.mjs` 对已运行的本地开发页面做只读页面检查，使用开发 seed 配置，不发送供应商消息；其端口假设需与本机服务一致。保留脚本与测试，不长期保存逐次验收截图或日志。

文档变更检查本地 Markdown 链接、过期术语和私有路径，并运行 `git diff --check`。行为变更按影响运行相关测试，不将未执行检查写成通过。

CI 配置位于 `.github/workflows/`，包含工程、数据库、浏览器及镜像检查；应查看真实托管运行结果。目标环境发布与恢复门槛见 [operations](operations.md)，本地固定服务和截图不替代这些门槛。
