import Dexie, { Table } from 'dexie';
import type { OfflineSyncWarning } from '@/lib/questions/offline-answers';

// Types for database entities
export interface Assessment {
  id?: number;
  uuid: string;
  assessorId: string;
  entityId: string;
  assessmentType: string;
  data: string; // Encrypted JSON
  keyVersion?: number;
  gpsLocation?: string;
  timestamp: Date;
  syncStatus: 'pending' | 'synced' | 'failed';
  lastModified: Date;
  /** P5: server-reported registry-drift warnings from the last offline sync. */
  warnings?: OfflineSyncWarning[];
}

export interface Response {
  id?: number;
  uuid: string;
  responderId: string;
  assessmentId: string;
  data: string; // Encrypted JSON
  keyVersion?: number;
  timestamp: Date;
  syncStatus: 'pending' | 'synced' | 'failed';
  lastModified: Date;
}

export interface Entity {
  id?: number;
  uuid: string;
  name: string;
  type: string;
  data: string; // Encrypted JSON
  keyVersion?: number;
  lastModified: Date;
  syncStatus: 'pending' | 'synced' | 'failed';
}

export interface SyncQueueItem {
  id?: number;
  uuid: string;
  type: 'assessment' | 'response' | 'entity';
  action: 'create' | 'update' | 'delete';
  entityUuid: string;
  data: string; // Encrypted JSON
  keyVersion?: number;
  priority: number;
  attempts: number;
  lastAttempt?: Date;
  nextRetry?: Date;
  error?: string;
  timestamp: Date;
}

export interface EncryptionKey {
  id?: number;
  keyName: string;
  keyData: string; // Base64 encoded key
  version: number;
  created: Date;
  lastUsed: Date;
  isActive: boolean;
  rotationSchedule?: Date;
}

export interface CachedSignal {
  id?: number;
  signalId: string;
  userId: string;
  entityId: string;
  incidentId: string | null;
  type: string;
  signalReason: string;
  priority: string;
  context: string;
  entity: string;
  incident: string;
  createdAt: string;
  resolvedAt: string | null;
  cachedAt: Date;
  expiresAt: Date;
}

// Encryption utilities using Web Crypto API
export class EncryptionManager {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12;
  private static readonly KEY_ROTATION_DAYS = 90; // Rotate every 90 days
  public static readonly MAX_KEY_VERSIONS = 5; // Keep 5 previous versions for decryption

