/**
 * 牌定义与素材映射
 *
 * 南通长牌的核心牌定义模块。提供牌实例创建、牌组生成、
 * 牌信息查询和素材路径映射等功能。
 *
 * tileId 编码规则：
 *   0-8   一万~九万 (wan)
 *   9-17  一条~九条 (tiao)
 *   18-26 一饼~九饼 (bing)
 *   27    千字 (qianzi, honor)
 *   28    红花 (honghua, honor)
 *   29    白花 (baihua, honor)
 *   30    九条-老将别名 (查询用，共享 tileId=17 的图片)
 *   31-35 福禄寿禧财 (xi)
 */

const {
  SUIT,
  CATEGORY,
  TOTAL_TILES_WITH_XI,
  TOTAL_TILES_WITHOUT_XI,
} = require('../utils/constants');

// ---- 牌定义表 ----

/**
 * 每种牌的静态定义。索引即 tileId (0-35)。
 *
 * suit:   花色
 * rank:   点数 (1-9)，字牌/喜牌为 0
 * name:   中文名称
 * category: 牌类别
 */
const TILE_DEFINITIONS = [
  // 0-8: 万子 (wan)
  { suit: SUIT.WAN, rank: 1, name: '一万', category: CATEGORY.NORMAL },
  { suit: SUIT.WAN, rank: 2, name: '二万', category: CATEGORY.NORMAL },
  { suit: SUIT.WAN, rank: 3, name: '三万', category: CATEGORY.NORMAL },
  { suit: SUIT.WAN, rank: 4, name: '四万', category: CATEGORY.NORMAL },
  { suit: SUIT.WAN, rank: 5, name: '五万', category: CATEGORY.NORMAL },
  { suit: SUIT.WAN, rank: 6, name: '六万', category: CATEGORY.NORMAL },
  { suit: SUIT.WAN, rank: 7, name: '七万', category: CATEGORY.NORMAL },
  { suit: SUIT.WAN, rank: 8, name: '八万', category: CATEGORY.NORMAL },
  { suit: SUIT.WAN, rank: 9, name: '九万', category: CATEGORY.NORMAL },

  // 9-17: 条子 (tiao)
  { suit: SUIT.TIAO, rank: 1, name: '一条', category: CATEGORY.NORMAL },
  { suit: SUIT.TIAO, rank: 2, name: '二条', category: CATEGORY.NORMAL },
  { suit: SUIT.TIAO, rank: 3, name: '三条', category: CATEGORY.NORMAL },
  { suit: SUIT.TIAO, rank: 4, name: '四条', category: CATEGORY.NORMAL },
  { suit: SUIT.TIAO, rank: 5, name: '五条', category: CATEGORY.NORMAL },
  { suit: SUIT.TIAO, rank: 6, name: '六条', category: CATEGORY.NORMAL },
  { suit: SUIT.TIAO, rank: 7, name: '七条', category: CATEGORY.NORMAL },
  { suit: SUIT.TIAO, rank: 8, name: '八条', category: CATEGORY.NORMAL },
  { suit: SUIT.TIAO, rank: 9, name: '九条', category: CATEGORY.NORMAL },

  // 18-26: 饼子 (bing)
  { suit: SUIT.BING, rank: 1, name: '一饼', category: CATEGORY.NORMAL },
  { suit: SUIT.BING, rank: 2, name: '二饼', category: CATEGORY.NORMAL },
  { suit: SUIT.BING, rank: 3, name: '三饼', category: CATEGORY.NORMAL },
  { suit: SUIT.BING, rank: 4, name: '四饼', category: CATEGORY.NORMAL },
  { suit: SUIT.BING, rank: 5, name: '五饼', category: CATEGORY.NORMAL },
  { suit: SUIT.BING, rank: 6, name: '六饼', category: CATEGORY.NORMAL },
  { suit: SUIT.BING, rank: 7, name: '七饼', category: CATEGORY.NORMAL },
  { suit: SUIT.BING, rank: 8, name: '八饼', category: CATEGORY.NORMAL },
  { suit: SUIT.BING, rank: 9, name: '九饼', category: CATEGORY.NORMAL },

  // 27-29: 字牌 (honor)
  { suit: SUIT.HONOR, rank: 0, name: '千字', category: CATEGORY.LAOJIANG },
  { suit: SUIT.HONOR, rank: 0, name: '红花', category: CATEGORY.LAOJIANG },
  { suit: SUIT.HONOR, rank: 0, name: '白花', category: CATEGORY.LAOJIANG },

  // 30: 九条-老将别名（查询用，不在牌组中生成独立牌）
  { suit: SUIT.TIAO, rank: 9, name: '九条(老将)', category: CATEGORY.LAOJIANG },

  // 31-35: 喜牌 (xi)
  { suit: SUIT.XI, rank: 0, name: '福', category: CATEGORY.XI },
  { suit: SUIT.XI, rank: 0, name: '禄', category: CATEGORY.XI },
  { suit: SUIT.XI, rank: 0, name: '寿', category: CATEGORY.XI },
  { suit: SUIT.XI, rank: 0, name: '禧', category: CATEGORY.XI },
  { suit: SUIT.XI, rank: 0, name: '财', category: CATEGORY.XI },
];

