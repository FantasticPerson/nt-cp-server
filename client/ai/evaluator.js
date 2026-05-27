/**
 * 牌面评估器
 *
 * 评估手牌状态，为 AI 决策提供依据。
 * 根据将牌身份、组合关联度、孤张/边张、安全性、听牌状态等因素
 * 对每张手牌评分，并计算整体手牌强度。
 */

var { SUIT, CATEGORY } = require('../utils/constants');
var { getTileInfo, isLaojiang, isTouwei } = require('../core/tile');
var { detectTing, buildCountMap } = require('../core/hand');

// ---- 评分权重 ----

var SCORE_JIANG = 30;           // 将牌加分
var SCORE_RELATED_HIGH = 20;    // 高关联度（对子/搭子两面）
var SCORE_RELATED_MID = 15;     // 中关联度（搭子一面）
var SCORE_RELATED_LOW = 10;     // 低关联度（间隔搭子）
var SCORE_LONELY = -10;         // 孤张扣分
var SCORE_SAFE_HIGH = 10;       // 高安全性（对手打过3张同类）
var SCORE_SAFE_MID = 7;         // 中安全性（对手打过2张同类）
var SCORE_SAFE_LOW = 5;         // 低安全性（对手打过1张同类）
var SCORE_TING_PENALTY = -15;   // 听牌状态打非关联牌扣分

// ---- handStrength 阈值 ----

var STRENGTH_TING_MIN = 80;     // 已听牌最低分
var STRENGTH_NEAR_MIN = 50;     // 接近听牌最低分
// 低于 STRENGTH_NEAR_MIN 表示离听牌远

// ---- 辅助函数 ----

/**
 * 判断 tileId 是否为数牌（万/条/饼，可组顺子）
 * @param {number} tileId
 * @returns {boolean}
 */
function isNumberTile(tileId) {
  return tileId >= 0 && tileId <= 26;
}

/**
 * 获取同一花色中相邻 tileId（用于顺子关联检测）
 * 仅适用于数牌（0-26），且在花色边界内
 *
 * @param {number} tileId
 * @returns {number[]} 相邻的 tileId 列表（最多2个：-1和+1）
 */
function getAdjacentTileIds(tileId) {
  if (!isNumberTile(tileId)) return [];

  var info = getTileInfo(tileId);
  // 老将不能组顺子
  if (isLaojiang(tileId)) return [];

  var result = [];
  var rank = info.rank;

  // rank-1 相邻（当前 tileId - 1）
  if (rank > 1) {
    result.push(tileId - 1);
  }
  // rank+1 相邻（当前 tileId + 1）
  if (rank < 9) {
    result.push(tileId + 1);
  }

  return result;
}

/**
 * 获取同一花色中间隔1张的 tileId（用于间隔搭子检测，如 1-3、2-4）
 *
 * @param {number} tileId
 * @returns {number[]} 间隔1张的 tileId 列表（最多2个）
 */
function getGapTileIds(tileId) {
  if (!isNumberTile(tileId)) return [];

  var info = getTileInfo(tileId);
  if (isLaojiang(tileId)) return [];

  var result = [];
  var rank = info.rank;

  if (rank > 2) {
    result.push(tileId - 2);
  }
  if (rank < 8) {
    result.push(tileId + 2);
  }

  return result;
}

/**
 * 计算一张牌的组合关联度加分
 *
 * 关联规则：
 * - 对子（同 tileId 有2张以上）: +20
 * - 两面搭子（相邻牌在手）: +20
 * - 一面搭子（相邻牌在手，但在花色边缘 rank=1 或 rank=9）: +15
 * - 间隔搭子（间隔1张的牌在手，如 1-3）: +10
 *
 * @param {Object} tile - 牌实例
 * @param {Object} countMap - tileId -> count 的映射
 * @returns {{ score: number, reasons: string[] }}
 */
