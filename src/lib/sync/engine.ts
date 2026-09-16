import { offlineDB, SyncQueueItem } from '../db/offline';
import { apiPost, extractArray } from '@/lib/api';
import type { OfflineSyncWarning } from '@/lib/questions/offline-answers';

export interface SyncChange {
  type: 'assessment' | 'response' | 'entity';
  action: 'create' | 'update' | 'delete';
  data: any;
  offlineId?: string;
  versionNumber: number;
  entityUuid: string;
}

export interface SyncResult {
  offlineId?: string;
  serverId: string;
  status: 'success' | 'conflict' | 'failed';
  message?: string;
  conflictData?: any;
  warnings?: OfflineSyncWarning[];
}


export interface SyncBatchResult {
  successful: SyncResult[];
  conflicts: SyncResult[];
  failed: SyncResult[];
  totalProcessed: number;
}

export interface ConnectivityStatus {
  isOnline: boolean;
  connectionType?: string;
  effectiveType?: string;
}

export class SyncEngine {
  private static instance: SyncEngine;
  private isOnline = typeof window !== 'undefined' && typeof navigator !== 'undefined' ? navigator.onLine : true;
  private syncInProgress = false;
  private retryTimeouts = new Map<string, NodeJS.Timeout>();
  private connectivityListeners = new Set<(status: ConnectivityStatus) => void>();
  private isInitialized = false;
  
  // Configuration
  private readonly MAX_RETRIES = 3;
  private readonly MAX_BATCH_SIZE = 100;
  private readonly RETRY_DELAYS = [2000, 5000, 10000]; // 2s, 5s, 10s
  private readonly SYNC_CHECK_INTERVAL = 30000; // 30 seconds

