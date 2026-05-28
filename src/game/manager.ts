/**
 * manager.ts -- GameManager（房间 → Game 引擎映射）
 *
 * 核心职责：
 * - 管理房间（roomId）到 Game 实例的映射
 * - 创建游戏时注册回调，startGame 时启动并替换 PlayerInterface
 * - 处理玩家操作（injectDecision）
 * - 管理在线/离线状态
 * - 监听状态变化推送通知
 */

const { Game } = require('../../client/engine/game');
const { RemotePlayer } = require('./adapter');
const { filterStateForPlayer } = require('../state-filter');

/** 玩家座位信息 */
interface PlayerSeatInfo {
  openId: string;
  seatIndex: number;
}

/** 游戏配置 */
interface GameConfig {
  mode: 'single' | 'double';
  xiEnabled: boolean;
  dealer?: number;
}

/** 网关接口（只使用需要的方法） */
interface Gateway {
  pushToUser(roomId: string, openId: string, message: any): Promise<void>;
  pushToRoomFiltered(roomId: string, players: any[], fullState: any): Promise<void>;
  pushToRoom(roomId: string, players: any[], message: any): Promise<void>;
}

/** 房间游戏数据 */
interface RoomGameData {
  game: any;
  players: Map<string, any>;  // openId → RemotePlayer
  seatMap: Map<string, number>;  // openId → seatIndex
  playerInfos: PlayerSeatInfo[];
  started: boolean;
}

export class GameManager {
  private rooms: Map<string, RoomGameData>;
  private gateway: Gateway;

  constructor(gateway: Gateway) {
    this.rooms = new Map();
    this.gateway = gateway;
  }

  /**
   * 创建游戏实例
   *
   * 1. 创建 new Game(config)
   * 2. 注册 onStateChange / onNeedInput / onGameOver 回调
   * 3. 首次 onStateChange（_init 完成后）替换 PlayerInterface 为 RemotePlayer
   *
   * 注意：不调用 _init() 或 start()，由 startGame() 触发。
   *
   * @param roomId   房间 ID
   * @param config   游戏配置
   * @param players  玩家座位信息列表
   */
  createGame(roomId: string, config: GameConfig, players: PlayerSeatInfo[]): void {
    const game = new Game({
      mode: config.mode,
      xiEnabled: config.xiEnabled,
      dealer: config.dealer || 0,
      difficulty: 'easy',
    });

    const self = this;

    // 构建 seatMap
    const seatMap = new Map<string, number>();
    const playersMap = new Map<string, any>();

    for (const p of players) {
      seatMap.set(p.openId, p.seatIndex);
    }

    // 注册状态变化回调 → 推送过滤后的状态
    let playersReplaced = false;

    game.onStateChange(function (state: any) {
      // 首次 onStateChange 回调（_init 完成后）替换 PlayerInterface
      if (!playersReplaced) {
        playersReplaced = true;
        self._replacePlayers(game, roomId, seatMap, playersMap, players);
      }

      // 推送过滤状态给在线玩家
      self._pushStateToRoom(roomId, state, playersMap, seatMap);
    });

    // 注册需要输入回调 → 推送 needInput 给对应玩家
    game.onNeedInput(function (context: any) {
      self._pushNeedInput(roomId, context, playersMap, seatMap);
    });

    // 注册游戏结束回调
    game.onGameOver(function (state: any) {
      self._pushStateToRoom(roomId, state, playersMap, seatMap);
    });

    // 存储房间数据（不调用 _init，由 startGame 触发）
    const roomData: RoomGameData = {
      game,
      players: playersMap,
      seatMap,
      playerInfos: players,
      started: false,
    };

    this.rooms.set(roomId, roomData);
  }

  /**
   * 替换 PlayerInterface 为 RemotePlayer
   *
   * _init() 创建 PlayerInterface 并发牌，此函数在首次
   * onStateChange 回调时调用，将 PlayerInterface 替换为
   * RemotePlayer，传递手牌数据。
   */
  private _replacePlayers(
    game: any,
    roomId: string,
    seatMap: Map<string, number>,
    playersMap: Map<string, any>,
    playerInfos: PlayerSeatInfo[]
  ): void {
    // 为每个 seatIndex 找到对应的 openId
    const openIdBySeat = new Map<number, string>();
    for (const p of playerInfos) {
      openIdBySeat.set(p.seatIndex, p.openId);
    }

    for (let i = 0; i < playerInfos.length; i++) {
      const oldPlayer = game._players[i];
      const hand = oldPlayer.getHand();

      // 创建 RemotePlayer，传入手牌数据
      const rp = new RemotePlayer(i, hand, game._jiangMap);

      // 替换引擎中的玩家
      game._players[i] = rp;

      // 记录 openId → RemotePlayer 映射
      const openId = openIdBySeat.get(i);
      if (openId) {
        playersMap.set(openId, rp);
      }
    }
  }

