/**
 * WS 处理器 — 抖音云 WebSocket 回调路由
 *
 * 抖音云托管中，WebSocket 事件以 HTTP POST 回调形式发送到服务端：
 * - POST /ws/connect    — 玩家建立 WS 连接
 * - POST /ws/disconnect — 玩家断开 WS 连接
 * - POST /ws/uplink     — 玩家发送上行消息
 *
 * 回调参数格式：
 * - connect:    { room_id, user_id }
 * - disconnect: { room_id, user_id }
 * - uplink:     { room_id, user_id, data }
 */

import Router from 'koa-router';
import { GameManager } from '../game/manager';
import { pushToUser, pushToRoom, PlayerInfo } from './gateway';
import { findRoomById, updateRoom } from '../db';

const router = new Router({ prefix: '/ws' });

/** GameManager 单例引用，由入口文件注入 */
let gameManager: GameManager | null = null;

/**
 * 注入 GameManager 实例
 *
 * 在服务启动时调用，将 GameManager 单例传入 WS 处理器。
 *
 * @param gm GameManager 实例
 */
export function setGameManager(gm: GameManager): void {
  gameManager = gm;
}

/**
 * 通过 openId 查找玩家所在的游戏房间
 *
 * 复用 DB 查询逻辑：根据 openId 遍历活跃房间，
 * 找到玩家所在的房间并返回 roomId。
 *
 * @param openId 用户 openId
 * @returns roomId 或 null
 */
async function findRoomByOpenId(openId: string): Promise<string | null> {
  // 遍历 GameManager 中的所有房间
  // GameManager 的 rooms 是私有属性，需要通过 hasGame 间接查询
  // 这里直接从 DB 查询玩家所在房间
  const { roomsCollection, initDatabase } = require('../db');
  const db = initDatabase();
  const result = await roomsCollection()
    .where({
      status: db.command.in(['waiting', 'playing']),
    })
    .get();

  const rooms = result.data || [];
  const found = rooms.find((r: any) =>
    r.players && r.players.some((p: any) => p.openId === openId)
  );

  return found ? found.roomId : null;
}

/**
 * 构建玩家信息列表（用于推送）
 *
 * 从 DB 房间数据构建 PlayerInfo 数组。
 *
 * @param roomData DB 中的房间数据
 * @returns PlayerInfo 数组
 */
function buildPlayerInfos(roomData: any): PlayerInfo[] {
  const gm = gameManager;
  const players: PlayerInfo[] = [];

  for (const p of roomData.players) {
    let online = p.online || false;

    // 如果游戏已开始，从 GameManager 获取实际在线状态
    if (gm && gm.hasGame(roomData.roomId)) {
      const playersMap = gm.getPlayers(roomData.roomId);
      const rp = playersMap?.get(p.openId);
      if (rp) {
        online = rp._online;
      }
    }

    players.push({
      openId: p.openId,
      seatIndex: p.seatIndex,
      online,
    });
  }

  return players;
}

// ─── POST /ws/connect — 玩家建立 WS 连接 ────────────────────

router.post('/connect', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { room_id, user_id } = body;

    if (!room_id || !user_id) {
      ctx.status = 400;
      ctx.body = { error: '缺少 room_id 或 user_id' };
      return;
    }

    console.log(`[ws-handler] 玩家连接 user_id=${user_id} room_id=${room_id}`);

    // 通过 openId 查找玩家所在的游戏房间
    const roomId = await findRoomByOpenId(user_id);

    if (!roomId) {
      console.warn(`[ws-handler] 玩家 ${user_id} 未找到所在房间`);
      ctx.status = 200;
      ctx.body = { success: true, message: '玩家未在任何房间' };
      return;
    }

    // 从 DB 查询房间数据
    const room = await findRoomById(roomId);
    if (!room) {
      ctx.status = 200;
      ctx.body = { success: true, message: '房间不存在' };
      return;
    }

    // 如果游戏已开始，执行重连逻辑
    if (gameManager && gameManager.hasGame(roomId)) {
      const filteredState = gameManager.playerReconnect(roomId, user_id);

      // 推送当前完整状态给重连玩家
      if (filteredState) {
        await pushToUser(room_id, user_id, {
          type: 'stateUpdate',
          state: filteredState,
        });
      }
    }

    // 更新 DB 中玩家 online 状态
    const player = room.players.find((p: any) => p.openId === user_id);
    if (player) {
      player.online = true;
      await updateRoom(room._id, { players: room.players });
    }

    // 通知房间内其他玩家
    const playerInfos = buildPlayerInfos(room);
    await pushToRoom(room_id, playerInfos, {
      type: 'playerOnline',
      openId: user_id,
    });

    ctx.body = { success: true };
  } catch (err: any) {
    console.error('[ws-handler] /ws/connect 错误:', err.message);
    ctx.status = 500;
    ctx.body = { error: err.message || '连接处理失败' };
  }
});

// ─── POST /ws/disconnect — 玩家断开 WS 连接 ──────────────────

