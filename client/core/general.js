/**
 * 将牌系统（Jiang System）
 *
 * 南通长牌的将牌机制模块，负责构建将牌映射表、查底胡分值和底胡进整。
 *
 * 将牌分类：
 *   - 老将：千字(27)、红花(28)、白花(29)、九条(17)，每局固定是将
 *   - 头尾将：1万(0)、9万(8)、1条(9)、9条(17)、1饼(18)、9饼(26)，仅单将模式
 *   - 翻将：庄家摸完牌后翻出的牌
 *   - 跟随将：根据翻将按 147/258/369 归组产生的将牌
 */

const { MODE, MELD_ACTION } = require('../utils/constants');
const { isLaojiang, isTouwei, getTileInfo, TOUWEI_TILE_IDS } = require('./tile');

// ---- 跟随将归组规则 ----

/**
 * 数牌点数到组的映射（147=A, 258=B, 369=C）
 */
var GROUP_MAP = {
  1: 'A', 2: 'B', 3: 'C',
  4: 'A', 5: 'B', 6: 'C',
  7: 'A', 8: 'B', 9: 'C',
};

/**
 * 特殊牌到组的映射
 */
var HONOR_GROUP = {
  27: 'A',  // 千字 -> A组(147)
  28: 'B',  // 红花 -> B组(258)
  29: 'C',  // 白花 -> C组(369)
  17: 'C',  // 九条 -> C组(369)
};

/**
 * 喜牌固定归为 A 组(147)
 */
var XI_GROUP = 'A';

// ---- 组到点数集合的映射 ----

var GROUP_TO_RANKS = {
  'A': [1, 4, 7],
  'B': [2, 5, 8],
  'C': [3, 6, 9],
};

// ---- 老将 tileId 集合 ----

var LAOJIANG_IDS = [17, 27, 28, 29];

// ---- 翻将分类 ----

/**
 * 判断一张翻将牌的类型
 * @param {number} tileId
 * @returns {'laojiang'|'xi'|'normal'} 翻将牌的分类
 */
function classifyFanJiang(tileId) {
  if (tileId >= 31 && tileId <= 35) return 'xi';
  if (isLaojiang(tileId)) return 'laojiang';
  return 'normal';
}

/**
 * 获取翻将牌所属的组 (A/B/C)
 * @param {number} tileId
 * @returns {string} 'A' | 'B' | 'C'
 */
function getTileGroup(tileId) {
  if (tileId >= 31 && tileId <= 35) return XI_GROUP;
  if (HONOR_GROUP[tileId] !== undefined) return HONOR_GROUP[tileId];
  var info = getTileInfo(tileId);
  return GROUP_MAP[info.rank];
}

/**
 * 获取跟随将的所有 tileId 列表（根据组）
 * 跟随将是万/条/饼三种花色中属于该组点数的所有牌
 * @param {string} group - 'A' | 'B' | 'C'
 * @returns {number[]} tileId 列表
 */
function getGenjiangTileIds(group) {
  var ranks = GROUP_TO_RANKS[group];
  var ids = [];
  for (var i = 0; i < ranks.length; i++) {
    var rank = ranks[i];
    // 万: rank 1-9 -> tileId 0-8
    ids.push(rank - 1);
    // 条: rank 1-9 -> tileId 9-17
    ids.push(rank - 1 + 9);
    // 饼: rank 1-9 -> tileId 18-26
    ids.push(rank - 1 + 18);
  }
  return ids;
}

// ---- 单将模式 ----

/**
 * 构建单将模式的将牌映射表
 *
 * @param {number} fanJiang - 翻将的 tileId
 * @param {boolean} xiEnabled - 是否启用喜牌
 * @returns {{ jiangMap: Object, scenario: null }}
 */
