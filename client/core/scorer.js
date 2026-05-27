/**
 * 计分系统模块
 *
 * 南通长牌的胡数计算和分数结算核心模块。
 * 负责底胡进整、文钱计算、喜胡查表、丫子/拖尾/吊头判断、
 * 胡数计算（单将/双将）、特殊胡和分数结算。
 */

var { MODE, HU_TYPE } = require('../utils/constants');

// ============================================================
// 底胡进整
// ============================================================

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

// ============================================================
// 文钱计算
// ============================================================

// 一二三饼的 tileId 分别是 18, 19, 20
var WENQIAN_IDS = [18, 19, 20];

/**
 * 检查一个顺子是否是文钱（一二三饼）
 *
 * @param {Array} shunzi - 三个 tileId 组成的数组
 * @returns {boolean}
 */
function isWenQianShunzi(shunzi) {
  var ids = [shunzi[0].tileId, shunzi[1].tileId, shunzi[2].tileId].sort(function (a, b) { return a - b; });
  return ids[0] === 18 && ids[1] === 19 && ids[2] === 20;
}

/**
 * 计算文钱胡数
 *
 * 文钱 = "一二三"饼子顺子
 * 1组=20胡, 2组=50胡, 3组=100胡
 *
 * @param {Array} melds - 已有的面子列表（龙/碰/杠）
 * @param {Object} decomposeResult - 拆牌结果
 * @returns {number} 文钱胡数
 */
function calcWenQian(melds, decomposeResult) {
  var count = 0;

  // 检查 melds 中的龙（撂龙是顺子）
  if (melds) {
    for (var i = 0; i < melds.length; i++) {
      if (melds[i].type === 'long') {
        if (isWenQianShunzi(melds[i].tiles)) {
          count++;
        }
      }
    }
  }

  // 检查 decomposeResult 中的顺子
  if (decomposeResult && decomposeResult.shunzi) {
    for (var j = 0; j < decomposeResult.shunzi.length; j++) {
      if (isWenQianShunzi(decomposeResult.shunzi[j])) {
        count++;
      }
    }
  }

  // 查表
  if (count === 0) return 0;
  if (count === 1) return 20;
  if (count === 2) return 50;
  if (count >= 3) return 100;

  return 0;
}

// ============================================================
// 喜胡查表
// ============================================================

/**
 * 单将喜胡表
 * fanOnXi: 0=翻将未打在喜上, 1=翻将打在喜上
 */
var SINGLE_XI_TABLE = {
  0: { 1: 20, 2: 30, 3: 50, 4: 70, 5: 200 },
  1: { 1: 30, 2: 60, 3: 100, 4: 200, 5: 400 },
};

/**
 * 双将喜胡表（南通规则）
 * fanOnXi: 0=未打在喜上, 1=一张打在喜上, 2=两张打在喜上
 */
var DOUBLE_XI_TABLE = {
  0: { 1: 10, 2: 30, 3: 50, 4: 100 },
  1: { 1: 30, 2: 50, 3: 100, 4: 200 },
  2: { 1: 50, 2: 100, 3: 200 },
};

/**
 * 计算喜胡胡数
 *
 * @param {number} xiCount - 喜牌数量 (0-5)
 * @param {number} fanOnXi - 翻将打在喜上的数量 (0/1/2)
 *   单将: 0=未打在喜上, 1=打在喜上
 *   双将: 0=未打在喜上, 1=一张打在喜上, 2=两张打在喜上
 * @param {string} mode - 'single' | 'double'
 * @returns {number} 喜胡胡数
 */
function calcXiHu(xiCount, fanOnXi, mode) {
  if (xiCount === 0) return 0;

  if (mode === MODE.SINGLE) {
    var table = SINGLE_XI_TABLE[fanOnXi];
    if (!table) return 0;
    return table[xiCount] || 0;
  }

  // 双将模式
  var dtable = DOUBLE_XI_TABLE[fanOnXi];
  if (!dtable) return 0;
  return dtable[xiCount] || 0;
}

// ============================================================
// 丫子/拖尾/吊头判断
// ============================================================

/**
 * 判断胡的牌是否是丫子
 * 丫子：胡的那张牌卡在两张牌中间（顺子的中间那张）
 *
 * @param {Object} decomposeResult - 拆牌结果
 * @param {number} huTileId - 胡的牌 tileId
 * @returns {boolean}
 */
function isYaZi(decomposeResult, huTileId) {
  if (!decomposeResult || !decomposeResult.shunzi || huTileId == null) return false;

  for (var i = 0; i < decomposeResult.shunzi.length; i++) {
    var shun = decomposeResult.shunzi[i];
    var ids = [shun[0].tileId, shun[1].tileId, shun[2].tileId].sort(function (a, b) { return a - b; });
    // 丫子是顺子中间的那张
    if (ids[1] === huTileId) {
      return true;
    }
  }
  return false;
}

