/**
 * 匹配路由 — /api/match/*
 *
 * 提供匹配队列的加入、取消、轮询等 HTTP API。
 */

import Router from 'koa-router';
import {
  addToQueue,
  findQueueByMode,
  findQueueByOpenId,
  removeFromQueue,
  createRoom,
  RoomData,
} from '../db';

const router = new Router({ prefix: '/api/match' });

/** POST /api/match/start — 加入匹配队列 */
router.post('/start', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { openId, nickname, mode = 'single', xiEnabled = true } = body;

    if (!openId) {
      ctx.status = 400;
      ctx.body = { error: '缺少 openId' };
      return;
    }

    // 先移除已有的匹配记录，防止重复
    await removeFromQueue(openId);

    await addToQueue({
      openId,
      nickname: nickname || '玩家',
      mode,
      xiEnabled,
      createdAt: Date.now(),
    });

    ctx.body = { success: true };
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = { error: err.message || '加入匹配队列失败' };
  }
});

/** POST /api/match/cancel — 取消匹配 */
router.post('/cancel', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { openId } = body;

    if (!openId) {
      ctx.status = 400;
      ctx.body = { error: '缺少 openId' };
      return;
    }

    await removeFromQueue(openId);

    ctx.body = { success: true };
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = { error: err.message || '取消匹配失败' };
  }
});

/** POST /api/match/poll — 轮询匹配状态 */
router.post('/poll', async (ctx) => {
  try {
    const body = ctx.request.body as any;
    const { openId } = body;

    if (!openId) {
      ctx.status = 400;
      ctx.body = { error: '缺少 openId' };
      return;
    }

    // 查找当前玩家在队列中的记录，获取 mode 和 xiEnabled
    const myRecord = await findQueueByOpenId(openId);

    if (!myRecord) {
      // 玩家不在队列中，可能已被匹配或已取消
      ctx.body = { matched: false, reason: 'not_in_queue' };
      return;
    }

    // 查找同 mode + xiEnabled 的匹配记录
    const candidates = await findQueueByMode(myRecord.mode, myRecord.xiEnabled);

    if (candidates.length >= 3) {
      // 凑满3人，创建房间
      const matched = candidates.slice(0, 3);
      const roomChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let roomId = '';
      for (let i = 0; i < 4; i++) {
        roomId += roomChars[Math.floor(Math.random() * roomChars.length)];
      }

      const players = matched.map((r: any, i: number) => ({
        openId: r.openId,
        nickname: r.nickname || `玩家${i + 1}`,
        ready: false,
        seatIndex: i,
        online: true,
      }));

      const roomData: RoomData = {
        roomId,
        mode: myRecord.mode,
        xiEnabled: myRecord.xiEnabled,
        hostId: matched[0].openId,
        players,
        status: 'waiting',
        createdAt: Date.now(),
        gameData: null,
      };

      await createRoom(roomData);

      // 从匹配队列中移除这3人
      for (const m of matched) {
        await removeFromQueue(m.openId);
      }

      // TODO: 通过 WS 网关推送 roomUpdate 给3人（任务9实现）
      // import { pushToUser } from '../ws/gateway';
      // for (const m of matched) {
      //   await pushToUser(roomId, m.openId, { type: 'roomUpdate', room: roomData });
      // }
      console.log(`[match] 匹配成功，房间 ${roomId}，玩家: ${matched.map((m: any) => m.openId).join(', ')}`);

      ctx.body = { matched: true, roomId, players };
    } else {
      // 还没凑满3人
      ctx.body = { matched: false, currentCount: candidates.length };
    }
  } catch (err: any) {
    ctx.status = 500;
    ctx.body = { error: err.message || '轮询匹配失败' };
  }
});

export default router;