function calcRelationScore(tile, countMap) {
  var tid = tile.tileId;
  var score = 0;
  var reasons = [];

  // 对子加分
  var selfCount = countMap[tid] || 0;
  if (selfCount >= 3) {
    score += SCORE_RELATED_HIGH;
    reasons.push('刻子在手');
  } else if (selfCount >= 2) {
    score += SCORE_RELATED_HIGH;
    reasons.push('对子在手');
  }

  // 数牌的顺子关联
  if (isNumberTile(tid) && !isLaojiang(tid)) {
    var info = getTileInfo(tid);
    var rank = info.rank;

    var adjacent = getAdjacentTileIds(tid);
    for (var i = 0; i < adjacent.length; i++) {
      var adjTid = adjacent[i];
      if (countMap[adjTid]) {
        // 检查是否为两面搭子还是边缘搭子
        // 两面搭子：rank 2-8 且相邻牌也在 2-8 范围
        // 边缘搭子：rank=1 或 rank=9，或相邻牌在边缘
        var adjRank = getTileInfo(adjTid).rank;
        if ((rank >= 2 && rank <= 8) && (adjRank >= 2 && adjRank <= 8)) {
          score += SCORE_RELATED_HIGH;
          reasons.push('两面搭子(' + info.name + '-' + getTileInfo(adjTid).name + ')');
        } else {
          score += SCORE_RELATED_MID;
          reasons.push('边缘搭子(' + info.name + '-' + getTileInfo(adjTid).name + ')');
        }
      }
    }

    // 间隔搭子
    var gaps = getGapTileIds(tid);
    for (var j = 0; j < gaps.length; j++) {
      var gapTid = gaps[j];
      if (countMap[gapTid]) {
        score += SCORE_RELATED_LOW;
        reasons.push('间隔搭子(' + info.name + '-' + getTileInfo(gapTid).name + ')');
      }
    }
  }

  // 刻子关联：老将牌/字牌如果只有1张，没有顺子关联，由孤独检测处理
  return { score: score, reasons: reasons };
}

/**
 * 计算安全性加分
 *
 * 根据对手已打出的同类牌数量评估安全性。
 * 同类牌定义：
 * - 数牌：同花色同 tileId 的牌
 * - 老将/字牌：同 tileId 的牌
 *
 * @param {Object} tile - 牌实例
 * @param {Object} discardedByOthers - 对手弃牌统计 { tileId: count }
 * @returns {{ score: number, reasons: string[] }}
 */
function calcSafetyScore(tile, discardedByOthers) {
  var tid = tile.tileId;
  var score = 0;
  var reasons = [];

  if (!discardedByOthers) return { score: 0, reasons: [] };

  var discCount = discardedByOthers[tid] || 0;

  if (discCount >= 3) {
    score += SCORE_SAFE_HIGH;
    reasons.push('极安全(对手已打' + discCount + '张同类)');
  } else if (discCount === 2) {
    score += SCORE_SAFE_MID;
    reasons.push('较安全(对手已打2张同类)');
  } else if (discCount === 1) {
    score += SCORE_SAFE_LOW;
    reasons.push('稍安全(对手已打1张同类)');
  }

  // 数牌额外安全检查：相邻牌已被打出也增加安全性
  if (isNumberTile(tid) && !isLaojiang(tid)) {
    var adjacent = getAdjacentTileIds(tid);
    var adjDiscCount = 0;
    for (var i = 0; i < adjacent.length; i++) {
      adjDiscCount += discardedByOthers[adjacent[i]] || 0;
    }
    if (adjDiscCount >= 2) {
      score += SCORE_SAFE_LOW;
      reasons.push('周围牌安全');
    }
  }

  return { score: score, reasons: reasons };
}

/**
 * 判断一张牌是否为孤张
 * 孤张定义：手中无同花色相邻牌、无对子、无间隔搭子
 *
 * @param {Object} tile - 牌实例
 * @param {Object} countMap - tileId -> count 的映射
 * @returns {boolean}
 */
function isLonelyTile(tile, countMap) {
  var tid = tile.tileId;

  // 有对子不算孤张
  if ((countMap[tid] || 0) >= 2) return false;

  // 数牌检查相邻和间隔
  if (isNumberTile(tid) && !isLaojiang(tid)) {
    var adjacent = getAdjacentTileIds(tid);
    for (var i = 0; i < adjacent.length; i++) {
      if (countMap[adjacent[i]]) return false;
    }
    var gaps = getGapTileIds(tid);
    for (var j = 0; j < gaps.length; j++) {
      if (countMap[gaps[j]]) return false;
    }
  }

  // 老将/字牌：只有1张且无对子即为孤张（老将牌无顺子关联）
  // 但老将牌本身有价值，不归为孤张
  if (isLaojiang(tid)) return false;

  // 头尾将也不算孤张
  if (isTouwei(tid)) return false;

  return true;
}

