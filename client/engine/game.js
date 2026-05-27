/**
 * 游戏流程编排模块
 *
 * Game 类串联所有模块，编排一局完整的南通长牌游戏流程。
 * 支持异步交互（等待人类玩家操作）和 AI 自动决策。
 *
 * 使用方式:
 *   const { Game } = require('./game');
 *   const game = new Game({ mode: 'single', xiEnabled: true, difficulty: 'normal' });
 *   game.onNeedInput(ctx => { ... });
 *   await game.start();
 */

const { MODE, STATE, PLAYER_COUNT, RESPOND_TYPE, DEALER_TILES, OTHER_TILES } = require('../utils/constants');
const { createDeck } = require('../core/tile');
const { shuffle, deal, drawFromWall } = require('../core/deck');
const { buildJiangMap, getDiHu, roundUpDiHu } = require('../core/general');
const { sortHolding, decompose, canHu, classifyHu } = require('../core/hand');
const { canZiMo, canDianPao, canMingGang, canPeng, canAnGang, canBuGang, checkLiaolong } = require('../core/rules');
const { StateMachine } = require('./state');
const { PlayerInterface, createEmptyHand } = require('./player');
const { resolveResponds, nextPlayer, getPlayerRespondOptions } = require('./action');
const { calcHuScore, calcSettlement } = require('../core/scorer');

// ---- 喜牌自动撂龙 ----

var XI_TILE_IDS = [31, 32, 33, 34, 35];

/**
 * 自动处理喜牌撂龙
 * 起手牌中的喜牌必须撂下
 *
 * @param {Array} holding - 手牌实例数组
 * @returns {{ xiTiles: Array, remaining: Array }}
 */
function autoXiLiaolong(holding) {
  var xiTiles = [];
  var remaining = [];
  for (var i = 0; i < holding.length; i++) {
    if (XI_TILE_IDS.indexOf(holding[i].tileId) !== -1) {
      xiTiles.push(holding[i]);
    } else {
      remaining.push(holding[i]);
    }
  }
  return { xiTiles: xiTiles, remaining: remaining };
}

// ---- Game 类 ----

/**
 * @param {Object} config
 * @param {string} config.mode - 'single' | 'double'
 * @param {boolean} config.xiEnabled - 是否启用喜牌
 * @param {string} config.difficulty - 'easy' | 'normal' | 'hard'
 * @param {number} [config.dealer] - 初始庄家索引（默认 0）
 */
function Game(config) {
  if (!config) config = {};

  this._config = {
    mode: config.mode || MODE.SINGLE,
    xiEnabled: config.xiEnabled !== false,
    difficulty: config.difficulty || 'normal',
  };

  this._dealer = config.dealer || 0;
  this._sm = new StateMachine();
  this._players = [];
  this._wall = [];
  this._fanJiang = [];
  this._jiangMap = {};
  this._scenario = null;
  this._currentPlayer = 0;
  this._lastDiscard = null;
  this._lastDiscardPlayer = -1;
  this._huResult = null;

  // 异步输入等待机制
  this._inputResolve = null;

  // 事件回调
  this._stateChangeCallbacks = [];
  this._gameOverCallbacks = [];
  this._needInputCallbacks = [];
}

// ---- 事件注册 ----

/**
 * 注册状态变化回调
 * @param {Function} callback - (gameState) => void
 */
Game.prototype.onStateChange = function (callback) {
  this._stateChangeCallbacks.push(callback);
};

/**
 * 注册游戏结束回调
 * @param {Function} callback - (gameState) => void
 */
Game.prototype.onGameOver = function (callback) {
  this._gameOverCallbacks.push(callback);
};

/**
 * 注册需要人类输入回调
 * @param {Function} callback - (context) => void
 *   context = { type: 'discard'|'respond'|'liaolong', playerIndex, ... }
 */
Game.prototype.onNeedInput = function (callback) {
  this._needInputCallbacks.push(callback);
};

