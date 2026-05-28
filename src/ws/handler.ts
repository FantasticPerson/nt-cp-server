/**
 * WS 处理器 — 抖音云 WebSocket 回调路由
 *
 * 抖音云托管 WebSocket 架构：
 *   客户端 ←WebSocket→ 抖音云网关 ←HTTP→ 开发者服务
 *
 * 网关将 WS 事件以 HTTP 请求转发到服务端（统一路径）：
 * - GET  + X-tt-event-type=connect    — 玩家建立 WS 连接
 * - GET  + X-tt-event-type=disconnect — 玩家断开 WS 连接
 * - POST + X-tt-event-type=uplink     — 玩家发送上行消息
 *
 * 用户信息从请求头获取：
 * - X-TT-OPENID    — 用户 openId
 * - X-TT-SESSIONID — 会话 ID
 */

import Router from 'koa-router';
import { GameManager } from '../game/manager';
import { pushToUser, pushToRoom, PlayerInfo, registerSession, unregisterSession } from './gateway';
import { findRoomById, updateRoom } from '../db';

const router = new Router({ prefix: '/ws' });

/** GameManager 单例引用，由入口文件注入 */
let gameManager: GameManager | null = null;

export function setGameManager(gm: GameManager): void {
  gameManager = gm;
}

async function findRoomByOpenId(openId: string): Promise<string | null> {
  try {
    const { roomsCollection, initDatabase } = require('../db');
    const db = initDatabase();
    if (!db) return null;

    const result = await roomsCollection()
      .where({ status: db.command.in(['waiting', 'playing']) })
      .get();

    const rooms = result.data || [];
    const found = rooms.find((r: any) =>
      r.players && r.players.some((p: any) => p.openId === openId)
    );

    return found ? found.roomId : null;
  } catch (err: any) {
    console.error('[ws-handler] findRoomByOpenId 错误:', err.message);
    return null;
  }
}

function buildPlayerInfos(roomData: any): PlayerInfo[] {
  const gm = gameManager;
  const players: PlayerInfo[] = [];

  for (const p of roomData.players) {
    let online = p.online || false;
    if (gm && gm.hasGame(roomData.roomId)) {
      const playersMap = gm.getPlayers(roomData.roomId);
      const rp = playersMap?.get(p.openId);
      if (rp) online = rp._online;
    }
    players.push({ openId: p.openId, seatIndex: p.seatIndex, online });
  }

  return players;
}

// ─── 统一 WS 回调入口 ──────────────────────────────────────

router.all('/', async (ctx) => {
  const eventType = String(ctx.header['x-tt-event-type'] || '');
  const openId = String(ctx.header['x-tt-openid'] || '');
  const sessionId = String(ctx.header['x-tt-sessionid'] || '');

  console.log(`[ws-handler] 回调 event=${eventType} openId=${openId} method=${ctx.method}`);

  if (!openId) {
    ctx.status = 400;
    ctx.body = { error: '缺少 X-TT-OPENID' };
    return;
  }

  switch (eventType) {
    case 'connect':
      await handleConnect(ctx, openId, sessionId);
      break;
    case 'disconnect':
      await handleDisconnect(ctx, openId, sessionId);
      break;
    case 'uplink':
      await handleUplink(ctx, openId, sessionId);
      break;
    default:
      console.warn(`[ws-handler] 未知事件类型: ${eventType}`);
      ctx.status = 200;
      ctx.body = { success: true };
  }
});

// ─── 连接 ──────────────────────────────────────────────────

async function handleConnect(ctx: any, openId: string, sessionId: string): Promise<void> {
  try {
    console.log(`[ws-handler] 玩家连接 openId=${openId} sessionId=${sessionId}`);

    registerSession(sessionId, openId);

    const roomId = await findRoomByOpenId(openId);
    if (!roomId) {
      ctx.body = { success: true, message: '玩家未在任何房间' };
      return;
    }

    const room = await findRoomById(roomId);
    if (!room) {
      ctx.body = { success: true, message: '房间不存在' };
      return;
    }

    // 游戏进行中 → 重连
    if (gameManager && gameManager.hasGame(roomId)) {
      const filteredState = gameManager.playerReconnect(roomId, openId);
      if (filteredState) {
        await pushToUser(roomId, openId, { type: 'stateUpdate', state: filteredState });
      }

      // 检查是否所有人都已连接，如果是则启动游戏
      if (gameManager.allPlayersOnline(roomId) && !gameManager.isGameStarted(roomId)) {
        console.log(`[ws-handler] 房间 ${roomId} 所有玩家已连接，启动游戏`);
        gameManager.startGame(roomId).catch(function (err: any) {
          console.error(`[ws-handler] 启动游戏失败:`, err.message);
        });
      }
    }

    // 房间状态为 playing 但游戏还没创建（刚从 ready 切换过来的玩家首次连接）
    if (room.status === 'playing' && gameManager && !gameManager.hasGame(roomId)) {
      // 游戏在 ready 接口中已创建，此处不应该发生
      console.log(`[ws-handler] 房间 ${roomId} 状态为 playing 但游戏不存在`);
    }

    // 推送 gameStart 消息给刚连接的玩家，告知其座位号
    if (gameManager && gameManager.hasGame(roomId)) {
      const seatMap = gameManager.getSeatMap(roomId);
      const seatIndex = seatMap?.get(openId);
      if (seatIndex !== undefined) {
        await pushToUser(roomId, openId, { type: 'gameStart', seatIndex });
      }
    }

    const player = room.players.find((p: any) => p.openId === openId);
    if (player) {
      player.online = true;
      await updateRoom(room._id, { players: room.players });
    }

    const playerInfos = buildPlayerInfos(room);
    await pushToRoom(roomId, playerInfos, { type: 'playerOnline', openId });

    ctx.body = { success: true };
  } catch (err: any) {
    console.error('[ws-handler] connect 错误:', err.message);
    ctx.status = 500;
    ctx.body = { error: err.message || '连接处理失败' };
  }
}