/**
 * 计算听牌关联扣分
 *
 * 如果当前已听牌，打出非听牌关联的牌应该扣分。
 * 听牌关联定义：该牌在某种听牌结构中被使用（如对子、搭子的一部分）。
 *
 * 简化处理：如果已听牌，检查该 tileId 是否出现在某个听牌的搭子中。
 * 最简单的判断：该 tileId 是否与听牌列表中的某张牌直接关联。
 *
 * @param {Object} tile - 牌实例
 * @param {number[]} tingTiles - 听牌列表
 * @param {Object} countMap - tileId -> count 的映射
 * @returns {{ score: number, reasons: string[] }}
 */
function calcTingPenalty(tile, tingTiles, countMap) {
  if (!tingTiles || tingTiles.length === 0) {
    return { score: 0, reasons: [] };
  }

  var tid = tile.tileId;

  // 如果这张牌本身就是听牌，不扣分
  for (var t = 0; t < tingTiles.length; t++) {
    if (tingTiles[t] === tid) {
      return { score: 0, reasons: ['听牌牌张'] };
    }
  }

  // 检查该牌是否与听牌直接关联（相邻、间隔、同 tileId 有多张）
  var isRelated = false;

  // 有对子/刻子则关联
  if ((countMap[tid] || 0) >= 2) {
    isRelated = true;
  }

  // 检查数牌与听牌的顺子关联
  if (!isRelated && isNumberTile(tid) && !isLaojiang(tid)) {
    for (var i = 0; i < tingTiles.length; i++) {
      var tingTid = tingTiles[i];
      // 听牌与当前牌相邻
      if (tingTid === tid - 1 || tingTid === tid + 1) {
        // 确保同花色
        if (getTileInfo(tingTid).suit === getTileInfo(tid).suit) {
          isRelated = true;
          break;
        }
      }
      // 听牌与当前牌间隔1
      if (tingTid === tid - 2 || tingTid === tid + 2) {
        if (getTileInfo(tingTid).suit === getTileInfo(tid).suit) {
          isRelated = true;
          break;
        }
      }
    }
  }

  if (!isRelated) {
    return { score: SCORE_TING_PENALTY, reasons: ['已听牌但此牌非关联牌'] };
  }

  return { score: 0, reasons: [] };
}

// ---- 核心接口 ----

/**
 * 计算整体手牌强度
 *
 * 已听牌 -> 80-100
 * 接近听牌 -> 50-79
 * 离听牌远 -> 0-49
 *
 * @param {number[]} tingTiles - 听牌列表
 * @param {Object} countMap - tileId -> count 的映射
 * @param {Array} melds - 已有面子列表
 * @returns {number} 0-100
 */