// ---- 公开接口 ----

/**
 * 获取当前游戏状态
 * @returns {Object} GameState
 */
Game.prototype.getState = function () {
  var self = this;
  var players = [];
  for (var i = 0; i < this._players.length; i++) {
    var p = this._players[i];
    var hand = p ? p.getHand() : createEmptyHand();

    var rawDiHu = 0;
    if (self._jiangMap) {
      for (var mi = 0; mi < hand.melds.length; mi++) {
        var meld = hand.melds[mi];
        var meldAction;
        if (meld.type === 'peng') meldAction = 'peng';
        else if (meld.type === 'gang') meldAction = 'minggang';
        else if (meld.type === 'angang') meldAction = 'angang';
        else if (meld.type === 'long' || meld.type === 'bao') meldAction = 'long';
        else continue;

        if (meld.tiles && meld.tiles.length > 0) {
          rawDiHu += getDiHu(self._jiangMap, self._scenario, meld.tiles[0].tileId, meldAction, self._config.mode);
        }
      }
    }

    players.push({
      holding: hand.holding,
      melds: hand.melds,
      discarded: hand.discarded,
      drawn: hand.drawn,
      isHu: !!(hand.isHu),
      huCount: roundUpDiHu(rawDiHu),
    });
  }

  return {
    state: this._sm.getCurrentState(),
    currentPlayer: this._currentPlayer,
    dealer: this._dealer,
    wall: this._wall,
    fanJiang: this._fanJiang,
    jiangMap: this._jiangMap,
    scenario: this._scenario,
    players: players,
    lastDiscard: this._lastDiscard,
    lastDiscardPlayer: this._lastDiscardPlayer,
    config: this._config,
  };
};

/**
 * 初始化并开始一局游戏
 * @returns {Promise<void>}
 */
Game.prototype.start = function () {
  var self = this;
  return self._init()
    .then(function () { return self._fanjiangPhase(); })
    .then(function () { return self._liaolongPhase(); })
    .then(function () { return self._gameLoop(); });
};

// ---- 人类玩家操作回调 ----

/**
 * 人类玩家出牌
 * @param {number} playerIndex - 玩家索引
 * @param {Object} tile - 要出的牌实例
 */
Game.prototype.playerDiscard = function (playerIndex, tile) {
  if (this._inputResolve) {
    var resolve = this._inputResolve;
    this._inputResolve = null;
    resolve({ action: 'discard', playerIndex: playerIndex, tile: tile });
  }
};

/**
 * 人类玩家响应
 * @param {number} playerIndex - 玩家索引
 * @param {string} action - 'peng' | 'gang' | 'hu' | 'pass'
 */
Game.prototype.playerRespond = function (playerIndex, action, tileId) {
  if (this._inputResolve) {
    var resolve = this._inputResolve;
    this._inputResolve = null;
    var result = { action: action, playerIndex: playerIndex };
    if (tileId !== undefined) result.tileId = tileId;
    resolve(result);
  }
};

/**
 * 人类玩家撂龙选择
 * @param {number} playerIndex - 玩家索引
 * @param {Array} chosenOptions - 选中的撂龙选项数组
 */
Game.prototype.playerLiaolong = function (playerIndex, action, chosenOptions) {
  if (this._inputResolve) {
    var resolve = this._inputResolve;
    this._inputResolve = null;
    resolve({ action: action, playerIndex: playerIndex, chosenOptions: chosenOptions || [] });
  }
};

// ---- 内部方法 ----

/**
 * 等待人类输入
 * @param {Object} context - 输入上下文
 * @returns {Promise<Object>}
 */
Game.prototype._waitForInput = function (context) {
  var self = this;
  // 通知需要输入
  for (var i = 0; i < self._needInputCallbacks.length; i++) {
    self._needInputCallbacks[i](context);
  }
  return new Promise(function (resolve) {
    self._inputResolve = resolve;
  });
};

