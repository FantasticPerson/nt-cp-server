/**
 * server.ts -- Koa 服务端入口
 *
 * 职责：
 * - 创建 Koa 应用，注册 bodyparser 中间件
 * - 注册 HTTP 路由：/api/room/*、/api/match/*
 * - 注册 WS 回调路由：/ws/connect、/ws/disconnect、/ws/uplink
 * - 初始化数据库连接
 * - 初始化 GameManager 单例（注入 WS 网关）
 * - 全局错误处理中间件
 * - 导出 app 供 Dockerfile 使用
 */

import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from 'koa-router';

// 路由
import roomRouter from './routes/room';
import matchRouter from './routes/match';
import wsRouter, { setGameManager } from './ws/handler';

// GameManager
import { GameManager } from './game/manager';

// WS 网关（作为 GameManager 的 gateway 参数）
import { pushToUser, pushToRoomFiltered, pushToRoom } from './ws/gateway';

// 数据库
import { initDatabase } from './db';

// ─── Koa 应用 ─────────────────────────────────────────────

const app = new Koa();

// 错误处理中间件（最外层，捕获所有未处理错误）
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err: any) {
    console.error('[server] 未捕获错误:', err.message);
    ctx.status = err.status || 500;
    ctx.body = { error: err.message || 'Internal Server Error' };
  }
});

// Body parser
app.use(bodyParser());

// 注册路由
app.use(roomRouter.routes()).use(roomRouter.allowedMethods());
app.use(matchRouter.routes()).use(matchRouter.allowedMethods());
app.use(wsRouter.routes()).use(wsRouter.allowedMethods());

// ─── 初始化 ───────────────────────────────────────────────

// 初始化数据库连接
initDatabase();

// 创建 GameManager，注入 WS 网关
const gameManager = new GameManager({
  pushToUser,
  pushToRoomFiltered,
  pushToRoom,
});

// 将 GameManager 注入到 WS 处理器
setGameManager(gameManager);

// ─── 启动 ─────────────────────────────────────────────────

const port = process.env.PORT || 8000;

app.listen(port, () => {
  console.log(`[server] 服务启动成功，端口: ${port}`);
});

export default app;