  static async generateKey(): Promise<CryptoKey> {
    return await crypto.subtle.generateKey(
      {
        name: this.ALGORITHM,
        length: this.KEY_LENGTH,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  static async exportKey(key: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  static async importKey(keyData: string): Promise<CryptoKey> {
    const keyBytes = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
    return await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: this.ALGORITHM },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async encrypt(data: string, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
    const encodedData = new TextEncoder().encode(data);
    
    const encrypted = await crypto.subtle.encrypt(
      {
        name: this.ALGORITHM,
        iv: iv,
      },
      key,
      encodedData
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  }

  static async decrypt(encryptedData: string, key: CryptoKey): Promise<string> {
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    const iv = combined.slice(0, this.IV_LENGTH);
    const encrypted = combined.slice(this.IV_LENGTH);

    const decrypted = await crypto.subtle.decrypt(
      {
        name: this.ALGORITHM,
        iv: iv,
      },
      key,
      encrypted
    );

    return new TextDecoder().decode(decrypted);
  }

  static shouldRotateKey(keyCreated: Date): boolean {
    const daysSinceCreation = Math.floor((Date.now() - keyCreated.getTime()) / (1000 * 60 * 60 * 24));
    return daysSinceCreation >= this.KEY_ROTATION_DAYS;
  }

  static getNextRotationDate(created: Date): Date {
    const nextRotation = new Date(created);
    nextRotation.setDate(nextRotation.getDate() + this.KEY_ROTATION_DAYS);
    return nextRotation;
  }
}

// Main database class
export class OfflineDatabase extends Dexie {
  assessments!: Table<Assessment>;
  responses!: Table<Response>;
  entities!: Table<Entity>;
  syncQueue!: Table<SyncQueueItem>;
  encryptionKeys!: Table<EncryptionKey>;
  cachedSignals!: Table<CachedSignal>;

  private encryptionKey: CryptoKey | null = null;
  private currentKeyVersion: number = 1;
  private keyCache: Map<number, CryptoKey> = new Map();

  constructor() {
    super('DisasterManagementDB');
    
    this.version(1).stores({
      assessments: '++id, uuid, assessorId, entityId, assessmentType, syncStatus, timestamp, lastModified, keyVersion',
      responses: '++id, uuid, responderId, assessmentId, syncStatus, timestamp, lastModified, keyVersion',
      entities: '++id, uuid, name, type, syncStatus, lastModified, keyVersion',
      syncQueue: '++id, uuid, type, action, entityUuid, priority, attempts, nextRetry, timestamp',
      encryptionKeys: '++id, keyName, version, created, lastUsed, isActive'
    });

    this.version(2).stores({
      assessments: '++id, uuid, assessorId, entityId, assessmentType, syncStatus, timestamp, lastModified, keyVersion',
      responses: '++id, uuid, responderId, assessmentId, syncStatus, timestamp, lastModified, keyVersion',
      entities: '++id, uuid, name, type, syncStatus, lastModified, keyVersion',
      syncQueue: '++id, uuid, type, action, entityUuid, priority, attempts, nextRetry, timestamp',
      encryptionKeys: '++id, keyName, version, created, lastUsed, isActive',
      cachedSignals: '++id, signalId, userId, entityId, signalReason, priority, cachedAt, expiresAt'
    });
  }

  async initializeEncryption(): Promise<void> {
    try {
      // Try to load active key
      const activeKey = await this.encryptionKeys
        .where('keyName').equals('primary')
        .and(key => key.isActive)
        .first();
      
      if (activeKey) {
        this.encryptionKey = await EncryptionManager.importKey(activeKey.keyData);
        this.currentKeyVersion = activeKey.version;
        this.keyCache.set(activeKey.version, this.encryptionKey);
        
        // Update last used timestamp
        await this.encryptionKeys.update(activeKey.id!, { lastUsed: new Date() });
        
        // Check if key needs rotation
        if (EncryptionManager.shouldRotateKey(activeKey.created)) {
          console.log('Key rotation needed - scheduling rotation');
          await this.scheduleKeyRotation();
        }
      } else {
        // Generate new key
        await this.createNewEncryptionKey();
      }
      
      // Load previous keys for decryption
      await this.loadPreviousKeys();
    } catch (error) {
      console.error('Failed to initialize encryption:', error);
      throw new Error('Encryption initialization failed');
    }
  }

  private async createNewEncryptionKey(): Promise<void> {
    this.encryptionKey = await EncryptionManager.generateKey();
    const keyData = await EncryptionManager.exportKey(this.encryptionKey);
    
    // Get next version number
    const lastKey = await this.encryptionKeys
      .where('keyName').equals('primary')
      .reverse()
      .sortBy('version');
    
    this.currentKeyVersion = lastKey.length > 0 ? lastKey[0].version + 1 : 1;
    
    const now = new Date();
    await this.encryptionKeys.add({
      keyName: 'primary',
      keyData,
      version: this.currentKeyVersion,
      created: now,
      lastUsed: now,
      isActive: true,
      rotationSchedule: EncryptionManager.getNextRotationDate(now)
    });
    
    this.keyCache.set(this.currentKeyVersion, this.encryptionKey);
  }

  private async loadPreviousKeys(): Promise<void> {
    const previousKeys = await this.encryptionKeys
      .where('keyName').equals('primary')
      .and(key => !key.isActive)
      .reverse()
      .sortBy('version');
    
    // Load up to MAX_KEY_VERSIONS previous keys
    const keysToLoad = previousKeys.slice(0, EncryptionManager.MAX_KEY_VERSIONS);
    
    for (const keyRecord of keysToLoad) {
      try {
        const key = await EncryptionManager.importKey(keyRecord.keyData);
        this.keyCache.set(keyRecord.version, key);
      } catch (error) {
        console.warn(`Failed to load key version ${keyRecord.version}:`, error);
      }
    }
  }

  private async scheduleKeyRotation(): Promise<void> {
    // In a real application, this would schedule a background task
    // For now, we'll perform rotation immediately if conditions are met
    const canRotate = await this.canPerformKeyRotation();
    if (canRotate) {
      await this.performKeyRotation();
    }
  }

  private async canPerformKeyRotation(): Promise<boolean> {
    // Check if there are pending sync operations that might use the current key
    const pendingCount = await this.syncQueue.count();
    return pendingCount === 0; // Only rotate when no pending operations
  }

  async performKeyRotation(): Promise<void> {
    let currentKey: any = null;
    try {
      console.log('Performing key rotation...');
      
      // Mark current key as inactive
      currentKey = await this.encryptionKeys
        .where('keyName').equals('primary')
        .and(key => key.isActive)
        .first();
      
      if (currentKey) {
        await this.encryptionKeys.update(currentKey.id!, { isActive: false });
      }
      
      // Create new key
      await this.createNewEncryptionKey();
      
      // Clean up old keys (keep only MAX_KEY_VERSIONS)
      await this.cleanupOldKeys();
      
      console.log(`Key rotation completed. New version: ${this.currentKeyVersion}`);
    } catch (error) {
      console.error('Key rotation failed:', error);
      // Revert current key to active if rotation failed
      if (currentKey) {
        await this.encryptionKeys.update(currentKey.id!, { isActive: true });
      }
      throw error;
    }
  }

  private async cleanupOldKeys(): Promise<void> {
    const allKeys = await this.encryptionKeys
      .where('keyName').equals('primary')
      .reverse()
      .sortBy('version');
    
    // Keep active key + MAX_KEY_VERSIONS inactive keys
    const keysToDelete = allKeys.slice(EncryptionManager.MAX_KEY_VERSIONS + 1);
    
    for (const key of keysToDelete) {
      await this.encryptionKeys.delete(key.id!);
      this.keyCache.delete(key.version);
    }
  }

  async encryptData(data: any): Promise<{ encryptedData: string; keyVersion: number }> {
    if (!this.encryptionKey) {
      await this.initializeEncryption();
    }
    const jsonData = JSON.stringify(data);
    const encryptedData = await EncryptionManager.encrypt(jsonData, this.encryptionKey!);
    return { encryptedData, keyVersion: this.currentKeyVersion };
  }

  async decryptData(encryptedData: string, keyVersion?: number): Promise<any> {
    if (!this.encryptionKey) {
      await this.initializeEncryption();
    }
    
    // Try current key first if no version specified
    if (!keyVersion) {
      try {
        const jsonData = await EncryptionManager.decrypt(encryptedData, this.encryptionKey!);
        return JSON.parse(jsonData);
      } catch (error) {
        // If current key fails, try all cached keys
        for (const [version, key] of this.keyCache.entries()) {
          try {
            const jsonData = await EncryptionManager.decrypt(encryptedData, key);
            return JSON.parse(jsonData);
          } catch {
            // Continue to next key
          }
        }
        throw new Error('Failed to decrypt data with any available key');
      }
    }
    
    // Use specific key version
    const key = this.keyCache.get(keyVersion);
    if (!key) {
      throw new Error(`Key version ${keyVersion} not available`);
    }
    
    const jsonData = await EncryptionManager.decrypt(encryptedData, key);
    return JSON.parse(jsonData);
  }

  // Assessment operations
  async addAssessment(assessment: Omit<Assessment, 'id' | 'data'> & { data: any }): Promise<number> {
    const { encryptedData, keyVersion } = await this.encryptData(assessment.data);
    return await this.assessments.add({
      ...assessment,
      data: encryptedData,
      keyVersion,
      timestamp: new Date(),
      lastModified: new Date(),
      syncStatus: 'pending'
    });
  }

  async getAssessment(uuid: string): Promise<(Assessment & { decryptedData: any }) | undefined> {
    const assessment = await this.assessments.where('uuid').equals(uuid).first();
    if (!assessment) return undefined;

    const decryptedData = await this.decryptData(assessment.data, (assessment as any).keyVersion);
    return { ...assessment, decryptedData };
  }

  async updateAssessment(uuid: string, updates: Partial<Assessment & { data: any }>): Promise<number> {
    const { data, ...otherUpdates } = updates;
    const updateData: Partial<Assessment & { keyVersion?: number }> = { ...otherUpdates, lastModified: new Date() };
    
    if (data) {
      const { encryptedData, keyVersion } = await this.encryptData(data);
      updateData.data = encryptedData;
      (updateData as any).keyVersion = keyVersion;
    }
    
    return await this.assessments.where('uuid').equals(uuid).modify(updateData);
  }

  // Response operations
  async addResponse(response: Omit<Response, 'id' | 'data'> & { data: any }): Promise<number> {
    const { encryptedData, keyVersion } = await this.encryptData(response.data);
    return await this.responses.add({
      ...response,
      data: encryptedData,
      keyVersion,
      timestamp: new Date(),
      lastModified: new Date(),
      syncStatus: 'pending'
    });
  }

  async getResponse(uuid: string): Promise<(Response & { decryptedData: any }) | undefined> {
    const response = await this.responses.where('uuid').equals(uuid).first();
    if (!response) return undefined;

    const decryptedData = await this.decryptData(response.data, (response as any).keyVersion);
    return { ...response, decryptedData };
  }

  async updateResponse(uuid: string, updates: Partial<Response & { data: any }>): Promise<number> {
    const { data, ...otherUpdates } = updates;
    const updateData: Partial<Response & { keyVersion?: number }> = { ...otherUpdates, lastModified: new Date() };
    
    if (data) {
      const { encryptedData, keyVersion } = await this.encryptData(data);
      updateData.data = encryptedData;
      (updateData as any).keyVersion = keyVersion;
    }
    
    return await this.responses.where('uuid').equals(uuid).modify(updateData);
  }

  // Entity operations
  async addEntity(entity: Omit<Entity, 'id' | 'data'> & { data: any }): Promise<number> {
    const { encryptedData, keyVersion } = await this.encryptData(entity.data);
    return await this.entities.add({
      ...entity,
      data: encryptedData,
      keyVersion,
      lastModified: new Date(),
      syncStatus: 'pending'
    });
  }

  async getEntity(uuid: string): Promise<(Entity & { decryptedData: any }) | undefined> {
    const entity = await this.entities.where('uuid').equals(uuid).first();
    if (!entity) return undefined;

    const decryptedData = await this.decryptData(entity.data, (entity as any).keyVersion);
    return { ...entity, decryptedData };
  }

  // Sync queue operations
  async addToSyncQueue(item: Omit<SyncQueueItem, 'id' | 'data'> & { data: any }): Promise<number> {
    const { encryptedData, keyVersion } = await this.encryptData(item.data);
    return await this.syncQueue.add({
      ...item,
      data: encryptedData,
      keyVersion,
      attempts: 0,
      timestamp: new Date()
    });
  }

  async getSyncQueue(limit?: number): Promise<(SyncQueueItem & { decryptedData: any })[]> {
    let query = this.syncQueue.orderBy('priority').reverse();
    if (limit) query = query.limit(limit);
    
    const items = await query.toArray();
    return await Promise.all(
      items.map(async (item) => ({
        ...item,
        decryptedData: await this.decryptData(item.data, (item as any).keyVersion)
      }))
    );
  }

  async updateSyncQueueItem(uuid: string, updates: Partial<SyncQueueItem>): Promise<number> {
    return await this.syncQueue.where('uuid').equals(uuid).modify(updates);
  }

  async removeSyncQueueItem(uuid: string): Promise<void> {
    await this.syncQueue.where('uuid').equals(uuid).delete();
  }

  // Utility methods
  async clearAll(): Promise<void> {
    await Promise.all([
      this.assessments.clear(),
      this.responses.clear(),
      this.entities.clear(),
      this.syncQueue.clear(),
      this.cachedSignals.clear()
      // Don't clear encryption keys
    ]);
  }

  async getStorageInfo(): Promise<{
    assessments: number;
    responses: number;
    entities: number;
    syncQueue: number;
    encryptionKeys: number;
    cachedSignals: number;
    currentKeyVersion: number;
  }> {
    return {
      assessments: await this.assessments.count(),
      responses: await this.responses.count(),
      entities: await this.entities.count(),
      syncQueue: await this.syncQueue.count(),
      encryptionKeys: await this.encryptionKeys.count(),
      cachedSignals: await this.cachedSignals.count(),
      currentKeyVersion: this.currentKeyVersion
    };
  }

  // Key management methods
  async getKeyRotationStatus(): Promise<{
    currentVersion: number;
    shouldRotate: boolean;
    nextRotationDate?: Date;
    canRotateNow: boolean;
  }> {
    const activeKey = await this.encryptionKeys
      .where('keyName').equals('primary')
      .and(key => key.isActive)
      .first();
    
    if (!activeKey) {
      return {
        currentVersion: 0,
        shouldRotate: true,
        canRotateNow: true
      };
    }
    
    const shouldRotate = EncryptionManager.shouldRotateKey(activeKey.created);
    const canRotateNow = await this.canPerformKeyRotation();
    
    return {
      currentVersion: activeKey.version,
      shouldRotate,
      nextRotationDate: activeKey.rotationSchedule,
      canRotateNow
    };
  }

  async forceKeyRotation(): Promise<void> {
    const canRotate = await this.canPerformKeyRotation();
    if (!canRotate) {
      throw new Error('Cannot rotate key while sync operations are pending');
    }
    await this.performKeyRotation();
  }

  async cacheSignals(signals: any[], userId: string): Promise<void> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await this.transaction('rw', this.cachedSignals, async () => {
      await this.cachedSignals.where('userId').equals(userId).delete();

      const rows: Omit<CachedSignal, 'id'>[] = signals.map(s => ({
        signalId: s.id,
        userId,
        entityId: s.entityId,
        incidentId: s.incidentId ?? null,
        type: s.type ?? '',
        signalReason: s.signalReason,
        priority: s.priority,
        context: JSON.stringify(s.context ?? {}),
        entity: JSON.stringify(s.entity ?? {}),
        incident: JSON.stringify(s.incident ?? null),
        createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date(s.createdAt).toISOString(),
        resolvedAt: s.resolvedAt ? (typeof s.resolvedAt === 'string' ? s.resolvedAt : new Date(s.resolvedAt).toISOString()) : null,
        cachedAt: now,
        expiresAt,
      }));

      await this.cachedSignals.bulkAdd(rows as any);
    });
  }

  async getCachedSignals(userId: string): Promise<any[]> {
    const now = new Date();
    await this.cachedSignals.where('expiresAt').below(now).delete();

    const rows = await this.cachedSignals.where('userId').equals(userId).toArray();
    return rows.map(row => ({
      id: row.signalId,
      userId: row.userId,
      entityId: row.entityId,
      incidentId: row.incidentId,
      type: row.type,
      signalReason: row.signalReason,
      priority: row.priority,
      context: JSON.parse(row.context),
      entity: JSON.parse(row.entity),
      incident: JSON.parse(row.incident),
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    }));
  }
}

// Export singleton instance
export const offlineDB = new OfflineDatabase();

// Export key rotation utilities for external use
export const KeyRotationManager = {
  shouldRotateKey: EncryptionManager.shouldRotateKey,
  getNextRotationDate: EncryptionManager.getNextRotationDate,
  async getRotationStatus() {
    return await offlineDB.getKeyRotationStatus();
  },
  async forceRotation() {
    return await offlineDB.forceKeyRotation();
  }
};