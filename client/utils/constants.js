/**
 * 全局常量定义
 *
 * 南通长牌游戏的所有枚举和常量数值。
 * 后续模块通过 require('./constants') 引用。
 */

// ---- 花色 ----

const SUIT = {
  WAN: 'wan',       // 万子
  TIAO: 'tiao',     // 条子
  BING: 'bing',     // 饼子
  HONOR: 'honor',   // 字牌（东南西北中发白）
  XI: 'xi',         // 喜牌（春 summer 秋冬等）
};

// ---- 牌类别 ----

const CATEGORY = {
  NORMAL: 'normal',         // 普通牌
  LAOJIANG: 'laojiang',     // 老将（各花色 1、9）
  TOUWEI: 'touwei',         // 头尾牌
  FANJIANG: 'fanjiang',     // 翻将牌
  GENJIANG: 'genjiang',     // 根将牌
  XI: 'xi',                 // 喜牌
};

// ---- 游戏模式 ----

const MODE = {
  SINGLE: 'single',   // 单人模式
  DOUBLE: 'double',   // 双人模式
};

// ---- 游戏状态 ----

const STATE = {
  INIT: 'init',               // 初始化
  FANJIANG: 'fanjiang',       // 翻将阶段
  LIAOLONG: 'liaolong',       // 料龙阶段
  DRAW: 'draw',               // 摸牌
  DISCARD: 'discard',         // 打牌
  RESPOND: 'respond',         // 响应（碰/杠/胡）
  MELD: 'meld',               // 组牌
  HU: 'hu',                   // 胡牌
  LIUJU: 'liuju',             // 流局
};

// ---- 胡牌类型 ----

const HU_TYPE = {
  QINGHU: 'qinghu',     // 清胡
  PIAOHU: 'piaohu',     // 飘胡
  TAHU: 'tahu',         // 踏胡
  MENHUN: 'menhun',     // 门混
};

// ---- 操作类型（底胡查表用） ----

const MELD_ACTION = {
  PENG: 'peng',           // 碰
  ANKE: 'anke',           // 暗刻
  MINGGANG: 'minggang',   // 明杠
  ANGANG: 'angang',       // 暗杠
  LONG: 'long',           // 龙
};

// ---- 响应类型 ----

const RESPOND_TYPE = {
  HU: 'hu',       // 胡
  GANG: 'gang',   // 杠
  PENG: 'peng',   // 碰
  PASS: 'pass',   // 过
};

// ---- 常量数值 ----

const PLAYER_COUNT = 3;              // 玩家人数
const DEALER_TILES = 23;             // 庄家起手张数
const OTHER_TILES = 22;              // 闲家起手张数
const TOTAL_TILES_WITH_XI = 125;     // 含喜牌总张数
const TOTAL_TILES_WITHOUT_XI = 120;  // 不含喜牌总张数

// ---- 导出 ----

module.exports = {
  SUIT,
  CATEGORY,
  MODE,
  STATE,
  HU_TYPE,
  MELD_ACTION,
  RESPOND_TYPE,
  PLAYER_COUNT,
  DEALER_TILES,
  OTHER_TILES,
  TOTAL_TILES_WITH_XI,
  TOTAL_TILES_WITHOUT_XI,
};
