/**
 * state-filter.test.ts — 状态过滤模块测试
 *
 * 测试目标：server/src/state-filter.ts
 * 核心职责：为每个玩家过滤游戏状态，隐藏对手手牌
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

/** 构造一个标准的3人游戏状态（用于测试） */
function createFullState() {
  return {
    state: 'discard',
    currentPlayer: 1,
    dealer: 0,
    wall: [{ id: 1, tileId: 10 }, { id: 2, tileId: 20 }],
    fanJiang: [{ id: 3, tileId: 5 }],
    jiangMap: { 5: 6 },
    scenario: 1,
    players: [
      {
        holding: [
          { id: 10, tileId: 1 },
          { id: 11, tileId: 2 },
          { id: 12, tileId: 3 },
        ],
        melds: [{ type: 'peng', tiles: [{ id: 20, tileId: 7 }] }],
        discarded: [{ id: 30, tileId: 8 }],
        drawn: { id: 15, tileId: 4 },
        isHu: false,
        huCount: 0,
      },
      {
        holding: [
          { id: 40, tileId: 5 },
          { id: 41, tileId: 6 },
        ],
        melds: [],
        discarded: [{ id: 50, tileId: 9 }, { id: 51, tileId: 10 }],
        drawn: null,
        isHu: false,
        huCount: 0,
      },
      {
        holding: [
          { id: 60, tileId: 11 },
          { id: 61, tileId: 12 },
          { id: 62, tileId: 13 },
          { id: 63, tileId: 14 },
        ],
        melds: [{ type: 'gang', tiles: [{ id: 70, tileId: 15 }] }],
        discarded: [],
        drawn: { id: 65, tileId: 16 },
        isHu: true,
        huCount: 1,
      },
    ],
    lastDiscard: { id: 30, tileId: 8 },
    lastDiscardPlayer: 0,
    config: { maxPlayers: 3 },
  };
}

// ============================================================
// 测试用例
// ============================================================