// ─── 断连 ──────────────────────────────────────────────────

async function handleDisconnect(ctx: any, openId: string, sessionId: string): Promise<void> {
  try {
    console.log(`[ws-handler] 玩家断开 openId=${openId} sessionId=${sessionId}`);

    unregisterSession(sessionId);

    const roomId = await findRoomByOpenId(openId);
    if (!roomId) {
      ctx.body = { success: true, message: '玩家未在任何房间' };
      return;
    }

    const room = await findRoomById(roomId);
    if (!room) {
      ctx.body = { success: true, message: '房间不存在' };
      return;
    }

    if (gameManager && gameManager.hasGame(roomId)) {
      gameManager.playerDisconnect(roomId, openId);
    }

    const player = room.players.find((p: any) => p.openId === openId);
    if (player) {
      player.online = false;
      await updateRoom(room._id, { players: room.players });
    }

    const playerInfos = buildPlayerInfos(room);
    await pushToRoom(roomId, playerInfos, { type: 'playerOffline', openId });

    ctx.body = { success: true };
  } catch (err: any) {
    console.error('[ws-handler] disconnect 错误:', err.message);
    ctx.status = 500;
    ctx.body = { error: err.message || '断连处理失败' };
  }
}

// ─── 上行消息 ──────────────────────────────────────────────

async function handleUplink(ctx: any, openId: string, _sessionId: string): Promise<void> {
  try {
    const body = ctx.request.body as any;

    let parsed: any;
    if (typeof body === 'string') {
      try {
        parsed = JSON.parse(body);
      } catch {
        await pushToUser('', openId, { type: 'error', message: '无效的消息格式' });
        ctx.body = { success: false, error: '无效的 JSON' };
        return;
      }
    } else if (body && typeof body === 'object') {
      parsed = typeof body.data === 'string' ? JSON.parse(body.data) : (body.data || body);
    } else {
      ctx.status = 400;
      ctx.body = { error: '空消息' };
      return;
    }

    console.log(`[ws-handler] 上行消息 openId=${openId} type=${parsed.type || 'unknown'}`);

    const roomId = await findRoomByOpenId(openId);
    if (!roomId) {
      await pushToUser('', openId, { type: 'error', message: '未找到所在房间' });
      ctx.body = { success: false, error: '未找到房间' };
      return;
    }

    if (parsed.type === 'action') {
      if (!gameManager || !gameManager.hasGame(roomId)) {
        await pushToUser(roomId, openId, { type: 'error', message: '游戏未开始' });
        ctx.body = { success: false, error: '游戏未开始' };
        return;
      }

      const success = gameManager.handleAction(roomId, openId, parsed);
      if (!success) {
        await pushToUser(roomId, openId, { type: 'error', message: '操作处理失败' });
      }
      ctx.body = { success };
    } else if (parsed.type === 'ready') {
      const room = await findRoomById(roomId);
      if (!room) {
        await pushToUser(roomId, openId, { type: 'error', message: '房间不存在' });
        ctx.body = { success: false, error: '房间不存在' };
        return;
      }

      if (room.status !== 'waiting') {
        await pushToUser(roomId, openId, { type: 'error', message: '房间已开始游戏' });
        ctx.body = { success: false, error: '房间已开始游戏' };
        return;
      }

      const player = room.players.find((p: any) => p.openId === openId);
      if (!player) {
        await pushToUser(roomId, openId, { type: 'error', message: '玩家不在此房间' });
        ctx.body = { success: false, error: '玩家不在此房间' };
        return;
      }

      player.ready = !player.ready;
      await updateRoom(room._id, { players: room.players });

      const playerInfos = buildPlayerInfos(room);
      await pushToRoom(roomId, playerInfos, { type: 'playerReady', openId, ready: player.ready });

      const allReady = room.players.length === 3 && room.players.every((p: any) => p.ready);
      if (allReady) {
        await pushToRoom(roomId, playerInfos, { type: 'allReady' });
        console.log(`[ws-handler] 房间 ${roomId} 3人全部 ready`);
      }

      ctx.body = { success: true, ready: player.ready, allReady };
    } else {
      await pushToUser(roomId, openId, { type: 'error', message: `未知的消息类型: ${parsed.type}` });
      ctx.body = { success: false, error: '未知的消息类型' };
    }
  } catch (err: any) {
    console.error('[ws-handler] uplink 错误:', err.message);
    ctx.status = 500;
    ctx.body = { error: err.message || '上行消息处理失败' };
  }
}

export default router;