/**
 * 通知状态变化
 */
Game.prototype._notifyStateChange = function () {
  var state = this.getState();
  for (var i = 0; i < this._stateChangeCallbacks.length; i++) {
    this._stateChangeCallbacks[i](state);
  }
};

/**
 * 通知游戏结束
 */
Game.prototype._notifyGameOver = function () {
  var state = this.getState();
  for (var i = 0; i < this._gameOverCallbacks.length; i++) {
    this._gameOverCallbacks[i](state);
  }
};

/**
 * 切换状态并通知
 */
Game.prototype._transition = function (nextState) {
  var ok = this._sm.transition(nextState);
  if (!ok) {
    throw new Error('Invalid state transition: ' + this._sm.getCurrentState() + ' -> ' + nextState);
  }
  this._notifyStateChange();
};

// ---- INIT ----

Game.prototype._init = function () {
  // 创建牌组
  var deck = createDeck(this._config.xiEnabled);
  shuffle(deck);

  // 发牌
  var dealResult = deal(deck, this._config.mode, this._config.xiEnabled);

  // 构建将牌映射
  var fanJiangArr = dealResult.fanJiang.map(function (t) { return t.tileId; });
  var fanJiangParam;
  if (this._config.mode === MODE.SINGLE) {
    fanJiangParam = fanJiangArr[0];
  } else {
    fanJiangParam = fanJiangArr;
  }

  var jiangResult = buildJiangMap(fanJiangParam, this._config.mode, this._config.xiEnabled);

  this._wall = dealResult.wall;
  this._fanJiang = dealResult.fanJiang;
  this._jiangMap = jiangResult.jiangMap;
  this._scenario = jiangResult.scenario;

  // 创建玩家（用 PlayerInterface 包装手牌数据）
  this._players = [];
  for (var i = 0; i < PLAYER_COUNT; i++) {
    var hand = dealResult.players[i];
    var player = new PlayerInterface(i, hand);
    this._players.push(player);
  }

  // 庄家先出
  this._currentPlayer = this._dealer;

  this._transition(STATE.FANJIANG);
  return Promise.resolve();
};

// ---- FANJIANG ----

Game.prototype._fanjiangPhase = function () {
  this._transition(STATE.LIAOLONG);
  return Promise.resolve();
};

// ---- LIAOLONG ----

Game.prototype._liaolongPhase = function () {
  var self = this;
  var chain = Promise.resolve();

  for (var i = 0; i < PLAYER_COUNT; i++) {
    (function (pIdx) {
      chain = chain.then(function () {
        return self._processLiaolong(pIdx);
      });
    })(i);
  }

  return chain.then(function () {
    // 不在此处转换到 DRAW，由 _drawPhase 负责转换
  });
};

