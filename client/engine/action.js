/**
 * 动作队列模块
 *
 * 出牌后按优先级处理其他玩家的响应。
 * 南通长牌没有一炮多响，按座位顺序第一个有权胡的胡。
 */

const { RESPOND_TYPE, PLAYER_COUNT } = require('../utils/constants');
const { canDianPao, canMingGang, canPeng } = require('../core/rules');

/**
 * 计算出牌者的下家
 * @param {number} current - 当前玩家座位号
 * @param {number} total - 总玩家人数
 * @returns {number} 下家座位号
 */
function nextPlayer(current, total) {
  return (current + 1) % total;
}

/**
 * 出牌后按优先级解析响应
 *
 * 逻辑：
 * 1. 按座位顺序（下家优先）获取除出牌者外的其他玩家
 * 2. 依次检查每家：能否胡 -> 能否杠 -> 能否碰
 * 3. 返回最高优先级的响应
 * 4. 没有一炮多响，第一个有权胡的胡
 * 5. 如果无人响应 -> pass，轮到下家
 *
 * @param {Object} tile - 出的牌实例 (TileInstance)
 * @param {number} fromPlayer - 出牌者的座位号
 * @param {Array} players - 所有玩家对象数组 (PlayerInterface[])
 * @returns {{ action: string, playerIndex: number }}
 *   action: RESPOND_TYPE 中的值 ('hu' | 'gang' | 'peng' | 'pass')
 *   playerIndex: 响应者的座位号（pass 时为下家）
 */
function resolveResponds(tile, fromPlayer, players) {
  var total = players.length || PLAYER_COUNT;

  // 按座位顺序获取除出牌者外的其他玩家，下家优先
  // 顺序: fromPlayer+1, fromPlayer+2, ..., (跳过 fromPlayer)
  var order = [];
  for (var i = 1; i < total; i++) {
    order.push((fromPlayer + i) % total);
  }

  // 按优先级检查每家
  // 优先级：胡 > 杠 > 碰
  // 第一轮只检查胡（没有一炮多响，第一个有权胡的胡）
  for (var h = 0; h < order.length; h++) {
    var pIdx = order[h];
    var player = players[pIdx];
    var hand = player.getHand();
    if (canDianPao(hand.holding, hand.melds, tile)) {
      return { action: RESPOND_TYPE.HU, playerIndex: pIdx };
    }
  }

  // 第二轮检查杠
  for (var g = 0; g < order.length; g++) {
    var gIdx = order[g];
    var gPlayer = players[gIdx];
    var gHand = gPlayer.getHand();
    if (canMingGang(gHand.holding, tile)) {
      return { action: RESPOND_TYPE.GANG, playerIndex: gIdx };
    }
  }

  // 第三轮检查碰
  for (var p = 0; p < order.length; p++) {
    var pIdx = order[p];
    var pPlayer = players[pIdx];
    var pHand = pPlayer.getHand();
    if (canPeng(pHand.holding, tile)) {
      return { action: RESPOND_TYPE.PENG, playerIndex: pIdx };
    }
  }

  // 无人响应，轮到下家
  return { action: RESPOND_TYPE.PASS, playerIndex: nextPlayer(fromPlayer, total) };
}

/**
 * 检查指定玩家可以执行哪些响应操作
 *
 * @param {number} playerIndex - 玩家索引
 * @param {Object} tile - 出的牌
 * @param {Array} players - 所有玩家
 * @returns {{ canHu: boolean, canGang: boolean, canPeng: boolean }}
 */
function getPlayerRespondOptions(playerIndex, tile, players) {
  var player = players[playerIndex];
  if (!player) return { canHu: false, canGang: false, canPeng: false };
  var hand = player.getHand();
  return {
    canHu: canDianPao(hand.holding, hand.melds, tile),
    canGang: canMingGang(hand.holding, tile),
    canPeng: canPeng(hand.holding, tile),
  };
}

// ---- 导出 ----

module.exports = {
  nextPlayer: nextPlayer,
  resolveResponds: resolveResponds,
  getPlayerRespondOptions: getPlayerRespondOptions,
};
