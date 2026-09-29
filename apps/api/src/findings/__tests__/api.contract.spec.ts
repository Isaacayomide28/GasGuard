/**
 * API contract tests (#993) for findings endpoints.
 *
 * Covers:
 * - Request validation (required fields, enums, limits)
 * - Authorization / tenant scoping (organizationId)
 * - Success response schemas (data + pagination envelope)
 * - Error envelope format ({ error: { code, message } })
 * - Backward-compatible query acceptance (header vs query organizationId)
 *
 * Security / operational notes (see also docs/api-contract.md):
 * - organizationId is treated as a tenancy boundary; callers must not receive
 *   findings from other orgs (isolation enforced in service/repository).
 * - Error messages avoid leaking internal stack traces or cross-tenant ids.
 * - No credentials or tokens are embedded in fixtures.
 */

import { findingsController } from '../findings.controller';
import { findingsRepository } from '../findings.repository';
import { findingsService } from '../findings.service';
import { Request, Response } from 'express';
import type { Finding } from '../finding.types';

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
    body?: Record<string, unknown>;
  } = {},
): Request {
  return {
    query: {},
    headers: {},
    params: {},
    body: {},
    ...overrides,
  } as unknown as Request;
}

/** Shared error envelope assertion for contract stability. */
function expectErrorEnvelope(
  body: unknown,
  expectedCode: string,
  statusCode: number,
  res: { statusCode: number },
) {
  expect(res.statusCode).toBe(statusCode);
  expect(body).toEqual(
    expect.objectContaining({
      error: expect.objectContaining({
        code: expectedCode,
        message: expect.any(String),
      }),
    }),
  );
  const err = (body as { error: { code: string; message: string } }).error;
  expect(err.message.length).toBeGreaterThan(0);
  // Must not leak stack traces in the public contract
  expect(JSON.stringify(body)).not.toMatch(/at Object\.|Error:.*\n\s+at /);
}

const FINDING_REQUIRED_FIELDS: (keyof Finding)[] = [
  'id',
  'organizationId',
  'repositoryId',
  'analysisJobId',
  'title',
  'description',
  'severity',
  'status',
  'ruleId',
  'createdAt',
  'updatedAt',
];

