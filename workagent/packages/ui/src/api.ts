export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(
    message: string,
    status: number,
    code = "error",
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const env =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env ?? {};
export const API_BASE = env.VITE_API_URL ?? "";

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (
    init.body &&
    !(init.body instanceof FormData) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const data = text && contentType.includes("json") ? JSON.parse(text) : text;

  if (!response.ok) {
    const error = data as
      | { error?: { code?: string; message?: string; details?: unknown } }
      | string;
    if (typeof error === "object" && error?.error) {
      throw new ApiError(
        error.error.message ?? "请求失败",
        response.status,
        error.error.code ?? "error",
        error.error.details,
      );
    }
    throw new ApiError(
      typeof error === "string" ? error : "请求失败",
      response.status,
    );
  }

  return data as T;
}

export function get<T>(path: string): Promise<T> {
  return apiFetch<T>(path);
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function patch<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function del<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<T>(path, { method: "POST", body: form });
}

export type StreamHandle = { close: () => void };

export function streamRunEvents(
  runId: string,
  onEvent: (event: Record<string, unknown>) => void,
  onError?: (error: unknown) => void,
): StreamHandle {
  const controller = new AbortController();
  let closed = false;
  let lastId = "";
  let reconnect: ReturnType<typeof setTimeout> | undefined;

  const connect = async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/runs/${runId}/events`, {
        headers: {
          accept: "text/event-stream",
          ...(lastId ? { "last-event-id": lastId } : {}),
        },
        credentials: "include",
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        throw new ApiError("无法连接运行事件流", response.status);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          const eventId = block
            .split("\n")
            .find((l) => l.startsWith("id:"))
            ?.slice(3)
            .trim();
          if (eventId) lastId = eventId;
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (!data) continue;
          try {
            onEvent(JSON.parse(data) as Record<string, unknown>);
          } catch {
            // ignore malformed event
          }
        }
      }
    } catch (error) {
      if (!closed) onError?.(error);
    } finally {
      if (!closed) reconnect = setTimeout(() => void connect(), 3000);
    }
  };

  void connect();
  return {
    close: () => {
      closed = true;
      controller.abort();
      if (reconnect) clearTimeout(reconnect);
    },
  };
}
