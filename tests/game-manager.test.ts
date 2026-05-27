/**
 * game-manager.test.ts -- GameManager 测试
 *
 * 测试目标：server/src/game/manager.ts
 * 核心职责：GameManager 管理房间 → Game 引擎的映射，
 *          创建/销毁游戏实例，处理玩家操作，管理在线状态。
 *
 * 使用 mock gateway（记录推送调用，不发送真实 HTTP 请求）
 * 使用真实 Game 引擎（Node.js 可直接运行）
 */

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error('FAIL: ' + message);
  }
}

function assertEqual(actual: any, expected: any, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(
      `FAIL: ${message}\n  expected: ${b}\n  actual:   ${a}`
    );
  }
}

/**
 * 创建 mock gateway
 * 记录所有推送调用，不发送真实 HTTP
 */
function createMockGateway() {
  const calls: Array<{ method: string; roomId: string; openId?: string; players?: any[]; message?: any; fullState?: any }> = [];

  return {
    pushToUser: async function (roomId: string, openId: string, message: any) {
      calls.push({ method: 'pushToUser', roomId, openId, message });
    },
    pushToRoomFiltered: async function (roomId: string, players: any[], fullState: any) {
      calls.push({ method: 'pushToRoomFiltered', roomId, players, fullState });
    },
    pushToRoom: async function (roomId: string, players: any[], message: any) {
      calls.push({ method: 'pushToRoom', roomId, players, message });
    },
    calls: calls,
  };
}

/** 标准玩家列表 */
function makePlayers() {
  return [
    { openId: 'user-a', seatIndex: 0 },
    { openId: 'user-b', seatIndex: 1 },
    { openId: 'user-c', seatIndex: 2 },
  ];
}

