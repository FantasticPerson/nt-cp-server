/**
 * 数据库层 — 封装云数据库 SDK 操作
 *
 * 提供 rooms 和 match_queue 集合的 CRUD 操作。
 * SDK 没有 @types，使用 require + any 类型。
 */

let database: any = null;

/** 初始化云数据库 SDK，返回 database 实例 */
export function initDatabase(): any {
  if (database) {
    return database;
  }
  try {
    const sdk = require('@open-dy/node-server-sdk') as any;

    // 方式1: 直接调 database()
    if (typeof sdk.database === 'function') {
      database = sdk.database();
      console.log('[db] 云数据库初始化成功 (sdk.database)');
      return database;
    }

    // 方式2: 先 init() 再 database()
    if (typeof sdk.init === 'function') {
      const cloud = sdk.init();
      if (cloud && typeof cloud.database === 'function') {
        database = cloud.database();
        console.log('[db] 云数据库初始化成功 (sdk.init.database)');
        return database;
      }
    }

    console.warn('[db] @open-dy/node-server-sdk 无法初始化，数据库功能降级');
  } catch (err: any) {
    console.warn('[db] 云数据库初始化失败:', err.message, '，数据库功能降级');
  }
  return database;
}

/** 获取 rooms 集合 */
export function roomsCollection(): any {
  const db = initDatabase();
  if (!db) throw new Error('数据库未初始化');
  return db.collection('rooms');
}

/** 获取 match_queue 集合 */
export function matchQueueCollection(): any {
  const db = initDatabase();
  if (!db) throw new Error('数据库未初始化');
  return db.collection('match_queue');
}

// ─── Room CRUD ────────────────────────────────────────────

export interface RoomData {
  roomId: string;
  players: any[];
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  [key: string]: any;
}

/** 创建房间 */
export async function createRoom(data: RoomData): Promise<any> {
  const collection = roomsCollection();
  return collection.add({ data });
}

/** 根据 roomId 查询房间 */
export async function findRoomById(roomId: string): Promise<any> {
  const collection = roomsCollection();
  const result = await collection.where({ roomId }).get();
  if (result.data && result.data.length > 0) {
    return result.data[0];
  }
  return null;
}

/** 更新房间（通过文档 _id） */
export async function updateRoom(id: string, data: Partial<RoomData>): Promise<any> {
  const collection = roomsCollection();
  return collection.doc(id).update({ data });
}

/** 删除房间（通过文档 _id） */
export async function deleteRoom(id: string): Promise<any> {
  const collection = roomsCollection();
  return collection.doc(id).remove();
}

// ─── Match Queue ──────────────────────────────────────────

export interface QueueData {
  openId: string;
  mode: string;
  createdAt: number;
  [key: string]: any;
}

/** 加入匹配队列 */
export async function addToQueue(data: QueueData): Promise<any> {
  const collection = matchQueueCollection();
  return collection.add({ data });
}

/** 按模式查找队列中的玩家 */
export async function findQueueByMode(mode: string, xiEnabled?: boolean): Promise<any[]> {
  const collection = matchQueueCollection();
  const condition: any = { mode };
  if (xiEnabled !== undefined) {
    condition.xiEnabled = xiEnabled;
  }
  const result = await collection.where(condition).get();
  return result.data || [];
}

/** 按 openId 查找队列中的玩家 */
export async function findQueueByOpenId(openId: string): Promise<any | null> {
  const collection = matchQueueCollection();
  const result = await collection.where({ openId }).get();
  if (result.data && result.data.length > 0) {
    return result.data[0];
  }
  return null;
}

/** 从队列中移除玩家（通过 openId） */
export async function removeFromQueue(openId: string): Promise<any> {
  const collection = matchQueueCollection();
  return collection.where({ openId }).remove();
}