  private constructor() {
    // Only initialize browser-specific features on the client side
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      this.initializeConnectivityListeners();
      this.startPeriodicSyncCheck();
      this.isInitialized = true;
    }
  }

  static getInstance(): SyncEngine {
    if (!SyncEngine.instance) {
      SyncEngine.instance = new SyncEngine();
    }
    return SyncEngine.instance;
  }

  private initializeConnectivityListeners(): void {
    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.isOnline = true;
      this.notifyConnectivityChange();
      this.triggerSync();
    });

    window.addEventListener('offline', () => {
      this.isOnline = false;
      this.notifyConnectivityChange();
    });

    // Enhanced connectivity detection
    if ('connection' in navigator) {
      const connection = (navigator as any).connection;
      connection.addEventListener('change', () => {
        this.notifyConnectivityChange();
      });
    }
  }

  private notifyConnectivityChange(): void {
    const status: ConnectivityStatus = {
      isOnline: this.isOnline,
      connectionType: this.getConnectionType(),
      effectiveType: this.getEffectiveType()
    };

    this.connectivityListeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('Error in connectivity listener:', error);
      }
    });
  }

  private getConnectionType(): string | undefined {
    if ('connection' in navigator) {
      return (navigator as any).connection?.type;
    }
    return undefined;
  }

  private getEffectiveType(): string | undefined {
    if ('connection' in navigator) {
      return (navigator as any).connection?.effectiveType;
    }
    return undefined;
  }

  onConnectivityChange(listener: (status: ConnectivityStatus) => void): () => void {
    this.connectivityListeners.add(listener);
    
    // Return unsubscribe function
    return () => {
      this.connectivityListeners.delete(listener);
    };
  }

  getConnectivityStatus(): ConnectivityStatus {
    return {
      isOnline: this.isOnline,
      connectionType: this.getConnectionType(),
      effectiveType: this.getEffectiveType()
    };
  }

  private startPeriodicSyncCheck(): void {
    setInterval(() => {
      if (this.isOnline && !this.syncInProgress) {
        this.checkAndSync();
      }
    }, this.SYNC_CHECK_INTERVAL);
  }

  private async checkAndSync(): Promise<void> {
    try {
      const queueCount = await offlineDB.syncQueue.count();
      if (queueCount > 0) {
        console.log(`Found ${queueCount} items in sync queue, triggering sync`);
        await this.triggerSync();
      }
    } catch (error) {
      console.error('Error during periodic sync check:', error);
    }
  }

  async triggerSync(maxItems?: number): Promise<SyncBatchResult | null> {
    if (!this.isOnline) {
      console.log('Cannot sync: device is offline');
      return null;
    }

    if (this.syncInProgress) {
      console.log('Sync already in progress');
      return null;
    }

    this.syncInProgress = true;

    try {
      console.log('Starting sync operation...');
      
      // Get items from sync queue
      const limit = Math.min(maxItems || this.MAX_BATCH_SIZE, this.MAX_BATCH_SIZE);
      const queueItems = await this.getNextSyncBatch(limit);
      
      if (queueItems.length === 0) {
        console.log('No items to sync');
        return {
          successful: [],
          conflicts: [],
          failed: [],
          totalProcessed: 0
        };
      }

      console.log(`Syncing ${queueItems.length} items`);
      
      // Convert queue items to sync changes
      const changes = queueItems.map(item => this.queueItemToSyncChange(item));
      
      // Process the batch
      const result = await this.processBatch(changes, queueItems);
      
      console.log(`Sync completed: ${result.successful.length} successful, ${result.conflicts.length} conflicts, ${result.failed.length} failed`);
      
      return result;
    } catch (error) {
      console.error('Sync operation failed:', error);
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  private async getNextSyncBatch(limit: number): Promise<(SyncQueueItem & { decryptedData: any })[]> {
    // Get items that are ready for retry (no retry time or past retry time)
    const now = new Date();
    
    return await offlineDB.transaction('r', offlineDB.syncQueue, async () => {
      const allItems = await offlineDB.getSyncQueue();
      
      return allItems
        .filter(item => !item.nextRetry || item.nextRetry <= now)
        .sort((a, b) => {
          // Priority first (higher priority first)
          if (a.priority !== b.priority) {
            return b.priority - a.priority;
          }
          // Then by timestamp (older first)
          return a.timestamp.getTime() - b.timestamp.getTime();
        })
        .slice(0, limit);
    });
  }

  private queueItemToSyncChange(item: SyncQueueItem & { decryptedData: any }): SyncChange {
    return {
      type: item.type,
      action: item.action,
      data: item.decryptedData,
      offlineId: item.uuid,
      versionNumber: item.decryptedData.version || 1,
      entityUuid: item.entityUuid
    };
  }

  private async processBatch(
    changes: SyncChange[], 
    queueItems: (SyncQueueItem & { decryptedData: any })[]
  ): Promise<SyncBatchResult> {
    const result: SyncBatchResult = {
      successful: [],
      conflicts: [],
      failed: [],
      totalProcessed: changes.length
    };

    try {
      const apiResult = await apiPost('/api/v1/sync/batch', { changes })

      if (!apiResult.success) {
        throw new Error(apiResult.error || 'Sync API error')
      }

      const syncResults: SyncResult[] = apiResult.data?.results || extractArray<SyncResult>(apiResult.data)

      // Process results and update queue
      for (let i = 0; i < syncResults.length; i++) {
        const syncResult = syncResults[i];
        const queueItem = queueItems[i];

        switch (syncResult.status) {
          case 'success':
            result.successful.push(syncResult);
            await this.handleSuccessfulSync(queueItem, syncResult);
            break;

          case 'conflict':
            result.conflicts.push(syncResult);
            await this.handleSyncConflict(queueItem, syncResult);
            break;

          case 'failed':
            result.failed.push(syncResult);
            await this.handleSyncFailure(queueItem, syncResult);
            break;
        }
      }

    } catch (error) {
      console.error('Batch sync failed:', error);
      
      // Mark all items as failed and schedule retry
      for (const queueItem of queueItems) {
        await this.handleSyncFailure(queueItem, {
          offlineId: queueItem.uuid,
          serverId: '',
          status: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
        
        result.failed.push({
          offlineId: queueItem.uuid,
          serverId: '',
          status: 'failed',
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return result;
  }

  private async handleSuccessfulSync(
    queueItem: SyncQueueItem & { decryptedData: any }, 
    syncResult: SyncResult
  ): Promise<void> {
    try {
      // Update the main entity with server ID and sync status
      await this.updateEntitySyncStatus(queueItem, syncResult.serverId, 'synced');

      // P5: surface + persist server-reported registry-drift warnings for
      // offline-synced assessments (console summary + Dexie record).
      if (syncResult.warnings && syncResult.warnings.length > 0) {
        this.reportSyncWarnings(queueItem, syncResult.warnings);
        await this.persistSyncWarnings(queueItem, syncResult.warnings);
      }
      
      // Remove from sync queue
      await offlineDB.removeSyncQueueItem(queueItem.uuid);
      
      // Clear any retry timeout
      this.clearRetryTimeout(queueItem.uuid);
      
      console.log(`Successfully synced ${queueItem.type} ${queueItem.entityUuid}`);
    } catch (error) {
      console.error('Error handling successful sync:', error);
    }
  }

  /** Logs a human-readable drift summary for one synced assessment. */
  private reportSyncWarnings(
    queueItem: SyncQueueItem & { decryptedData: any },
    warnings: OfflineSyncWarning[]
  ): void {
    const summarize = (type: OfflineSyncWarning['type']) =>
      warnings.filter(w => w.type === type).map(w => w.key).join(', ') || 'none';
    console.warn(
      `[SyncEngine] offline sync drift for assessment ${queueItem.decryptedData?.id ?? queueItem.entityUuid}: ` +
      `${warnings.length} warning(s) — added: [${summarize('added')}], ` +
      `removed: [${summarize('removed')}], unknown: [${summarize('unknown')}]`
    );
    for (const warning of warnings) {
      console.warn(`[SyncEngine] drift warning (${warning.type}): ${warning.message}`);
    }
  }

  /** Persists drift warnings onto the Dexie assessment record. */
  private async persistSyncWarnings(
    queueItem: SyncQueueItem & { decryptedData: any },
    warnings: OfflineSyncWarning[]
  ): Promise<void> {
    try {
      if (queueItem.type !== 'assessment' || warnings.length === 0) return;
      const assessmentUuid = queueItem.decryptedData?.id || queueItem.entityUuid;
      await offlineDB.updateAssessment(assessmentUuid, { warnings });
    } catch (error) {
      console.error('Error persisting sync warnings:', error);
    }
  }

  private async handleSyncConflict(
    queueItem: SyncQueueItem & { decryptedData: any }, 
    syncResult: SyncResult
  ): Promise<void> {
    try {
      console.log(`Sync conflict for ${queueItem.type} ${queueItem.entityUuid}:`, syncResult.message);
      
      // For now, implement last-write-wins automatically
      // In a more sophisticated system, this might queue for manual resolution
      
      if (syncResult.conflictData) {
        // Update local data with server data (last-write-wins)
        await this.resolveConflictWithServerData(queueItem, syncResult.conflictData);
      }
      
      // Remove from sync queue since conflict is resolved
      await offlineDB.removeSyncQueueItem(queueItem.uuid);
      
      // Clear retry timeout
      this.clearRetryTimeout(queueItem.uuid);
      
    } catch (error) {
      console.error('Error handling sync conflict:', error);
      // Treat as failed sync if conflict resolution fails
      await this.handleSyncFailure(queueItem, {
        ...syncResult,
        status: 'failed',
        message: 'Conflict resolution failed'
      });
    }
  }

  private async handleSyncFailure(
    queueItem: SyncQueueItem & { decryptedData: any }, 
    syncResult: SyncResult
  ): Promise<void> {
    const newAttempts = queueItem.attempts + 1;
    
    if (newAttempts >= this.MAX_RETRIES) {
      console.error(`Max retries exceeded for ${queueItem.type} ${queueItem.entityUuid}`);
      
      // Update entity sync status to failed
      await this.updateEntitySyncStatus(queueItem, '', 'failed');
      
      // Remove from sync queue
      await offlineDB.removeSyncQueueItem(queueItem.uuid);
      
      // Clear retry timeout
      this.clearRetryTimeout(queueItem.uuid);
    } else {
      // Schedule retry with exponential backoff
      const retryDelay = this.RETRY_DELAYS[newAttempts - 1] || this.RETRY_DELAYS[this.RETRY_DELAYS.length - 1];
      const nextRetry = new Date(Date.now() + retryDelay);
      
      await offlineDB.updateSyncQueueItem(queueItem.uuid, {
        attempts: newAttempts,
        lastAttempt: new Date(),
        nextRetry,
        error: syncResult.message
      });
      
      console.log(`Scheduling retry #${newAttempts} for ${queueItem.type} ${queueItem.entityUuid} at ${nextRetry}`);
      
      // Set timeout for retry
      this.scheduleRetry(queueItem.uuid, retryDelay);
    }
  }

  private async updateEntitySyncStatus(
    queueItem: SyncQueueItem & { decryptedData?: any }, 
    serverId: string, 
    status: 'synced' | 'failed'
  ): Promise<void> {
    try {
      switch (queueItem.type) {
        case 'assessment': {
          const assessmentUuid = queueItem.decryptedData?.id || queueItem.entityUuid;
          await offlineDB.updateAssessment(assessmentUuid, { 
            syncStatus: status 
          });
          break;
        }
          
        case 'response':
          await offlineDB.responses
            .where('uuid').equals(queueItem.entityUuid)
            .modify({ syncStatus: status });
          break;
          
        case 'entity':
          await offlineDB.entities
            .where('uuid').equals(queueItem.entityUuid)
            .modify({ syncStatus: status });
          break;
      }
    } catch (error) {
      console.error('Error updating entity sync status:', error);
    }
  }

  private async resolveConflictWithServerData(
    queueItem: SyncQueueItem & { decryptedData: any }, 
    serverData: any
  ): Promise<void> {
    try {
      // Update local entity with server data (last-write-wins)
      switch (queueItem.type) {
        case 'assessment':
          await offlineDB.updateAssessment(queueItem.entityUuid, {
            data: serverData,
            syncStatus: 'synced',
            lastModified: new Date()
          });
          break;
          
        case 'response':
          await offlineDB.responses
            .where('uuid').equals(queueItem.entityUuid)
            .modify({
              data: await (await offlineDB.encryptData(serverData)).encryptedData,
              syncStatus: 'synced',
              lastModified: new Date()
            });
          break;
          
        case 'entity':
          await offlineDB.entities
            .where('uuid').equals(queueItem.entityUuid)
            .modify({
              data: await (await offlineDB.encryptData(serverData)).encryptedData,
              syncStatus: 'synced',
              lastModified: new Date()
            });
          break;
      }
      
      console.log(`Resolved conflict for ${queueItem.type} ${queueItem.entityUuid} with server data`);
    } catch (error) {
      console.error('Error resolving conflict with server data:', error);
      throw error;
    }
  }

  private scheduleRetry(queueItemUuid: string, delay: number): void {
    // Clear existing timeout
    this.clearRetryTimeout(queueItemUuid);
    
    // Schedule new retry
    const timeout = setTimeout(() => {
      this.retryTimeouts.delete(queueItemUuid);
      if (this.isOnline && !this.syncInProgress) {
        this.triggerSync(1); // Retry just one item
      }
    }, delay);
    
    this.retryTimeouts.set(queueItemUuid, timeout);
  }

  private clearRetryTimeout(queueItemUuid: string): void {
    const timeout = this.retryTimeouts.get(queueItemUuid);
    if (timeout) {
      clearTimeout(timeout);
      this.retryTimeouts.delete(queueItemUuid);
    }
  }

  // Public methods for queue management
  async addToQueue(
    type: 'assessment' | 'response' | 'entity',
    action: 'create' | 'update' | 'delete',
    entityUuid: string,
    data: any,
    priority: number = 5
  ): Promise<void> {
    await offlineDB.addToSyncQueue({
      uuid: crypto.randomUUID(),
      type,
      action,
      entityUuid,
      data,
      priority,
      attempts: 0,
      timestamp: new Date()
    });

    // Trigger sync if online
    if (this.isOnline && !this.syncInProgress) {
      // Don't await - let it run in background
      this.triggerSync().catch(error => {
        console.error('Background sync failed:', error);
      });
    }
  }

  async getQueueStatus(): Promise<{
    totalItems: number;
    pendingItems: number;
    failedItems: number;
    oldestItem?: Date;
    isOnline: boolean;
    syncInProgress: boolean;
  }> {
    const totalItems = await offlineDB.syncQueue.count();
    
    const now = new Date();
    const allItems = await offlineDB.getSyncQueue();
    
    const pendingItems = allItems.filter(item => 
      item.attempts < this.MAX_RETRIES && 
      (!item.nextRetry || item.nextRetry <= now)
    ).length;
    
    const failedItems = allItems.filter(item => 
      item.attempts >= this.MAX_RETRIES
    ).length;
    
    const oldestItem = allItems.length > 0 
      ? allItems.reduce((oldest, item) => 
          item.timestamp < oldest ? item.timestamp : oldest, allItems[0].timestamp)
      : undefined;

    return {
      totalItems,
      pendingItems,
      failedItems,
      oldestItem,
      isOnline: this.isOnline,
      syncInProgress: this.syncInProgress
    };
  }

  async clearFailedItems(): Promise<number> {
    const failedItems = await offlineDB.syncQueue
      .where('attempts').aboveOrEqual(this.MAX_RETRIES)
      .toArray();
    
    for (const item of failedItems) {
      await offlineDB.removeSyncQueueItem(item.uuid);
    }
    
    return failedItems.length;
  }

  async retryFailedItems(): Promise<void> {
    // Reset failed items to allow retry
    await offlineDB.syncQueue
      .where('attempts').aboveOrEqual(this.MAX_RETRIES)
      .modify({
        attempts: 0,
        lastAttempt: undefined,
        nextRetry: undefined,
        error: undefined
      });
    
    // Trigger sync
    if (this.isOnline) {
      await this.triggerSync();
    }
  }

  // Cleanup method
  destroy(): void {
    // Clear all retry timeouts
    this.retryTimeouts.forEach(timeout => clearTimeout(timeout));
    this.retryTimeouts.clear();
    
    // Clear connectivity listeners
    this.connectivityListeners.clear();
  }
}

// Export singleton instance
export const syncEngine = SyncEngine.getInstance();