Game.prototype._processLiaolong = function (playerIndex) {
  var player = this._players[playerIndex];
  var hand = player.getHand();
  var holding = hand.holding;

  // 记录需要补牌的数量
  var drawCount = 0;

  // 1. 自动撂喜
  if (this._config.xiEnabled) {
    var xiResult = autoXiLiaolong(holding);
    if (xiResult.xiTiles.length > 0) {
      // 喜牌从 holding 移到 melds
      for (var xi = 0; xi < xiResult.xiTiles.length; xi++) {
        player.removeFromHolding(xiResult.xiTiles[xi]);
      }
      for (var xm = 0; xm < xiResult.xiTiles.length; xm++) {
        player.addMeld({
          type: 'xi',
          tiles: [xiResult.xiTiles[xm]],
          tileId: xiResult.xiTiles[xm].tileId,
        });
      }
      // 撂喜：撂几张补几张
      drawCount += xiResult.xiTiles.length;
      holding = player.getHand().holding;
    }
  }

  // 2. 检查撂龙条件
  var fanJiangParam;
  if (this._config.mode === MODE.SINGLE) {
    fanJiangParam = this._fanJiang[0].tileId;
  } else {
    fanJiangParam = this._fanJiang.map(function (t) { return t.tileId; });
  }

  var options = checkLiaolong(holding, fanJiangParam, this._config.mode);

  if (options.length === 0) {
    // 没有撂龙，只补撂喜的牌
    return this._drawReplacement(player, drawCount);
  }

  // 3. 让玩家选择撂龙
  var self = this;
  return self._getPlayerLiaolong(playerIndex, options)
    .then(function (result) {
      var action = result.action;
      var chosen = result.chosen;

      if (!chosen || chosen.length === 0 || action === 'pass') {
        // 没有选择撂龙，只补撂喜的牌
        return self._drawReplacement(player, drawCount);
      }

      for (var c = 0; c < chosen.length; c++) {
        var opt = chosen[c];

        if (action === 'bao') {
          // 报：牌留在手牌中，只添加显示 meld，不补牌
          player.addMeld({
            type: 'bao',
            tiles: opt.tiles,
            tileId: opt.tileId,
          });
        } else {
          // 杠/撂龙：从手牌移除
          for (var t = 0; t < opt.tiles.length; t++) {
            player.removeFromHolding(opt.tiles[t]);
          }
          var meldType = 'long';
          if (opt.type === '1111') {
            meldType = 'gang';
          }
          player.addMeld({
            type: meldType,
            tiles: opt.tiles,
            tileId: opt.tileId,
          });

          // 根据撂龙类型计算补牌数
          if (opt.type === '1111') {
            drawCount += 1; // 四张补一
          } else if (opt.type === '11') {
            drawCount += 2; // 两张补二
          }
          // 111型（三张翻将）不补
        }
      }

      return self._drawReplacement(player, drawCount);
    });
};

/**
 * 从牌墙补摸指定数量的牌
 * @param {Object} player - 玩家对象
 * @param {number} count - 补牌数量
 */
Game.prototype._drawReplacement = function (player, count) {
  for (var i = 0; i < count; i++) {
    var tile = drawFromWall(this._wall);
    if (tile !== null) {
      player.addToHolding(tile);
    }
  }
  return Promise.resolve();
};

/**
 * 获取玩家的撂龙选择
 * AI 玩家自动选择全部，人类玩家等待输入
 */
Game.prototype._getPlayerLiaolong = function (playerIndex, options) {
  var player = this._players[playerIndex];

  // 如果玩家实现了 onLiaolong 则调用（AI 玩家）
  if (player.onLiaolong !== PlayerInterface.prototype.onLiaolong) {
    return player.onLiaolong(options)
      .then(function (result) {
        return { action: 'auto', chosen: result.declared || [] };
      });
  }

  // 人类玩家：等待输入（报、杠或过）
  return this._waitForInput({
    type: 'liaolong',
    playerIndex: playerIndex,
    options: options,
  }).then(function (input) {
    return { action: input.action, chosen: input.chosenOptions || [] };
  });
};

// ---- DRAW ----

Game.prototype._gameLoop = function () {
  var self = this;
  return self._drawPhase();
};

/**
 * 摸牌阶段
 */
Game.prototype._drawPhase = function () {
  var self = this;

  // 先转换状态到 DRAW（从 LIAOLONG/RESPOND/MELD 进入时需要）
  self._transition(STATE.DRAW);

  // 从牌墙摸牌
  var tile = drawFromWall(self._wall);
  if (tile === null) {
    // 牌墙空，流局（从 DRAW -> LIUJU 是合法的）
    return self._liujuPhase();
  }

  var player = self._players[self._currentPlayer];
  player.setDrawn(tile);

  // 进入出牌阶段（自摸/暗杠/补杠检查在 _discardPhase 中统一处理）
  return self._discardPhase();
};

// ---- DISCARD ----

