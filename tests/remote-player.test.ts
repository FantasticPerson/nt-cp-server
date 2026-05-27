/**
 * remote-player.test.ts -- RemotePlayer 测试
 *
 * 测试目标：server/src/game/adapter.ts
 * 核心职责：RemotePlayer 桥接 WebSocket 指令到 Game 引擎，
 *          在线时等待 injectDecision，离线时回退 AI 决策。
 *
 * 默认状态：离线（_online = false），所有决策回退 AI。
 * setOnline(true) 后，injectDecision 可注入客户端指令。
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

async function main() {
  const { RemotePlayer } = await import('../src/game/adapter');

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

  console.log('\n=== RemotePlayer 测试 ===\n');

  // ----------------------------------------------------------
  // 测试1: RemotePlayer 继承 PlayerInterface，构造函数接收参数
  // ----------------------------------------------------------
  await runTest('RemotePlayer 继承 PlayerInterface，构造函数接收参数', async () => {
    const { PlayerInterface } = require('../client/engine/player');
    const rp = new RemotePlayer(0, undefined, null);

    assert(rp instanceof PlayerInterface, 'RemotePlayer 应为 PlayerInterface 实例');
    assertEqual(rp.getIndex(), 0, 'getIndex() 应返回 0');
    assert(rp.getHand(), 'getHand() 应返回手牌对象');
    assert(Array.isArray(rp.getHand().holding), 'hand.holding 应为数组');
  });

  // ----------------------------------------------------------
  // 测试2: onDraw 默认回退 AI 决策（离线状态，无 injectDecision）
  // ----------------------------------------------------------
  await runTest('onDraw 默认回退 AI 决策', async () => {
    const rp = new RemotePlayer(1, undefined, null);
    const tile = { id: 1, tileId: 10 };
    const result = await rp.onDraw(tile);

    assert(result !== null && typeof result === 'object', 'onDraw 应返回决策对象');
    assert(typeof result.action === 'string', '决策应有 action 字段');
    // AI 在空手牌 + 一张摸牌时应该选择出牌
    assert(result.action === 'discard', 'AI 应选择 discard');
  });

  // ----------------------------------------------------------
  // 测试3: injectDecision 后 onDraw 立即 resolve 该决策（在线状态）
  // ----------------------------------------------------------
  await runTest('injectDecision 后 onDraw 立即 resolve', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    rp.setOnline(true);
    const tile = { id: 1, tileId: 10 };
    const expectedDecision = { action: 'discard', tile: { id: 99, tileId: 50 } };

    // 先 inject，再调用 onDraw
    rp.injectDecision(expectedDecision);
    const result = await rp.onDraw(tile);

    assertEqual(result, expectedDecision, 'onDraw 应返回 injectDecision 注入的决策');
  });

  // ----------------------------------------------------------
  // 测试4: onDraw 返回 Promise，等待 injectDecision resolve（在线状态）
  // ----------------------------------------------------------
  await runTest('onDraw 等待 injectDecision 触发 resolve', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    rp.setOnline(true);
    const tile = { id: 1, tileId: 10 };
    const expectedDecision = { action: 'hu' };

    // 先调用 onDraw（返回 Promise，尚未 resolve）
    const promise = rp.onDraw(tile);

    // 稍后注入决策
    setTimeout(() => {
      rp.injectDecision(expectedDecision);
    }, 50);

    const result = await promise;
    assertEqual(result, expectedDecision, 'onDraw 应返回后续 injectDecision 注入的决策');
  });

  // ----------------------------------------------------------
  // 测试5: injectDecision 不影响其他玩家的 AI 决策
  // ----------------------------------------------------------
  await runTest('injectDecision 不影响其他玩家的 AI 决策', async () => {
    const rp1 = new RemotePlayer(0, undefined, null);
    const rp2 = new RemotePlayer(1, undefined, null);
    const tile = { id: 1, tileId: 10 };

    // 给 rp1 注入决策（rp1 在线）
    rp1.setOnline(true);
    rp1.injectDecision({ action: 'hu' });

    // rp2 保持离线，应该回退 AI（返回 discard 而非 hu）
    const result2 = await rp2.onDraw(tile);
    assert(result2.action === 'discard', 'rp2 应不受影响，使用 AI 决策 discard');
  });

  // ----------------------------------------------------------
  // 测试6: 连续 injectDecision：只有最近一个生效
  // ----------------------------------------------------------
  await runTest('连续 injectDecision：只有最近一个生效', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    rp.setOnline(true);
    const tile = { id: 1, tileId: 10 };

    rp.injectDecision({ action: 'discard', tile: { id: 1, tileId: 1 } });
    rp.injectDecision({ action: 'hu' });

    const result = await rp.onDraw(tile);
    assertEqual(result, { action: 'hu' }, '应使用最后一次 injectDecision');
  });

  // ----------------------------------------------------------
  // 测试7: onDiscard — AI 或 injectDecision
  // ----------------------------------------------------------
  await runTest('onDiscard 默认回退 AI 决策', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    const tile = { id: 1, tileId: 10 };

    const result = await rp.onDiscard(tile, 1);
    assert(typeof result === 'object' && typeof result.action === 'string',
      'onDiscard 应返回带 action 的决策对象');
    // AI 无牌可碰/杠/胡，应该 pass
    assert(result.action === 'pass', 'AI 应选择 pass');
  });

  await runTest('onDiscard injectDecision 生效', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    rp.setOnline(true);
    const tile = { id: 1, tileId: 10 };
    const expected = { action: 'peng' };

    rp.injectDecision(expected);
    const result = await rp.onDiscard(tile, 1);
    assertEqual(result, expected, 'onDiscard 应返回注入的决策');
  });

  // ----------------------------------------------------------
  // 测试8: onLiaolong — AI 或 injectDecision
  // ----------------------------------------------------------
  await runTest('onLiaolong 默认回退 AI 决策（全部报）', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    const options = [{ type: 'long', tiles: [] }, { type: 'xi', tiles: [] }];

    const result = await rp.onLiaolong(options);
    assert(Array.isArray(result.declared), 'onLiaolong 应返回 declared 数组');
    assertEqual(result.declared.length, 2, 'AI 应全部报（2个）');
  });

  await runTest('onLiaolong injectDecision 生效', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    rp.setOnline(true);
    const options = [{ type: 'long', tiles: [] }, { type: 'xi', tiles: [] }];
    const expected = { declared: [options[0]] };

    rp.injectDecision(expected);
    const result = await rp.onLiaolong(options);
    assertEqual(result, expected, 'onLiaolong 应返回注入的决策');
  });

  // ----------------------------------------------------------
  // 测试9: setOnline(false) 后 injectDecision 无效，全部回退 AI
  // ----------------------------------------------------------
  await runTest('setOnline(false) 后 injectDecision 无效，回退 AI', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    const tile = { id: 1, tileId: 10 };

    rp.setOnline(false);
    rp.injectDecision({ action: 'hu' });

    const result = await rp.onDraw(tile);
    assert(result.action === 'discard', '离线时 injectDecision 无效，应使用 AI discard');
  });

  // ----------------------------------------------------------
  // 测试10: setOnline(true) 后恢复接受 injectDecision
  // ----------------------------------------------------------
  await runTest('setOnline(true) 恢复接受 injectDecision', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    const tile = { id: 1, tileId: 10 };

    rp.setOnline(false);
    rp.setOnline(true);

    const expectedDecision = { action: 'hu' };
    rp.injectDecision(expectedDecision);

    const result = await rp.onDraw(tile);
    assertEqual(result, expectedDecision, '重新上线后应接受 injectDecision');
  });

  // ----------------------------------------------------------
  // 测试11: 构造函数传入 hand 和 jiangMap 参数
  // ----------------------------------------------------------
  await runTest('构造函数传入 hand 和 jiangMap 参数', async () => {
    const hand = {
      holding: [{ id: 1, tileId: 10 }, { id: 2, tileId: 20 }],
      melds: [],
      discarded: [],
      drawn: null,
    };
    const jiangMap = { 10: 11 };

    const rp = new RemotePlayer(2, hand, jiangMap);
    assertEqual(rp.getIndex(), 2, 'index 应为 2');
    assertEqual(rp.getHand().holding.length, 2, 'holding 应有 2 张牌');
  });

  // ----------------------------------------------------------
  // 测试12: PlayerInterface 方法仍可用（addToHolding 等）
  // ----------------------------------------------------------
  await runTest('PlayerInterface 方法仍可用', async () => {
    const rp = new RemotePlayer(0, undefined, null);
    const tile = { id: 100, tileId: 50 };

    rp.addToHolding(tile);
    assertEqual(rp.getHand().holding.length, 1, 'addToHolding 应增加牌');
    assertEqual(rp.getHand().holding[0].id, 100, '添加的牌应正确');

    rp.removeFromHolding(tile);
    assertEqual(rp.getHand().holding.length, 0, 'removeFromHolding 应移除牌');
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