  /**
   * 推送状态给房间内所有在线玩家（每人过滤视角不同）
   */
  private _pushStateToRoom(
    roomId: string,
    state: any,
    playersMap: Map<string, any>,
    seatMap: Map<string, number>
  ): void {
    const onlinePlayers: Array<{ openId: string; seatIndex: number; online: boolean }> = [];

    playersMap.forEach(function (rp: any, openId: string) {
      onlinePlayers.push({
        openId,
        seatIndex: seatMap.get(openId)!,
        online: rp._online,
      });
    });

    // 异步推送，不阻塞游戏流程
    this.gateway.pushToRoomFiltered(roomId, onlinePlayers, state).catch(function (err: any) {
      console.error('[GameManager] pushToRoomFiltered error:', err.message);
    });
  }

  /**
   * 处理需要输入的回调
   *
   * 在线玩家：推送 needInput 消息
   * 离线玩家：使用 RemotePlayer 内置 AI 自动响应
   *
   * 注意：引擎的 _respondPhase 对 HUMAN_INDEX=2 使用 game._waitForInput()
   * 而非 player.onDiscard()，所以离线时需要通过 game.playerRespond() 自动 pass。
   */
  private _pushNeedInput(
    roomId: string,
    context: any,
    playersMap: Map<string, any>,
    seatMap: Map<string, number>
  ): void {
    const self = this;
    const roomData = this.rooms.get(roomId);
    if (!roomData) return;

    const playerIndex = context.playerIndex;
    seatMap.forEach(function (si: number, openId: string) {
      if (si === playerIndex) {
        const rp = playersMap.get(openId);
        if (rp && rp._online) {
          // 在线：推送 needInput 给客户端
          self.gateway.pushToUser(roomId, openId, {
            type: 'needInput',
            context: context,
          }).catch(function (err: any) {
            console.error('[GameManager] pushNeedInput error:', err.message);
          });
        } else if (rp && !rp._online) {
          // 离线：使用 AI 自动响应
          self._autoRespond(roomData.game, context, rp);
        }
      }
    });
  }

  /**
   * 离线玩家自动响应（使用 RemotePlayer 内置 AI）
   */
  private _autoRespond(game: any, context: any, rp: any): void {
    const self = this;

    if (context.type === 'respond') {
      // 响应阶段：使用 AI 决策并调用 game.playerRespond
      const aiPlayer = rp._aiPlayer;
      if (aiPlayer) {
        aiPlayer.onDiscard(context.tile, -1).then(function (aiDecision: any) {
          if (aiDecision.action === 'hu') {
            game.playerRespond(context.playerIndex, 'hu');
          } else if (aiDecision.action === 'gang') {
            game.playerRespond(context.playerIndex, 'gang');
          } else if (aiDecision.action === 'peng') {
            game.playerRespond(context.playerIndex, 'peng');
          } else {
            game.playerRespond(context.playerIndex, 'pass');
          }
        }).catch(function (err: any) {
          console.error('[GameManager] AI auto-respond error:', err.message);
          game.playerRespond(context.playerIndex, 'pass');
        });
      } else {
        game.playerRespond(context.playerIndex, 'pass');
      }
    } else if (context.type === 'discard') {
      // 出牌阶段：使用 AI 决策
      const aiPlayer = rp._aiPlayer;
      if (aiPlayer) {
        aiPlayer.onDraw(context.drawn).then(function (aiDecision: any) {
          if (aiDecision.action === 'hu') {
            game.playerRespond(context.playerIndex, 'hu');
          } else if (aiDecision.action === 'angang') {
            game.playerRespond(context.playerIndex, 'angang', aiDecision.tile.tileId);
          } else if (aiDecision.action === 'bugang') {
            game.playerRespond(context.playerIndex, 'bugang', aiDecision.tile.tileId);
          } else if (aiDecision.action === 'discard') {
            // 出牌阶段：注入决策到 RemotePlayer（让它通过 onDraw 路径）
            rp.injectDecision(aiDecision);
          } else {
            rp.injectDecision(aiDecision);
          }
        }).catch(function (err: any) {
          console.error('[GameManager] AI auto-discard error:', err.message);
        });
      }
    } else if (context.type === 'liaolong') {
      // 撂龙阶段：使用 AI 决策
      const aiPlayer = rp._aiPlayer;
      if (aiPlayer) {
        aiPlayer.onLiaolong(context.options).then(function (aiDecision: any) {
          game.playerLiaolong(context.playerIndex, 'auto', aiDecision.declared || []);
        }).catch(function (err: any) {
          console.error('[GameManager] AI auto-liaolong error:', err.message);
          game.playerLiaolong(context.playerIndex, 'pass', []);
        });
      } else {
        game.playerLiaolong(context.playerIndex, 'pass', []);
      }
    }
  }

