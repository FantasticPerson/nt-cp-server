/**
 * 牌堆管理模块
 *
 * 提供洗牌、发牌、摸牌等牌堆操作功能。
 * 南通长牌三人玩法：庄家 23 张，闲家各 22 张，翻将从牌墙顶部取。
 */

const {
  MODE,
  DEALER_TILES,
  OTHER_TILES,
  PLAYER_COUNT,
} = require('../utils/constants');

// ---- 洗牌 ----

/**
 * Fisher-Yates 洗牌算法
 * 原地打乱数组并返回同一引用。
 *
 * @param {Array} tiles - 牌数组
 * @returns {Array} 打乱后的同一数组引用
 */
function shuffle(tiles) {
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = tiles[i];
    tiles[i] = tiles[j];
    tiles[j] = temp;
  }
  return tiles;
}

// ---- 发牌 ----

/**
 * 发牌
 *
 * 从已洗好的牌堆顶部依次发牌：
 *   1. 庄家(index 0)摸 23 张
 *   2. 闲家(index 1)摸 22 张
 *   3. 闲家(index 2)摸 22 张
 *   4. 从牌墙顶部翻将：单将 1 张，双将 2 张
 *
 * @param {Array} deckTiles - 已洗好的完整牌组
 * @param {string} mode - 游戏模式 MODE.SINGLE 或 MODE.DOUBLE
 * @param {boolean} [xiEnabled=true] - 是否包含喜牌（仅用于验证牌组总数）
 * @returns {{ players: Array, wall: Array, fanJiang: Array }}
 */
function deal(deckTiles, mode, xiEnabled) {
  if (!Array.isArray(deckTiles) || deckTiles.length === 0) {
    throw new Error('deckTiles must be a non-empty array');
  }

  var fanJiangCount = (mode === MODE.DOUBLE) ? 2 : 1;
  var totalNeeded = DEALER_TILES + OTHER_TILES * (PLAYER_COUNT - 1) + fanJiangCount;

  if (deckTiles.length < totalNeeded) {
    throw new Error(
      'Not enough tiles: need ' + totalNeeded + ', have ' + deckTiles.length
    );
  }

  // 使用副本，避免修改原数组
  var remaining = deckTiles.slice();
  var offset = 0;

  // 庄家摸牌
  var dealerHolding = remaining.slice(offset, offset + DEALER_TILES);
  offset += DEALER_TILES;

  // 闲家1摸牌
  var other1Holding = remaining.slice(offset, offset + OTHER_TILES);
  offset += OTHER_TILES;

  // 闲家2摸牌
  var other2Holding = remaining.slice(offset, offset + OTHER_TILES);
  offset += OTHER_TILES;

  // 翻将：从牌墙顶部取
  var fanJiang = remaining.slice(offset, offset + fanJiangCount);
  offset += fanJiangCount;

  // 剩余为牌墙
  var wall = remaining.slice(offset);

  var players = [];
  for (var i = 0; i < PLAYER_COUNT; i++) {
    players.push({
      holding: i === 0 ? dealerHolding : (i === 1 ? other1Holding : other2Holding),
      melds: [],
      discarded: [],
      drawn: null,
    });
  }

  return {
    players: players,
    wall: wall,
    fanJiang: fanJiang,
  };
}

// ---- 摸牌 ----

/**
 * 从牌墙摸一张牌
 * 从牌墙顶部（数组起始位置）取走一张。
 *
 * @param {Array} wall - 牌墙数组（会被原地修改）
 * @returns {Object|null} 取出的牌实例，牌墙空时返回 null
 */
function drawFromWall(wall) {
  if (!Array.isArray(wall) || wall.length === 0) {
    return null;
  }
  return wall.shift();
}

// ---- 导出 ----

module.exports = {
  shuffle: shuffle,
  deal: deal,
  drawFromWall: drawFromWall,
};
