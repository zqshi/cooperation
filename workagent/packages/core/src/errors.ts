export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const unauthorized = (message = "未登录或会话已过期") =>
  new AppError(401, "unauthorized", message);
export const forbidden = (message = "没有权限执行此操作") =>
  new AppError(403, "forbidden", message);
export const notFound = (message = "资源不存在") =>
  new AppError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);
export const tooMany = (message = "请求过于频繁") =>
  new AppError(429, "too_many_requests", message);
export const internal = (message = "服务器内部错误") =>
  new AppError(500, "internal_error", message);

export function toErrorResponse(error: unknown): {
  status: number;
  body: { error: { code: string; message: string; details?: unknown } };
} {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
    };
  }
  const message = "服务器内部错误";
  return { status: 500, body: { error: { code: "internal_error", message } } };
}
