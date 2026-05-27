/**
 * AI 策略引擎
 *
 * AI 玩家的决策引擎，继承 PlayerInterface，
 * 实现 onDraw / onDiscard / onLiaolong 三个抽象方法。
 * 支持三种难度：easy / normal / hard。
 */

const { PlayerInterface } = require('../engine/player');
const { evaluateHand } = require('./evaluator');
const {
  canPeng,
  canMingGang,
  canAnGang,
  canBuGang,
  canDianPao,
  canZiMo,
  checkLiaolong,
} = require('../core/rules');
const { canHu, detectTing } = require('../core/hand');

// ---- 难度配置 ----

var DIFFICULTY = {
  easy:   { discardNoise: 0.3, meldAccuracy: 0.6 },
  normal: { discardNoise: 0.1, meldAccuracy: 0.85 },
  hard:   { discardNoise: 0,   meldAccuracy: 1.0, trackDiscards: true },
};

// ---- 辅助函数 ----

/**
 * 生成 [0, 1) 区间的伪随机数
 * @returns {number}
 */
function random() {
  return Math.random();
}

/**
 * 从数组中随机选一个元素
 * @param {Array} arr
 * @returns {*}
 */
function randomPick(arr) {
  return arr[Math.floor(random() * arr.length)];
}

/**
 * 查找手中指定 tileId 的所有牌实例
 * @param {Array} holding - 手中暗牌实例数组
 * @param {number} tileId
 * @returns {Array} 匹配的牌实例数组
 */
function findTilesByTileId(holding, tileId) {
  var result = [];
  for (var i = 0; i < holding.length; i++) {
    if (holding[i].tileId === tileId) {
      result.push(holding[i]);
    }
  }
  return result;
}

/**
 * 检查当前是否已听牌
 * 听牌条件：暗牌 + melds 张数 = 22 时检测
 * @param {Array} holding - 手中暗牌
 * @param {Array} melds - 已有面子
 * @returns {boolean}
 */
function isTing(holding, melds) {
  if (!melds) melds = [];
  var meldTileCount = 0;
  for (var i = 0; i < melds.length; i++) {
    meldTileCount += melds[i].tiles.length;
  }
  if (holding.length + meldTileCount !== 22) return false;
  var tingList = detectTing(holding, melds, null);
  return tingList.length > 0;
}

// ---- AIPlayer 构造函数 ----

/**
 * AI 玩家
 *
 * @param {number} index - 座位号 (0-based)
 * @param {Object} [hand] - 初始手牌对象，不传则创建空手牌
 * @param {string} [difficulty='normal'] - 难度 'easy' | 'normal' | 'hard'
 */
function AIPlayer(index, hand, difficulty, jiangMap) {
  PlayerInterface.call(this, index, hand);

  this._difficulty = difficulty || 'normal';
  if (!DIFFICULTY[this._difficulty]) {
    this._difficulty = 'normal';
  }

  this._config = DIFFICULTY[this._difficulty];
  this._jiangMap = jiangMap || null;

  // Hard 模式：跟踪对手出牌
  this._opponentDiscards = [];
  this._trackDiscards = !!this._config.trackDiscards;
}

// 继承 PlayerInterface
AIPlayer.prototype = Object.create(PlayerInterface.prototype);
AIPlayer.prototype.constructor = AIPlayer;

// ---- onDraw: 摸牌后决策 ----

/**
 * 摸牌后的决策
 *
 * 决策优先级：
 * 1. 自摸胡 → { action: 'hu' }
 * 2. 暗杠  → { action: 'angang', tile: TileInstance }
 * 3. 补杠  → { action: 'bugang', tile: TileInstance }
 * 4. 出牌  → { action: 'discard', tile: TileInstance }
 *
 * @param {Object} tile - 摸到的牌实例
 * @returns {Promise<{ action: string, tile?: Object }>}
 */
AIPlayer.prototype.onDraw = function (tile) {
  var hand = this.getHand();
  var holding = hand.holding;
  var melds = hand.melds;
  var config = this._config;

  // 将摸到的牌纳入检查
  var holdingWithDrawn = holding.slice();
  if (tile) holdingWithDrawn.push(tile);

  // 1. 检查自摸胡
  if (canZiMo(holding, melds, tile)) {
    return Promise.resolve({ action: 'hu' });
  }

  // 2. 检查暗杠（手中4张相同，或将牌3张，含摸到的牌）
  var anGangIds = canAnGang(holdingWithDrawn, this._jiangMap);
  if (anGangIds.length > 0) {
    // 选择一个暗杠（优先选择评估分数较低的牌组来暗杠）
    var angangTileId = anGangIds[0];
    var angangTiles = findTilesByTileId(holdingWithDrawn, angangTileId);
    if (angangTiles.length >= 4) {
      return Promise.resolve({ action: 'angang', tile: angangTiles[0] });
    }
  }

  // 3. 检查补杠（已碰的基础上摸到第4张，含摸到的牌）
  var buGangIds = canBuGang(holdingWithDrawn, melds);
  if (buGangIds.length > 0) {
    var bugangTileId = buGangIds[0];
    var bugangTiles = findTilesByTileId(holdingWithDrawn, bugangTileId);
    if (bugangTiles.length > 0) {
      return Promise.resolve({ action: 'bugang', tile: bugangTiles[0] });
    }
  }

  // 4. 出牌策略：调用评估器，选得分最低的牌打出
  var discardTile = this._chooseDiscard(holding, melds, tile, config);

  return Promise.resolve({ action: 'discard', tile: discardTile });
};

// ---- onDiscard: 别人出牌后决策 ----

