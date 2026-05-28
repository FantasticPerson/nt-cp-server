/**
 * 房间路由 — /api/room/*
 *
 * 提供房间的创建、加入、离开、准备、查询等 HTTP API。
 */

import Router from 'koa-router';
import {
  createRoom,
  findRoomById,
  updateRoom,
  deleteRoom,
  roomsCollection,
  initDatabase,
  RoomData,
} from '../db';
import { GameManager } from '../game/manager';

const router = new Router({ prefix: '/api/room' });

/** GameManager 单例引用，由入口文件注入 */
let gameManager: GameManager | null = null;

export function setGameManager(gm: GameManager): void {
  gameManager = gm;
}

// 用于生成房间号的字符集：大写字母+数字，排除 I/O/0/1 避免混淆
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_CODE_LENGTH = 4;

/** 生成4位随机房间号，确保不与已有房间冲突 */
async function generateRoomId(): Promise<string> {
  const collection = roomsCollection();
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    }
    const existing = await collection.where({ roomId: code }).get();
    if (!existing.data || existing.data.length === 0) {
      return code;
    }
  }
  throw new Error('无法生成唯一房间号，请重试');
}

/** POST /api/room/create — 创建房间 */
router.post('/create', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { openId, nickname, mode = 'single', xiEnabled = true } = body;

    if (!openId) {
      ctx.status = 400;
      ctx.body = { error: '缺少 openId' };
      return;
    }

    const roomId = await generateRoomId();
    const roomData: RoomData = {
      roomId,
      mode,
      xiEnabled,
      hostId: openId,
      players: [
        {
          openId,
          nickname: nickname || '玩家1',
          ready: false,
          seatIndex: 0,
          online: true,
        },
      ],
      status: 'waiting',
      createdAt: Date.now(),
      gameData: null,
    };

    await createRoom(roomData);

    ctx.body = { roomId, seatIndex: 0 };
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = { error: err.message || '创建房间失败' };
  }
});

/** POST /api/room/join — 加入房间 */
router.post('/join', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { roomId, openId, nickname } = body;

    if (!roomId || !openId) {
      ctx.status = 400;
      ctx.body = { error: '缺少 roomId 或 openId' };
      return;
    }

    const room = await findRoomById(roomId);
    if (!room) {
      ctx.status = 404;
      ctx.body = { error: '房间不存在' };
      return;
    }

    if (room.status !== 'waiting') {
      ctx.status = 400;
      ctx.body = { error: '房间已开始游戏' };
      return;
    }

    if (room.players.length >= 3) {
      ctx.status = 400;
      ctx.body = { error: '房间已满' };
      return;
    }

    // 检查是否已在房间中
    const alreadyIn = room.players.some((p: any) => p.openId === openId);
    if (alreadyIn) {
      ctx.status = 400;
      ctx.body = { error: '已在房间中' };
      return;
    }

    const seatIndex = room.players.length;
    room.players.push({
      openId,
      nickname: nickname || `玩家${seatIndex + 1}`,
      ready: false,
      seatIndex,
      online: true,
    });

    await updateRoom(room._id, { players: room.players });

    ctx.body = { seatIndex };
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = { error: err.message || '加入房间失败' };
  }
});

/** POST /api/room/leave — 离开房间 */
router.post('/leave', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { roomId, openId } = body;

    if (!roomId || !openId) {
      ctx.status = 400;
      ctx.body = { error: '缺少 roomId 或 openId' };
      return;
    }

    const room = await findRoomById(roomId);
    if (!room) {
      ctx.status = 404;
      ctx.body = { error: '房间不存在' };
      return;
    }

    const playerIndex = room.players.findIndex((p: any) => p.openId === openId);
    if (playerIndex === -1) {
      ctx.status = 400;
      ctx.body = { error: '玩家不在此房间' };
      return;
    }

    room.players.splice(playerIndex, 1);

    if (room.players.length === 0) {
      // 最后一人离开，删除房间
      await deleteRoom(room._id);
    } else {
      // 重新分配 seatIndex
      room.players.forEach((p: any, i: number) => {
        p.seatIndex = i;
      });

      // 如果房主离开，将房主转让给第一个玩家
      if (room.hostId === openId) {
        room.hostId = room.players[0].openId;
      }

      await updateRoom(room._id, {
        players: room.players,
        hostId: room.hostId,
      });
    }

    ctx.body = { success: true };
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = { error: err.message || '离开房间失败' };
  }
});

/** POST /api/room/ready — 切换准备状态 */
router.post('/ready', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { roomId, openId } = body;

    if (!roomId || !openId) {
      ctx.status = 400;
      ctx.body = { error: '缺少 roomId 或 openId' };
      return;
    }

    const room = await findRoomById(roomId);
    if (!room) {
      ctx.status = 404;
      ctx.body = { error: '房间不存在' };
      return;
    }

    if (room.status !== 'waiting') {
      ctx.status = 400;
      ctx.body = { error: '房间已开始游戏' };
      return;
    }

    const player = room.players.find((p: any) => p.openId === openId);
    if (!player) {
      ctx.status = 400;
      ctx.body = { error: '玩家不在此房间' };
      return;
    }

    // 切换 ready 状态
    player.ready = !player.ready;
    await updateRoom(room._id, { players: room.players });

    // 检查是否3人全部 ready
    const allReady = room.players.length === 3 && room.players.every((p: any) => p.ready);

    if (allReady) {
      // 3人全部 ready，创建游戏实例（等待所有玩家 WS 连接后再 startGame）
      if (gameManager) {
        const players = room.players.map((p: any) => ({
          openId: p.openId,
          seatIndex: p.seatIndex,
        }));

        gameManager.createGame(roomId, {
          mode: room.mode || 'single',
          xiEnabled: room.xiEnabled !== false,
        }, players);

        await updateRoom(room._id, { status: 'playing' });
        console.log(`[room] 房间 ${roomId} 游戏已创建，等待玩家连接`);
      }
    }

    ctx.body = { ready: player.ready, allReady };
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = { error: err.message || '切换准备状态失败' };
  }
});

/** GET /api/room/info — 查询玩家所在房间 */
router.get('/info', async (ctx) => {
  try {
    const openId = ctx.query.openId as string;

    if (!openId) {
      ctx.status = 400;
      ctx.body = { error: '缺少 openId' };
      return;
    }

    // 查询所有活跃状态的房间，在内存中过滤
    // 注意：云数据库 SDK 的 where 条件不支持嵌套数组查询，
    // 这里使用简单条件查询后在内存中匹配
    const collection = roomsCollection();
    const db = initDatabase();
    const result = await collection
      .where({
        status: db.command.in(['waiting', 'playing']),
      })
      .get();

    const rooms = result.data || [];
    const found = rooms.find((r: any) =>
      r.players && r.players.some((p: any) => p.openId === openId)
    );

    if (!found) {
      ctx.body = { room: null };
      return;
    }

    ctx.body = { room: found };
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = { error: err.message || '查询房间失败' };
  }
});

export default router;
