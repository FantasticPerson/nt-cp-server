/**
 * WS 网关 — 封装抖音云 WebSocket 推送
 *
 * 抖音云托管中，服务端无法直接向客户端推送 WS 消息，
 * 需通过抖音云 WS 网关的 HTTP API 推送。
 *
 * API: POST https://webcastbytetccd01.zijieapi.com/ws/push_data
 * Header: X-Api-Token: <service_token>
 * Body: { room_id, user_id, data }
 */

import * as https from 'https';
import { filterStateForPlayer } from '../state-filter';

const WS_GATEWAY_URL = 'https://webcastbytetccd01.zijieapi.com/ws/push_data';

/** 从环境变量获取 serviceToken（云托管自动注入） */
function getServiceToken(): string {
  const token = process.env.SERVICE_TOKEN;
  if (!token) {
    console.warn('[ws-gateway] SERVICE_TOKEN 环境变量未设置，推送将失败');
  }
  return token || '';
}

/**
 * 底层推送 — 向抖音云 WS 网关发送 POST 请求
 *
 * @param roomId  容器房间 ID（WebSocket 连接的房间）
 * @param userId  目标用户 openId
 * @param message 要推送的消息对象，会被 JSON.stringify
 */
async function pushRaw(roomId: string, userId: string, message: any): Promise<void> {
  const token = getServiceToken();
  if (!token) {
    console.error('[ws-gateway] SERVICE_TOKEN 缺失，跳过推送');
    return;
  }

  const body = JSON.stringify({
    room_id: roomId,
    user_id: userId,
    data: JSON.stringify(message),
  });

  const options: https.RequestOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Token': token,
      'Content-Length': Buffer.byteLength(body),
    },
  };

  return new Promise<void>((resolve) => {
    const req = https.request(WS_GATEWAY_URL, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          console.error(
            `[ws-gateway] 推送失败 roomId=${roomId} userId=${userId} ` +
            `status=${res.statusCode} body=${data}`
          );
          resolve(); // 不 reject，避免中断游戏流程
        }
      });
    });

    req.on('error', (err) => {
      console.error(
        `[ws-gateway] 推送异常 roomId=${roomId} userId=${userId}`,
        err.message
      );
      resolve(); // 不 reject，避免中断游戏流程
    });

    req.write(body);
    req.end();
  });
}

/**
 * 推送消息给指定用户
 *
 * @param roomId  容器房间 ID
 * @param openId  目标用户 openId
 * @param message 消息对象
 */
export async function pushToUser(
  roomId: string,
  openId: string,
  message: any
): Promise<void> {
  try {
    await pushRaw(roomId, openId, message);
  } catch (err: any) {
    console.error(`[ws-gateway] pushToUser 失败 openId=${openId}`, err.message);
  }
}

/** 玩家信息（用于 pushToRoom / pushToRoomFiltered） */
export interface PlayerInfo {
  openId: string;
  seatIndex: number;
  online: boolean;
}

/**
 * 向房间内所有在线玩家推送同一条消息
 *
 * @param roomId  容器房间 ID
 * @param players 玩家列表
 * @param message 消息对象
 */
export async function pushToRoom(
  roomId: string,
  players: PlayerInfo[],
  message: any
): Promise<void> {
  const tasks = players
    .filter((p) => p.online)
    .map((p) => pushToUser(roomId, p.openId, message));

  await Promise.all(tasks);
}

/**
 * 向房间内每个在线玩家推送经过过滤的状态
 *
 * 对每个玩家，根据其 seatIndex 过滤完整状态后推送，
 * 确保玩家只能看到自己该看到的信息（如手牌）。
 *
 * @param roomId    容器房间 ID
 * @param players   玩家列表
 * @param fullState 完整游戏状态
 */
export async function pushToRoomFiltered(
  roomId: string,
  players: PlayerInfo[],
  fullState: any
): Promise<void> {
  const tasks = players
    .filter((p) => p.online)
    .map((p) => {
      const filteredState = filterStateForPlayer(fullState, p.seatIndex);
      return pushToUser(roomId, p.openId, filteredState);
    });

  await Promise.all(tasks);
}