async function main() {
  const managerModule = await import('../src/game/manager');
  const { GameManager } = managerModule;

  let passed = 0;
  let failed = 0;

  async function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  FAIL: ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  console.log('\n=== GameManager 测试 ===\n');

  // ==========================================
  // 第一组：无需 startGame 的基础测试
  // ==========================================

  // ----------------------------------------------------------
  // 测试1: createGame 后 hasGame 返回 true
  // ----------------------------------------------------------
  await runTest('createGame 后 hasGame 返回 true', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);
    gm.createGame('room-1', { mode: 'single', xiEnabled: true }, makePlayers());
    assert(gm.hasGame('room-1'), 'hasGame 应返回 true');
  });

  // ----------------------------------------------------------
  // 测试2: getGameState 不存在的 roomId 返回 null
  // ----------------------------------------------------------
  await runTest('getGameState 不存在的 roomId 返回 null', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);
    const state = gm.getGameState('non-existent');
    assert(state === null, '不存在的 roomId 应返回 null');
  });

  // ----------------------------------------------------------
  // 测试3: destroyGame 清理资源
  // ----------------------------------------------------------
  await runTest('destroyGame 清理资源', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);
    gm.createGame('room-3', { mode: 'single', xiEnabled: true }, makePlayers());
    assert(gm.hasGame('room-3') === true, '游戏应存在');
    gm.destroyGame('room-3');
    assert(gm.hasGame('room-3') === false, 'destroyGame 后游戏不应存在');
    assert(gm.getGameState('room-3') === null, 'getGameState 应返回 null');
  });

  // ----------------------------------------------------------
  // 测试4: destroyGame 不存在的 roomId 不报错
  // ----------------------------------------------------------
  await runTest('destroyGame 不存在的 roomId 不报错', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);
    gm.destroyGame('non-existent-room');
  });

  // ----------------------------------------------------------
  // 测试5: startGame 不存在的 roomId 返回 rejected promise
  // ----------------------------------------------------------
  await runTest('startGame 不存在的 roomId 返回 rejected promise', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);
    let caught = false;
    try {
      await gm.startGame('non-existent');
    } catch (err: any) {
      caught = true;
      assert(err.message.indexOf('Room not found') !== -1, '应包含 Room not found');
    }
    assert(caught, '应抛出异常');
  });

  // ----------------------------------------------------------
  // 测试6: playerReconnect 不存在的 roomId 返回 null
  // ----------------------------------------------------------
  await runTest('playerReconnect 不存在的 roomId 返回 null', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);
    const result = gm.playerReconnect('non-existent', 'user-a');
    assert(result === null, '不存在的 roomId 应返回 null');
  });

  // ----------------------------------------------------------
  // 测试7: playerDisconnect 不存在的 roomId 不报错
  // ----------------------------------------------------------
  await runTest('playerDisconnect 不存在的 roomId 不报错', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);
    gm.playerDisconnect('non-existent', 'user-a');
  });

  // ----------------------------------------------------------
  // 测试8: handleAction 不存在的 roomId 返回 false
  // ----------------------------------------------------------
  await runTest('handleAction 不存在的 roomId 返回 false', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);
    const result = gm.handleAction('non-existent', 'user-a', { action: 'discard' });
    assert(result === false, '不存在的 roomId 应返回 false');
  });

  // ==========================================
  // 第二组：需要 startGame 的测试（用一个游戏实例完成多个断言）
  // ==========================================

  // ----------------------------------------------------------
  // 测试9: startGame 完整流程 — 替换玩家、seatMap、默认离线、
  //         reconnect/disconnect、状态过滤、推送、AI 完成一局
  // ----------------------------------------------------------
  await runTest('startGame 完整流程（玩家替换、在线管理、状态过滤、AI 完成一局）', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);

    const roomId = 'room-full';
    const players = makePlayers();

    gm.createGame(roomId, { mode: 'single', xiEnabled: true }, players);

    // 启动游戏
    const gamePromise = gm.startGame(roomId);
    // 等待 _init 完成和首次状态推送
    await new Promise((resolve) => setTimeout(resolve, 300));

    // --- 验证 PlayerInterface 被替换为 RemotePlayer ---
    const internalPlayers = gm.getPlayers(roomId);
    assert(internalPlayers !== null, 'players 应存在');
    assertEqual(internalPlayers!.size, 3, '应有 3 个玩家');
    assert(internalPlayers!.has('user-a'), '应有 user-a');
    assert(internalPlayers!.has('user-b'), '应有 user-b');
    assert(internalPlayers!.has('user-c'), '应有 user-c');

    // --- 验证 seatMap ---
    const seatMap = gm.getSeatMap(roomId);
    assert(seatMap !== null, 'seatMap 应存在');
    assertEqual(seatMap!.get('user-a'), 0, 'user-a → seat 0');
    assertEqual(seatMap!.get('user-b'), 1, 'user-b → seat 1');
    assertEqual(seatMap!.get('user-c'), 2, 'user-c → seat 2');

    // --- 验证默认离线 ---
    internalPlayers!.forEach(function (rp: any) {
      assert(rp._online === false, 'RemotePlayer 应默认离线');
    });

    // --- 验证 playerReconnect ---
    const filteredState: any = gm.playerReconnect(roomId, 'user-a');
    assert(filteredState !== null, 'playerReconnect 应返回过滤后的状态');
    const rpA = internalPlayers!.get('user-a')!;
    assert(rpA._online === true, 'user-a 应已设为在线');

    // 验证状态过滤：自己手牌可见，对手手牌隐藏
    assert(Array.isArray(filteredState.players[0].holding), '自己的手牌应为数组');
    assert(
      filteredState.players[1].holding.count !== undefined,
      '对手1的手牌应被过滤为 { count: N }'
    );
    assert(
      filteredState.players[2].holding.count !== undefined,
      '对手2的手牌应被过滤为 { count: N }'
    );

    // --- 验证 playerDisconnect ---
    gm.playerDisconnect(roomId, 'user-a');
    assert(rpA._online === false, 'user-a 应已设为离线');

    // --- 验证推送调用 ---
    assert(gw.calls.length > 0, '应有推送调用');
    const filteredCalls = gw.calls.filter((c) => c.method === 'pushToRoomFiltered');
    assert(filteredCalls.length > 0, '应有 pushToRoomFiltered 调用');

    // --- 验证 handleAction 不存在的 openId ---
    const result = gm.handleAction(roomId, 'non-existent-user', { action: 'discard' });
    assert(result === false, '不存在的 openId 应返回 false');

    // --- 等待游戏结束 ---
    const raceResult = await Promise.race([
      gamePromise.then(() => 'done'),
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 20000)),
    ]);
    assert(raceResult === 'done', '游戏应在超时前结束');

    // --- 验证最终状态 ---
    const finalState: any = gm.getGameState(roomId);
    assert(
      finalState.state === 'hu' || finalState.state === 'liuju',
      '游戏结束后状态应为 hu 或 liuju，实际: ' + finalState.state
    );
  });

  // ----------------------------------------------------------
  // 测试10: handleAction 注入决策到正确的 RemotePlayer
  // ----------------------------------------------------------
  await runTest('handleAction 注入决策到正确的 RemotePlayer', async () => {
    const gw = createMockGateway();
    const gm = new GameManager(gw as any);

    const roomId = 'room-action';
    const players = makePlayers();

    gm.createGame(roomId, { mode: 'single', xiEnabled: true }, players);
    const gamePromise = gm.startGame(roomId);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // user-a 上线
    gm.playerReconnect(roomId, 'user-a');

    // 注入 discard 决策
    const result = gm.handleAction(roomId, 'user-a', { action: 'discard', tile: { id: 999, tileId: 10 } });
    assert(result === true, 'handleAction 应返回 true（成功注入）');

    // 等待游戏完成
    await Promise.race([
      gamePromise,
      new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 20000)),
    ]);
  });

  // ----------------------------------------------------------
  // 汇总
  // ----------------------------------------------------------
  console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
