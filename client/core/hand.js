/**
 * 手牌分析与拆牌模块
 *
 * 南通长牌的胡牌结构分析核心模块。
 * 负责手牌排序、拆牌穷举、胡牌判定、胡牌分类和听牌检测。
 *
 * 胡牌结构：N个面子 + 1个将头，总共23张。
 *   - 清胡：1对子 + 7顺子
 *   - 飘胡：1对子 + 任意刻子/杠/文钱
 *   - 塌子胡：1对子 + 顺子 + 刻子或杠（混合）
 *   - 闷荤：飘胡的特殊自摸情形
 */

const { SUIT, CATEGORY, HU_TYPE, MELD_ACTION } = require('../utils/constants');
const { getTileInfo, isLaojiang } = require('./tile');

// ---- 排序 ----

/** 花色排序权重 */
var SUIT_ORDER = {};
SUIT_ORDER[SUIT.WAN] = 0;
SUIT_ORDER[SUIT.TIAO] = 1;
SUIT_ORDER[SUIT.BING] = 2;
SUIT_ORDER[SUIT.HONOR] = 3;
SUIT_ORDER[SUIT.XI] = 4;

/**
 * 老将排序子序：千字(27) < 红花(28) < 白花(29) < 九条(17)
 */
function _laojiangOrder(tileId) {
  if (tileId === 27) return 0; // 千字
  if (tileId === 28) return 1; // 红花
  if (tileId === 29) return 2; // 白花
  if (tileId === 17) return 3; // 九条
  return 4;
}

/**
 * 排序手牌
 * 排序规则：万 < 条 < 饼 < 老将 < 喜，同花色按点数从小到大
 * 老将内部：千字 < 红花 < 白花 < 九条
 *
 * @param {Array} holding - 牌实例数组
 * @returns {Array} 排序后的牌实例数组（新数组）
 */
function sortHolding(holding) {
  var sorted = holding.slice();
  sorted.sort(function (a, b) {
    var infoA = getTileInfo(a.tileId);
    var infoB = getTileInfo(b.tileId);
    var suitA = SUIT_ORDER[infoA.suit];
    var suitB = SUIT_ORDER[infoB.suit];
    // 老将统一排到饼(2)之后、喜(4)之前
    var isLaoA = isLaojiang(a.tileId);
    var isLaoB = isLaojiang(b.tileId);
    if (isLaoA) suitA = 2.5;
    if (isLaoB) suitB = 2.5;
    if (suitA !== suitB) return suitA - suitB;
    // 老将内部按千字→红花→白花→九条排序
    if (isLaoA && isLaoB) {
      return _laojiangOrder(a.tileId) - _laojiangOrder(b.tileId);
    }
    return infoA.rank - infoB.rank;
  });
  return sorted;
}

// ---- 拆牌核心算法 ----

/**
 * 检查三张牌是否构成顺子
 * 顺子条件：同花色、点数连续、非老将非喜
 *
 * @param {Array} tiles - 三张牌实例
 * @returns {boolean}
 */
function isShunzi(tiles) {
  if (tiles.length !== 3) return false;
  var info0 = getTileInfo(tiles[0].tileId);
  var info1 = getTileInfo(tiles[1].tileId);
  var info2 = getTileInfo(tiles[2].tileId);

  // 老将牌和喜牌不能组顺子
  // 注意：九条(tileId=17) 的 category 是 NORMAL，但 isLaojiang 为 true
  if (isLaojiang(tiles[0].tileId) || info0.category === CATEGORY.XI) return false;
  if (isLaojiang(tiles[1].tileId) || info1.category === CATEGORY.XI) return false;
  if (isLaojiang(tiles[2].tileId) || info2.category === CATEGORY.XI) return false;

  // 同花色
  if (info0.suit !== info1.suit || info0.suit !== info2.suit) return false;

  // 按rank排序后检查连续
  var ranks = [info0.rank, info1.rank, info2.rank].sort(function (a, b) { return a - b; });
  return ranks[0] + 1 === ranks[1] && ranks[1] + 1 === ranks[2];
}

/**
 * 检查三张牌是否构成刻子
 * 刻子条件：三张 tileId 相同
 *
 * @param {Array} tiles - 三张牌实例
 * @returns {boolean}
 */
function isKezi(tiles) {
  if (tiles.length !== 3) return false;
  return tiles[0].tileId === tiles[1].tileId && tiles[1].tileId === tiles[2].tileId;
}

/**
 * 将牌实例列表转为 tileId 计数映射
 *
 * @param {Array} tiles - 牌实例数组
 * @returns {Object} tileId -> count
 */
