/**
 * API contract tests (#993) for findings endpoints.
 * Exercises validation, response schema shape, and error format.
 */

import { findingsController } from '../findings.controller';
import { findingsRepository } from '../findings.repository';
import { findingsService } from '../findings.service';
import { Request, Response } from 'express';

function mockRes() {
  const res: Partial<Response> & {
    statusCode: number;
    body: unknown;
  } = {
    statusCode: 200,
    body: undefined,
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res as Response;
  });
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res as Response;
  });
  return res as Response & { statusCode: number; body: unknown };
}

function mockReq(
  overrides: Partial<Request> & {
    query?: Record<string, string>;
    headers?: Record<string, string>;
    params?: Record<string, string>;
  } = {},
): Request {
  return {
    query: {},
    headers: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

describe('findings API contract (#993)', () => {
  beforeEach(() => {
    findingsRepository.clear();
  });

  it('list returns data + pagination schema on success', () => {
    findingsService.create({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'T',
      description: 'D',
      severity: 'high',
      ruleId: 'r1',
    });
    const res = mockRes();
    findingsController.list(
      mockReq({
        headers: { 'x-organization-id': 'org-1' },
        query: { limit: '10' },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      data: unknown[];
      pagination: { nextCursor: string | null; limit: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.pagination).toMatchObject({ limit: 10 });
    expect(body.pagination).toHaveProperty('nextCursor');
  });

  it('list validates missing organizationId', () => {
    const res = mockRes();
    findingsController.list(mockReq({ query: {} }), res);
    expect(res.statusCode).toBe(400);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/organizationId/i);
  });

  it('list validates bad severity filter', () => {
    const res = mockRes();
    findingsController.list(
      mockReq({
        headers: { 'x-organization-id': 'org-1' },
        query: { severity: 'ultra' },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('list validates bad sortBy', () => {
    const res = mockRes();
    findingsController.list(
      mockReq({
        headers: { 'x-organization-id': 'org-1' },
        query: { sortBy: 'notAField' },
      }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('getOne returns 404 with stable error shape for missing/cross-tenant', () => {
    const created = findingsService.create({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'T',
      description: 'D',
      severity: 'low',
      ruleId: 'r1',
    });
    const res = mockRes();
    findingsController.getOne(
      mockReq({
        headers: { 'x-organization-id': 'org-other' },
        params: { id: created.id },
      }),
      res,
    );
    expect(res.statusCode).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'NOT_FOUND',
    );
  });

  it('getOne returns finding under data key when authorized', () => {
    const created = findingsService.create({
      organizationId: 'org-1',
      repositoryId: 'repo-1',
      analysisJobId: 'job-1',
      title: 'Visible',
      description: 'D',
      severity: 'low',
      ruleId: 'r1',
    });
    const res = mockRes();
    findingsController.getOne(
      mockReq({
        headers: { 'x-organization-id': 'org-1' },
        params: { id: created.id },
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect((res.body as { data: { title: string } }).data.title).toBe(
      'Visible',
    );
  });
});