async function main() {
  // 动态导入，确保编译后也能运行
  const { filterStateForPlayer } = await import('../src/state-filter');

  // 辅助：将返回值转为 any 以方便属性访问
  function filter(state: any, seat: number): any {
    return filterStateForPlayer(state, seat) as any;
  }

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

  console.log('\n=== state-filter 测试 ===\n');

  // ----------------------------------------------------------
  // 测试1: 过滤对手手牌 — holding 变为 { count: N }, drawn 变为 null
  // ----------------------------------------------------------
  await runTest('过滤对手手牌：holding 变为数量对象，drawn 变为 null', () => {
    const state = createFullState();
    // 玩家0看玩家1的手牌
    const result = filter(state, 0);

    assertEqual(result.players[1].holding, { count: 2 },
      '玩家1的 holding 应变为 { count: 2 }');
    assertEqual(result.players[1].drawn, null,
      '玩家1的 drawn 应变为 null');
  });

  // ----------------------------------------------------------
  // 测试2: 保留自己的手牌 — holding 和 drawn 不变
  // ----------------------------------------------------------
  await runTest('保留自己的手牌：holding 和 drawn 不变', () => {
    const state = createFullState();
    const result = filter(state, 0);

    assertEqual(result.players[0].holding, state.players[0].holding,
      '玩家0自己的 holding 应保持不变');
    assertEqual(result.players[0].drawn, state.players[0].drawn,
      '玩家0自己的 drawn 应保持不变');
  });

  // ----------------------------------------------------------
  // 测试3: 公共信息不过滤 — wall、fanJiang、lastDiscard 不变
  // ----------------------------------------------------------
  await runTest('公共信息不过滤：wall、fanJiang、lastDiscard 不变', () => {
    const state = createFullState();
    const result = filter(state, 0);

    assertEqual(result.wall, state.wall, 'wall 应不变');
    assertEqual(result.fanJiang, state.fanJiang, 'fanJiang 应不变');
    assertEqual(result.lastDiscard, state.lastDiscard, 'lastDiscard 应不变');
    assertEqual(result.lastDiscardPlayer, state.lastDiscardPlayer,
      'lastDiscardPlayer 应不变');
    assertEqual(result.config, state.config, 'config 应不变');
    assertEqual(result.state, state.state, 'state 应不变');
    assertEqual(result.currentPlayer, state.currentPlayer,
      'currentPlayer 应不变');
    assertEqual(result.dealer, state.dealer, 'dealer 应不变');
    assertEqual(result.jiangMap, state.jiangMap, 'jiangMap 应不变');
    assertEqual(result.scenario, state.scenario, 'scenario 应不变');
  });

  // ----------------------------------------------------------
  // 测试4: 3人过滤 — 对每个 seatIndex 生成不同的结果
  // ----------------------------------------------------------
  await runTest('3人过滤：每个 seatIndex 生成不同的过滤结果', () => {
    const state = createFullState();

    const result0 = filter(state, 0);
    const result1 = filter(state, 1);
    const result2 = filter(state, 2);

    // 玩家0的视角：玩家1、2被过滤
    assertEqual(result0.players[1].holding, { count: 2 },
      '视角0: 玩家1 holding 被过滤');
    assertEqual(result0.players[2].holding, { count: 4 },
      '视角0: 玩家2 holding 被过滤');
    assertEqual(result0.players[0].holding, state.players[0].holding,
      '视角0: 自己 holding 不变');

    // 玩家1的视角：玩家0、2被过滤
    assertEqual(result1.players[0].holding, { count: 3 },
      '视角1: 玩家0 holding 被过滤');
    assertEqual(result1.players[2].holding, { count: 4 },
      '视角1: 玩家2 holding 被过滤');
    assertEqual(result1.players[1].holding, state.players[1].holding,
      '视角1: 自己 holding 不变');

    // 玩家2的视角：玩家0、1被过滤
    assertEqual(result2.players[0].holding, { count: 3 },
      '视角2: 玩家0 holding 被过滤');
    assertEqual(result2.players[1].holding, { count: 2 },
      '视角2: 玩家1 holding 被过滤');
    assertEqual(result2.players[2].holding, state.players[2].holding,
      '视角2: 自己 holding 不变');

    // 所有视角下 drawn 隐藏
    assertEqual(result0.players[1].drawn, null, '视角0: 玩家1 drawn null');
    assertEqual(result0.players[2].drawn, null, '视角0: 玩家2 drawn null');
    assertEqual(result1.players[0].drawn, null, '视角1: 玩家0 drawn null');
    assertEqual(result1.players[2].drawn, null, '视角1: 玩家2 drawn null');
    assertEqual(result2.players[0].drawn, null, '视角2: 玩家0 drawn null');
    assertEqual(result2.players[1].drawn, null, '视角2: 玩家1 drawn null');
  });

  // ----------------------------------------------------------
  // 测试5: 空 state 处理 — 返回 null
  // ----------------------------------------------------------
  await runTest('空 state 处理：返回 null', () => {
    assertEqual(filterStateForPlayer(null as any, 0), null,
      'null 输入应返回 null');
    assertEqual(filterStateForPlayer(undefined as any, 0), null,
      'undefined 输入应返回 null');
  });

  // ----------------------------------------------------------
  // 测试6: melds 不隐藏（碰/杠/撂龙是公开信息）
  // ----------------------------------------------------------
  await runTest('melds 不隐藏：碰/杠/撂龙是公开信息', () => {
    const state = createFullState();
    const result = filter(state, 1);

    assertEqual(result.players[0].melds, state.players[0].melds,
      '玩家0的 melds 应不变');
    assertEqual(result.players[2].melds, state.players[2].melds,
      '玩家2的 melds 应不变');
  });

  // ----------------------------------------------------------
  // 测试7: discarded 不隐藏（牌河公开）
  // ----------------------------------------------------------
  await runTest('discarded 不隐藏：牌河公开', () => {
    const state = createFullState();
    const result = filter(state, 1);

    assertEqual(result.players[0].discarded, state.players[0].discarded,
      '玩家0的 discarded 应不变');
    assertEqual(result.players[2].discarded, state.players[2].discarded,
      '玩家2的 discarded 应不变');
  });

  // ----------------------------------------------------------
  // 测试8: isHu/huCount 等其他字段不隐藏
  // ----------------------------------------------------------
  await runTest('isHu/huCount 等字段不隐藏', () => {
    const state = createFullState();
    const result = filter(state, 0);

    assertEqual(result.players[1].isHu, false, '玩家1 isHu 不变');
    assertEqual(result.players[1].huCount, 0, '玩家1 huCount 不变');
    assertEqual(result.players[2].isHu, true, '玩家2 isHu 不变');
    assertEqual(result.players[2].huCount, 1, '玩家2 huCount 不变');
  });

  // ----------------------------------------------------------
  // 测试9: 不修改原始 state（深拷贝验证）
  // ----------------------------------------------------------
  await runTest('不修改原始 state（深拷贝验证）', () => {
    const state = createFullState();
    const originalJson = JSON.stringify(state);
    filterStateForPlayer(state, 0);
    const afterJson = JSON.stringify(state);

    assertEqual(afterJson, originalJson,
      '原始 state 不应被修改');
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
