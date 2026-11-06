import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Button, Card, Modal } from "@workagent/ui";

import type { PersonalState } from "../lib/personal.js";
import { ProfileForm } from "./ProfileForm.js";
import { PersonalExecutionModal } from "../components/PersonalExecutionModal.js";

const glyphs = { spark: "✦", leaf: "❧", star: "★", sun: "☀" };
export function PersonalPage({ state }: { state: PersonalState }) {
  const cache = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(false);
  const navigate = useNavigate();
  const agent = state.agent;
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-slate-500">我的搭档 · 个人 Agent</p>
        <h1 className="mt-2 text-3xl font-semibold">
          {agent ? "我的搭档" : "认识你的工作搭档"}
        </h1>
        <p className="mt-3 text-sm text-slate-500">
          只属于你的工作职责与偏好。直接从网页开始工作，在运行管理查看额外渠道。
        </p>
      </div>
      {agent && (
        <>
          <Card className="overflow-hidden" padding={false}>
            <div className="bg-gradient-to-br from-blue-50 to-slate-100 p-6 sm:p-10">
              <div className="wa-personal-identity">
                <div
                  aria-label="搭档头像"
                  className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-white text-4xl text-blue-600 shadow-sm"
                >
                  {glyphs[agent.profile.avatar]}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-blue-700">
                    我的私人搭档 · 仅本人可用
                  </p>
                  <h2 className="mt-2 break-words text-2xl font-semibold">
                    {agent.name}
                  </h2>
                  <p className="mt-2 text-sm text-slate-500">
                    定义已就绪 · 生效版本 v{agent.activeVersion}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  编辑档案
                </Button>
              </div>
            </div>
            <div className="grid gap-8 p-6 sm:grid-cols-2 sm:p-10">
              <div>
                <h3 className="mb-3 font-medium">搭档身份</h3>
                <dl className="space-y-3 text-sm">
                  <div><dt className="text-xs text-slate-500">角色定位</dt><dd className="mt-1 text-slate-800">{agent.profile.role || "尚未设置"}</dd></div>
                  <div><dt className="text-xs text-slate-500">使命</dt><dd className="mt-1 whitespace-pre-wrap text-slate-800">{agent.profile.mission || "尚未设置"}</dd></div>
                  {agent.profile.styleTags.length ? <div><dt className="text-xs text-slate-500">沟通风格</dt><dd className="mt-1 flex flex-wrap gap-1.5">{agent.profile.styleTags.map((tag) => <span key={tag} className="border border-slate-200 px-2 py-1 text-xs text-slate-700">{tag}</span>)}</dd></div> : null}
                </dl>
              </div>
              <div>
                <h3 className="mb-3 font-medium">工作职责</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                  {agent.profile.purpose}
                </p>
              </div>
              <div>
                <h3 className="mb-3 font-medium">协作偏好</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">
                  {agent.profile.preferences ||
                    "清晰、准确地回答；不确定时主动澄清。"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <h3 className="mb-3 font-medium">关于搭档</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{agent.profile.selfIntroduction || "为搭档补充自我介绍，明确它的工作方式。"}</p>
              </div>
              <div className="sm:col-span-2">
                <h3 className="mb-3 font-medium">关于我</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{agent.profile.userContext || "补充你的角色与工作背景，让搭档更好理解任务上下文。"}</p>
              </div>
            </div>
          </Card>
          <Card title="能力范围" description="个人搭档仅处理文本任务，不连接工具、知识库或自动记忆。">
            <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm"><span><strong className="font-semibold">文本执行</strong><span className="ml-2 text-emerald-700">{state.readiness.canExecute ? "可用" : "等待企业配置模型"}</span></span><span><strong className="font-semibold">工具与外部连接</strong><span className="ml-2 text-slate-500">未启用</span></span><span><strong className="font-semibold">自动记忆</strong><span className="ml-2 text-slate-500">未启用</span></span></div>
          </Card>
          <div className="grid gap-5 sm:grid-cols-2">
            <Card>
              <h2 className="font-semibold">开始一件工作</h2>
              <p className="my-3 text-sm leading-6 text-slate-500">
                与私人搭档进行独立文本执行。需要团队协作与交付验收时，请进入项目；私人搭档不会取得项目权限。
              </p>
              <Button onClick={() => setStart(true)}>和搭档开始执行</Button>
              <Link
                className="ml-4 inline-block py-3 text-sm text-blue-700"
                to="/projects"
              >
                进入项目协作
              </Link>
            </Card>
            <Card>
              <h2 className="font-semibold">运行准备</h2>
              <p className="my-3 text-sm leading-6 text-slate-600">
                {state.readiness.canExecute
                  ? "模型执行可用；执行结果以实际任务记录为准。"
                  : "模型服务尚未配置。请联系企业管理员配置模型，随后即可执行。"}
              </p>
              <p className="text-xs text-slate-500">
                纯文本安全策略 · 无外部工具 · 无自动记忆
              </p>
              <Link
                className="mt-4 inline-block text-sm text-blue-700"
                to="/authorization"
              >
                查看我的渠道与授权 →
              </Link>
            </Card>
          </div>
          <Modal
            open={editing}
            title="编辑搭档档案"
            onClose={() => setEditing(false)}
          >
            <ProfileForm
              initial={agent.profile}
              onSaved={() => {
                setEditing(false);
                void cache.invalidateQueries();
              }}
            />
          </Modal>
          <PersonalExecutionModal
            open={start}
            onClose={() => setStart(false)}
            agents={[agent]}
            defaultAgentId={agent.id}
            lockAgent
            onCreated={(run) => navigate(`/tasks/${run.id}`)}
          />
        </>
      )}
    </div>
  );
}
