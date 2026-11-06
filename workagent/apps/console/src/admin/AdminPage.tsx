import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronLeft, ChevronRight, CirclePlus, Eye, RefreshCw, Search } from "lucide-react";
import {
  Button,
  Card,
  DataTable,
  ErrorText,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Stat,
  StatusBadge,
  Textarea,
} from "@workagent/ui";
import { adminRequest, resolveAdminEndpoint } from "./api.js";
import { adminPageCatalog, type AdminCommand, type AdminField } from "./page-catalog.js";
import type { AdminPageId } from "./navigation.js";
import { filterAdminRows, paginateAdminRows } from "./table-model.js";

type RecordValue = Record<string, unknown>;
type Envelope = { data?: unknown; meta?: Record<string, unknown> };

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function unwrap(value: unknown): unknown {
  const envelope = record(value) as Envelope;
  return envelope.data ?? value;
}

function rowsFrom(value: unknown): RecordValue[] {
  const data = record(unwrap(value));
  const rows = data.items ?? data.rows ?? data.results;
  return Array.isArray(rows) ? rows.map(record) : [];
}

function detailFrom(value: unknown): RecordValue {
  const data = record(unwrap(value));
  return record(data.resource ?? data.item ?? data.result ?? data);
}

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function getId(value: RecordValue): string {
  const id = value.id ?? value.resourceId ?? value.providerId ?? value.runId ?? value.slug;
  return id === undefined ? "" : String(id);
}

function endpointFor(endpoint: string, params: Record<string, string | undefined>) {
  return resolveAdminEndpoint(endpoint, params);
}

function updateMethod(endpoint: string): "PATCH" | "PUT" {
  return ["/v1/agents", "/v1/models", "/v1/platform/dicts", "/v1/management/content", "/v1/platform/runtime-images", "/v1/platform/profiles", "/v1/platform/scheduled-tasks"].some((prefix) => endpoint.startsWith(prefix)) ? "PUT" : "PATCH";
}

function valueForField(field: AdminField, value: unknown): string | number | boolean {
  if (field.type === "json") return value == null ? "" : JSON.stringify(value, null, 2);
  if (field.type === "number") return typeof value === "number" ? value : "";
  if (field.type === "boolean") return typeof value === "boolean" ? value : false;
  return value == null ? "" : String(value);
}

function FieldControl({ field, value, onChange }: { field: AdminField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === "textarea" || field.type === "json") {
    return <Textarea rows={field.type === "json" ? 6 : 4} required={field.required} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  }
  if (field.type === "select") {
    return <Select required={field.required} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}>
      <option value="">请选择</option>
      {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>;
  }
  if (field.type === "boolean") {
    return <label className="inline-flex min-h-10 items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />{field.label}</label>;
  }
  return <Input required={field.required} type={field.type === "secret" ? "password" : field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(field.type === "number" ? Number(event.target.value) : event.target.value)} />;
}