function buildCountMap(tiles) {
  var map = {};
  for (var i = 0; i < tiles.length; i++) {
    var tid = tiles[i].tileId;
    if (!map[tid]) map[tid] = 0;
    map[tid]++;
  }
  return map;
}

/**
 * 从计数映射中移除指定数量的某 tileId
 * @param {Object} countMap - tileId -> count
 * @param {number} tileId
 * @param {number} count
 */
function countMapRemove(countMap, tileId, count) {
  countMap[tileId] -= count;
  if (countMap[tileId] <= 0) {
    delete countMap[tileId];
  }
}

/**
 * 从计数映射中添加指定数量的某 tileId
 * @param {Object} countMap - tileId -> count
 * @param {number} tileId
 * @param {number} count
 */
function countMapAdd(countMap, tileId, count) {
  if (!countMap[tileId]) countMap[tileId] = 0;
  countMap[tileId] += count;
}

/**
 * 递归拆牌核心算法
 * 从计数映射中穷举所有合法的3张组合方式
 *
 * @param {Object} countMap - tileId -> count 剩余牌计数
 * @param {Array} sortedTileIds - 所有出现过的 tileId 排序列表
 * @param {number} idx - 当前处理到的 tileId 索引
 * @returns {Array} 面子组列表的列表，每个面子组是 [tileId, tileId, tileId] 形式
 */
function decomposeGroups(countMap, sortedTileIds, idx) {
  // 找到下一个还有牌的 tileId
  while (idx < sortedTileIds.length && !countMap[sortedTileIds[idx]]) {
    idx++;
  }

  // 所有牌都用完，返回一个空解
  if (idx >= sortedTileIds.length) {
    return [[]];
  }

  var tid = sortedTileIds[idx];
  var info = getTileInfo(tid);
  var results = [];

  // 尝试刻子
  if (countMap[tid] >= 3) {
    countMapRemove(countMap, tid, 3);
    var subResults = decomposeGroups(countMap, sortedTileIds, idx);
    for (var i = 0; i < subResults.length; i++) {
      results.push([[tid, tid, tid]].concat(subResults[i]));
    }
    countMapAdd(countMap, tid, 3);
  }

  // 尝试顺子（只有非老将非喜的数牌才能组顺子）
  if (!isLaojiang(tid) && info.category !== CATEGORY.XI && info.suit !== SUIT.HONOR) {
    var rank = info.rank;
    // 只有 rank <= 7 才可能作为顺子的第一张
    if (rank <= 7) {
      var tid2 = tid + 1;
      var tid3 = tid + 2;
      // 确保同花色（连续的 tileId 在同一花色内）
      var info2 = getTileInfo(tid2);
      var info3 = getTileInfo(tid3);
      if (info2.suit === info.suit && info3.suit === info.suit &&
          info2.rank === rank + 1 && info3.rank === rank + 2 &&
          countMap[tid] >= 1 && countMap[tid2] >= 1 && countMap[tid3] >= 1) {
        countMapRemove(countMap, tid, 1);
        countMapRemove(countMap, tid2, 1);
        countMapRemove(countMap, tid3, 1);
        var subResults2 = decomposeGroups(countMap, sortedTileIds, idx);
        for (var j = 0; j < subResults2.length; j++) {
          results.push([[tid, tid2, tid3]].concat(subResults2[j]));
        }
        countMapAdd(countMap, tid, 1);
        countMapAdd(countMap, tid2, 1);
        countMapAdd(countMap, tid3, 1);
      }
    }
  }

  return results;
}

/**
 * 拆牌（核心算法）
 * 穷举所有合法拆法：选一个对子作为将头，剩余牌拆为面子组
 *
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Object|null} drawn - 刚摸的牌实例（可能为null）
 * @returns {Array} DecomposeResult 数组
 *   DecomposeResult = {
 *     pair: TileInstance,
 *     shunzi: TileInstance[][],
 *     kezi: TileInstance[][],
 *   }
 */