Game.prototype._discardPhase = function () {
  var self = this;
  self._transition(STATE.DISCARD);

  var player = self._players[self._currentPlayer];
  var hand = player.getHand();
  var drawn = hand.drawn;

  // AI 出牌
  if (player.onDraw !== PlayerInterface.prototype.onDraw) {
    var pIdx = self._currentPlayer;
    return player.onDraw(drawn).then(function (result) {
      if (!result) {
        console.error('[_discardPhase] AI player', pIdx, 'returned null result');
        return self._drawPhase();
      }
      if (result.action === 'discard' && !result.tile && !drawn) {
        console.error('[_discardPhase] AI player', pIdx, 'no tile to discard, drawn:', drawn);
        return self._drawPhase();
      }
      if (result.action === 'hu') {
        return self._huPhase(self._currentPlayer, true, drawn);
      }
      if (result.action === 'angang') {
        return self._meldPhase(self._currentPlayer, 'angang', null, result.tile.tileId);
      }
      if (result.action === 'bugang') {
        return self._meldPhase(self._currentPlayer, 'bugang', null, result.tile.tileId);
      }
      return self._executeDiscard(player, result.tile || drawn);
    });
  }

  // 人类：先检查暗杠/补杠/自摸
  var holding = hand.holding;
  var melds = hand.melds;
  // 将摸到的牌纳入检查（drawn 不在 holding 中）
  var holdingForCheck = holding.slice();
  if (drawn) holdingForCheck.push(drawn);
  var anGangIds = canAnGang(holdingForCheck, self._jiangMap);
  var buGangIds = canBuGang(holdingForCheck, melds);
  var canHu = drawn ? canZiMo(holding, melds, drawn) : false;

  if (anGangIds.length > 0 || buGangIds.length > 0 || canHu) {
    return self._waitForInput({
      type: 'discard',
      playerIndex: self._currentPlayer,
      drawn: drawn,
      canAnGang: anGangIds,
      canBuGang: buGangIds,
      canHu: canHu,
      canPass: true,
    }).then(function (input) {
      if (input.action === 'hu') {
        return self._huPhase(self._currentPlayer, true, drawn);
      }
      if (input.action === 'angang') {
        return self._meldPhase(self._currentPlayer, 'angang', null, input.tileId);
      }
      if (input.action === 'bugang') {
        return self._meldPhase(self._currentPlayer, 'bugang', null, input.tileId);
      }
      // pass 或 discard：正常出牌
      return self._waitForInput({
        type: 'discard',
        playerIndex: self._currentPlayer,
        drawn: drawn,
      }).then(function (input2) {
        return self._executeDiscard(player, input2.tile);
      });
    });
  }

  // 人类出牌（无特殊操作）
  return self._waitForInput({
    type: 'discard',
    playerIndex: self._currentPlayer,
    drawn: drawn,
  }).then(function (input) {
    return self._executeDiscard(player, input.tile);
  });
};

Game.prototype._executeDiscard = function (player, tile) {
  if (!tile) {
    console.error('[_executeDiscard] tile is null, player:', player.getIndex(),
      'holding:', player.getHand().holding.length,
      'drawn:', player.getHand().drawn);
    // 出牌为空时不能调用 _drawPhase（DISCARD→DRAW 是无效状态转换）
    // 重新等待出牌输入
    return this._discardPhase();
  }

  // 从手牌/摸牌中移除
  var hand = player.getHand();
  var drawn = hand.drawn;

  // 如果出的是刚摸的牌
  if (drawn && tile && drawn.id === tile.id) {
    player.clearDrawn();
  } else {
    // 从 holding 中移除
    player.removeFromHolding(tile);
    // 如果有 drawn，加入 holding
    if (drawn) {
      player.addToHolding(drawn);
      player.clearDrawn();
    }
  }

  // 加入牌河
  player.addDiscarded(tile);

  this._lastDiscard = tile;
  this._lastDiscardPlayer = player.getIndex();

  return this._respondPhase();
};

// ---- RESPOND ----