function calcHandStrength(tingTiles, countMap, melds) {
  if (!melds) melds = [];

  // 已听牌
  if (tingTiles && tingTiles.length > 0) {
    // 听牌数量越多越强
    // 1张听牌 = 80, 2张 = 85, 3张 = 90, ...最高 100
    var tingCount = tingTiles.length;
    var base = STRENGTH_TING_MIN;
    var bonus = Math.min((tingCount - 1) * 5, 20);
    return Math.min(base + bonus, 100);
  }

  // 估算接近听牌的程度
  // 考虑因素：
  // 1. 已有的面子数量（melds + 暗牌中的对子/搭子）
  // 2. 将牌数量
  // 3. 有效搭子数量

  var meldCount = melds.length; // 已碰/杠/龙的数量
  var pairCount = 0;
  var pseudoMeldCount = 0; // 伪面子（对子算半个面子，搭子算部分面子）

  var tileIds = Object.keys(countMap).map(Number);
  for (var i = 0; i < tileIds.length; i++) {
    var tid = tileIds[i];
    var cnt = countMap[tid];

    // 对子/刻子
    if (cnt >= 3) {
      pseudoMeldCount += 1; // 暗刻算一个完整面子
    } else if (cnt === 2) {
      pairCount += 1;
      pseudoMeldCount += 0.5; // 对子算半个面子
    }

    // 搭子检测（数牌相邻）
    if (isNumberTile(tid) && !isLaojiang(tid) && cnt >= 1) {
      var adjacent = getAdjacentTileIds(tid);
      for (var j = 0; j < adjacent.length; j++) {
        if (countMap[adjacent[j]] && adjacent[j] > tid) {
          // 避免重复计算，只计算 tid < adjacent[j] 的搭子
          pseudoMeldCount += 0.3;
        }
      }
    }
  }

  // 总面子数 = melds + 暗牌伪面子
  var totalMeldScore = meldCount + pseudoMeldCount;

  // 胡牌需要 7 个面子 + 1 对将，听牌前大约需要 7 个面子
  // 用 totalMeldScore / 7 来估算进度
  var progress = Math.min(totalMeldScore / 7, 1);

  // 映射到 0-49 或 50-79 范围
  // progress >= 0.7 (接近听牌): 50-79
  // progress < 0.7 (离听牌远): 0-49
  if (progress >= 0.7) {
    // 接近听牌: 50-79
    var nearProgress = (progress - 0.7) / 0.3; // 0-1
    return Math.round(50 + nearProgress * 29);
  } else {
    // 离听牌远: 0-49
    var farProgress = progress / 0.7; // 0-1
    return Math.round(farProgress * 49);
  }
}

/**
 * 评估手牌状态
 *
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Array} melds - 已有的面子列表，每个 meld 是 { type: string, tiles: TileInstance[] }
 * @param {Object} jiangMap - 将牌映射表
 * @param {Object} discardedByOthers - 对手弃牌统计 { tileId: count }
 * @returns {{ tingTiles: number[], tileScores: Array, handStrength: number }}
 */
function evaluateHand(holding, melds, jiangMap, discardedByOthers) {
  if (!melds) melds = [];
  if (!discardedByOthers) discardedByOthers = {};

  // 1. 检测听牌
  var tingTiles = detectTing(holding, melds, jiangMap);

  // 2. 构建手牌计数映射
  var countMap = buildCountMap(holding);

  // 3. 对每张手牌评分
  var tileScores = [];
  for (var i = 0; i < holding.length; i++) {
    var tile = holding[i];
    var tid = tile.tileId;
    var score = 0;
    var reasons = [];

    // (1) 将牌加分
    if (jiangMap && jiangMap[tid] && jiangMap[tid].isJiang) {
      score += SCORE_JIANG;
      reasons.push('将牌(' + jiangMap[tid].jiangType + ')');
    }

    // (2) 组合关联度
    var relationResult = calcRelationScore(tile, countMap);
    score += relationResult.score;
    for (var r = 0; r < relationResult.reasons.length; r++) {
      reasons.push(relationResult.reasons[r]);
    }

    // (3) 孤张/边张扣分
    if (isLonelyTile(tile, countMap)) {
      score += SCORE_LONELY;
      reasons.push('孤张');
    }

    // (4) 安全性
    var safetyResult = calcSafetyScore(tile, discardedByOthers);
    score += safetyResult.score;
    for (var s = 0; s < safetyResult.reasons.length; s++) {
      reasons.push(safetyResult.reasons[s]);
    }

    // (5) 听牌关联扣分
    var tingResult = calcTingPenalty(tile, tingTiles, countMap);
    score += tingResult.score;
    for (var tp = 0; tp < tingResult.reasons.length; tp++) {
      reasons.push(tingResult.reasons[tp]);
    }

    // 限制在 0-100 范围
    score = Math.max(0, Math.min(100, score));

    tileScores.push({
      tile: tile,
      score: score,
      reasons: reasons,
    });
  }

  // 4. 计算整体手牌强度
  var handStrength = calcHandStrength(tingTiles, countMap, melds);

  return {
    tingTiles: tingTiles,
    tileScores: tileScores,
    handStrength: handStrength,
  };
}

// ---- 导出 ----

module.exports = {
  evaluateHand: evaluateHand,
  calcHandStrength: calcHandStrength,

  // 辅助函数（供测试使用）
  calcRelationScore: calcRelationScore,
  calcSafetyScore: calcSafetyScore,
  isLonelyTile: isLonelyTile,
  calcTingPenalty: calcTingPenalty,
};
