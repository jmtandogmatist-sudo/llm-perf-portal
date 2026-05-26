import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { apiKeys, ApiKey, InsertApiKey } from '../../drizzle/schema';

/**
 * API Key 管理服务
 * 支持多 Key 存储、加密、轮换和使用统计
 */
export class KeyManager {
  private encryptionKey: string;

  constructor(encryptionKey?: string) {
    // 使用环境变量中的加密密钥，如果没有则使用默认值
    this.encryptionKey = encryptionKey || process.env.ENCRYPTION_KEY || 'default-encryption-key-32-chars-long';
    
    // 确保密钥长度正确（32 字节用于 AES-256）
    if (this.encryptionKey.length < 32) {
      this.encryptionKey = this.encryptionKey.padEnd(32, '0');
    } else if (this.encryptionKey.length > 32) {
      this.encryptionKey = this.encryptionKey.substring(0, 32);
    }
  }

  private encryptKey(key: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', Buffer.from(this.encryptionKey), iv);
    let encrypted = cipher.update(key, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  }

  private decryptKey(encryptedKey: string): string {
    const [ivHex, encrypted] = encryptedKey.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = createDecipheriv('aes-256-cbc', Buffer.from(this.encryptionKey), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }

  async addKey(
    userId: number,
    apiProvider: string,
    key: string,
    keyName?: string
  ): Promise<ApiKey> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const encryptedKey = this.encryptKey(key);
    await db.insert(apiKeys).values({
      userId,
      apiProvider,
      keyEncrypted: encryptedKey,
      keyName: keyName || `Key ${Date.now()}`,
      isActive: true,
    });

    const inserted = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.apiProvider, apiProvider), eq(apiKeys.userId, userId)))
      .orderBy(apiKeys.createdAt)
      .limit(1);

    return inserted[0] as ApiKey;
  }

  async getActiveKeys(userId: number, apiProvider: string): Promise<string[]> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const keys = await db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.apiProvider, apiProvider),
          eq(apiKeys.userId, userId),
          eq(apiKeys.isActive, true),
          isNull(apiKeys.deletedAt)
        )
      );

    return keys.map(k => this.decryptKey(k.keyEncrypted));
  }

  async getNextKey(userId: number, apiProvider: string): Promise<{ key: string; keyId: number } | null> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const keys = await db
      .select()
      .from(apiKeys)
      .where(
        and(
          eq(apiKeys.apiProvider, apiProvider),
          eq(apiKeys.userId, userId),
          eq(apiKeys.isActive, true),
          isNull(apiKeys.deletedAt)
        )
      )
      .orderBy(apiKeys.usageCount)
      .limit(1);

    if (keys.length === 0) {
      return null;
    }

    return {
      key: this.decryptKey(keys[0].keyEncrypted),
      keyId: keys[0].id,
    };
  }

  async recordKeyUsage(keyId: number): Promise<void> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }

    const currentKey = await db.select().from(apiKeys).where(eq(apiKeys.id, keyId)).limit(1);
    if (currentKey.length > 0) {
      await db
        .update(apiKeys)
        .set({
          usageCount: (currentKey[0].usageCount || 0) + 1,
          lastUsedAt: new Date(),
        })
        .where(eq(apiKeys.id, keyId));
    }
  }

  async disableKey(keyId: number): Promise<void> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }
    await db.update(apiKeys).set({ isActive: false }).where(eq(apiKeys.id, keyId));
  }

  async deleteKey(keyId: number): Promise<void> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }
    await db.update(apiKeys).set({ deletedAt: new Date(), isActive: false }).where(eq(apiKeys.id, keyId));
  }

  async getAllKeys(userId: number, apiProvider: string): Promise<ApiKey[]> {
    const db = await getDb();
    if (!db) {
      throw new Error('Database not available');
    }
    return await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.apiProvider, apiProvider), eq(apiKeys.userId, userId), isNull(apiKeys.deletedAt)));
  }

  async getKeyStats(userId: number, apiProvider: string): Promise<{
    totalKeys: number;
    activeKeys: number;
    totalUsage: number;
    averageUsage: number;
  }> {
    const keys = await this.getAllKeys(userId, apiProvider);
    const activeKeys = keys.filter(k => k.isActive === true);
    const totalUsage = keys.reduce((sum, k) => sum + (k.usageCount || 0), 0);
    return {
      totalKeys: keys.length,
      activeKeys: activeKeys.length,
      totalUsage,
      averageUsage: keys.length > 0 ? totalUsage / keys.length : 0,
    };
  }
}

export const keyManager = new KeyManager();