  /**
   * 启动游戏（开始游戏循环）
   *
   * 调用 game.start()，内部依次执行 _init → fanjiang → liaolong → gameLoop。
   * 首次 onStateChange 回调中替换 PlayerInterface。
   *
   * @param roomId 房间 ID
   * @returns Promise<void> 游戏结束时 resolve
   */
  startGame(roomId: string): Promise<void> {
    const roomData = this.rooms.get(roomId);
    if (!roomData) {
      return Promise.reject(new Error('Room not found: ' + roomId));
    }

    roomData.started = true;
    return roomData.game.start();
  }

  /**
   * 处理玩家操作
   *
   * 根据 openId 找到对应的 RemotePlayer，注入决策。
   *
   * @param roomId  房间 ID
   * @param openId  用户 openId
   * @param action  操作对象
   * @returns true 成功，false 失败
   */
  handleAction(roomId: string, openId: string, action: any): boolean {
    const roomData = this.rooms.get(roomId);
    if (!roomData) {
      return false;
    }

    const rp = roomData.players.get(openId);
    if (!rp) {
      return false;
    }

    const seatIndex = roomData.seatMap.get(openId);
    if (seatIndex === undefined) {
      return false;
    }

    // 根据 action 类型路由到不同的引擎方法或直接注入决策
    if (action.action === 'liaolong') {
      // 撂龙选择：直接调用引擎的 playerLiaolong
      roomData.game.playerLiaolong(seatIndex, action.action, action.chosenOptions);
    } else {
      // 其他操作（discard、peng、gang、hu、pass 等）通过 injectDecision
      rp.injectDecision(action);
    }

    return true;
  }

  /**
   * 获取当前游戏状态
   *
   * @param roomId 房间 ID
   * @returns 完整游戏状态，不存在时返回 null
   */
  getGameState(roomId: string): any | null {
    const roomData = this.rooms.get(roomId);
    if (!roomData) {
      return null;
    }
    return roomData.game.getState();
  }

  /**
   * 玩家重连
   *
   * 设置 RemotePlayer 为在线，返回过滤后的当前状态。
   *
   * @param roomId  房间 ID
   * @param openId  用户 openId
   * @returns 过滤后的游戏状态，不存在时返回 null
   */
  playerReconnect(roomId: string, openId: string): any | null {
    const roomData = this.rooms.get(roomId);
    if (!roomData) {
      return null;
    }

    const rp = roomData.players.get(openId);
    if (!rp) {
      return null;
    }

    rp.setOnline(true);

    const seatIndex = roomData.seatMap.get(openId);
    if (seatIndex === undefined) {
      return null;
    }

    const fullState = roomData.game.getState();
    return filterStateForPlayer(fullState, seatIndex);
  }

  /**
   * 玩家断连
   *
   * 设置 RemotePlayer 为离线，自动回退 AI 决策。
   *
   * @param roomId  房间 ID
   * @param openId  用户 openId
   */
  playerDisconnect(roomId: string, openId: string): void {
    const roomData = this.rooms.get(roomId);
    if (!roomData) {
      return;
    }

    const rp = roomData.players.get(openId);
    if (!rp) {
      return;
    }

    rp.setOnline(false);
  }

  /**
   * 销毁游戏，清理资源
   *
   * @param roomId 房间 ID
   */
  destroyGame(roomId: string): void {
    this.rooms.delete(roomId);
  }

  /**
   * 检查房间游戏是否存在
   */
  hasGame(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * 检查游戏是否已启动
   */
  isGameStarted(roomId: string): boolean {
    const roomData = this.rooms.get(roomId);
    if (!roomData) return false;
    return roomData.started;
  }

  /**
   * 检查房间内所有玩家是否都已在线
   */
  allPlayersOnline(roomId: string): boolean {
    const roomData = this.rooms.get(roomId);
    if (!roomData) return false;
    if (!roomData.started) {
      // 游戏还没开始，检查所有 RemotePlayer 是否在线
      let allOnline = true;
      roomData.players.forEach(function (rp: any) {
        if (!rp._online) allOnline = false;
      });
      return allOnline && roomData.players.size === roomData.playerInfos.length;
    }
    return true;
  }

  /**
   * 获取房间内玩家数量
   */
  getPlayerCount(roomId: string): number {
    const roomData = this.rooms.get(roomId);
    if (!roomData) return 0;
    return roomData.playerInfos.length;
  }

  /**
   * 获取玩家映射（openId → RemotePlayer）
   * 测试辅助方法
   */
  getPlayers(roomId: string): Map<string, any> | null {
    const roomData = this.rooms.get(roomId);
    if (!roomData) {
      return null;
    }
    return roomData.players;
  }

  /**
   * 获取座位映射（openId → seatIndex）
   * 测试辅助方法
   */
  getSeatMap(roomId: string): Map<string, number> | null {
    const roomData = this.rooms.get(roomId);
    if (!roomData) {
      return null;
    }
    return roomData.seatMap;
  }
}
