/**
 * WS 网关 — 抖音云 WebSocket 推送
 *
 * 推送 API（抖音云托管内部服务）：
 * - POST /ws/push_data — 按 sessionId 或 openId 推送（最多 5 个）
 *
 * Headers:
 * - X-TT-WS-SESSIONIDS — 目标 sessionId（逗号分隔）
 * - X-TT-WS-OPENIDS    — 目标 openId（逗号分隔）
 *
 * 推送基础 URL 通过 WS_PUSH_BASE_URL 环境变量配置。
 */

import * as https from 'https';
import { filterStateForPlayer } from '../state-filter';

const WS_PUSH_BASE = process.env.WS_PUSH_BASE_URL || 'https://webcastbytetccd01.zijieapi.com';

// ─── 会话管理 ──────────────────────────────────────────────

const sessionMap = new Map<string, string>();

export function registerSession(sessionId: string, openId: string): void {
  sessionMap.set(sessionId, openId);
}

export function unregisterSession(sessionId: string): void {
  sessionMap.delete(sessionId);
}

// ─── 底层推送 ──────────────────────────────────────────────

async function pushRaw(path: string, headers: Record<string, string>, message: any): Promise<void> {
  const url = `${WS_PUSH_BASE}${path}`;
  const body = JSON.stringify(message);

  return new Promise<void>((resolve) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          console.error(`[ws-gateway] 推送失败 status=${res.statusCode} body=${data}`);
          resolve();
        }
      });
    });

    req.on('error', (err) => {
      console.error('[ws-gateway] 推送异常:', err.message);
      resolve();
    });

    req.write(body);
    req.end();
  });
}

/** 按 openId 列表推送（自动分批，每批最多 5 个） */
async function pushByOpenIds(openIds: string[], message: any): Promise<void> {
  for (let i = 0; i < openIds.length; i += 5) {
    const batch = openIds.slice(i, i + 5);
    await pushRaw('/ws/push_data', { 'X-TT-WS-OPENIDS': batch.join(',') }, message);
  }
}

// ─── 公共接口 ──────────────────────────────────────────────

export interface PlayerInfo {
  openId: string;
  seatIndex: number;
  online: boolean;
}

export async function pushToUser(
  _roomId: string,
  openId: string,
  message: any
): Promise<void> {
  try {
    await pushByOpenIds([openId], message);
  } catch (err: any) {
    console.error(`[ws-gateway] pushToUser 失败 openId=${openId}`, err.message);
  }
}

export async function pushToRoom(
  _roomId: string,
  players: PlayerInfo[],
  message: any
): Promise<void> {
  const openIds = players.filter(p => p.online).map(p => p.openId);
  if (openIds.length === 0) return;
  await pushByOpenIds(openIds, message);
}

export async function pushToRoomFiltered(
  _roomId: string,
  players: PlayerInfo[],
  fullState: any
): Promise<void> {
  const tasks = players
    .filter(p => p.online)
    .map(p => {
      const filteredState = filterStateForPlayer(fullState, p.seatIndex);
      return pushByOpenIds([p.openId], filteredState);
    });

  await Promise.all(tasks);
}