// ---- 头尾将 (touwei) ----
// 1万(0), 9万(8), 1条(9), 9条(17), 1饼(18), 9饼(26)
// 九条同时是老将和头尾将，但千字/红花/白花只是老将，不是头尾将
const TOUWEI_TILE_IDS = [0, 8, 9, 17, 18, 26];

// ---- 图片文件名映射 ----
// tileId 0-29 → {tileId}.png
// tileId 30   → 17.png (与 tileId=17 共享图片)
// tileId 31-35 → {tileId+3}.png (34.png - 38.png)
const IMAGE_FILE_MAP = {};
for (let i = 0; i <= 29; i++) {
  IMAGE_FILE_MAP[i] = `${i}.png`;
}
IMAGE_FILE_MAP[30] = '17.png';
IMAGE_FILE_MAP[31] = '34.png';
IMAGE_FILE_MAP[32] = '35.png';
IMAGE_FILE_MAP[33] = '36.png';
IMAGE_FILE_MAP[34] = '37.png';
IMAGE_FILE_MAP[35] = '38.png';

// ---- 牌组构成 ----
// 普通牌 (tileId 0-26, 不含老将): 每种 4 张
// 老将牌 (tileId 27-29): 每种 4 张
// 九条(tileId=17) 同时也是老将，但在牌组中只有 4 张(用 tileId=17 表示)
// 喜牌 (tileId 31-35): 每种 1 张
// tileId=30 不在牌组中生成

/**
 * 老将牌 tileId 列表（用于牌组生成）
 * 千字(27), 红花(28), 白花(29) 各4张
 * 九条(17) 在普通牌中已包含，但属于老将牌
 */
const LAOJIANG_TILE_IDS = [27, 28, 29];
// 九条(17) 虽然是老将，但它在普通数牌序列中，牌组中只用 tileId=17

/** 喜牌 tileId 列表 */
const XI_TILE_IDS = [31, 32, 33, 34, 35];

/**
 * 普通数牌的 tileId 范围 (0-26)，排除老将
 * 注意：九条(tileId=17) 虽然是老将身份，但在数牌序列中，
 * 牌组中用 tileId=17 生成，共 4 张。
 */
const NORMAL_TILE_IDS = [];
for (let i = 0; i <= 26; i++) {
  NORMAL_TILE_IDS.push(i);
}

// ---- 工具函数 ----

/**
 * 判断 tileId 是否为老将牌
 * 老将：千字(27)、红花(28)、白花(29)、九条(17)
 * 注意：头尾将（1/9点数牌）不是老将
 * @param {number} tileId
 * @returns {boolean}
 */
function isLaojiang(tileId) {
  // 老将：千字(27)、红花(28)、白花(29)、九条(17)
  // 九条(17) 同时是老将和头尾将
  // 注意：1万/9万/1条/1饼/9饼 是头尾将，不是老将
  if (tileId === 17) return true;  // 九条
  if (tileId === 27) return true;  // 千字
  if (tileId === 28) return true;  // 红花
  if (tileId === 29) return true;  // 白花
  if (tileId === 30) return true;  // 九条老将别名
  return false;
}

/**
 * 判断 tileId 是否为头尾将
 * 头尾将：1万(0)、9万(8)、1条(9)、9条(17)、1饼(18)、9饼(26)
 * 仅单将模式下有效
 * @param {number} tileId
 * @returns {boolean}
 */
function isTouwei(tileId) {
  return TOUWEI_TILE_IDS.indexOf(tileId) !== -1;
}