Game.prototype._respondPhase = function () {
  var self = this;
  self._transition(STATE.RESPOND);

  var HUMAN_INDEX = 2;

  // 先检查 AI 玩家是否有人可以胡（胡最高优先级，不让人类选择）
  var total = self._players.length || 3;
  for (var i = 1; i < total; i++) {
    var aiIdx = (self._lastDiscardPlayer + i) % total;
    if (aiIdx === HUMAN_INDEX) continue;
    var aiHand = self._players[aiIdx].getHand();
    if (canDianPao(aiHand.holding, aiHand.melds, self._lastDiscard)) {
      console.log('[respond] AI玩家' + aiIdx + '点炮胡');
      return self._huPhase(aiIdx, false, self._lastDiscard);
    }
  }

  // 检查人类玩家是否可以响应（碰/杠/胡）
  if (self._lastDiscardPlayer !== HUMAN_INDEX) {
    var opts = getPlayerRespondOptions(HUMAN_INDEX, self._lastDiscard, self._players);
    console.log('[respond] 玩家' + self._lastDiscardPlayer + '出牌, 人类响应:', JSON.stringify(opts),
      '出牌tileId:', self._lastDiscard ? self._lastDiscard.tileId : null);
    if (opts.canHu || opts.canGang || opts.canPeng) {
      // 等待人类玩家选择
      return self._waitForInput({
        type: 'respond',
        playerIndex: HUMAN_INDEX,
        tile: self._lastDiscard,
        canHu: opts.canHu,
        canGang: opts.canGang,
        canPeng: opts.canPeng,
      }).then(function (input) {
        if (input.action === 'hu') {
          return self._huPhase(HUMAN_INDEX, false, self._lastDiscard);
        }
        if (input.action === 'gang') {
          return self._meldPhase(HUMAN_INDEX, 'gang', self._lastDiscard);
        }
        if (input.action === 'peng') {
          return self._meldPhase(HUMAN_INDEX, 'peng', self._lastDiscard);
        }
        // pass - 继续检查 AI
        return self._respondPhaseAI();
      });
    }
  }

  // 没有人类响应，检查 AI
  return self._respondPhaseAI();
};

/**
 * AI 玩家的响应处理（人类已 pass 或无响应）
 */
Game.prototype._respondPhaseAI = function () {
  var self = this;
  var HUMAN_INDEX = 2;

  // 跳过人类，只检查 AI
  var total = self._players.length || 3;
  for (var i = 1; i < total; i++) {
    var gIdx = (self._lastDiscardPlayer + i) % total;
    if (gIdx === HUMAN_INDEX) continue;
    var gHand = self._players[gIdx].getHand();
    if (canMingGang(gHand.holding, self._lastDiscard)) {
      return self._meldPhase(gIdx, 'gang', self._lastDiscard);
    }
  }

  for (var j = 1; j < total; j++) {
    var pIdx = (self._lastDiscardPlayer + j) % total;
    if (pIdx === HUMAN_INDEX) continue;
    var pHand = self._players[pIdx].getHand();
    if (canPeng(pHand.holding, self._lastDiscard)) {
      return self._meldPhase(pIdx, 'peng', self._lastDiscard);
    }
  }

  // 无人响应，轮到下家
  self._currentPlayer = nextPlayer(self._lastDiscardPlayer, total);
  return self._drawPhase();
};

// ---- MELD ----