router.post('/disconnect', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { room_id, user_id } = body;

    if (!room_id || !user_id) {
      ctx.status = 400;
      ctx.body = { error: '缺少 room_id 或 user_id' };
      return;
    }

    console.log(`[ws-handler] 玩家断开 user_id=${user_id} room_id=${room_id}`);

    // 通过 openId 查找玩家所在的游戏房间
    const roomId = await findRoomByOpenId(user_id);

    if (!roomId) {
      ctx.status = 200;
      ctx.body = { success: true, message: '玩家未在任何房间' };
      return;
    }

    // 从 DB 查询房间数据
    const room = await findRoomById(roomId);
    if (!room) {
      ctx.status = 200;
      ctx.body = { success: true, message: '房间不存在' };
      return;
    }

    // 如果游戏已开始，设置玩家离线（自动回退 AI）
    if (gameManager && gameManager.hasGame(roomId)) {
      gameManager.playerDisconnect(roomId, user_id);
    }

    // 更新 DB 中玩家 online 状态
    const player = room.players.find((p: any) => p.openId === user_id);
    if (player) {
      player.online = false;
      await updateRoom(room._id, { players: room.players });
    }

    // 通知房间内其他玩家
    const playerInfos = buildPlayerInfos(room);
    await pushToRoom(room_id, playerInfos, {
      type: 'playerOffline',
      openId: user_id,
    });

    ctx.body = { success: true };
  } catch (err: any) {
    console.error('[ws-handler] /ws/disconnect 错误:', err.message);
    ctx.status = 500;
    ctx.body = { error: err.message || '断连处理失败' };
  }
});

// ─── POST /ws/uplink — 玩家发送上行消息 ──────────────────────

router.post('/uplink', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { room_id, user_id, data } = body;

    if (!room_id || !user_id) {
      ctx.status = 400;
      ctx.body = { error: '缺少 room_id 或 user_id' };
      return;
    }

    // 解析 data JSON
    let parsed: any;
    if (typeof data === 'string') {
      try {
        parsed = JSON.parse(data);
      } catch {
        await pushToUser(room_id, user_id, {
          type: 'error',
          message: '无效的消息格式',
        });
        ctx.body = { success: false, error: '无效的 JSON' };
        return;
      }
    } else {
      parsed = data;
    }

    console.log(
      `[ws-handler] 上行消息 user_id=${user_id} type=${parsed.type || 'unknown'}`
    );

    // 通过 openId 查找玩家所在的游戏房间
    const roomId = await findRoomByOpenId(user_id);

    if (!roomId) {
      await pushToUser(room_id, user_id, {
        type: 'error',
        message: '未找到所在房间',
      });
      ctx.body = { success: false, error: '未找到房间' };
      return;
    }

    if (!gameManager || !gameManager.hasGame(roomId)) {
      await pushToUser(room_id, user_id, {
        type: 'error',
        message: '游戏未开始',
      });
      ctx.body = { success: false, error: '游戏未开始' };
      return;
    }

    const messageType = parsed.type;

    if (messageType === 'action') {
      // 游戏操作：委托 GameManager 处理
      const success = gameManager.handleAction(roomId, user_id, parsed);

      if (!success) {
        await pushToUser(room_id, user_id, {
          type: 'error',
          message: '操作处理失败',
        });
      }

      ctx.body = { success };
    } else if (messageType === 'ready') {
      // 准备操作：复用房间路由的 ready 逻辑
      const room = await findRoomById(roomId);
      if (!room) {
        await pushToUser(room_id, user_id, {
          type: 'error',
          message: '房间不存在',
        });
        ctx.body = { success: false, error: '房间不存在' };
        return;
      }

      if (room.status !== 'waiting') {
        await pushToUser(room_id, user_id, {
          type: 'error',
          message: '房间已开始游戏',
        });
        ctx.body = { success: false, error: '房间已开始游戏' };
        return;
      }

      const player = room.players.find((p: any) => p.openId === user_id);
      if (!player) {
        await pushToUser(room_id, user_id, {
          type: 'error',
          message: '玩家不在此房间',
        });
        ctx.body = { success: false, error: '玩家不在此房间' };
        return;
      }

      // 切换 ready 状态
      player.ready = !player.ready;
      await updateRoom(room._id, { players: room.players });

      // 通知房间内所有玩家 ready 状态变化
      const playerInfos = buildPlayerInfos(room);
      await pushToRoom(room_id, playerInfos, {
        type: 'playerReady',
        openId: user_id,
        ready: player.ready,
      });

      // 检查是否3人全部 ready
      const allReady =
        room.players.length === 3 &&
        room.players.every((p: any) => p.ready);

      if (allReady) {
        await pushToRoom(room_id, playerInfos, {
          type: 'allReady',
        });
        console.log(`[ws-handler] 房间 ${roomId} 3人全部 ready`);
      }

      ctx.body = { success: true, ready: player.ready, allReady };
    } else {
      await pushToUser(room_id, user_id, {
        type: 'error',
        message: `未知的消息类型: ${messageType}`,
      });
      ctx.body = { success: false, error: '未知的消息类型' };
    }
  } catch (err: any) {
    console.error('[ws-handler] /ws/uplink 错误:', err.message);
    ctx.status = 500;
    ctx.body = { error: err.message || '上行消息处理失败' };
  }
});

export default router;