/**
 * 判断胡的牌是否是拖尾
 * 拖尾："一二三"里的"三" 或 "七八九"里的"七"
 * 即顺子中 rank=3 或 rank=7 的那张
 *
 * @param {Object} decomposeResult - 拆牌结果
 * @param {number} huTileId - 胡的牌 tileId
 * @returns {boolean}
 */
function isTuoWei(decomposeResult, huTileId) {
  if (!decomposeResult || !decomposeResult.shunzi || huTileId == null) return false;

  var info = null;
  // 需要 getTileInfo 来判断 rank
  try {
    info = require('./tile').getTileInfo(huTileId);
  } catch (e) {
    return false;
  }
  if (!info) return false;

  // 只有 rank=3（拖尾=三）或 rank=7（拖尾=七）才可能是拖尾
  if (info.rank !== 3 && info.rank !== 7) return false;

  for (var i = 0; i < decomposeResult.shunzi.length; i++) {
    var shun = decomposeResult.shunzi[i];
    var ids = [shun[0].tileId, shun[1].tileId, shun[2].tileId].sort(function (a, b) { return a - b; });
    // 检查 huTileId 是否在此顺子中
    var found = false;
    for (var j = 0; j < ids.length; j++) {
      if (ids[j] === huTileId) found = true;
    }
    if (!found) continue;

    // 排序后 ids[0] < ids[1] < ids[2]
    // 拖尾 = 顺子中的最大牌（rank=3的情况：一二三中的三）
    //       或顺子中的最小牌（rank=7的情况：七八九中的七）
    if (info.rank === 3 && ids[2] === huTileId) return true;
    if (info.rank === 7 && ids[0] === huTileId) return true;
  }
  return false;
}

/**
 * 判断胡的牌是否是吊头
 * 吊头：最后一张牌组成唯一的对子（做将头）
 *
 * @param {Object} decomposeResult - 拆牌结果
 * @param {number} huTileId - 胡的牌 tileId
 * @returns {boolean}
 */
function isDiaoTou(decomposeResult, huTileId) {
  if (!decomposeResult || !decomposeResult.pair || huTileId == null) return false;
  return decomposeResult.pair.tileId === huTileId;
}

/**
 * 判断是否是老将牌
 */
function _isLaojiang(tileId) {
  return tileId === 17 || tileId === 27 || tileId === 28 || tileId === 29;
}

/**
 * 检测清胡把子
 *
 * 把子：某张牌既可以算在顺子里，也可以算在暗刻或暗杠里。
 * 即 decomposeResult 中某个 shunzi 里的某张牌，也出现在某个 kezi 里。
 * 只在清胡时有效。
 *
 * @param {Object} decomposeResult - 拆牌结果
 * @returns {boolean}
 */
