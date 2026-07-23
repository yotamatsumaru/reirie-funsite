/**
 * Route Handler 共通のエラー型と JSON レスポンスヘルパ
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const errors = {
  unauthorized: (msg = 'ログインが必要です') => new ApiError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'アクセス権限がありません') => new ApiError(403, 'FORBIDDEN', msg),
  notFound: (msg = '見つかりません') => new ApiError(404, 'NOT_FOUND', msg),
  conflict: (msg = '競合が発生しました') => new ApiError(409, 'CONFLICT', msg),
  badRequest: (msg = '不正なリクエストです', details?: unknown) =>
    new ApiError(400, 'BAD_REQUEST', msg, details),
  unprocessable: (msg = '入力値が不正です', details?: unknown) =>
    new ApiError(422, 'UNPROCESSABLE_ENTITY', msg, details),
  rateLimited: (msg = 'リクエストが多すぎます') => new ApiError(429, 'RATE_LIMITED', msg),
  internal: (msg = 'サーバーエラーが発生しました') => new ApiError(500, 'INTERNAL_ERROR', msg),
  planRequired: (label: string) =>
    new ApiError(403, 'PLAN_REQUIRED', `${label} プラン以上が必要です`),
};

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: '入力値が不正です',
          details: err.flatten(),
        },
      },
      { status: 422 },
    );
  }
  // Pui 整合性エラー (PuiIntegrityError) はクライアントに原因を返す。
  // 循環 import を避けるため name で判定する。
  if (err instanceof Error && err.name === 'PuiIntegrityError') {
    return NextResponse.json(
      { error: { code: 'PUI_INTEGRITY', message: err.message } },
      { status: 422 },
    );
  }
  // eslint-disable-next-line no-console
  console.error('[api] unexpected error', err);
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'サーバーエラーが発生しました' } },
    { status: 500 },
  );
}

/**
 * Route Handler を try/catch でラップする高階関数
 */
export function handle<T extends (req: Request, ctx: any) => Promise<Response>>(fn: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (async (req: Request, ctx: any) => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  }) as T;
}
