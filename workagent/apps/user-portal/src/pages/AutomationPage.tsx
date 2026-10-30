import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Clock3, Play, Plus, CalendarClock, ArrowLeft } from "lucide-react";
import {
  Button,
  Modal,
  Card,
  ErrorText,
  Field,
  Input,
  Textarea,
  Select,
  PageHeader,
  Spinner,
  get,
  post,
  put,
} from "@workagent/ui";
import {
  automationWallTime,
  automationWallMinute,
  type Automation,
  type AutomationInput,
  type AutomationOccurrence,
} from "@workagent/contracts";
import { usePersonalAssistant } from "../lib/personal.js";
const labels: Record<string, string> = {
  active: "已启用",
  paused: "已暂停",
  completed: "日程已结束",
  terminated: "已终止",
  deleted: "已删除",
  queued: "排队中",
  running: "执行中",
  waiting_approval: "待审批",
  succeeded: "成功",
  failed: "失败",
  skipped: "已跳过",
  canceled: "已取消",
  timeout: "超时",
};
function date(value: string | null, tz: string) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: tz,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}
function frequency(a: Automation) {
  return a.schedule.kind === "once"
    ? "单次执行"
    : `周期执行 · ${a.schedule.cron}`;
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${status === "active" || status === "succeeded" ? "bg-emerald-50 text-emerald-700" : status === "failed" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
function Pager({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
      <span>
        共 {total} 条 · 第 {page} 页
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          disabled={page * 20 >= total}
          onClick={() => onChange(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
export function AutomationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<"terminate" | "delete" | null>(null);
  const personal = usePersonalAssistant();
  const list = useQuery({
    queryKey: ["automations", page],
    queryFn: () =>
      get<{ items: Automation[]; total: number }>(
        `/v1/automations?page=${page}`,
      ),
    enabled: !id,
    refetchInterval: 5000,
  });
  const detail = useQuery({
    queryKey: ["automation", id],
    queryFn: () => get<Automation>(`/v1/automations/${id}`),
    enabled: !!id,
    refetchInterval: 5000,
  });
  const history = useQuery({
    queryKey: ["automation-history", id, page],
    queryFn: () =>
      get<{ items: AutomationOccurrence[]; total: number }>(
        `/v1/automations/${id}/history?page=${page}`,
      ),
    enabled: !!id,
    refetchInterval: 3000,
  });
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["automations"] }),
      qc.invalidateQueries({ queryKey: ["automation"] }),
      qc.invalidateQueries({ queryKey: ["automation-history"] }),
    ]);
  };
  const action = async (action: string) => {
    if (!detail.data) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/v1/automations/${id}/actions`, {
        action,
        version: detail.data.version,
      });
      setConfirm(null);
      if (action === "delete") navigate("/automations");
      await refresh();
    } catch (e) {
      setError(e);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const trigger = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/v1/automations/${id}/trigger`, { key: crypto.randomUUID() });
      setPage(1);
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const current = detail.data;
  const terminal =
    current && ["terminated", "deleted"].includes(current.status);
  return (
    <div className="space-y-6">
      {id && (
        <Link
          to="/automations"
          className="inline-flex items-center gap-2 text-sm text-slate-500"
        >
          <ArrowLeft size={16} />
          返回自动化
        </Link>
      )}
      <PageHeader
        title={id ? (current?.title ?? "自动化详情") : "自动化"}
        description={
          id
            ? "查看日程和每次真实执行的结果。"
            : "让个人搭档按时接手重复工作，把精力留给重要的事。"
        }
        actions={
          !id ? (
            <Button onClick={() => setEditing(true)}>
              <Plus size={16} />
              新建自动化
            </Button>
          ) : undefined
        }
      />
      <div className="flex gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm text-slate-600">
        <CalendarClock className="shrink-0 text-blue-500" size={20} />
        <div>
          <p className="font-medium text-slate-800">
            由我的私人搭档执行 · 结果留在站内历史
          </p>
          <p className="mt-1 text-xs leading-6">
            仅文本任务，遵守现有执行额度。无需连接
            IM。周期停机最多补一次；已有执行时跳过本次。暂停只停止日程，终止会同时取消进行中的执行。
          </p>
          {personal.data && !personal.data.readiness.canExecute && (
            <p className="mt-2 font-medium text-amber-700">
              尚未配置模型。可以保存日程；触发后会如实记录执行失败。请联系企业管理员配置模型。
            </p>
          )}
        </div>
      </div>
      <ErrorText error={error ?? list.error ?? detail.error ?? history.error} />
      {!id ? (
        list.isPending ? (
          <Spinner />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {list.data?.items.map((a) => (
                <Link
                  key={a.id}
                  to={`/automations/${a.id}`}
                  className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="rounded-xl bg-blue-50 p-3 text-blue-600">
                      <Clock3 size={20} />
                    </span>
                    <Badge status={a.status} />
                  </div>
                  <h2 className="mt-4 break-words font-semibold text-slate-900">
                    {a.title}
                  </h2>
                  <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-slate-500">
                    {a.prompt}
                  </p>
                  <div className="mt-5 border-t border-slate-100 pt-4 text-xs leading-6 text-slate-500">
                    <p>
                      {frequency(a)} · {a.timezone}
                    </p>
                    <p>
                      下次执行：
                      {a.status === "active"
                        ? date(a.nextAt, a.timezone)
                        : "日程未启用"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
            {list.data?.items.length === 0 && (
              <Card>
                <div className="py-12 text-center">
                  <Clock3 className="mx-auto mb-4 text-blue-400" size={36} />
                  <h2 className="font-semibold">把一件重复工作交给搭档</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                    例如每天整理给定材料、每周生成复盘提纲，或在指定时间起草一份工作清单。
                  </p>
                  <Button className="mt-5" onClick={() => setEditing(true)}>
                    创建第一个自动化
                  </Button>
                </div>
              </Card>
            )}
            <Pager
              page={page}
              total={list.data?.total ?? 0}
              onChange={setPage}
            />
          </>
        )
      ) : current ? (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Badge status={current.status} />
              <div className="flex flex-wrap gap-2">
                {!terminal && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setEditing(true)}
                    >
                      编辑日程
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          current.status === "active" ? "pause" : "resume",
                        )
                      }
                    >
                      {current.status === "active" ? "暂停" : "启用"}
                    </Button>
                    <Button disabled={busy} onClick={() => void trigger()}>
                      <Play size={14} />
                      立即执行
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirm("terminate")}
                    >
                      终止
                    </Button>
                  </>
                )}
                {current.status !== "deleted" && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirm("delete")}
                  >
                    删除
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
              {current.prompt}
            </p>
            <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-400">执行频率</p>
                <p className="mt-2 break-words">{frequency(current)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">时区</p>
                <p className="mt-2">{current.timezone}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">下次执行</p>
                <p className="mt-2">
                  {current.status === "active"
                    ? date(current.nextAt, current.timezone)
                    : "—"}
                </p>
              </div>
            </div>
          </Card>
          <section>
            <h2 className="mb-4 font-semibold">执行历史</h2>
            <div className="space-y-3">
              {history.data?.items.map((o) => (
                <Card key={o.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-slate-600">
                      {o.trigger === "manual" ? "手动触发" : "定时触发"} ·{" "}
                      {date(o.scheduledAt, current.timezone)}
                    </div>
                    <Badge status={o.status} />
                  </div>
                  {o.error && (
                    <p className="mt-3 break-words rounded-lg bg-red-50 p-3 text-sm text-red-700">
                      {o.error}
                    </p>
                  )}
                  {o.output && (
                    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
                      {o.output}
                    </p>
                  )}
                  {o.runId && (
                    <Link
                      className="mt-4 inline-block text-sm font-medium text-blue-600"
                      to={`/runs/${o.runId}`}
                    >
                      查看执行详情 →
                    </Link>
                  )}
                </Card>
              ))}
              {history.data?.items.length === 0 && (
                <Card>
                  <p className="py-6 text-center text-sm text-slate-400">
                    还没有执行记录。日程到期或立即执行后，会在这里保留真实结果。
                  </p>
                </Card>
              )}
            </div>
            <Pager
              page={page}
              total={history.data?.total ?? 0}
              onChange={setPage}
            />
          </section>
        </>
      ) : detail.isPending ? (
        <Spinner />
      ) : null}
      {editing && (
        <AutomationForm
          key={id ?? "new"}
          initial={current}
          onClose={() => setEditing(false)}
          onSave={async (data) => {
            const saved = id
              ? await put<Automation>(`/v1/automations/${id}`, {
                  ...data,
                  version: current!.version,
                })
              : await post<Automation>("/v1/automations", data);
            setEditing(false);
            setPage(1);
            navigate(`/automations/${saved.id}`);
            await refresh();
          }}
        />
      )}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="确认操作"
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="font-semibold">
              {confirm === "delete" ? "删除自动化" : "终止自动化"}？
            </h2>
            <p className="my-4 text-sm leading-7 text-slate-500">
              停止后续调度并取消当前执行。历史 run 保留，已产生的结果不会撤回。
              {confirm === "delete"
                ? "此日程将从列表移除。"
                : "此操作不可恢复；需要时可另建日程。"}
            </p>
            <ErrorText error={error} />
            <div className="mt-4 flex justify-end gap-3">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                返回
              </Button>
              <Button
                variant="danger"
                loading={busy}
                onClick={() => void action(confirm)}
              >
                确认{confirm === "delete" ? "删除" : "终止"}
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function AutomationForm({
  initial,
  onClose,
  onSave,
}: {
  initial?: Automation;
  onClose: () => void;
  onSave: (data: AutomationInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [kind, setKind] = useState(initial?.schedule.kind ?? "recurring");
  const [preset, setPreset] = useState(initial ? "custom" : "daily");
  const [cron, setCron] = useState(
    initial?.schedule.kind === "recurring"
      ? initial.schedule.cron
      : "0 9 * * *",
  );
  const [time, setTime] = useState("09:00");
  const [day, setDay] = useState("1");
  const [at, setAt] = useState(
    initial?.schedule.kind === "once"
      ? automationWallMinute(initial.schedule.at, initial.timezone)
      : "",
  );
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const computed =
    preset === "custom"
      ? cron
      : `${Number(time.split(":")[1])} ${Number(time.split(":")[0])} ${preset === "monthly" ? day : "*"} * ${preset === "weekly" ? day : "*"}`;
  return (
    <Modal
      open
      title={initial ? "编辑自动化" : "新建自动化"}
      description="描述目标，再为搭档安排一个执行时间。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="wa-automation-form"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          void (async () => {
            try {
              await onSave({
                title,
                prompt,
                timezone,
                enabled,
                schedule:
                  kind === "once"
                    ? { kind: "once", at: automationWallTime(at, timezone) }
                    : { kind: "recurring", cron: computed },
              });
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <Field label="任务标题">
          <Input
            autoFocus
            required
            maxLength={100}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="每周复盘提纲"
          />
        </Field>
        <Field
          label="任务描述"
          hint="私人搭档只处理给定文本，不会联网获取资讯或发送通知。"
        >
          <Textarea
            required
            rows={4}
            maxLength={12000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="根据以下本周工作记录，整理成果、阻碍和下周行动……"
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="执行方式">
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="recurring">周期执行</option>
              <option value="once">单次执行</option>
            </Select>
          </Field>
          <Field label="时区" hint="使用 IANA 名称，如 Asia/Shanghai">
            <Input
              required
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              list="automation-timezones"
            />
          </Field>
          <datalist id="automation-timezones">
            {[
              "Asia/Shanghai",
              "Asia/Tokyo",
              "America/Los_Angeles",
              "America/New_York",
              "Europe/London",
              "UTC",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </datalist>
        </div>
        {kind === "once" ? (
          <Field
            label="执行日期和时间"
            hint="按上方时区解释。夏令时不存在或重复的时刻会拒绝保存。"
          >
            <Input
              required
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </Field>
        ) : (
          <>
            <Field label="频率">
              <Select
                value={preset}
                onChange={(e) => {
                  setPreset(e.target.value);
                  setDay("1");
                }}
              >
                <option value="daily">每天</option>
                <option value="weekly">每周</option>
                <option value="monthly">每月</option>
                <option value="custom">自定义 cron</option>
              </Select>
            </Field>
            {preset === "custom" ? (
              <Field
                label="五段 cron"
                hint="分 时 日 月 周；最小分钟间隔 15 分钟。例：0 9 * * 1"
              >
                <Input
                  required
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                />
              </Field>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="执行时间">
                  <Input
                    type="time"
                    required
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                  />
                </Field>
                {preset === "weekly" && (
                  <Field label="星期">
                    <Select
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                    >
                      {[
                        "周日",
                        "周一",
                        "周二",
                        "周三",
                        "周四",
                        "周五",
                        "周六",
                      ].map((v, i) => (
                        <option key={v} value={i}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {preset === "monthly" && (
                  <Field label="每月日期" hint="当月不存在的日期自动跳过">
                    <Input
                      type="number"
                      min={1}
                      max={31}
                      required
                      value={day}
                      onChange={(e) => setDay(e.target.value)}
                    />
                  </Field>
                )}
              </div>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          保存后启用日程
        </label>
        <ErrorText error={error} />
        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </Button>
          <Button type="submit" loading={busy}>
            {initial ? "保存修改" : "创建自动化"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