function hasBaZi(decomposeResult) {
  if (!decomposeResult) return false;
  var shunzi = decomposeResult.shunzi || [];
  var kezi = decomposeResult.kezi || [];
  if (shunzi.length === 0 || kezi.length === 0) return false;

  // 收集所有暗刻中的 tileId
  var keziIds = {};
  for (var k = 0; k < kezi.length; k++) {
    for (var ki = 0; ki < kezi[k].length; ki++) {
      keziIds[kezi[k][ki].tileId] = true;
    }
  }

  // 检查顺子中是否有牌也在暗刻中
  for (var s = 0; s < shunzi.length; s++) {
    for (var si = 0; si < shunzi[s].length; si++) {
      if (keziIds[shunzi[s][si].tileId]) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 检测双龙条件
 *
 * 双龙：自摸且持有 2 个及以上暗杠。
 * 注：暗杠在 melds 中 type='gang'，且全部来自手中（非碰升级）。
 * 由于暗杠和明杠都存为 type='gang'，通过 gangAnGangCount 参数传入暗杠数。
 *
 * @param {number} anGangCount - 暗杠数量
 * @param {boolean} isSelfDrawn - 是否自摸
 * @returns {boolean}
 */
function isShuangLong(anGangCount, isSelfDrawn) {
  return isSelfDrawn && anGangCount >= 2;
}

// ============================================================
// 胡数计算
// ============================================================

/**
 * 计算一个玩家的总胡数
 *
 * @param {Object} params - 参数对象
 * @returns {{ baseHu: number, totalHu: number, breakdown: Object }}
 */
function calcHuScore(params) {
  var huType = params.huType;
  var mode = params.mode || MODE.SINGLE;
  var isSelfDrawn = params.isSelfDrawn || false;
  var isHaiDi = params.isHaiDi || false;
  var melds = params.melds || [];
  var decomposeResult = params.decomposeResult || { pair: null, shunzi: [], kezi: [] };
  var xiEnabled = params.xiEnabled || false;
  var hasXi = params.hasXi || false;
  var xiCount = params.xiCount || 0;
  var fanOnXi = params.fanOnXi || 0;
  var rawDiHu = params.rawDiHu || 0;
  var huTile = params.huTile;
  var isLiuju = params.isLiuju || false;
  var sanLaoHuiQi = params.sanLaoHuiQi || false;

  var huTileId = huTile != null ? (typeof huTile === 'object' ? huTile.tileId : huTile) : null;

  var breakdown = {
    diHu: 0,
    chengHu: 0,
    wenQian: 0,
    diao: 0,       // 软硬钓
    yazi: 0,       // 丫子
    tuoWei: 0,     // 拖尾
    diaoTou: 0,    // 吊头
    sanLaoDuDiao: 0, // 三老会面独钓
    baZi: 0,       // 清胡把子
    xiHu: 0,
    ziMo: 0,
    multiplier: 1,
    specials: [],
  };

  // ---- 流局处理 ----
  if (isLiuju) {
    // 未胡牌者：底胡不算、文钱不算、穷狠不算、穷穷狠不算、海底不算
    // 只算成胡
    breakdown.chengHu = 20;
    return {
      baseHu: breakdown.chengHu,
      totalHu: breakdown.chengHu,
      breakdown: breakdown,
    };
  }

  // ---- 底胡 ----
  breakdown.diHu = roundUpDiHu(rawDiHu);

  // ---- 成胡 ----
  if (mode === MODE.SINGLE) {
    if (huType === HU_TYPE.QINGHU) {
      breakdown.chengHu = 80;
    } else {
      breakdown.chengHu = 20;
    }
  } else {
    // 双将
    if (huType === HU_TYPE.QINGHU) {
      breakdown.chengHu = 100;  // 双将清胡基数是100（包含成胡）
    } else {
      breakdown.chengHu = 20;
    }
  }

  // ---- 文钱 ----
  breakdown.wenQian = calcWenQian(melds, decomposeResult);

  // ---- 丫子/拖尾/吊头 ----
  if (huTileId != null && decomposeResult) {
    if (isYaZi(decomposeResult, huTileId)) {
      if (isSelfDrawn) {
        breakdown.yazi = 20; // 硬丫子（自摸）
      } else {
        breakdown.yazi = 10; // 软丫子（别人打出）
      }
    }
    if (isTuoWei(decomposeResult, huTileId)) {
      breakdown.tuoWei = 10;
    }
    if (isDiaoTou(decomposeResult, huTileId)) {
      breakdown.diaoTou = 10;
    }
  }

  // ---- 三老会面独钓 ----
  // 单将模式下，其他玩家有胡时，单吊第三个三老胡牌算三老会面独钓10胡
  // 此项通过 params 传入
  if (params.sanLaoDuDiao) {
    breakdown.sanLaoDuDiao = 10;
  }

  // ---- 清胡把子 ----
  // 清胡中，某张牌既可以算在顺子里也可以算在暗刻/暗杠里，额外 +10 胡
  if (huType === HU_TYPE.QINGHU && hasBaZi(decomposeResult)) {
    breakdown.baZi = 10;
  }

  // ---- 双龙 ----
  // 自摸 2+ 暗杠时标记双龙
  var anGangCount = params.anGangCount || 0;
  if (isShuangLong(anGangCount, isSelfDrawn)) {
    breakdown.specials.push('shuangLong');
  }

  // ---- 喜胡 ----
  if (xiEnabled && xiCount > 0) {
    breakdown.xiHu = calcXiHu(xiCount, fanOnXi, mode);
  }

  // ---- 自摸 ----
  if (isSelfDrawn) {
    breakdown.ziMo = 10;
  }

  // ---- 计算基本胡数（乘数前） ----
  var baseHu = 0;

  if (mode === MODE.SINGLE) {
    // 单将公式
    var sum = breakdown.chengHu + breakdown.diHu + breakdown.wenQian +
              breakdown.yazi + breakdown.tuoWei + breakdown.diaoTou +
              breakdown.sanLaoDuDiao + breakdown.baZi +
              breakdown.xiHu + breakdown.ziMo;

    if (huType === HU_TYPE.PIAOHU) {
      breakdown.multiplier = 2;
      baseHu = sum;
    } else if (huType === HU_TYPE.QINGHU) {
      breakdown.multiplier = 1;
      baseHu = sum;
    } else if (huType === HU_TYPE.TAHU) {
      breakdown.multiplier = 1;
      baseHu = sum;
    } else if (huType === HU_TYPE.MENHUN) {
      breakdown.multiplier = 4;
      baseHu = sum;
    }
  } else {
    // 双将公式
    if (huType === HU_TYPE.PIAOHU) {
      // 双将飘胡：(底胡 + 成胡 + 30 + 其他 + 自摸) × 2
      breakdown.multiplier = 2;
      baseHu = breakdown.diHu + breakdown.chengHu + 30 +
               breakdown.wenQian + breakdown.yazi + breakdown.tuoWei +
               breakdown.diaoTou + breakdown.xiHu + breakdown.ziMo;
    } else if (huType === HU_TYPE.QINGHU) {
      // 双将清胡：100胡 + 其他 + 自摸
      breakdown.multiplier = 1;
      baseHu = breakdown.chengHu + breakdown.wenQian +
               breakdown.yazi + breakdown.tuoWei + breakdown.diaoTou +
               breakdown.baZi + breakdown.xiHu + breakdown.ziMo;
    } else if (huType === HU_TYPE.TAHU) {
      // 双将塌胡：底胡 + 成胡 + 其他 + 自摸
      breakdown.multiplier = 1;
      baseHu = breakdown.diHu + breakdown.chengHu +
               breakdown.wenQian + breakdown.yazi + breakdown.tuoWei +
               breakdown.diaoTou + breakdown.xiHu + breakdown.ziMo;
    } else if (huType === HU_TYPE.MENHUN) {
      // 双将闷荤：飘胡的基础上再双算
      breakdown.multiplier = 4;
      baseHu = breakdown.diHu + breakdown.chengHu + 30 +
               breakdown.wenQian + breakdown.yazi + breakdown.tuoWei +
               breakdown.diaoTou + breakdown.xiHu + breakdown.ziMo;
    }
  }

  var totalHu = baseHu * breakdown.multiplier;

  // ---- 特殊胡 ----

  // 三老会齐（单将）：胡数 × 2
  if (sanLaoHuiQi && mode === MODE.SINGLE) {
    totalHu = totalHu * 2;
    breakdown.specials.push('sanLaoHuiQi');
  }

  // 三老会齐（双将）：增加1倍三老将的底胡数
  // 需要通过 params.sanLaoDiHu 传入三老将的底胡
  if (sanLaoHuiQi && mode === MODE.DOUBLE) {
    var sanLaoDiHu = params.sanLaoDiHu || 0;
    totalHu = totalHu + sanLaoDiHu;
    breakdown.specials.push('sanLaoHuiQi');
  }

  // 海底捞月：增加1倍基本胡数
  if (isHaiDi) {
    totalHu = totalHu + baseHu;
    breakdown.specials.push('haiDi');
  }

  // 穷狠：带喜玩法中没有摸到喜牌 × 2
  var fanJiang = params.fanJiang;
  if (xiEnabled && !hasXi) {
    if (mode === MODE.SINGLE) {
      // 穷穷狠优先检查：翻将是喜 + 无喜牌 × 4
      var fanIsXi = false;
      if (fanJiang != null) {
        var fanId = typeof fanJiang === 'object' ? fanJiang.tileId : fanJiang;
        fanIsXi = fanId >= 31 && fanId <= 35;
      }
      if (fanIsXi) {
        totalHu = totalHu * 4;
        breakdown.specials.push('qiongHen'); // 穷穷狠也标记为穷狠
      } else {
        totalHu = totalHu * 2;
        breakdown.specials.push('qiongHen');
      }
    } else {
      // 双将穷狠
      totalHu = totalHu * 2;
      breakdown.specials.push('qiongHen');
    }
  }

  return {
    baseHu: baseHu,
    totalHu: totalHu,
    breakdown: breakdown,
  };
}

// ============================================================
// 分数结算
// ============================================================

/**
 * 计算三人分数结算
 *
 * 公式：己方应付 = 己方胡数 × 2 − (另外两家胡数之和)
 *
 * @param {number[]} scores - 三人的胡数数组 [A, B, C]
 * @returns {{ payments: number[] }} 三人的应付分数
 */
function calcSettlement(scores) {
  var payments = [];
  for (var i = 0; i < scores.length; i++) {
    var otherSum = 0;
    for (var j = 0; j < scores.length; j++) {
      if (j !== i) {
        otherSum += scores[j];
      }
    }
    payments.push(scores[i] * 2 - otherSum);
  }
  return { payments: payments };
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  roundUpDiHu: roundUpDiHu,
  calcWenQian: calcWenQian,
  calcXiHu: calcXiHu,
  calcHuScore: calcHuScore,
  calcSettlement: calcSettlement,
  isYaZi: isYaZi,
  isTuoWei: isTuoWei,
  isDiaoTou: isDiaoTou,
  hasBaZi: hasBaZi,
  isShuangLong: isShuangLong,
};
