import { describe, expect, it, vi, beforeEach } from 'vitest';
import { testRouter } from './test';
import type { TrpcContext } from '../_core/context';

// ──────────────────────────────────────────────────────────
// Mock 依赖
// ──────────────────────────────────────────────────────────

/**
 * 构建完整的 Drizzle ORM select 链 Mock
 *
 * Drizzle 的 select 查询可能使用以下任意组合：
 *   .select().from().where()
 *   .select().from().where().orderBy().limit()
 *   .select().from().where().limit()
 *
 * 使用递归可链式的 Mock 对象，确保每个方法都返回
 * 同一个对象（既可以 await 解析为 []，也可以继续链式调用）
 */
function buildSelectChainMock(resolvedValue: any[] = []) {
  // 构建一个既是 Promise（可 await）又有链式方法的对象
  const chainable: any = Object.assign(Promise.resolve(resolvedValue), {
    from: vi.fn().mockImplementation(() => chainable),
    where: vi.fn().mockImplementation(() => chainable),
    orderBy: vi.fn().mockImplementation(() => chainable),
    limit: vi.fn().mockImplementation(() => Promise.resolve(resolvedValue)),
  });
  return chainable;
}

/**
 * Mock 数据库模块
 * 使用链式调用结构模拟 Drizzle ORM 的 insert / select / update 行为
 * select 链支持 .where().orderBy().limit() 完整调用序列
 */
vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
    }),
    select: vi.fn().mockImplementation(() => buildSelectChainMock()),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    }),
  }),
}));

// ──────────────────────────────────────────────────────────
// 测试工具函数
// ──────────────────────────────────────────────────────────

/**
 * 创建标准 Mock 上下文（已登录用户）
 * 所有需要认证的 procedure 都需要此上下文
 */
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

/**
 * 创建未登录 Mock 上下文（user 为 null）
 * 用于测试认证守卫是否正确阻断未授权请求
 */
const createUnauthenticatedContext = () => ({
  user: null,
  req: { protocol: 'https', headers: {} } as TrpcContext['req'],
  res: {} as TrpcContext['res'],
});

/**
 * 构建合法的 LLM saveConfig 请求体（最小可通过验证集合）
 */
const validLlmSaveConfigInput = () => ({
  name: 'LLM Test Config',
  apiProvider: 'openai',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-testkey',
  model: 'gpt-4o',
  loadMode: 'constant' as const,
  loadConfig: { concurrency: 5, duration: 60 },
  inputType: 'text' as const,
  inputData: 'Hello, world!',
});

/**
 * 构建合法的 LLM executeTest 请求体
 */
const validLlmExecuteTestInput = () => ({
  apiProvider: 'openai',
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  apiKey: 'sk-testkey',
  model: 'gpt-4o',
  loadMode: 'constant' as const,
  loadConfig: { concurrency: 1, duration: 10 },
  inputType: 'text' as const,
  inputData: 'Test prompt for performance evaluation.',
});

/**
 * 构建合法的 REST_API saveConfig 请求体
 */
const validRestSaveConfigInput = () => ({
  name: 'REST API Test Config',
  testType: 'REST_API',
  protocolConfig: {
    url: 'https://example.com/api/v1/health',
    method: 'GET',
    headers: { 'X-Test': 'true' },
    queryParams: { foo: 'bar' },
    bodyType: 'json',
    bodyContent: '',
    expectedStatus: 200,
  },
  loadMode: 'constant' as const,
  loadConfig: { concurrency: 5, duration: 30 },
});

/**
 * 构建合法的 REST_API executeTest 请求体
 */
const validRestExecuteTestInput = () => ({
  testType: 'REST_API',
  protocolConfig: {
    url: 'https://example.com/api/v1/health',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    bodyType: 'json',
    bodyContent: '{"status":"ok"}',
    expectedStatus: 201,
  },
  loadMode: 'constant' as const,
  loadConfig: { concurrency: 10, duration: 10 },
});

// ──────────────────────────────────────────────────────────
// 测试套件
// ──────────────────────────────────────────────────────────

