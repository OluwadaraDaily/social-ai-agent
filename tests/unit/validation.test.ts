import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { validate, generatePostSchema } from '@/middleware/validation.js';

function makeReqRes(body: unknown) {
  const req = { body } as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next: NextFunction = vi.fn();
  return { req, res, next };
}

describe('validate middleware (generatePostSchema)', () => {
  const mw = validate(generatePostSchema);

  it('calls next() for a valid body', () => {
    const { req, res, next } = makeReqRes({ query: 'hello', social_platform: 'x' });
    mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 when query is missing', () => {
    const { req, res, next } = makeReqRes({ social_platform: 'x' });
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.error).toBe('Validation failed');
    expect(body.details.some((d: any) => d.path === 'query')).toBe(true);
  });

  it('returns 400 when query is an empty string', () => {
    const { req, res, next } = makeReqRes({ query: '', social_platform: 'x' });
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when query exceeds 1000 characters', () => {
    const { req, res, next } = makeReqRes({
      query: 'a'.repeat(1001),
      social_platform: 'x',
    });
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 when social_platform is missing', () => {
    const { req, res, next } = makeReqRes({ query: 'hello' });
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(body.details.some((d: any) => d.path === 'social_platform')).toBe(true);
  });

  it('returns 400 when social_platform is an empty string', () => {
    const { req, res, next } = makeReqRes({ query: 'hello', social_platform: '' });
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts query exactly at 1000 characters', () => {
    const { req, res, next } = makeReqRes({
      query: 'a'.repeat(1000),
      social_platform: 'x',
    });
    mw(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
