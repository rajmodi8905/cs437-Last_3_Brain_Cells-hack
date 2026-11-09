// Errors reach students as a plain sentence that says what happened and what to do. The raw
// text stays available as a detail for a bug report, never as the message itself.
import { describe, expect, it } from 'vitest';
import { plainError } from '../../src/app/plainError';
import { AppOperationError } from '../../src/shared';
import { ApiFailure } from '../../pilot/client/api';
import type { PilotErrorCode } from '../../pilot/contract';

// Words and codes a student should never have to read in an error message.
const JARGON =
  /vault|epoch|cursor|embedding|inference|assets?\b|quota|csrf|\bhttp \d{3}|\b[A-Z]{3,}_[A-Z_]+\b|unicode|code points|\bhash\b|TypeError|DOMException|undefined/i;
const sentence = (text: string) => expect(text).toMatch(/^[A-Z].*[.!?]$/s);

describe('plainError', () => {
  it.each<PilotErrorCode>([
    'RATE_LIMITED',
    'NOT_FOUND',
    'VAULT_RESET',
    'QUOTA_EXCEEDED',
    'UNAUTHENTICATED',
    'FORBIDDEN',
    'RESYNC_REQUIRED',
    'INTERNAL_ERROR',
    'LIMIT_EXCEEDED',
    'INVALID_INPUT',
  ])('turns the Auto-sync %s error into a plain sentence', (code) => {
    const raw = code === 'INVALID_INPUT' ? 'after must be a cursor.' : `HTTP 500`;
    const result = plainError(new ApiFailure(500, code, raw, {}));
    sentence(result.message);
    expect(result.message).not.toMatch(JARGON);
    expect(result.message).not.toContain(code);
    expect(result.detail).toContain(raw);
  });

  it('says a full cloud library is full and a rate limit means waiting', () => {
    expect(
      plainError(new ApiFailure(413, 'QUOTA_EXCEEDED', 'Quota exceeded.', {})).message,
    ).toMatch(/full/i);
    expect(plainError(new ApiFailure(429, 'RATE_LIMITED', 'HTTP 429', {})).message).toMatch(
      /wait/i,
    );
  });

  it('explains a network failure as a connection problem', () => {
    for (const cause of [
      new TypeError('Failed to fetch'),
      new TypeError('NetworkError when attempting to fetch resource.'),
      new TypeError('Load failed'),
    ]) {
      const result = plainError(cause);
      expect(result.message).toMatch(/connection/i);
      expect(result.message).not.toMatch(JARGON);
    }
  });

  it('explains a storage quota failure as running out of space', () => {
    const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    const wrapped = new AppOperationError({
      code: 'STORAGE_FAILED',
      message: 'QuotaExceededError: The quota has been exceeded.',
      retryable: true,
    });
    for (const cause of [quota, wrapped]) {
      const result = plainError(cause);
      expect(result.message).toMatch(/space/i);
      expect(result.message).not.toMatch(JARGON);
      sentence(result.message);
    }
  });

  it.each([
    'Title must be between one and 120 Unicode code points.',
    'Integrity check failed for embeddinggemma/onnx/model_q4.onnx. Please retry setup.',
    'Could not download embeddinggemma/onnx/model_q4.onnx. Retry when connected.',
    'Downloaded original does not match its hash.',
    'HTTP 502',
    'Request origin or CSRF token is not valid.',
    'after must be a cursor.',
    'This browser does not support safe processing locks. Use a current Safari, Chrome or Firefox.',
    'The server did not return the requested part of the original.',
  ])('rewrites the raw message %j and keeps it as a detail', (raw) => {
    for (const cause of [new Error(raw), raw, `Error: ${raw}`]) {
      const result = plainError(cause);
      sentence(result.message);
      expect(result.message).not.toMatch(JARGON);
      expect(result.message).not.toBe(raw);
      expect(result.detail).toContain(raw);
    }
  });

  it('keeps a title rule that names the real limit', () => {
    const cause = new AppOperationError({
      code: 'INVALID_INPUT',
      message: 'Title must be between one and 120 Unicode code points.',
      retryable: false,
    });
    expect(plainError(cause).message).toMatch(/120 characters/);
  });

  it('keeps messages that are already written for students', () => {
    for (const message of [
      'This website could not be captured. Paste its text below, or import an HTML or PDF snapshot. Your browser may block direct access.',
      'This PDF exceeds 50 pages. Split it into smaller documents.',
      'Archive manifest is invalid.',
      'This original is unavailable. Restore it from a backup if you have one.',
    ]) {
      const result = plainError(new Error(message));
      expect(result.message).toBe(message);
      expect(result.detail).toBeUndefined();
    }
    const archive = new AppOperationError({
      code: 'INVALID_ARCHIVE',
      message: 'Archive hash does not match its original.',
      retryable: false,
    });
    expect(plainError(archive).message).toBe('Archive hash does not match its original.');
  });

  it('falls back to a plain sentence and keeps the unknown text as a detail', () => {
    for (const cause of [
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      { weird: true },
      'DatabaseClosedError: Database has been closed',
    ]) {
      const result = plainError(cause);
      sentence(result.message);
      expect(result.message).not.toMatch(JARGON);
      expect(result.detail).toBeTruthy();
    }
  });
});
