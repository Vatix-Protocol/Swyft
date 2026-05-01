import { HttpAdapterHost } from '@nestjs/core';
import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ArgumentsHost } from '@nestjs/common';

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildMockHost(url = '/api/v1/test', method = 'GET'): ArgumentsHost {
  const mockReply = jest.fn();
  const mockRequest = { method, url } as unknown as Request;

  return {
    switchToHttp: () => ({
      getRequest: () => mockRequest,
      getResponse: () => ({}),
    }),
  } as unknown as ArgumentsHost;
}

function buildFilter(replyMock: jest.Mock): AllExceptionsFilter {
  const httpAdapter = {
    getRequestUrl: () => '/api/v1/test',
    reply: replyMock,
  };

  const httpAdapterHost = {
    httpAdapter,
  } as unknown as HttpAdapterHost;

  return new AllExceptionsFilter(httpAdapterHost);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AllExceptionsFilter', () => {
  let replyMock: jest.Mock;
  let filter: AllExceptionsFilter;
  let host: ArgumentsHost;

  beforeEach(() => {
    replyMock = jest.fn();
    filter = buildFilter(replyMock);
    host = buildMockHost();
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── 400 Validation ─────────────────────────────────────────────────────────

  describe('400 — ValidationPipe errors', () => {
    it('returns structured validationErrors array', () => {
      const exception = new BadRequestException({
        message: ['email must be an email', 'username must be longer than or equal to 3 characters'],
        error: 'Bad Request',
        statusCode: 400,
      });

      filter.catch(exception, host);

      const [body, status] = replyMock.mock.calls[0];

      expect(status).toBe(HttpStatus.BAD_REQUEST);
      expect(body.statusCode).toBe(400);
      expect(body.message).toBe('Validation failed');
      expect(body.error).toBe('Bad Request');
      expect(body.validationErrors).toBeInstanceOf(Array);
      expect(body.validationErrors.length).toBeGreaterThan(0);
      expect(body.timestamp).toBeDefined();
      expect(body.path).toBeDefined();
    });

    it('maps field names correctly', () => {
      const exception = new BadRequestException({
        message: ['email must be an email', 'email should not be empty'],
        error: 'Bad Request',
        statusCode: 400,
      });

      filter.catch(exception, host);
      const [body] = replyMock.mock.calls[0];

      const emailError = body.validationErrors.find(
        (e: { field: string }) => e.field === 'email',
      );
      expect(emailError).toBeDefined();
      expect(emailError.constraints).toContain('must be an email');
    });
  });

  // ── 400 Plain ──────────────────────────────────────────────────────────────

  describe('400 — plain BadRequestException', () => {
    it('returns { statusCode: 400 } with string message', () => {
      const exception = new BadRequestException('ID format is invalid');
      filter.catch(exception, host);

      const [body, status] = replyMock.mock.calls[0];
      expect(status).toBe(400);
      expect(body.message).toBe('ID format is invalid');
    });
  });

  // ── 401 ───────────────────────────────────────────────────────────────────

  describe('401 — UnauthorizedException', () => {
    it('returns 401 with correct shape', () => {
      const exception = new UnauthorizedException('Token is invalid or expired');
      filter.catch(exception, host);

      const [body, status] = replyMock.mock.calls[0];
      expect(status).toBe(401);
      expect(body.statusCode).toBe(401);
      expect(body.error).toMatch(/Unauthorized/i);
    });
  });

  // ── 404 ───────────────────────────────────────────────────────────────────

  describe('404 — NotFoundException', () => {
    it('returns 404 with descriptive message', () => {
      const exception = new NotFoundException("User with identifier 'abc-123' was not found");
      filter.catch(exception, host);

      const [body, status] = replyMock.mock.calls[0];
      expect(status).toBe(404);
      expect(body.message).toContain('abc-123');
    });
  });

  // ── 500 ───────────────────────────────────────────────────────────────────

  describe('500 — unhandled exceptions', () => {
    it('returns 500 with generic message in production', () => {
      process.env.NODE_ENV = 'production';
      filter.catch(new Error('DB connection refused'), host);

      const [body, status] = replyMock.mock.calls[0];
      expect(status).toBe(500);
      expect(body.message).toBe('An unexpected error occurred');
      // must not expose the real error message in prod
      expect(body.message).not.toContain('DB connection');
    });

    it('exposes message in non-production environments', () => {
      process.env.NODE_ENV = 'test';
      filter.catch(new Error('DB connection refused'), host);

      const [body] = replyMock.mock.calls[0];
      expect(body.message).toContain('DB connection refused');
    });

    it('always includes timestamp and path', () => {
      filter.catch(new Error('boom'), host);

      const [body] = replyMock.mock.calls[0];
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.path).toBeDefined();
    });
  });

  // ── Response shape contract ────────────────────────────────────────────────

  describe('Response shape contract', () => {
    const exceptions = [
      new BadRequestException('bad'),
      new UnauthorizedException(),
      new NotFoundException(),
      new Error('boom'),
    ];

    it.each(exceptions)('always includes statusCode, message, error, timestamp, path', (exc) => {
      filter.catch(exc, host);
      const [body] = replyMock.mock.calls[0];

      expect(body).toHaveProperty('statusCode');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path');

      replyMock.mockClear();
    });
  });
});