Game.prototype._meldPhase = function (playerIndex, meldType, tile, tileId) {
  var self = this;
  self._transition(STATE.MELD);

  var player = self._players[playerIndex];
  var hand = player.getHand();

  if (meldType === 'angang') {
    // 暗杠：翻将3张可杠，其他牌4张可杠
    var agId = tileId;
    var agJiangInfo = self._jiangMap && self._jiangMap[agId];
    var isFanjiang = agJiangInfo && agJiangInfo.jiangType && agJiangInfo.jiangType.indexOf('fanjiang') === 0;
    var agTarget = isFanjiang ? 3 : 4;
    var agTiles = [];
    // 如果摸到的牌是暗杠的一部分，先收入
    if (hand.drawn && hand.drawn.tileId === agId) {
      agTiles.push(hand.drawn);
      player.clearDrawn();
    }
    var agHolding = player.getHand().holding;
    for (var ai = agHolding.length - 1; ai >= 0; ai--) {
      if (agHolding[ai].tileId === agId && agTiles.length < agTarget) {
        agTiles.push(agHolding[ai]);
        player.removeFromHolding(agHolding[ai]);
        agHolding = player.getHand().holding;
        ai = agHolding.length;
      }
    }

    player.addMeld({
      type: 'gang',
      tiles: agTiles,
      tileId: agId,
    });

    self._currentPlayer = playerIndex;
    return self._drawPhase();
  }

  if (meldType === 'bugang') {
    // 补杠：从手牌/摸牌中移除1张，加到已有的碰中
    var bgId = tileId;
    var bgTile = null;
    // 优先使用摸到的牌
    if (hand.drawn && hand.drawn.tileId === bgId) {
      bgTile = hand.drawn;
      player.clearDrawn();
    }
    // 否则从 holding 中找
    if (!bgTile) {
      var bgHolding = hand.holding;
      for (var bi = 0; bi < bgHolding.length; bi++) {
        if (bgHolding[bi].tileId === bgId) {
          bgTile = bgHolding[bi];
          player.removeFromHolding(bgTile);
          break;
        }
      }
    }

    // 找到已有的碰并升级为杠
    if (bgTile) {
      var melds = hand.melds || player.melds || [];
      for (var mi = 0; mi < melds.length; mi++) {
        if (melds[mi].type === 'peng' && melds[mi].tileId === bgId) {
          melds[mi].type = 'gang';
          melds[mi].tiles.push(bgTile);
          break;
        }
      }
    }

    self._currentPlayer = playerIndex;
    return self._drawPhase();
  }

  if (meldType === 'peng') {
    // 碰：从手牌中找2张相同的牌 + 出的牌组成碰
    var pengTiles = [tile];
    var holding = hand.holding;
    var count = 0;
    for (var i = holding.length - 1; i >= 0; i--) {
      if (holding[i].tileId === tile.tileId && count < 2) {
        pengTiles.push(holding[i]);
        player.removeFromHolding(holding[i]);
        count++;
        // removeFromHolding 改变了数组，需要调整
        // 重新获取 holding
        holding = player.getHand().holding;
        i = holding.length; // reset loop (will be decremented)
      }
    }

    player.addMeld({
      type: 'peng',
      tiles: pengTiles,
      tileId: tile.tileId,
    });

    self._currentPlayer = playerIndex;

    // 碰后需要出牌
    return self._discardPhase();
  }

  if (meldType === 'gang') {
    // 明杠：从手牌中找3张相同的牌 + 出的牌组成杠
    var gangTiles = [tile];
    holding = hand.holding;
    var gangCount = 0;
    for (var gi = holding.length - 1; gi >= 0; gi--) {
      if (holding[gi].tileId === tile.tileId && gangCount < 3) {
        gangTiles.push(holding[gi]);
        player.removeFromHolding(holding[gi]);
        gangCount++;
        holding = player.getHand().holding;
        gi = holding.length;
      }
    }

    player.addMeld({
      type: 'gang',
      tiles: gangTiles,
      tileId: tile.tileId,
    });

    self._currentPlayer = playerIndex;

    // 杠后补摸一张（由 _drawPhase 负责摸牌和牌墙空判断）
    return self._drawPhase();
  }

  return Promise.resolve();
};

// ---- HU ----

