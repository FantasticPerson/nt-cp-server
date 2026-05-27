/**
 * 玩家接口模块
 *
 * 提供玩家手牌数据结构管理和玩家接口基类。
 * PlayerInterface 是抽象基类，onDraw/onDiscard/onLiaolong 由子类（人类/AI/网络）实现。
 */

// ---- 玩家手牌数据结构 ----
//
// hand = {
//   holding: [],   // 手中暗牌 (TileInstance[])
//   melds: [],     // 已碰/杠/撂龙的面子
//                  //   Meld = { type: 'peng'|'gang'|'angang'|'long'|'xi', tiles: TileInstance[], tileId: number }
//   discarded: [], // 已打出的牌 (TileInstance[])
//   drawn: null,   // 刚摸到的牌（等待出牌或胡）(TileInstance | null)
// }

/**
 * 创建空手牌对象
 * @returns {Object} hand 对象
 */
function createEmptyHand() {
  return {
    holding: [],
    melds: [],
    discarded: [],
    drawn: null,
  };
}

// ---- PlayerInterface 基类 ----

/**
 * 玩家接口基类
 *
 * 管理玩家的座位号和手牌数据，提供手牌操作方法。
 * onDraw/onDiscard/onLiaolong 为抽象方法，必须由子类覆盖。
 *
 * @param {number} index - 玩家座位号 (0-based)
 * @param {Object} [hand] - 初始手牌对象，不传则创建空手牌
 */
function PlayerInterface(index, hand) {
  if (typeof index !== 'number' || index < 0) {
    throw new Error('PlayerInterface: index must be a non-negative number');
  }

  this._index = index;
  this._hand = hand || createEmptyHand();
}

/**
 * 获取玩家座位号
 * @returns {number}
 */
PlayerInterface.prototype.getIndex = function () {
  return this._index;
};

/**
 * 获取玩家手牌对象
 * @returns {Object} hand 对象
 */
PlayerInterface.prototype.getHand = function () {
  return this._hand;
};

/**
 * 摸牌加入手牌
 * @param {Object} tile - 牌实例 (TileInstance)
 */
PlayerInterface.prototype.addToHolding = function (tile) {
  if (!tile) {
    throw new Error('addToHolding: tile is required');
  }
  this._hand.holding.push(tile);
};

/**
 * 出牌从手牌移除
 * 通过牌实例的 id 查找并移除
 * @param {Object} tile - 要移除的牌实例 (TileInstance)
 * @returns {boolean} 是否成功移除
 */
PlayerInterface.prototype.removeFromHolding = function (tile) {
  if (!tile) {
    throw new Error('removeFromHolding: tile is required');
  }
  for (var i = 0; i < this._hand.holding.length; i++) {
    if (this._hand.holding[i].id === tile.id) {
      this._hand.holding.splice(i, 1);
      return true;
    }
  }
  return false;
};

/**
 * 添加已碰/杠/撂龙的面子
 * @param {Object} meld - 面子对象 { type: string, tiles: TileInstance[], tileId: number }
 */
PlayerInterface.prototype.addMeld = function (meld) {
  if (!meld || !meld.type || !Array.isArray(meld.tiles)) {
    throw new Error('addMeld: meld must have type and tiles');
  }
  this._hand.melds.push(meld);
};

/**
 * 打出的牌加入牌河
 * @param {Object} tile - 牌实例 (TileInstance)
 */
PlayerInterface.prototype.addDiscarded = function (tile) {
  if (!tile) {
    throw new Error('addDiscarded: tile is required');
  }
  this._hand.discarded.push(tile);
};

/**
 * 设置刚摸的牌
 * @param {Object} tile - 牌实例 (TileInstance)
 */
PlayerInterface.prototype.setDrawn = function (tile) {
  this._hand.drawn = tile;
};

/**
 * 清除刚摸的牌
 */
PlayerInterface.prototype.clearDrawn = function () {
  this._hand.drawn = null;
};

// ---- 抽象方法（子类必须覆盖） ----

/**
 * 摸牌后的决策回调
 * 子类必须实现
 *
 * @param {Object} tile - 摸到的牌实例
 * @returns {Promise<{ action: string, tile?: Object }>}
 *   action: 'discard' | 'hu' | 'angang' | 'bugang'
 *   tile: 出牌时为要打出的牌，杠时为杠的牌
 * @throws {Error} 基类中调用将抛出"未实现"错误
 */
PlayerInterface.prototype.onDraw = function (tile) {
  throw new Error('PlayerInterface.onDraw not implemented');
};

/**
 * 别人出牌后的响应回调
 * 子类必须实现
 *
 * @param {Object} tile - 别人打出的牌实例
 * @param {number} fromPlayer - 出牌者的座位号
 * @returns {Promise<{ action: string }>}
 *   action: 'hu' | 'gang' | 'peng' | 'pass'
 * @throws {Error} 基类中调用将抛出"未实现"错误
 */
PlayerInterface.prototype.onDiscard = function (tile, fromPlayer) {
  throw new Error('PlayerInterface.onDiscard not implemented');
};

/**
 * 撂龙阶段的声明回调
 * 子类必须实现
 *
 * @param {Array} options - 可报的撂龙选项列表 (LiaolongOption[])
 * @returns {Promise<{ declared: Array }>}
 *   declared: 选中的撂龙选项数组
 * @throws {Error} 基类中调用将抛出"未实现"错误
 */
PlayerInterface.prototype.onLiaolong = function (options) {
  throw new Error('PlayerInterface.onLiaolong not implemented');
};

// ---- 导出 ----

module.exports = {
  PlayerInterface: PlayerInterface,
  createEmptyHand: createEmptyHand,
};