describe('Test Router - 参数验证与边界测试', () => {
  beforeEach(() => {
    // 每个测试前清空所有 Mock 调用记录，确保测试相互独立
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────
  // 分组 1：saveConfig - 输入验证
  // ────────────────────────────────────────────────────────
  describe('saveConfig - 输入参数验证', () => {
    it('缺失 name 字段时应抛出验证错误', async () => {
      const caller = testRouter.createCaller(createMockContext());
      try {
        // @ts-ignore 故意传入不合法数据
        await caller.saveConfig({
          apiProvider: 'openai',
          apiUrl: 'https://api.openai.com/v1/chat/completions',
          apiKey: 'sk-test',
          model: 'gpt-4o',
          loadMode: 'constant',
          loadConfig: { concurrency: 1, duration: 60 },
          inputType: 'text',
          inputData: 'hello',
          // name 字段缺失
        });
        expect.fail('缺失 name 时应抛出验证错误');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('缺失所有必填字段时应抛出验证错误', async () => {
      const caller = testRouter.createCaller(createMockContext());
      try {
        // @ts-ignore 故意传入不合法数据
        await caller.saveConfig({ name: 'Incomplete Config' });
        expect.fail('缺失必填字段时应抛出验证错误');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('inputData 为纯空白字符串（只含空格）时应被拒绝', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.saveConfig({
          ...validLlmSaveConfigInput(),
          inputType: 'text',
          inputData: '   ', // 纯空格，trim 后为空
        })
      ).rejects.toBeDefined();
    });

    it('inputData 为空字符串时应被拒绝', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.saveConfig({
          ...validLlmSaveConfigInput(),
          inputType: 'text',
          inputData: '',
        })
      ).rejects.toBeDefined();
    });

    it('loadConfig.concurrency 为 0 时应被拒绝（下边界）', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.saveConfig({
          ...validLlmSaveConfigInput(),
          loadConfig: { concurrency: 0, duration: 60 }, // 0 低于最小值 1
        })
      ).rejects.toBeDefined();
    });

    it('loadConfig.concurrency 为负数时应被拒绝', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.saveConfig({
          ...validLlmSaveConfigInput(),
          loadConfig: { concurrency: -5, duration: 60 },
        })
      ).rejects.toBeDefined();
    });

    it('loadConfig.duration 为 0 时应被拒绝（下边界）', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.saveConfig({
          ...validLlmSaveConfigInput(),
          loadConfig: { concurrency: 1, duration: 0 }, // 0 低于最小值
        })
      ).rejects.toBeDefined();
    });

    it('传入合法的 LLM 配置时应成功保存并返回 configId', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig(validLlmSaveConfigInput());
      // 断言返回值包含 configId 和 success 标志
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('传入合法的 REST_API 配置时应成功保存', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig(validRestSaveConfigInput());
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('loadMode 为 ramp_up 时传入合法的阶梯参数应成功', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validLlmSaveConfigInput(),
        loadMode: 'ramp_up',
        loadConfig: { start: 1, end: 50, step: 5, duration: 120 },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('loadMode 为 spike 时传入合法的突刺参数应成功', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validLlmSaveConfigInput(),
        loadMode: 'spike',
        loadConfig: { baseline: 10, spike: 100, spike_duration: 10 },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });
  });

  // ────────────────────────────────────────────────────────
  // 分组 2：executeTest - 输入验证
  // ────────────────────────────────────────────────────────
  describe('executeTest - 输入参数验证', () => {
    it('缺失 apiProvider 以外所有字段时应抛出验证错误', async () => {
      const caller = testRouter.createCaller(createMockContext());
      try {
        // @ts-ignore 故意传入不合法数据
        await caller.executeTest({ apiProvider: 'openai' });
        expect.fail('缺失必填字段时应抛出验证错误');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('inputData 为纯空白字符串时应被拒绝执行测试', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.executeTest({
          ...validLlmExecuteTestInput(),
          inputType: 'text',
          inputData: '   ',
        })
      ).rejects.toBeDefined();
    });

    it('inputData 为空字符串时应被拒绝执行测试', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.executeTest({
          ...validLlmExecuteTestInput(),
          inputType: 'text',
          inputData: '',
        })
      ).rejects.toBeDefined();
    });

    it('loadConfig.concurrency 为 0 时应被拒绝', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.executeTest({
          ...validLlmExecuteTestInput(),
          loadConfig: { concurrency: 0, duration: 30 },
        })
      ).rejects.toBeDefined();
    });

    it('loadConfig.concurrency 为负数时应被拒绝', async () => {
      const caller = testRouter.createCaller(createMockContext());
      await expect(
        caller.executeTest({
          ...validLlmExecuteTestInput(),
          loadConfig: { concurrency: -1, duration: 30 },
        })
      ).rejects.toBeDefined();
    });

    it('传入合法的 LLM 执行参数时应返回 resultId', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.executeTest(validLlmExecuteTestInput());
      // 断言返回值包含 resultId 字段
      expect(result).toEqual({ resultId: 1 });
    });

    it('传入合法的 REST_API 执行参数时应返回 resultId', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.executeTest(validRestExecuteTestInput());
      expect(result).toEqual({ resultId: 1 });
    });

    it('REST_API 配置使用 POST method 时应正常执行', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.executeTest({
        ...validRestExecuteTestInput(),
        protocolConfig: {
          ...validRestExecuteTestInput().protocolConfig,
          method: 'POST',
          bodyType: 'json',
          bodyContent: '{"key":"value"}',
        },
      });
      expect(result).toEqual({ resultId: 1 });
    });
  });

  // ────────────────────────────────────────────────────────
  // 分组 3：认证守卫
  // ────────────────────────────────────────────────────────
  describe('认证守卫 - 未登录访问受保护接口', () => {
    it('未登录用户访问 getConfigs 时应抛出认证错误', async () => {
      const caller = testRouter.createCaller(createUnauthenticatedContext() as any);
      try {
        await caller.getConfigs();
        expect.fail('未登录应抛出认证错误');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('未登录用户访问 getResults 时应抛出认证错误', async () => {
      const caller = testRouter.createCaller(createUnauthenticatedContext() as any);
      try {
        await caller.getResults();
        expect.fail('未登录应抛出认证错误');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('未登录用户调用 saveConfig 时应抛出认证错误', async () => {
      const caller = testRouter.createCaller(createUnauthenticatedContext() as any);
      try {
        await caller.saveConfig(validLlmSaveConfigInput() as any);
        expect.fail('未登录应抛出认证错误');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    it('未登录用户调用 executeTest 时应抛出认证错误', async () => {
      const caller = testRouter.createCaller(createUnauthenticatedContext() as any);
      try {
        await caller.executeTest(validLlmExecuteTestInput() as any);
        expect.fail('未登录应抛出认证错误');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  // ────────────────────────────────────────────────────────
  // 分组 4：REST_API 协议配置校验
  // ────────────────────────────────────────────────────────
  describe('REST_API - 协议配置边界校验', () => {
    it('REST_API 配置使用 GET method 时应成功保存', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validRestSaveConfigInput(),
        protocolConfig: {
          ...validRestSaveConfigInput().protocolConfig,
          method: 'GET',
        },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('REST_API 配置使用 DELETE method 时应成功保存', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validRestSaveConfigInput(),
        protocolConfig: {
          ...validRestSaveConfigInput().protocolConfig,
          method: 'DELETE',
        },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('REST_API 配置 expectedStatus 为 404 时应成功保存', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validRestSaveConfigInput(),
        protocolConfig: {
          ...validRestSaveConfigInput().protocolConfig,
          expectedStatus: 404,
        },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('REST_API 配置包含自定义 Headers 时应成功保存', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validRestSaveConfigInput(),
        protocolConfig: {
          ...validRestSaveConfigInput().protocolConfig,
          headers: {
            'Authorization': 'Bearer my-token',
            'X-Custom-Header': 'custom-value',
            'Content-Type': 'application/json',
          },
        },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('REST_API 执行时使用高并发 (concurrency=50) 应成功入队', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.executeTest({
        ...validRestExecuteTestInput(),
        loadMode: 'constant',
        loadConfig: { concurrency: 50, duration: 30 },
      });
      expect(result).toEqual({ resultId: 1 });
    });
  });

  // ────────────────────────────────────────────────────────
  // 分组 5：负载模式多样性验证
  // ────────────────────────────────────────────────────────
  describe('负载模式 - 各模式参数合法性', () => {
    it('constant 模式：最小合法并发数 (1) 应通过验证', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validLlmSaveConfigInput(),
        loadMode: 'constant',
        loadConfig: { concurrency: 1, duration: 10 },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('constant 模式：大并发数 (concurrency=200) 应通过验证', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validLlmSaveConfigInput(),
        loadMode: 'constant',
        loadConfig: { concurrency: 200, duration: 60 },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });

    it('fluctuate 模式：正确的波动参数应通过验证', async () => {
      const caller = testRouter.createCaller(createMockContext());
      const result = await caller.saveConfig({
        ...validLlmSaveConfigInput(),
        loadMode: 'fluctuate',
        loadConfig: { min: 5, max: 50, period: 30, duration: 300 },
      });
      expect(result).toEqual({ configId: 1, success: true });
    });
  });
});