export function AdminPage({ pageId }: { pageId: AdminPageId }) {
  const formRef = useRef<HTMLFormElement>(null);
  const definition = adminPageCatalog[pageId];
  const params = useParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<RecordValue | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [current, setCurrent] = useState<RecordValue | null>(null);
  const [commandMode, setCommandMode] = useState<AdminCommand | null>(null);
  const [commandRow, setCommandRow] = useState<RecordValue | null>(null);
  const [formValues, setFormValues] = useState<RecordValue>({});
  const [formError, setFormError] = useState<unknown>();
  const [success, setSuccess] = useState("");
  const [preview, setPreview] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const endpoint = endpointFor(definition.endpoint, params);
  const pageKey = ["admin-page", pageId, endpoint] as const;

  const query = useQuery({
    queryKey: pageKey,
    queryFn: ({ signal }) => {
      return adminRequest<Envelope>(endpoint, { signal });
    },
  });
  const payload = unwrap(query.data);
  const rows = useMemo(() => rowsFrom(query.data), [query.data]);
  const filteredRows = useMemo(() => filterAdminRows(rows, search, statusFilter), [rows, search, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const visibleRows = useMemo(() => paginateAdminRows(filteredRows, page, pageSize), [filteredRows, page, pageSize]);
  const statusOptions = useMemo(() => [...new Set(rows.map((row) => String(row.status ?? "")).filter(Boolean))].sort(), [rows]);
  const detail = useMemo(() => detailFrom(query.data), [query.data]);
  const metrics = useMemo(() => {
    const data = record(payload);
    const raw = record(data.metrics ?? data.summary ?? data.totals);
    const source = Object.keys(raw).length ? raw : data;
    return Object.entries(source).filter(([, value]) => ["string", "number"].includes(typeof value)).slice(0, 8);
  }, [payload]);

  useEffect(() => { setPage(1); }, [search, statusFilter, pageSize]);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  function blankValues(row?: RecordValue | null) {
    return Object.fromEntries(definition.fields.map((field) => [field.name, field.name === "ownerPassword" ? "" : row ? valueForField(field, row[field.name]) : field.type === "boolean" ? true : ""]));
  }

  function openCreate() {
    setCurrent(null);
    setCommandMode(null);
    setFormValues(blankValues());
    setFormError(undefined);
    setSuccess("");
    setPreview(undefined);
    setFormOpen(true);
  }

  function openEdit(row: RecordValue) {
    setCurrent(row);
    setCommandMode(null);
    setFormValues(blankValues(row));
    setFormError(undefined);
    setFormOpen(true);
  }

  function openCommand(command: AdminCommand, row?: RecordValue) {
    const needsValues = !row && !command.endpoint.includes(":id") && definition.fields.length > 0;
    if (needsValues) {
      if (command.confirm && !window.confirm(command.confirm)) return;
      setCommandMode(command);
      setCommandRow(null);
      if (command.id !== "import") setFormValues(blankValues());
      setFormError(undefined);
      setFormOpen(true);
      return;
    }
    void executeCommand(command, row);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFormError(undefined);
    setSuccess("");
    try {
      const body: RecordValue = {};
      for (const field of definition.fields) {
        if (current && field.createOnly) continue;
        const raw = formValues[field.name];
        if (field.type === "secret" && !raw && current) continue;
        if (field.type === "json" && typeof raw === "string" && raw.trim()) {
          try { body[field.name] = JSON.parse(raw); }
          catch { throw new Error(`${field.label}需要是合法 JSON`); }
        } else if (field.type === "number" && raw !== "") body[field.name] = Number(raw);
        else if (raw !== undefined) body[field.name] = raw;
      }
      if (commandMode) {
        const result = await adminRequest<unknown>(endpointFor(commandMode.endpoint, { ...params, id: getId(commandRow ?? {}) }), { method: commandMode.method, body: { ...commandMode.body, ...body } });
        if (commandMode.id === "preview") {
          setPreview(unwrap(result));
          setSuccess("预览完成。检查解析结果后，再确认导入。");
          setCommandMode(null);
          return;
        }
        setSuccess("操作已提交并由服务端确认。");
        setFormOpen(false);
        await queryClient.invalidateQueries({ queryKey: pageKey });
      } else {
        const resourceEndpoint = endpoint.split("?")[0]!;
        const rowId = current ? getId(current) : "";
        const updateEndpoint = rowId ? `${resourceEndpoint}/${encodeURIComponent(rowId)}` : resourceEndpoint;
        const version = current?.version;
        await adminRequest<unknown>(updateEndpoint, {
          method: rowId ? updateMethod(resourceEndpoint) : "POST",
          body: { ...body, ...(version === undefined ? {} : { expectedVersion: version }) },
        });
        setSuccess(rowId ? "修改已保存。" : "已创建记录。");
        setFormOpen(false);
        await queryClient.invalidateQueries({ queryKey: pageKey });
      }
    } catch (error) {
      setFormError(error);
    } finally {
      setBusy(false);
    }
  }

  async function executeCommand(command: AdminCommand, row?: RecordValue) {
    if (command.confirm && !window.confirm(command.confirm)) return;
    setBusy(true);
    setFormError(undefined);
    setSuccess("");
    try {
      const targetId = getId(row ?? {});
      const actionEndpoint = endpointFor(command.endpoint, { ...params, id: targetId });
      await adminRequest(actionEndpoint, { method: command.method, body: command.body ?? {} });
      setSuccess(`${command.label}已完成。`);
      await queryClient.invalidateQueries({ queryKey: ["admin-page", pageId] });
    } catch (error) {
      setFormError(error);
    } finally {
      setBusy(false);
    }
  }

  const dataColumns = definition.columns.map((column) => ({
    key: column.key,
    header: column.label,
    render: (row: RecordValue) => {
      const value = row[column.key];
      if (column.key.toLowerCase().includes("status") && typeof value === "string") return <StatusBadge status={value} />;
      return <span className="block max-w-[360px] truncate" title={display(value)}>{display(value)}</span>;
    },
  }));
  const tableColumns = [...dataColumns];
  if (definition.kind === "resource" || definition.kind === "workflow") {
    tableColumns.push({
      key: "_actions",
      header: "操作",
      render: (row: RecordValue) => <div className="flex flex-wrap gap-1" onClick={(event) => event.stopPropagation()}>
        <Button variant="ghost" size="sm" aria-label={`查看${definition.title}详情`} title="查看详情" onClick={() => setSelected(row)}><Eye size={15} /></Button>
        <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>编辑</Button>
        {definition.actions.filter((action) => action.endpoint.includes(":id")).map((action) => <Button key={action.id} variant="outline" size="sm" disabled={busy} onClick={() => openCommand(action, row)}>{action.label}</Button>)}
      </div>,
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={definition.title}
        description={definition.description}
        actions={<>
          <Button variant="outline" onClick={() => void query.refetch()} aria-label="刷新" title="刷新"><RefreshCw size={15} />刷新</Button>
          {definition.kind === "resource" || definition.kind === "workflow" ? <Button onClick={openCreate}><CirclePlus size={16} />新建</Button> : null}
          {definition.actions.filter((action) => !action.endpoint.includes(":id")).map((action) => <Button key={action.id} variant={action.id === "import" ? "primary" : "outline"} disabled={busy || (action.id === "import" && !preview)} onClick={() => openCommand(action)}>{action.label}</Button>)}
        </>}
      />

      {success ? <div role="status" className="flex items-center gap-2 border-l-2 border-teal-700 bg-teal-50 px-3 py-2 text-sm text-teal-900"><Activity size={15} />{success}</div> : null}
      <ErrorText error={query.error ?? formError} />

      {metrics.length ? <section aria-label="统计指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([key, value]) => <Stat key={key} label={humanize(key)} value={display(value)} />)}</section> : null}

      {definition.kind === "detail" ? (
        query.isLoading ? <Spinner /> : query.data ? <Card title={definition.title} description={getId(detail) || undefined}>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(detail).map(([key, value]) => <div key={key} className="min-w-0 border-b border-slate-100 pb-3"><dt className="text-xs text-slate-500">{humanize(key)}</dt><dd className="mt-1 break-words text-sm text-slate-900">{key.toLowerCase().includes("status") && typeof value === "string" ? <StatusBadge status={value} /> : display(value)}</dd></div>)}</dl>
          {definition.actions.length ? <div className="mt-5 flex flex-wrap gap-2">{definition.actions.map((action) => <Button key={action.id} variant="outline" disabled={busy} onClick={() => openCommand(action, detail)}>{action.label}</Button>)}</div> : null}
        </Card> : <Card title="无法载入详情"><p className="text-sm text-slate-600">请求未返回资源详情，请重试或返回列表。</p></Card>
      ) : (
        <>
        <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><Input aria-label="搜索记录" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索当前列表" className="pl-9" /></div>
          {statusOptions.length > 1 ? <Select aria-label="按状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full max-w-[190px]"><option value="">全部状态</option>{statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}</Select> : null}
            {query.isFetching && !query.isLoading ? <span className="text-xs text-slate-500">正在更新…</span> : null}
          </div>
          {query.isLoading ? <Spinner /> : query.error ? null : filteredRows.length ? <><Card padding={false}><DataTable rows={visibleRows} keyFor={(row) => getId(row) || JSON.stringify(row)} columns={tableColumns} onRowClick={setSelected} /></Card><div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"><span>共 {filteredRows.length} 条 · 第 {page} / {pageCount} 页</span><div className="flex items-center gap-2"><Select aria-label="每页条数" value={String(pageSize)} onChange={(event) => setPageSize(Number(event.target.value))} className="w-24"><option value="10">10 条</option><option value="20">20 条</option><option value="50">50 条</option></Select><Button variant="outline" size="sm" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={15} /></Button><Button variant="outline" size="sm" aria-label="下一页" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight size={15} /></Button></div></div></> : <Card title={rows.length ? "没有匹配记录" : "暂无记录"} description={rows.length ? "调整搜索词或状态筛选后重试。" : "此查询成功，但当前范围内没有可显示的记录。"} />}
        </>
      )}

      <Modal open={Boolean(selected)} title={selected ? display(selected.name ?? selected.title ?? selected.id ?? definition.title) : "记录详情"} description={selected ? getId(selected) : undefined} onClose={() => setSelected(null)} wide footer={<Button variant="outline" onClick={() => setSelected(null)}>关闭</Button>}>
        {selected ? <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{Object.entries(selected).map(([key, value]) => <div key={key} className="min-w-0 border-b border-slate-100 pb-3"><dt className="text-xs text-slate-500">{humanize(key)}</dt><dd className="mt-1 break-words text-sm text-slate-900">{key.toLowerCase().includes("status") && typeof value === "string" ? <StatusBadge status={value} /> : display(value)}</dd></div>)}</dl> : null}</Modal>

      <Modal open={formOpen} title={commandMode ? commandMode.label : current ? `编辑${definition.title}` : definition.title === "导入服务连接器" ? "连接器导入预览" : `新建${definition.title}`} description={current?.version ? `当前版本 v${display(current.version)}；保存时会检查版本冲突。` : undefined} onClose={() => !busy && setFormOpen(false)} wide footer={<>
        <Button variant="ghost" disabled={busy} onClick={() => setFormOpen(false)}>取消</Button>
        <Button loading={busy} onClick={() => formRef.current?.requestSubmit()}>{commandMode?.id === "preview" ? "生成预览" : commandMode ? commandMode.label : current ? "保存修改" : definition.title === "导入服务连接器" ? "生成预览" : "创建"}</Button>
      </>}>
        <form ref={formRef} id="admin-resource-form" className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submitForm(event)}>
          {(commandMode?.id === "import" ? [] : definition.fields.filter((field) => !current || !field.createOnly)).map((field) => <Field key={field.name} label={field.label} hint={field.type === "secret" && current ? "留空以保持现有密钥" : undefined} className={field.type === "textarea" || field.type === "json" ? "sm:col-span-2" : undefined}><FieldControl field={field} value={formValues[field.name]} onChange={(value) => setFormValues((currentValues) => ({ ...currentValues, [field.name]: value }))} /></Field>)}
          {formError ? <div className="sm:col-span-2"><ErrorText error={formError} /></div> : null}
          {preview !== undefined ? <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-3 text-xs sm:col-span-2">{JSON.stringify(preview, null, 2)}</pre> : null}
          <button className="hidden" type="submit" aria-hidden="true" />
        </form>
      </Modal>
    </div>
  );
}
