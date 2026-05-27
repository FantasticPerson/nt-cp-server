/**
 * adapter.ts -- RemotePlayer（WS 指令桥接到 Game 引擎）
 *
 * 服务端最关键组件：每个玩家位置使用 RemotePlayer。
 * 在线时：等待 injectDecision 注入客户端指令
 * 离线时：回退 AI 决策
 *
 * 设计：
 * - 继承 PlayerInterface（prototype 链）
 * - 内部组合一个 AIPlayer 实例用于离线决策
 * - _pendingResolve 机制：onDraw/onDiscard/onLiaolong 返回 Promise
 */

const playerModule = require('../../client/engine/player');
const aiModule = require('../../client/ai/strategy');

const PlayerInterface = playerModule.PlayerInterface;
const AIPlayer = aiModule.AIPlayer;

/**
 * 创建一个继承 PlayerInterface 的 RemotePlayer 构造函数
 *
 * 使用工厂模式避免 TypeScript strict 模式下对
 * function-as-constructor 的 this 类型检查问题。
 */
function createRemotePlayerClass() {
  /**
   * RemotePlayer -- 远程玩家适配器
   */
  function RemotePlayer(this: any, index: number, hand?: any, jiangMap?: any) {
    if (!(this instanceof RemotePlayer)) {
      return new (RemotePlayer as any)(index, hand, jiangMap);
    }

    PlayerInterface.call(this, index, hand);

    const self = this as any;

    // 内部组合 AIPlayer 用于离线决策
    self._aiPlayer = new AIPlayer(index, self._hand, 'easy', jiangMap);

    // pending promise 的 resolve 函数
    self._pendingResolve = null;

    // 缓存的决策（injectDecision 在 onDraw 之前调用时使用）
    self._cachedDecision = undefined;

    // 在线状态，默认离线（等待客户端连接后设为在线）
    self._online = false;
  }

  // 继承 PlayerInterface
  RemotePlayer.prototype = Object.create(PlayerInterface.prototype);
  RemotePlayer.prototype.constructor = RemotePlayer;

  /**
   * 设置在线状态
   */
  RemotePlayer.prototype.setOnline = function (this: any, online: boolean) {
    this._online = online;
  };

  /**
   * 注入客户端决策
   *
   * 如果当前有 pending 的 promise，立即 resolve。
   * 否则缓存决策供下次 onDraw/onDiscard/onLiaolong 使用。
   */
  RemotePlayer.prototype.injectDecision = function (this: any, decision: any) {
    if (this._pendingResolve) {
      const resolve = this._pendingResolve;
      this._pendingResolve = null;
      resolve(decision);
    } else {
      // 没有等待中的 promise，缓存决策
      this._cachedDecision = decision;
    }
  };

  /**
   * 摸牌后的决策
   *
   * 在线时返回 Promise 等待 injectDecision
   * 离线时委托 AIPlayer
   */
  RemotePlayer.prototype.onDraw = function (this: any, tile: any): Promise<any> {
    if (!this._online) {
      return this._aiPlayer.onDraw(tile);
    }

    // 如果有缓存的决策，立即使用
    if (this._cachedDecision !== undefined) {
      const decision = this._cachedDecision;
      this._cachedDecision = undefined;
      return Promise.resolve(decision);
    }

    const self = this;
    return new Promise(function (resolve) {
      self._pendingResolve = resolve;
    });
  };

  /**
   * 别人出牌后的响应
   *
   * 在线时等待 injectDecision，离线时委托 AI
   */
  RemotePlayer.prototype.onDiscard = function (this: any, tile: any, fromPlayer: number): Promise<any> {
    if (!this._online) {
      return this._aiPlayer.onDiscard(tile, fromPlayer);
    }

    if (this._cachedDecision !== undefined) {
      const decision = this._cachedDecision;
      this._cachedDecision = undefined;
      return Promise.resolve(decision);
    }

    const self = this;
    return new Promise(function (resolve) {
      self._pendingResolve = resolve;
    });
  };

  /**
   * 撂龙阶段决策
   *
   * 在线时等待 injectDecision，离线时委托 AI
   */
  RemotePlayer.prototype.onLiaolong = function (this: any, options: any[]): Promise<any> {
    if (!this._online) {
      return this._aiPlayer.onLiaolong(options);
    }

    if (this._cachedDecision !== undefined) {
      const decision = this._cachedDecision;
      this._cachedDecision = undefined;
      return Promise.resolve(decision);
    }

    const self = this;
    return new Promise(function (resolve) {
      self._pendingResolve = resolve;
    });
  };

  return RemotePlayer;
}

const RemotePlayer = createRemotePlayerClass();

export { RemotePlayer };
