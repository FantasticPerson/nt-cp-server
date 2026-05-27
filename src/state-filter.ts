/**
 * state-filter.ts — 游戏状态过滤模块
 *
 * 核心安全职责：为每个玩家过滤完整游戏状态，
 * 隐藏对手手牌，确保客户端只能看到自己该看到的信息。
 *
 * 过滤规则：
 * - 对手 holding → { count: N }（只保留数量）
 * - 对手 drawn → null（隐藏刚摸的牌）
 * - melds / discarded 不隐藏（碰/杠/撂龙/牌河为公开信息）
 * - 公共字段（wall、fanJiang、lastDiscard 等）不过滤
 */

/**
 * 为指定玩家过滤完整游戏状态
 *
 * @param fullState  完整游戏状态（来自 engine/game.js getState()）
 * @param seatIndex  目标玩家的座位索引（0-2）
 * @returns 过滤后的状态（深拷贝），输入为空时返回 null
 */
export function filterStateForPlayer(
  fullState: object | null | undefined,
  seatIndex: number
): object | null {
  if (!fullState) return null;

  // 深拷贝，避免修改原始状态
  const filtered = JSON.parse(JSON.stringify(fullState)) as any;

  // 遍历所有玩家，隐藏对手手牌
  for (let i = 0; i < filtered.players.length; i++) {
    if (i !== seatIndex) {
      // 对手手牌只保留数量
      filtered.players[i].holding = { count: filtered.players[i].holding.length };
      // 隐藏对手刚摸的牌
      filtered.players[i].drawn = null;
    }
  }

  return filtered;
}