function decompose(holding, drawn) {
  // 合并所有暗牌
  var tiles = holding.slice();
  if (drawn) {
    tiles.push(drawn);
  }

  // 牌总数必须是 3n+2 的形式才能拆
  var total = tiles.length;
  if (total < 2 || (total - 2) % 3 !== 0) {
    return [];
  }

  // 构建计数映射
  var countMap = buildCountMap(tiles);

  // 获取所有出现过的 tileId 并排序
  var allTileIds = Object.keys(countMap).map(Number).sort(function (a, b) { return a - b; });

  // 构建牌实例池（tileId -> 实例列表），用于生成结果中的实例引用
  var instancePool = {};
  for (var i = 0; i < tiles.length; i++) {
    var tid = tiles[i].tileId;
    if (!instancePool[tid]) instancePool[tid] = [];
    instancePool[tid].push(tiles[i]);
  }

  var results = [];

  // 遍历所有可能的将头（对子）
  var pairTileIds = Object.keys(countMap).map(Number);
  for (var p = 0; p < pairTileIds.length; p++) {
    var pairTid = pairTileIds[p];
    if (countMap[pairTid] < 2) continue;

    // 取出对子
    countMapRemove(countMap, pairTid, 2);

    // 递归拆分剩余牌
    var groupResults = decomposeGroups(countMap, allTileIds, 0);

    // 恢复对子
    countMapAdd(countMap, pairTid, 2);

    // 将每种拆法转为 DecomposeResult
    for (var g = 0; g < groupResults.length; g++) {
      var groups = groupResults[g];
      var shunziList = [];
      var keziList = [];

      // 为每个 tileId 建立可用实例索引（扣掉对子用的2张）
      var poolIdx = {};
      var poolKeys = Object.keys(instancePool);
      for (var pk = 0; pk < poolKeys.length; pk++) {
        var poolTid = Number(poolKeys[pk]);
        if (poolTid === pairTid) {
          poolIdx[poolTid] = 2; // 对子用了前2张
        } else {
          poolIdx[poolTid] = 0;
        }
      }

      for (var gi = 0; gi < groups.length; gi++) {
        var group = groups[gi];
        if (group[0] === group[1] && group[1] === group[2]) {
          var tid0 = group[0];
          var idx0 = poolIdx[tid0] || 0;
          keziList.push([instancePool[tid0][idx0], instancePool[tid0][idx0 + 1], instancePool[tid0][idx0 + 2]]);
          poolIdx[tid0] = idx0 + 3;
        } else {
          var st0 = group[0], st1 = group[1], st2 = group[2];
          var si0 = poolIdx[st0] || 0;
          var si1 = poolIdx[st1] || 0;
          var si2 = poolIdx[st2] || 0;
          shunziList.push([instancePool[st0][si0], instancePool[st1][si1], instancePool[st2][si2]]);
          poolIdx[st0] = si0 + 1;
          poolIdx[st1] = si1 + 1;
          poolIdx[st2] = si2 + 1;
        }
      }

      results.push({
        pair: instancePool[pairTid][0],
        shunzi: shunziList,
        kezi: keziList,
      });
    }
  }

  return results;
}

// ---- 胡牌判定 ----

/**
 * 判断是否可胡
 * melds 中已有碰/杠/撂龙，这些面子固定不可拆
 * 需要检查 holding + drawn 能否和 melds 中的面子组成合法结构
 *
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Array} melds - 已有的面子列表，每个 meld 是 { type: 'peng'|'gang'|'long', tiles: TileInstance[] }
 * @param {Object|null} drawn - 刚摸的牌实例
 * @returns {boolean}
 */
function canHu(holding, melds, drawn) {
  if (!melds) melds = [];

  var tiles = holding.slice();
  if (drawn) {
    tiles.push(drawn);
  }

  var meldTileCount = 0;
  var gangCount = 0;
  for (var i = 0; i < melds.length; i++) {
    // 报牌仍留在手牌中，不计入面子牌数
    if (melds[i].type === 'bao') continue;
    meldTileCount += melds[i].tiles.length;
    // 杠比碰多1张牌，每杠一次总数+1
    if (melds[i].type === 'gang') gangCount++;
  }

  var totalCount = tiles.length + meldTileCount;
  // 总数必须是 23 + 杠数（每杠一次总牌数+1）
  if (totalCount !== 23 + gangCount) return false;

  // 暗牌总数必须是 3n+2
  var hiddenCount = tiles.length;
  if (hiddenCount < 2 || (hiddenCount - 2) % 3 !== 0) return false;

  var results = decompose(holding, drawn);
  return results.length > 0;
}

// ---- 胡牌分类 ----

/**
 * 胡牌类型分类
 *
 * 分类规则：
 * - 清胡：所有面子（暗牌拆出的 + melds中的）全部是顺子
 * - 飘胡：所有面子全部是刻子/杠
 * - 塌子胡：混合顺子和刻子/杠
 * - 闷荤：飘胡的特殊自摸情形
 *
 * @param {Object} decomposeResult - 拆牌结果 { pair, shunzi, kezi }
 * @param {Array} melds - 已有的面子列表
 * @param {boolean} isSelfDrawn - 是否自摸
 * @param {string} mode - 'single' | 'double'
 * @returns {string} HU_TYPE 中的值
 */