describe('findings API contract (#993)', () => {
  beforeEach(() => {
    findingsRepository.clear();
  });

  describe('success response schemas', () => {
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
        data: Finding[];
        pagination: { nextCursor: string | null; limit: number };
      };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.pagination).toMatchObject({ limit: 10 });
      expect(body.pagination).toHaveProperty('nextCursor');
      for (const field of FINDING_REQUIRED_FIELDS) {
        expect(body.data[0]).toHaveProperty(field);
      }
    });

    it('getOne returns finding under data key with stable field set', () => {
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
      const data = (res.body as { data: Finding }).data;
      expect(data.title).toBe('Visible');
      for (const field of FINDING_REQUIRED_FIELDS) {
        expect(data).toHaveProperty(field);
      }
      expect(data.organizationId).toBe('org-1');
    });
  });

  describe('request validation', () => {
    it('list validates missing organizationId', () => {
      const res = mockRes();
      findingsController.list(mockReq({ query: {} }), res);
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR', 400, res);
      expect(
        (res.body as { error: { message: string } }).error.message,
      ).toMatch(/organizationId/i);
    });

    it('list rejects invalid severity enum', () => {
      const res = mockRes();
      findingsController.list(
        mockReq({
          headers: { 'x-organization-id': 'org-1' },
          query: { severity: 'ultra' },
        }),
        res,
      );
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR', 400, res);
    });

    it('list rejects invalid status enum', () => {
      const res = mockRes();
      findingsController.list(
        mockReq({
          headers: { 'x-organization-id': 'org-1' },
          query: { status: 'deleted' },
        }),
        res,
      );
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR', 400, res);
    });

    it('list rejects invalid sortBy', () => {
      const res = mockRes();
      findingsController.list(
        mockReq({
          headers: { 'x-organization-id': 'org-1' },
          query: { sortBy: 'not-a-field' },
        }),
        res,
      );
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR', 400, res);
    });

    it('list rejects invalid sortDir', () => {
      const res = mockRes();
      findingsController.list(
        mockReq({
          headers: { 'x-organization-id': 'org-1' },
          query: { sortDir: 'sideways' },
        }),
        res,
      );
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR', 400, res);
    });

    it('list accepts valid multi-value severity CSV filter', () => {
      findingsService.create({
        organizationId: 'org-1',
        repositoryId: 'repo-1',
        analysisJobId: 'job-1',
        title: 'H',
        description: 'D',
        severity: 'high',
        ruleId: 'r1',
      });
      findingsService.create({
        organizationId: 'org-1',
        repositoryId: 'repo-1',
        analysisJobId: 'job-1',
        title: 'L',
        description: 'D',
        severity: 'low',
        ruleId: 'r1',
      });
      const res = mockRes();
      findingsController.list(
        mockReq({
          headers: { 'x-organization-id': 'org-1' },
          query: { severity: 'high,critical' },
        }),
        res,
      );
      expect(res.statusCode).toBe(200);
      const body = res.body as { data: Finding[] };
      expect(body.data.every((f) => f.severity === 'high')).toBe(true);
    });

    it('getOne validates missing organizationId', () => {
      const res = mockRes();
      findingsController.getOne(
        mockReq({ params: { id: 'any' }, query: {} }),
        res,
      );
      expectErrorEnvelope(res.body, 'VALIDATION_ERROR', 400, res);
    });
  });

  describe('authorization / tenancy', () => {
    it('getOne returns NOT_FOUND for cross-organization access', () => {
      const created = findingsService.create({
        organizationId: 'org-1',
        repositoryId: 'repo-1',
        analysisJobId: 'job-1',
        title: 'Secret',
        description: 'D',
        severity: 'critical',
        ruleId: 'r1',
      });
      const res = mockRes();
      findingsController.getOne(
        mockReq({
          headers: { 'x-organization-id': 'org-2' },
          params: { id: created.id },
        }),
        res,
      );
      expectErrorEnvelope(res.body, 'NOT_FOUND', 404, res);
    });

    it('list only returns findings for the requested organization', () => {
      findingsService.create({
        organizationId: 'org-1',
        repositoryId: 'repo-1',
        analysisJobId: 'job-1',
        title: 'A',
        description: 'D',
        severity: 'info',
        ruleId: 'r1',
      });
      findingsService.create({
        organizationId: 'org-2',
        repositoryId: 'repo-2',
        analysisJobId: 'job-2',
        title: 'B',
        description: 'D',
        severity: 'info',
        ruleId: 'r1',
      });
      const res = mockRes();
      findingsController.list(
        mockReq({ headers: { 'x-organization-id': 'org-1' } }),
        res,
      );
      expect(res.statusCode).toBe(200);
      const body = res.body as { data: Finding[] };
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.organizationId).toBe('org-1');
    });
  });

  describe('error format contract', () => {
    it('uses consistent error envelope shape for 404', () => {
      const res = mockRes();
      findingsController.getOne(
        mockReq({
          headers: { 'x-organization-id': 'org-1' },
          params: { id: 'missing-id' },
        }),
        res,
      );
      expectErrorEnvelope(res.body, 'NOT_FOUND', 404, res);
    });

    it('error envelope never exposes stack or internal keys', () => {
      const res = mockRes();
      findingsController.list(mockReq({ query: {} }), res);
      const keys = Object.keys(
        (res.body as { error: Record<string, unknown> }).error,
      );
      expect(keys.sort()).toEqual(['code', 'message'].sort());
    });
  });

  describe('backward compatibility', () => {
    it('accepts organizationId via query when header is absent', () => {
      findingsService.create({
        organizationId: 'org-legacy',
        repositoryId: 'repo-1',
        analysisJobId: 'job-1',
        title: 'Legacy',
        description: 'D',
        severity: 'medium',
        ruleId: 'r1',
      });
      const res = mockRes();
      findingsController.list(
        mockReq({ query: { organizationId: 'org-legacy', limit: '5' } }),
        res,
      );
      expect(res.statusCode).toBe(200);
      const body = res.body as { data: Finding[]; pagination: { limit: number } };
      expect(body.data).toHaveLength(1);
      expect(body.pagination.limit).toBe(5);
    });

    it('prefers x-organization-id header over query when both present', () => {
      findingsService.create({
        organizationId: 'org-header',
        repositoryId: 'repo-1',
        analysisJobId: 'job-1',
        title: 'FromHeader',
        description: 'D',
        severity: 'medium',
        ruleId: 'r1',
      });
      findingsService.create({
        organizationId: 'org-query',
        repositoryId: 'repo-1',
        analysisJobId: 'job-1',
        title: 'FromQuery',
        description: 'D',
        severity: 'medium',
        ruleId: 'r1',
      });
      const res = mockRes();
      findingsController.list(
        mockReq({
          headers: { 'x-organization-id': 'org-header' },
          query: { organizationId: 'org-query' },
        }),
        res,
      );
      expect(res.statusCode).toBe(200);
      const body = res.body as { data: Finding[] };
      expect(body.data.every((f) => f.organizationId === 'org-header')).toBe(
        true,
      );
    });

    it('clamps limit to server maximum without breaking callers', () => {
      const res = mockRes();
      findingsController.list(
        mockReq({
          headers: { 'x-organization-id': 'org-1' },
          query: { limit: '99999' },
        }),
        res,
      );
      expect(res.statusCode).toBe(200);
      const body = res.body as { pagination: { limit: number } };
      expect(body.pagination.limit).toBeLessThanOrEqual(100);
      expect(body.pagination.limit).toBeGreaterThan(0);
    });
  });
});