/**
 * 别人出牌后的响应决策
 *
 * 优先级：胡 > 杠 > 碰 > 过
 * 根据听牌状态和难度概率决定是否碰/杠
 *
 * @param {Object} tile - 别人打出的牌实例
 * @param {number} fromPlayer - 出牌者的座位号
 * @returns {Promise<{ action: string }>}
 */
AIPlayer.prototype.onDiscard = function (tile, fromPlayer) {
  var hand = this.getHand();
  var holding = hand.holding;
  var melds = hand.melds;
  var config = this._config;

  // 记录对手出牌（Hard 模式）
  if (this._trackDiscards) {
    this._opponentDiscards.push({
      tile: tile,
      fromPlayer: fromPlayer,
    });
  }

  // 1. 胡牌总是优先选择
  if (canDianPao(holding, melds, tile)) {
    return Promise.resolve({ action: 'hu' });
  }

  // 2. 明杠
  if (canMingGang(holding, tile)) {
    // 杠的决策：根据难度概率和听牌状态
    var shouldGang = this._shouldMeld(holding, melds, config);
    if (shouldGang) {
      return Promise.resolve({ action: 'gang' });
    }
    return Promise.resolve({ action: 'pass' });
  }

  // 3. 碰
  if (canPeng(holding, tile)) {
    var shouldPeng = this._shouldMeld(holding, melds, config);
    if (shouldPeng) {
      return Promise.resolve({ action: 'peng' });
    }
    return Promise.resolve({ action: 'pass' });
  }

  // 4. 默认过
  return Promise.resolve({ action: 'pass' });
};

// ---- onLiaolong: 撂龙阶段决策 ----

/**
 * 撂龙阶段决策
 * 撂龙只有收益没有代价，总是全部报
 *
 * @param {Array} options - 可报的撂龙选项列表 (LiaolongOption[])
 * @returns {Promise<{ declared: Array }>}
 */
AIPlayer.prototype.onLiaolong = function (options) {
  // 撂龙只有收益没有代价，全部报
  return Promise.resolve({ declared: options || [] });
};

// ---- 内部策略方法 ----

/**
 * 选择要打出的牌
 *
 * 策略：调用 evaluateHand 评估每张手牌，
 * 选得分最低（对胡牌帮助最小）的牌打出。
 * 根据难度的 discardNoise 加入随机性。
 *
 * @param {Array} holding - 手中暗牌（不含刚摸的牌）
 * @param {Array} melds - 已有面子
 * @param {Object} drawn - 刚摸的牌
 * @param {Object} config - 难度配置
 * @returns {Object} 要打出的牌实例
 */
AIPlayer.prototype._chooseDiscard = function (holding, melds, drawn, config) {
  // 合并所有可用牌（手中 + 刚摸的）
  var allTiles = holding.slice();
  if (drawn) {
    allTiles.push(drawn);
  }

  // 调用评估器获取每张牌的分数
  var scores;
  try {
    scores = evaluateHand(allTiles, melds);
  } catch (e) {
    // 如果评估器不可用，随机选一张
    return randomPick(allTiles);
  }

  if (!scores || !Array.isArray(scores) || scores.length === 0) {
    return randomPick(allTiles);
  }

  // scores 应该是 { tile, score } 的数组
  // 按分数排序（从低到高，分数低的先打出）
  var sorted = scores.slice().sort(function (a, b) {
    return a.score - b.score;
  });

  // 加入随机噪声
  if (config.discardNoise > 0 && random() < config.discardNoise) {
    // 随机选一张打出
    return randomPick(allTiles);
  }

  // 选分数最低的牌打出
  // 需要确保选中的牌确实在手牌中
  for (var i = 0; i < sorted.length; i++) {
    var candidate = sorted[i];
    var candidateTile = candidate.tile;
    if (candidateTile && this._isTileInHand(candidateTile, allTiles)) {
      return candidateTile;
    }
  }

  // 兜底：随机选一张
  return randomPick(allTiles);
};

/**
 * 判断牌实例是否在给定牌列表中
 * @param {Object} tile - 牌实例
 * @param {Array} tileList - 牌实例数组
 * @returns {boolean}
 */
AIPlayer.prototype._isTileInHand = function (tile, tileList) {
  for (var i = 0; i < tileList.length; i++) {
    if (tileList[i].id === tile.id) {
      return true;
    }
  }
  return false;
};

/**
 * 碰/杠决策
 *
 * 根据听牌状态和难度概率决定是否碰/杠：
 * - 已听牌 → 谨慎（碰杠可能破坏听牌结构，70%选择过）
 * - 未听牌 → 积极（碰杠加速凑牌，80%选择碰/杠）
 * - 根据难度 meldAccuracy 概率叠加
 *
 * @param {Array} holding - 手中暗牌
 * @param {Array} melds - 已有面子
 * @param {Object} config - 难度配置
 * @returns {boolean} 是否选择碰/杠
 */
AIPlayer.prototype._shouldMeld = function (holding, melds, config) {
  var ting = isTing(holding, melds);

  var baseProbability;
  if (ting) {
    // 已听牌：谨慎，70% 选择过（即 30% 选择碰/杠）
    baseProbability = 0.3;
  } else {
    // 未听牌：积极，80% 选择碰/杠
    baseProbability = 0.8;
  }

  // 叠加难度概率
  var finalProbability = baseProbability * config.meldAccuracy;

  return random() < finalProbability;
};

// ---- 导出 ----

module.exports = {
  AIPlayer: AIPlayer,
  DIFFICULTY: DIFFICULTY,
};