Game.prototype._huPhase = function (playerIndex, isSelfDrawn, huTile) {
  var self = this;
  self._transition(STATE.HU);

  var player = self._players[playerIndex];
  var hand = player.getHand();

  // 标记胡
  hand.isHu = true;

  // 拆牌分析
  var decomposeResults = decompose(hand.holding, hand.drawn);
  var decomposeResult = decomposeResults.length > 0 ? decomposeResults[0] : null;

  if (!decomposeResult) {
    // 不应该发生
    self._notifyGameOver();
    return Promise.resolve();
  }

  // 分类胡
  var huType = classifyHu(decomposeResult, hand.melds, isSelfDrawn, self._config.mode);

  // 计算底胡
  var rawDiHu = 0;
  // 遍历 melds 计算底胡
  for (var mi = 0; mi < hand.melds.length; mi++) {
    var meld = hand.melds[mi];
    var meldAction;
    if (meld.type === 'peng') meldAction = 'peng';
    else if (meld.type === 'gang') meldAction = 'minggang';
    else if (meld.type === 'angang') meldAction = 'angang';
    else if (meld.type === 'long') meldAction = 'long';
    else continue;

    if (meld.tiles.length > 0) {
      var diHuVal = getDiHu(self._jiangMap, self._scenario, meld.tiles[0].tileId, meldAction, self._config.mode);
      if (diHuVal > 0) rawDiHu += diHuVal;
    }
  }

  // 遍历 decomposeResult 中的刻子计算底胡
  if (decomposeResult.kezi) {
    for (var ki = 0; ki < decomposeResult.kezi.length; ki++) {
      var kez = decomposeResult.kezi[ki];
      if (kez.length > 0) {
        var keDiHu = getDiHu(self._jiangMap, self._scenario, kez[0].tileId, 'anke', self._config.mode);
        if (keDiHu > 0) rawDiHu += keDiHu;
      }
    }
  }

  // 统计暗杠数量（用于双龙判定）
  var anGangCount = 0;
  for (var agi = 0; agi < hand.melds.length; agi++) {
    if (hand.melds[agi].type === 'gang') {
      anGangCount++;
    }
  }

  // 统计喜牌数量
  var xiCount = 0;
  var fanOnXi = 0;
  for (var si = 0; si < hand.melds.length; si++) {
    if (hand.melds[si].type === 'xi') {
      xiCount++;
    }
  }

  // 翻将是否打在喜上
  if (self._config.xiEnabled) {
    for (var fi = 0; fi < self._fanJiang.length; fi++) {
      var fanTid = self._fanJiang[fi].tileId;
      if (fanTid >= 31 && fanTid <= 35) {
        fanOnXi++;
      }
    }
  }

  var huScoreParams = {
    huType: huType,
    mode: self._config.mode,
    isSelfDrawn: isSelfDrawn,
    isHaiDi: false,
    melds: hand.melds,
    decomposeResult: decomposeResult,
    xiEnabled: self._config.xiEnabled,
    hasXi: xiCount > 0,
    xiCount: xiCount,
    fanOnXi: fanOnXi,
    rawDiHu: rawDiHu,
    huTile: huTile,
    isLiuju: false,
    fanJiang: self._fanJiang[0],
    anGangCount: anGangCount,
  };

  var huScore = calcHuScore(huScoreParams);

  self._huResult = {
    playerIndex: playerIndex,
    isSelfDrawn: isSelfDrawn,
    huTile: huTile,
    huType: huType,
    score: huScore,
  };

  self._notifyGameOver();
  return Promise.resolve();
};

// ---- LIUJU ----

Game.prototype._liujuPhase = function () {
  var self = this;
  self._transition(STATE.LIUJU);

  self._huResult = {
    playerIndex: -1,
    isSelfDrawn: false,
    huTile: null,
    huType: null,
    score: null,
    isLiuju: true,
  };

  self._notifyGameOver();
  return Promise.resolve();
};

// ---- 庄家轮换 ----

/**
 * 获取下一局的庄家索引
 * @returns {number}
 */
Game.prototype.getNextDealer = function () {
  return (this._dealer + 1) % PLAYER_COUNT;
};

// ---- 导出 ----

module.exports = { Game: Game };
