/**
 * 游戏状态机
 *
 * 定义南通长牌游戏的所有状态及合法流转规则。
 * 每个状态只能按预定义的流转表切换到下一个状态，
 * 非法流转会被拒绝并返回 false。
 *
 * 使用方式:
 *   const { StateMachine } = require('./state');
 *   const sm = new StateMachine();
 *   sm.transition('fanjiang');  // true
 *   sm.getCurrentState();       // 'fanjiang'
 */

const { STATE } = require('../utils/constants');

// ---- 合法流转表 ----
// key = 当前状态, value = 允许切换到的状态集合

const TRANSITIONS = {
  [STATE.INIT]:     [STATE.FANJIANG],
  [STATE.FANJIANG]: [STATE.LIAOLONG],
  [STATE.LIAOLONG]: [STATE.DRAW],
  [STATE.DRAW]:     [STATE.DISCARD, STATE.HU, STATE.LIUJU],
  [STATE.DISCARD]:  [STATE.RESPOND, STATE.HU, STATE.MELD],
  [STATE.RESPOND]:  [STATE.HU, STATE.MELD, STATE.DRAW],
  [STATE.MELD]:     [STATE.DRAW, STATE.DISCARD],
  // HU 和 LIUJU 是终态，无后续流转
  [STATE.HU]:       [],
  [STATE.LIUJU]:    [],
};

// 终态集合
const TERMINAL_STATES = new Set([STATE.HU, STATE.LIUJU]);

class StateMachine {
  constructor() {
    /** @type {string} 当前状态 */
    this._state = STATE.INIT;

    /**
     * 附加数据存储，用于保存子状态等额外信息。
     * 例如 LIAOLONG 阶段的子状态:
     *   { currentPlayer: 0, phase: 'auto' }
     *
     * @type {Object}
     * @private
     */
    this._data = {};
  }

  /**
   * 获取当前状态
   * @returns {string} 当前状态枚举值
   */
  getCurrentState() {
    return this._state;
  }

  /**
   * 尝试切换到目标状态
   * @param {string} nextState - 目标状态
   * @returns {boolean} 成功返回 true，非法流转返回 false
   */
  transition(nextState) {
    if (!this.canTransition(nextState)) {
      return false;
    }
    this._state = nextState;
    return true;
  }

  /**
   * 检查是否可以从当前状态切换到目标状态
   * @param {string} nextState - 目标状态
   * @returns {boolean}
   */
  canTransition(nextState) {
    const allowed = TRANSITIONS[this._state];
    if (!allowed) {
      return false;
    }
    return allowed.includes(nextState);
  }

  /**
   * 重置状态机回到 INIT
   * 同时清空所有附加数据
   */
  reset() {
    this._state = STATE.INIT;
    this._data = {};
  }

  /**
   * 判断当前状态是否为终态（HU 或 LIUJU）
   * @returns {boolean}
   */
  isTerminal() {
    return TERMINAL_STATES.has(this._state);
  }

  /**
   * 存储附加数据
   * @param {string} key - 数据键名
   * @param {*} value - 数据值
   */
  setData(key, value) {
    this._data[key] = value;
  }

  /**
   * 读取附加数据
   * @param {string} key - 数据键名
   * @returns {*} 存在则返回值，否则返回 undefined
   */
  getData(key) {
    return this._data[key];
  }
}

module.exports = { StateMachine, TRANSITIONS, TERMINAL_STATES };