function classifyHu(decomposeResult, melds, isSelfDrawn, mode) {
  if (!melds) melds = [];

  var hasShunzi = decomposeResult.shunzi.length > 0;
  var hasKezi = decomposeResult.kezi.length > 0;

  // 检查 melds 中是否有顺子或刻子/杠
  for (var i = 0; i < melds.length; i++) {
    var meld = melds[i];
    if (meld.type === 'bao') continue;
    if (meld.type === 'long') {
      // 撂龙是顺子
      hasShunzi = true;
    } else if (meld.type === 'peng' || meld.type === 'gang') {
      // 碰和杠是刻子类
      hasKezi = true;
    }
  }

  var huType;

  if (hasShunzi && !hasKezi) {
    huType = HU_TYPE.QINGHU;
  } else if (!hasShunzi && hasKezi) {
    huType = HU_TYPE.PIAOHU;
  } else {
    huType = HU_TYPE.TAHU;
  }

  // 检查闷荤条件（飘胡 + 自摸的特殊情况）
  if (huType === HU_TYPE.PIAOHU && isSelfDrawn) {
    // 闷荤（单将）：飘胡+自摸+只有杠
    // 闷荤（双将）：飘胡+自摸+无碰（全部自摸的飘胡）
    // 两种闷荤都归为 MENHUN 类型
    var hasPeng = false;
    var hasGang = false;

    for (var j = 0; j < melds.length; j++) {
      if (melds[j].type === 'peng') hasPeng = true;
      if (melds[j].type === 'gang') hasGang = true;
    }

    // 单将闷荤：只有杠没有碰
    if (hasGang && !hasPeng && decomposeResult.kezi.length > 0) {
      huType = HU_TYPE.MENHUN;
    }

    // 双将闷荤：无碰（全部自摸的飘胡）
    if (!hasPeng && melds.length === 0) {
      huType = HU_TYPE.MENHUN;
    }
  }

  return huType;
}

// ---- 听牌检测 ----

/**
 * 听牌检测
 * 返回所有听了的牌的 tileId
 *
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Array} melds - 已有的面子列表
 * @param {Object} jiangMap - 将牌映射表
 * @returns {number[]} 听牌的 tileId 列表
 */
function detectTing(holding, melds, jiangMap) {
  if (!melds) melds = [];

  var meldTileCount = 0;
  var gangCount = 0;
  for (var i = 0; i < melds.length; i++) {
    if (melds[i].type === 'bao') continue;
    meldTileCount += melds[i].tiles.length;
    if (melds[i].type === 'gang') gangCount++;
  }

  var hiddenCount = holding.length;
  // 暗牌+1张+melds = 23 + 杠数
  // hiddenCount + 1 + meldTileCount = 23 + gangCount
  // hiddenCount + meldTileCount = 22 + gangCount
  if (hiddenCount + meldTileCount !== 22 + gangCount) {
    return [];
  }

  // 构建手牌计数映射（用于快速排除不可能的牌）
  var holdingCount = buildCountMap(holding);

  // 候选牌：所有可能被摸到的牌
  // 数牌 0-26，老将 27-29，九条 17（已在数牌中）
  // 喜牌不在候选范围内（喜牌只能通过撂龙放下，不能摸到后组入手牌结构）
  var candidateTileIds = [];
  for (var tid = 0; tid <= 29; tid++) {
    if (tid === 30) continue; // 跳过九条别名
    candidateTileIds.push(tid);
  }

  var tingList = [];

  for (var c = 0; c < candidateTileIds.length; c++) {
    var candTid = candidateTileIds[c];

    // 检查是否还有剩余张数（最多4张，减去手中和melds中的）
    var usedCount = holdingCount[candTid] || 0;
    for (var m = 0; m < melds.length; m++) {
      if (melds[m].type === 'bao') continue;
      for (var t = 0; t < melds[m].tiles.length; t++) {
        if (melds[m].tiles[t].tileId === candTid) {
          usedCount++;
        }
      }
    }
    // 每种牌最多4张（数牌和老将），如果有4张在用则不可能再摸到
    if (usedCount >= 4) continue;

    // 创建一个虚拟的 drawn 牌来测试
    var fakeDrawn = { id: candTid + '-fake', tileId: candTid, suit: getTileInfo(candTid).suit, rank: getTileInfo(candTid).rank, category: getTileInfo(candTid).category };
    if (canHu(holding, melds, fakeDrawn)) {
      tingList.push(candTid);
    }
  }

  return tingList;
}

// ---- 导出 ----

module.exports = {
  sortHolding: sortHolding,
  decompose: decompose,
  canHu: canHu,
  classifyHu: classifyHu,
  detectTing: detectTing,

  // 辅助函数（供测试使用）
  isShunzi: isShunzi,
  isKezi: isKezi,
  buildCountMap: buildCountMap,
};
