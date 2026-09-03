import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';

import { ApiResponse, toPagination } from './apiResponse';
import { asyncHandler } from './asyncHandler';

function fakeRes() {
  const json = vi.fn();
  const send = vi.fn();
  const res = { status: vi.fn().mockReturnThis(), json, send } as unknown as Response;
  return { res, json, send, body: () => json.mock.calls[0]?.[0] };
}

describe('ApiResponse.ok', () => {
  // 994 of ~2,000 responses in controllers/ are {success, message} with no data,
  // so both halves have to be optional or the helper does not fit its callers.
  it('emits a message-only response, the most common shape in the codebase', () => {
    const { res, body } = fakeRes();
    ApiResponse.ok(res, undefined, 'Deleted successfully');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(body()).toEqual({ success: true, message: 'Deleted successfully' });
  });

  it('emits data without a message', () => {
    const { res, body } = fakeRes();
    ApiResponse.ok(res, { id: 'u1' });
    expect(body()).toEqual({ success: true, data: { id: 'u1' } });
  });

  it('emits both when both are given', () => {
    const { res, body } = fakeRes();
    ApiResponse.ok(res, [1, 2], 'Units fetched successfully');
    expect(body()).toEqual({ success: true, message: 'Units fetched successfully', data: [1, 2] });
  });

  // `data: null` is a meaningful payload; `undefined` means "no payload".
  it('keeps an explicit null payload', () => {
    const { res, body } = fakeRes();
    ApiResponse.ok(res, null, 'Nothing linked');
    expect(body()).toEqual({ success: true, message: 'Nothing linked', data: null });
  });
});

describe('ApiResponse.created', () => {
  it('is a 201 carrying both message and data', () => {
    const { res, body } = fakeRes();
    ApiResponse.created(res, { id: 'i1' }, 'Invoice created successfully');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(body()).toEqual({
      success: true,
      message: 'Invoice created successfully',
      data: { id: 'i1' },
    });
  });
});

describe('ApiResponse.page', () => {
  // Pagination nests inside data: the majority placement (47 against 19), and
  // the one apps/web/src/types/apiResponses.ts already models.
  it('nests rows and pagination under data', () => {
    const { res, body } = fakeRes();
    ApiResponse.page(res, 'units', [{ id: 'u1' }], toPagination(1, 1, 10), 'Units fetched successfully');
    expect(body()).toEqual({
      success: true,
      message: 'Units fetched successfully',
      data: {
        units: [{ id: 'u1' }],
        pagination: { total: 1, page: 1, limit: 10, totalPages: 1 },
      },
    });
  });

  it('omits the message when there is none', () => {
    const { res, body } = fakeRes();
    ApiResponse.page(res, 'units', [], toPagination(0, 1, 10));
    expect(body()).toEqual({
      success: true,
      data: { units: [], pagination: { total: 0, page: 1, limit: 10, totalPages: 0 } },
    });
  });
});

describe('ApiResponse.noContent', () => {
  it('sends a 204 with no body', () => {
    const { res, json, send } = fakeRes();
    ApiResponse.noContent(res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(send).toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});

describe('asyncHandler', () => {
  it('routes a rejection to next, rather than leaving it unhandled', async () => {
    const err = new Error('boom');
    const next = vi.fn();
    const { res } = fakeRes();
    asyncHandler(async () => {
      throw err;
    })({} as never, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(err));
  });

  it('routes a synchronous throw to next as well', async () => {
    const err = new Error('sync boom');
    const next = vi.fn();
    const { res } = fakeRes();
    // Not async, so this throws before a promise exists.
    asyncHandler((() => {
      throw err;
    }) as never)({} as never, res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(err));
  });

  it('leaves next alone when the handler resolves', async () => {
    const next = vi.fn();
    const { res } = fakeRes();
    asyncHandler(async (_req, r) => {
      ApiResponse.ok(r, { ok: true });
    })({} as never, res, next);
    await new Promise((r) => setTimeout(r, 0));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