function buildSingleJiangMap(fanJiang, xiEnabled) {
  var jiangMap = {};
  var i, tileId;

  // 初始化所有牌为普通牌
  for (i = 0; i <= 35; i++) {
    jiangMap[i] = { isJiang: false, jiangType: 'normal' };
  }

  // 判断翻将是否为老将
  var fanIsLaojiang = isLaojiang(fanJiang);

  // 1. 老将总是将
  for (i = 0; i < LAOJIANG_IDS.length; i++) {
    tileId = LAOJIANG_IDS[i];
    if (fanIsLaojiang) {
      jiangMap[tileId] = { isJiang: true, jiangType: 'laojiang_fan' };
    } else {
      jiangMap[tileId] = { isJiang: true, jiangType: 'laojiang' };
    }
  }

  // 2. 头尾将（仅单将模式）
  for (i = 0; i < TOUWEI_TILE_IDS.length; i++) {
    tileId = TOUWEI_TILE_IDS[i];
    // 九条已经是老将，已经设置过了
    if (tileId === 17) continue;
    jiangMap[tileId] = { isJiang: true, jiangType: 'touwei' };
  }

  // 3. 翻将本身是将
  if (fanIsLaojiang) {
    jiangMap[fanJiang] = { isJiang: true, jiangType: 'fanjiang_lao' };
  } else if (fanJiang >= 31 && fanJiang <= 35) {
    // 喜牌作为翻将，喜牌本身不在可操作范围内，但标记为翻将
    jiangMap[fanJiang] = { isJiang: true, jiangType: 'fanjiang' };
  } else {
    jiangMap[fanJiang] = { isJiang: true, jiangType: 'fanjiang' };
  }

  // 4. 跟随将
  var group = getTileGroup(fanJiang);
  var genIds = getGenjiangTileIds(group);
  for (i = 0; i < genIds.length; i++) {
    tileId = genIds[i];
    // 跳过已经是将的牌（老将、头尾将、翻将本身）
    if (jiangMap[tileId].isJiang) continue;
    jiangMap[tileId] = { isJiang: true, jiangType: 'genjiang' };
  }

  return { jiangMap: jiangMap, scenario: null };
}

// ---- 双将模式 ----

/**
 * 判定双将场景
 *
 * @param {number} fan1 - 第一张翻将 tileId
 * @param {number} fan2 - 第二张翻将 tileId
 * @returns {number} 场景编号 1-8
 */
function determineScenario(fan1, fan2) {
  var type1 = classifyFanJiang(fan1);
  var type2 = classifyFanJiang(fan2);

  // 场景6: 两张都打在喜上
  if (type1 === 'xi' && type2 === 'xi') return 6;
  // 场景7: 一张喜一张老将
  if ((type1 === 'xi' && type2 === 'laojiang') || (type1 === 'laojiang' && type2 === 'xi')) return 7;
  // 场景8: 一张喜一张普通牌
  if ((type1 === 'xi' && type2 === 'normal') || (type1 === 'normal' && type2 === 'xi')) return 8;

  // 两张都是老将
  if (type1 === 'laojiang' && type2 === 'laojiang') {
    if (fan1 === fan2) {
      return 1; // 两张打在同一张老将上
    }
    return 2; // 两张打在不同老将上
  }

  // 一张老将一张普通牌（半边将）
  if ((type1 === 'laojiang' && type2 === 'normal') || (type1 === 'normal' && type2 === 'laojiang')) {
    return 3;
  }

  // 两张都是普通牌
  if (type1 === 'normal' && type2 === 'normal') {
    if (fan1 === fan2) {
      return 4; // 两张打在同一张普通牌上
    }
    return 5; // 两张打在不同普通牌上
  }

  // 理论上不应到达这里
  throw new Error('Unexpected fan jiang combination: ' + fan1 + ', ' + fan2);
}

/**
 * 构建双将模式的将牌映射表
 *
 * @param {number[]} fanJiangArr - 两张翻将的 tileId 数组 [fan1, fan2]
 * @param {boolean} xiEnabled - 是否启用喜牌
 * @returns {{ jiangMap: Object, scenario: number }}
 */
