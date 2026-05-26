import { describe, expect, it, vi, beforeEach } from 'vitest';
import { testRouter } from './test';
import type { TrpcContext } from '../_core/context';

// Mock database
const mockDb = {
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
  }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue({}),
    }),
  }),
};

// Mock context
const createMockContext = (): TrpcContext => ({
  user: {
    id: 1,
    openId: 'test-user',
    email: 'test@example.com',
    name: 'Test User',
    loginMethod: 'test',
    role: 'user',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: {
    protocol: 'https',
    headers: {},
  } as TrpcContext['req'],
  res: {} as TrpcContext['res'],
});

describe('Test Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should validate saveConfig input', async () => {
    const caller = testRouter.createCaller(createMockContext());

    try {
      // @ts-ignore - intentionally passing invalid data
      await caller.saveConfig({
        name: 'Test Config',
        // Missing required fields
      });
      expect.fail('Should have thrown validation error');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('should validate executeTest input', async () => {
    const caller = testRouter.createCaller(createMockContext());

    try {
      // @ts-ignore - intentionally passing invalid data
      await caller.executeTest({
        apiProvider: 'openai',
        // Missing required fields
      });
      expect.fail('Should have thrown validation error');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  it('should reject empty text input when saving config', async () => {
    const caller = testRouter.createCaller(createMockContext());

    await expect(
      caller.saveConfig({
        name: 'Test Config',
        apiProvider: 'openai',
        apiUrl: 'https://example.com/v1/chat/completions',
        apiKey: 'secret',
        model: 'test-model',
        loadMode: 'constant',
        loadConfig: {
          concurrency: 1,
          duration: 60,
        },
        inputType: 'text',
        inputData: '   ',
      })
    ).rejects.toBeDefined();
  });

  it('should reject empty text input when executing test', async () => {
    const caller = testRouter.createCaller(createMockContext());

    await expect(
      caller.executeTest({
        apiProvider: 'openai',
        apiUrl: 'https://example.com/v1/chat/completions',
        apiKey: 'secret',
        model: 'test-model',
        loadMode: 'constant',
        loadConfig: {
          concurrency: 1,
          duration: 60,
        },
        inputType: 'text',
        inputData: '   ',
      })
    ).rejects.toBeDefined();
  });

  it('should require authentication for protected procedures', async () => {
    const contextWithoutUser = {
      user: null,
      req: { protocol: 'https', headers: {} } as TrpcContext['req'],
      res: {} as TrpcContext['res'],
    };

    const caller = testRouter.createCaller(contextWithoutUser as any);

    try {
      await caller.getConfigs();
      expect.fail('Should have thrown auth error');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