// ---- 公开接口 ----

/**
 * 创建牌实例
 *
 * @param {number} tileId - 牌类型 ID (0-35)
 * @param {number} [instanceIndex=0] - 同类型牌的第几张 (0-3)
 * @returns {{ id: string, tileId: number, suit: string, rank: number, category: string }}
 *   id 格式: '{tileId}-{instanceIndex}'
 */
function createTileInstance(tileId, instanceIndex) {
  if (instanceIndex === undefined) {
    instanceIndex = 0;
  }

  if (tileId < 0 || tileId > 35) {
    throw new Error(`Invalid tileId: ${tileId}, must be 0-35`);
  }

  const def = TILE_DEFINITIONS[tileId];
  if (!def) {
    throw new Error(`No definition found for tileId: ${tileId}`);
  }

  return {
    id: `${tileId}-${instanceIndex}`,
    tileId: tileId,
    suit: def.suit,
    rank: def.rank,
    category: def.category,
  };
}

/**
 * 创建完整牌组
 *
 * 牌组构成:
 *   - 数牌 (0-26): 27 种 x 4 张 = 108 张
 *   - 老将字牌 (27-29): 3 种 x 4 张 = 12 张
 *   - 喜牌 (31-35): 5 种 x 1 张 = 5 张 (仅 xiEnabled=true 时)
 *
 * 总计: 120 张 (无喜牌) 或 125 张 (含喜牌)
 *
 * 注意: 九条(tileId=17) 在数牌序列中已包含，不再额外生成。
 * tileId=30 仅用于查询，不参与牌组生成。
 *
 * @param {boolean} [xiEnabled=true] - 是否包含喜牌
 * @returns {Array<{ id: string, tileId: number, suit: string, rank: number, category: string }>}
 */
function createDeck(xiEnabled) {
  if (xiEnabled === undefined) {
    xiEnabled = true;
  }

  const deck = [];

  // 数牌 (tileId 0-26), 每种 4 张
  for (let i = 0; i <= 26; i++) {
    for (let j = 0; j < 4; j++) {
      deck.push(createTileInstance(i, j));
    }
  }

  // 老将字牌 (tileId 27-29), 每种 4 张
  for (let i = 27; i <= 29; i++) {
    for (let j = 0; j < 4; j++) {
      deck.push(createTileInstance(i, j));
    }
  }

  // 喜牌 (tileId 31-35), 每种 1 张
  if (xiEnabled) {
    for (let i = 0; i < XI_TILE_IDS.length; i++) {
      deck.push(createTileInstance(XI_TILE_IDS[i], 0));
    }
  }

  return deck;
}

/**
 * 获取牌信息
 *
 * @param {number} tileId - 牌类型 ID (0-35)
 * @returns {{ suit: string, rank: number, category: string, name: string,
 *             isLaojiang: boolean, isTouwei: boolean, isXi: boolean }}
 */
function getTileInfo(tileId) {
  if (tileId < 0 || tileId > 35) {
    throw new Error(`Invalid tileId: ${tileId}, must be 0-35`);
  }

  const def = TILE_DEFINITIONS[tileId];
  if (!def) {
    throw new Error(`No definition found for tileId: ${tileId}`);
  }

  return {
    suit: def.suit,
    rank: def.rank,
    category: def.category,
    name: def.name,
    isLaojiang: isLaojiang(tileId),
    isTouwei: isTouwei(tileId),
    isXi: def.category === CATEGORY.XI,
  };
}

/**
 * 获取牌图片路径
 *
 * @param {number} tileId - 牌类型 ID (0-35)
 * @returns {string} 图片相对路径 (如 '/tiles/0.png')
 */
function getTileImageSrc(tileId) {
  if (tileId < 0 || tileId > 35) {
    throw new Error(`Invalid tileId: ${tileId}, must be 0-35`);
  }

  const filename = IMAGE_FILE_MAP[tileId];
  if (!filename) {
    throw new Error(`No image mapping found for tileId: ${tileId}`);
  }

  return `/tiles/${filename}`;
}

// ---- 导出 ----

module.exports = {
  TILE_DEFINITIONS,
  TOUWEI_TILE_IDS,
  createTileInstance,
  createDeck,
  getTileInfo,
  getTileImageSrc,
  isLaojiang,
  isTouwei,
};