function buildDoubleJiangMap(fanJiangArr, xiEnabled) {
  var fan1 = fanJiangArr[0];
  var fan2 = fanJiangArr[1];
  var scenario = determineScenario(fan1, fan2);

  var jiangMap = {};
  var i, tileId;

  // 初始化所有牌为普通牌
  for (i = 0; i <= 35; i++) {
    jiangMap[i] = { isJiang: false, jiangType: 'normal' };
  }

  // 老将始终是将，根据场景赋予不同 jiangType
  for (i = 0; i < LAOJIANG_IDS.length; i++) {
    tileId = LAOJIANG_IDS[i];
    jiangMap[tileId] = { isJiang: true, jiangType: 'laojiang' };
  }

  // 根据场景标记翻将和跟随将
  switch (scenario) {
    case 1:
      // 两张翻将在同一张老将上
      jiangMap[fan1] = { isJiang: true, jiangType: 'fanjiang_double_same_lao' };
      // 老将都是跟随老将
      for (i = 0; i < LAOJIANG_IDS.length; i++) {
        tileId = LAOJIANG_IDS[i];
        if (tileId === fan1) continue; // 翻将本身不重复标记
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_laojiang' };
      }
      break;

    case 2:
      // 两张翻将在不同老将上
      jiangMap[fan1] = { isJiang: true, jiangType: 'fanjiang_lao' };
      jiangMap[fan2] = { isJiang: true, jiangType: 'fanjiang_lao' };
      // 其他老将是跟随老将
      for (i = 0; i < LAOJIANG_IDS.length; i++) {
        tileId = LAOJIANG_IDS[i];
        if (tileId === fan1 || tileId === fan2) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_laojiang' };
      }
      break;

    case 3: {
      // 半边将：一张老将一张普通牌
      var laoFan, normalFan;
      if (isLaojiang(fan1)) {
        laoFan = fan1;
        normalFan = fan2;
      } else {
        laoFan = fan2;
        normalFan = fan1;
      }
      jiangMap[laoFan] = { isJiang: true, jiangType: 'fanjiang_lao' };
      jiangMap[normalFan] = { isJiang: true, jiangType: 'fanjiang' };

      // 老将方面的跟随：老将的组
      var laoGroup = getTileGroup(laoFan);
      var laoGenIds = getGenjiangTileIds(laoGroup);
      for (i = 0; i < laoGenIds.length; i++) {
        tileId = laoGenIds[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_laojiang' };
      }
      // 老将的跟随也包括其他老将
      for (i = 0; i < LAOJIANG_IDS.length; i++) {
        tileId = LAOJIANG_IDS[i];
        if (tileId === laoFan) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_laojiang' };
      }

      // 普通牌方面的跟随
      var normalGroup = getTileGroup(normalFan);
      var normalGenIds = getGenjiangTileIds(normalGroup);
      for (i = 0; i < normalGenIds.length; i++) {
        tileId = normalGenIds[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_normal' };
      }
      break;
    }

    case 4:
      // 两张翻将在同一张普通牌上
      jiangMap[fan1] = { isJiang: true, jiangType: 'fanjiang_double_same_normal' };
      // 跟随普通将
      var group4 = getTileGroup(fan1);
      var genIds4 = getGenjiangTileIds(group4);
      for (i = 0; i < genIds4.length; i++) {
        tileId = genIds4[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_normal' };
      }
      // 老将保留
      break;

    case 5:
      // 两张翻将在不同普通牌上
      jiangMap[fan1] = { isJiang: true, jiangType: 'fanjiang' };
      jiangMap[fan2] = { isJiang: true, jiangType: 'fanjiang' };
      // 两张牌的跟随将
      var group5a = getTileGroup(fan1);
      var genIds5a = getGenjiangTileIds(group5a);
      for (i = 0; i < genIds5a.length; i++) {
        tileId = genIds5a[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_normal' };
      }
      var group5b = getTileGroup(fan2);
      var genIds5b = getGenjiangTileIds(group5b);
      for (i = 0; i < genIds5b.length; i++) {
        tileId = genIds5b[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_normal' };
      }
      break;

    case 6:
      // 两张都打在喜上 -> 喜归A组(147)
      var genIds6 = getGenjiangTileIds('A');
      for (i = 0; i < genIds6.length; i++) {
        tileId = genIds6[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_normal' };
      }
      break;

    case 7: {
      // 一张喜一张老将
      var laoFan7;
      if (isLaojiang(fan1)) {
        laoFan7 = fan1;
      } else {
        laoFan7 = fan2;
      }
      jiangMap[laoFan7] = { isJiang: true, jiangType: 'fanjiang_lao' };
      // 其他老将是跟随老将
      for (i = 0; i < LAOJIANG_IDS.length; i++) {
        tileId = LAOJIANG_IDS[i];
        if (tileId === laoFan7) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_laojiang' };
      }
      // 喜归A组，产生的跟随将
      var genIds7 = getGenjiangTileIds(XI_GROUP);
      for (i = 0; i < genIds7.length; i++) {
        tileId = genIds7[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_normal' };
      }
      break;
    }

    case 8: {
      // 一张喜一张普通牌
      var normalFan8;
      if (classifyFanJiang(fan1) === 'normal') {
        normalFan8 = fan1;
      } else {
        normalFan8 = fan2;
      }
      jiangMap[normalFan8] = { isJiang: true, jiangType: 'fanjiang' };
      // 老将
      // 喜归A组 + 普通牌的组 -> 跟随普通将
      var group8 = getTileGroup(normalFan8);
      var genIds8 = getGenjiangTileIds(group8);
      for (i = 0; i < genIds8.length; i++) {
        tileId = genIds8[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_normal' };
      }
      // 喜的A组跟随
      var genIds8xi = getGenjiangTileIds(XI_GROUP);
      for (i = 0; i < genIds8xi.length; i++) {
        tileId = genIds8xi[i];
        if (jiangMap[tileId].isJiang) continue;
        jiangMap[tileId] = { isJiang: true, jiangType: 'gen_normal' };
      }
      break;
    }
  }

  return { jiangMap: jiangMap, scenario: scenario };
}

// ---- buildJiangMap 统一入口 ----

/**
 * 构建将牌映射表（统一入口）
 *
 * @param {number|number[]} fanJiang - 翻将 tileId。单将为 number，双将为 [fan1, fan2] 数组
 * @param {string} mode - MODE.SINGLE 或 MODE.DOUBLE
 * @param {boolean} [xiEnabled=true] - 是否启用喜牌
 * @returns {{ jiangMap: Object, scenario: number|null }}
 */
function buildJiangMap(fanJiang, mode, xiEnabled) {
  if (xiEnabled === undefined) xiEnabled = true;

  if (mode === MODE.SINGLE) {
    return buildSingleJiangMap(fanJiang, xiEnabled);
  }

  // 双将模式
  return buildDoubleJiangMap(fanJiang, xiEnabled);
}

// ---- 底胡查表 ----

/**
 * 单将底胡表
 * key: jiangType, value: { peng, anke, minggang, angang, long }
 */
var SINGLE_DIHU_TABLE = {
  'normal':        { peng: 1,  anke: 2,  minggang: 4,  angang: 6,  long: 8 },
  'fanjiang':      { peng: 8,  anke: 24, minggang: -1, angang: -1, long: 32 },
  'fanjiang_lao':  { peng: 16, anke: 48, minggang: -1, angang: -1, long: 64 },
  'laojiang':      { peng: 4,  anke: 8,  minggang: 16, angang: 24, long: 32 },
  'laojiang_fan':  { peng: 8,  anke: 16, minggang: 32, angang: 48, long: 64 },
  'touwei':        { peng: 4,  anke: 8,  minggang: 16, angang: 24, long: 32 },
  'genjiang':      { peng: 4,  anke: 8,  minggang: 16, angang: 24, long: 32 },
};

/**
 * 双将底胡表（按场景编号索引）
 * 每个场景下: key 为 jiangType, value 为 { peng, anke, minggang, angang, long }
 */
var DOUBLE_DIHU_TABLE = {
  1: {
    'fanjiang_double_same_lao': { peng: -1, anke: -1, minggang: -1, angang: -1, long: 128 },
    'gen_laojiang':             { peng: 16, anke: 32, minggang: 64, angang: 96, long: 128 },
    'laojiang':                 { peng: 16, anke: 32, minggang: 64, angang: 96, long: 128 },
    'normal':                   { peng: 2,  anke: 4,  minggang: 8,  angang: 12, long: 16 },
  },
  2: {
    'fanjiang_lao':   { peng: 32, anke: 96, minggang: -1, angang: -1, long: 128 },
    'gen_laojiang':   { peng: 16, anke: 32, minggang: 64, angang: 96, long: 128 },
    'laojiang':       { peng: 16, anke: 32, minggang: 64, angang: 96, long: 128 },
    'normal':         { peng: 2,  anke: 4,  minggang: 8,  angang: 12, long: 16 },
  },
  3: {
    'fanjiang_lao':   { peng: 16, anke: 48, minggang: -1, angang: -1, long: 64 },
    'fanjiang':       { peng: 8,  anke: 24, minggang: -1, angang: -1, long: 32 },
    'gen_normal':     { peng: 4,  anke: 8,  minggang: 16, angang: 24, long: 32 },
    'gen_laojiang':   { peng: 8,  anke: 16, minggang: 32, angang: 48, long: 64 },
    'laojiang':       { peng: 8,  anke: 16, minggang: 32, angang: 48, long: 64 },
    'normal':         { peng: 2,  anke: 4,  minggang: 8,  angang: 12, long: 16 },
  },
  4: {
    'fanjiang_double_same_normal': { peng: -1, anke: -1, minggang: -1, angang: -1, long: 64 },
    'laojiang':                    { peng: 4,  anke: 8,  minggang: 16, angang: 24, long: 32 },
    'gen_normal':                  { peng: 4,  anke: 16, minggang: 32, angang: 48, long: 64 },
    'normal':                      { peng: 2,  anke: 4,  minggang: 8,  angang: 12, long: 16 },
  },
  5: {
    'fanjiang':   { peng: 8,  anke: 24, minggang: -1, angang: -1, long: 32 },
    'laojiang':   { peng: 4,  anke: 8,  minggang: 16, angang: 24, long: 32 },
    'gen_normal': { peng: 4,  anke: 8,  minggang: 16, angang: 24, long: 32 },
    'normal':     { peng: 2,  anke: 4,  minggang: 8,  angang: 12, long: 16 },
  },
  6: {
    'laojiang': { peng: 16, anke: 32, minggang: 64, angang: 96, long: 128 },
    'normal':   { peng: 2,  anke: 4,  minggang: 8,  angang: 12, long: 16 },
  },
  7: {
    'fanjiang_lao': { peng: 32, anke: 96, minggang: -1, angang: -1, long: 128 },
    'gen_laojiang': { peng: 16, anke: 32, minggang: 64, angang: 96, long: 128 },
    'laojiang':     { peng: 16, anke: 32, minggang: 64, angang: 96, long: 128 },
    'normal':       { peng: 2,  anke: 4,  minggang: 8,  angang: 12, long: 16 },
  },
  8: {
    'fanjiang':   { peng: 8,  anke: 24, minggang: -1, angang: -1, long: 32 },
    'gen_normal': { peng: 4,  anke: 8,  minggang: 16, angang: 24, long: 32 },
    'laojiang':   { peng: 4,  anke: 16, minggang: 32, angang: 48, long: 64 },
    'normal':     { peng: 2,  anke: 4,  minggang: 8,  angang: 12, long: 16 },
  },
};

/**
 * 获取底胡值
 *
 * @param {Object} jiangMap - 将牌映射表
 * @param {number|null} scenario - 双将场景编号，单将为 null
 * @param {number} tileId - 牌的 tileId
 * @param {string} action - 操作类型 (MELD_ACTION 中的值)
 * @param {string} mode - MODE.SINGLE 或 MODE.DOUBLE
 * @returns {number} 底胡分值，-1 表示不可能的操作（如翻将不能杠）
 */
function getDiHu(jiangMap, scenario, tileId, action, mode) {
  var entry = jiangMap[tileId];
  if (!entry) return 0;

  var jiangType = entry.jiangType;

  if (mode === MODE.SINGLE) {
    var table = SINGLE_DIHU_TABLE[jiangType];
    if (!table) return 0;
    return table[action];
  }

  // 双将模式
  if (!scenario) return 0;
  var scenarioTable = DOUBLE_DIHU_TABLE[scenario];
  if (!scenarioTable) return 0;
  var row = scenarioTable[jiangType];
  if (!row) return 0;
  return row[action];
}

/**
 * 底胡进整（向上取整到最近的 10 的倍数）
 * 0 保持为 0，其他值向上取整到 10 的倍数
 *
 * @param {number} rawDiHu - 原始底胡值
 * @returns {number} 进整后的底胡值
 */
function roundUpDiHu(rawDiHu) {
  if (rawDiHu === 0) return 0;
  return Math.ceil(rawDiHu / 10) * 10;
}

// ---- 导出 ----

module.exports = {
  // 核心接口
  buildJiangMap: buildJiangMap,
  getDiHu: getDiHu,
  roundUpDiHu: roundUpDiHu,

  // 辅助函数（供测试使用）
  classifyFanJiang: classifyFanJiang,
  getTileGroup: getTileGroup,
  getGenjiangTileIds: getGenjiangTileIds,
  determineScenario: determineScenario,

  // 常量
  GROUP_MAP: GROUP_MAP,
  HONOR_GROUP: HONOR_GROUP,
  XI_GROUP: XI_GROUP,
  LAOJIANG_IDS: LAOJIANG_IDS,
  SINGLE_DIHU_TABLE: SINGLE_DIHU_TABLE,
  DOUBLE_DIHU_TABLE: DOUBLE_DIHU_TABLE,
};
