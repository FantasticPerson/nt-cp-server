/**
 * 规则引擎模块
 *
 * 南通长牌的碰/杠/胡合法性检查、撂龙条件判定、出牌后响应优先级。
 * 所有判定函数只关心牌的合法性，不关心游戏状态流转。
 */

const { MODE } = require('../utils/constants');
const { canHu } = require('./hand');

// ---- 辅助函数 ----

/**
 * 构建 tileId -> 实例列表 的映射
 * @param {Array} tiles - 牌实例数组
 * @returns {Object} tileId -> TileInstance[]
 */
function buildInstanceMap(tiles) {
  var map = {};
  for (var i = 0; i < tiles.length; i++) {
    var tid = tiles[i].tileId;
    if (!map[tid]) map[tid] = [];
    map[tid].push(tiles[i]);
  }
  return map;
}

/**
 * 构建 tileId -> 数量 的映射
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

// ---- 碰判定 ----

/**
 * 碰判定：手中有2张以上相同牌，别人打出该牌
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Object} tile - 别人打出的牌实例
 * @returns {boolean}
 */
function canPeng(holding, tile) {
  var count = 0;
  for (var i = 0; i < holding.length; i++) {
    if (holding[i].tileId === tile.tileId) {
      count++;
    }
  }
  return count >= 2;
}

// ---- 明杠判定 ----

/**
 * 明杠判定：手中有3张相同牌，别人打出第4张
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Object} tile - 别人打出的牌实例
 * @returns {boolean}
 */
function canMingGang(holding, tile) {
  var count = 0;
  for (var i = 0; i < holding.length; i++) {
    if (holding[i].tileId === tile.tileId) {
      count++;
    }
  }
  return count >= 3;
}

// ---- 暗杠判定 ----

/**
 * 暗杠判定：手中有4张相同牌，或翻将3张（自己摸牌后）
 * 翻将（本局翻出的将牌）3张即可暗杠，其他牌需4张。
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Object} [jiangMap] - 将牌映射表（tileId → { isJiang, jiangType }）
 * @returns {number[]} 可暗杠的 tileId 列表
 */
function canAnGang(holding, jiangMap) {
  var countMap = buildCountMap(holding);
  var result = [];
  var keys = Object.keys(countMap);
  for (var i = 0; i < keys.length; i++) {
    var tid = Number(keys[i]);
    var count = countMap[tid];
    var jiangInfo = jiangMap && jiangMap[tid];
    // 只有翻将（fanjiang / fanjiang_lao / fanjiang_double_same_lao 等）3张可杠
    var isFanjiang = jiangInfo && jiangInfo.jiangType && jiangInfo.jiangType.indexOf('fanjiang') === 0;
    if (count >= 4 || (isFanjiang && count >= 3)) {
      result.push(tid);
    }
  }
  return result;
}

// ---- 补杠判定 ----

/**
 * 补杠判定：已碰的基础上摸到第4张
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Array} melds - 已有的面子列表
 * @returns {number[]} 可补杠的 tileId 列表
 */
function canBuGang(holding, melds) {
  if (!melds) melds = [];

  // 找出所有碰过的 tileId
  var pengTileIds = {};
  for (var i = 0; i < melds.length; i++) {
    if (melds[i].type === 'peng') {
      var tiles = melds[i].tiles;
      if (tiles.length > 0) {
        pengTileIds[tiles[0].tileId] = true;
      }
    }
  }

  // 检查手中是否有碰过的牌类型的牌
  var result = [];
  var holdingCount = buildCountMap(holding);
  var pengKeys = Object.keys(pengTileIds);
  for (var j = 0; j < pengKeys.length; j++) {
    var tid = Number(pengKeys[j]);
    if (holdingCount[tid] && holdingCount[tid] >= 1) {
      result.push(tid);
    }
  }

  return result;
}

// ---- 胡判定 ----

/**
 * 点炮判定：别人打出的牌让自己可胡
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Array} melds - 已有的面子列表
 * @param {Object} tile - 别人打出的牌实例
 * @returns {boolean}
 */
function canDianPao(holding, melds, tile) {
  return canHu(holding, melds, tile);
}

/**
 * 自摸判定：自己摸到的牌让自己可胡
 * @param {Array} holding - 手中暗牌实例数组（不含摸到的牌）
 * @param {Array} melds - 已有的面子列表
 * @param {Object} drawn - 摸到的牌实例
 * @returns {boolean}
 */
function canZiMo(holding, melds, drawn) {
  return canHu(holding, melds, drawn);
}

// ---- 撂龙条件检查 ----

/**
 * 撂龙条件检查
 * 返回可报的撂龙选项
 *
 * @param {Array} holding - 起手暗牌实例数组
 * @param {number|number[]} fanJiang - 翻将 tileId（单将为 number，双将为 number[]）
 * @param {string} mode - MODE.SINGLE 或 MODE.DOUBLE
 * @returns {LiaolongOption[]} 可报的撂龙选项
 *   LiaolongOption = { type: '1111'|'111'|'11', tileId: number, tiles: TileInstance[] }
 */
function checkLiaolong(holding, fanJiang, mode) {
  var options = [];
  var instanceMap = buildInstanceMap(holding);

  // ---- 1111型：起手有4张相同的牌（两种模式都有） ----
  var instanceKeys = Object.keys(instanceMap);
  for (var i = 0; i < instanceKeys.length; i++) {
    var tid = Number(instanceKeys[i]);
    if (instanceMap[tid].length >= 4) {
      options.push({
        type: '1111',
        tileId: tid,
        tiles: instanceMap[tid].slice(0, 4),
      });
    }
  }

  // ---- 111型：手中有3张翻将牌 ----
  if (mode === MODE.SINGLE) {
    // 单将模式：翻将是单个 number
    var fanTid = fanJiang;
    if (instanceMap[fanTid] && instanceMap[fanTid].length >= 3) {
      options.push({
        type: '111',
        tileId: fanTid,
        tiles: instanceMap[fanTid].slice(0, 3),
      });
    }
  } else {
    // 双将模式：翻将是 number[]
    // 两张翻将牌分别检查
    for (var fi = 0; fi < fanJiang.length; fi++) {
      var ftid = fanJiang[fi];
      if (instanceMap[ftid] && instanceMap[ftid].length >= 3) {
        // 避免重复（两张翻将可能是同一个 tileId）
        var alreadyAdded = false;
        for (var oi = 0; oi < options.length; oi++) {
          if (options[oi].type === '111' && options[oi].tileId === ftid) {
            alreadyAdded = true;
            break;
          }
        }
        if (!alreadyAdded) {
          options.push({
            type: '111',
            tileId: ftid,
            tiles: instanceMap[ftid].slice(0, 3),
          });
        }
      }
    }

    // ---- 11型（仅双将模式）：翻将必须打在同一张牌中，且起手有2张该翻将牌 ----
    if (fanJiang.length === 2 && fanJiang[0] === fanJiang[1]) {
      // 两张翻将相同
      var sameTid = fanJiang[0];
      if (instanceMap[sameTid] && instanceMap[sameTid].length >= 2) {
        // 避免与111型重复：11型只要求2张，如果已有111型（3张），11型也允许报
        options.push({
          type: '11',
          tileId: sameTid,
          tiles: instanceMap[sameTid].slice(0, 2),
        });
      }
    }
  }

  return options;
}

// ---- 综合响应检查 ----

/**
 * 综合响应检查（出牌后调用）
 *
 * @param {Array} holding - 手中暗牌实例数组
 * @param {Array} melds - 已有的面子列表
 * @param {Object} tile - 出的牌实例
 * @param {boolean} isSelfTurn - 是否自己回合（摸牌后）
 * @returns {RespondOption[]} 按优先级排序的响应选项
 *   RespondOption = { type: 'hu'|'gang'|'peng', tile: TileInstance }
 */
function checkResponds(holding, melds, tile, isSelfTurn) {
  if (!melds) melds = [];
  var results = [];

  if (isSelfTurn) {
    // 自己回合：只检查暗杠、补杠、自摸
    // 暗杠
    var anGangIds = canAnGang(holding);
    for (var i = 0; i < anGangIds.length; i++) {
      results.push({ type: 'gang', tile: null, subType: 'an', tileId: anGangIds[i] });
    }

    // 补杠
    var buGangIds = canBuGang(holding, melds);
    for (var j = 0; j < buGangIds.length; j++) {
      results.push({ type: 'gang', tile: null, subType: 'bu', tileId: buGangIds[j] });
    }

    // 自摸胡
    if (canZiMo(holding, melds, tile)) {
      results.push({ type: 'hu', tile: tile });
    }

    // 胡优先：把 hu 排到最前
    results.sort(function (a, b) {
      if (a.type === 'hu' && b.type !== 'hu') return -1;
      if (a.type !== 'hu' && b.type === 'hu') return 1;
      return 0;
    });

    return results;
  }

  // 别人出牌：检查胡、明杠、碰（按优先级排序）
  // 1. 胡
  if (canDianPao(holding, melds, tile)) {
    results.push({ type: 'hu', tile: tile });
  }

  // 2. 明杠
  if (canMingGang(holding, tile)) {
    results.push({ type: 'gang', tile: tile, subType: 'ming' });
  }

  // 3. 碰（注意：已碰过的牌不能再碰，但可以杠。但明杠已经检查过了，这里的碰需要排除已有3张的情况）
  //    实际上如果有3张，应该杠（优先级更高），但碰的判定依然成立。
  //    按照规格，碰只要求2张，所以如果已满足杠的条件，碰选项也会存在，但杠在前面。
  if (canPeng(holding, tile)) {
    results.push({ type: 'peng', tile: tile });
  }

  return results;
}

// ---- 导出 ----

module.exports = {
  canPeng: canPeng,
  canMingGang: canMingGang,
  canAnGang: canAnGang,
  canBuGang: canBuGang,
  canDianPao: canDianPao,
  canZiMo: canZiMo,
  checkLiaolong: checkLiaolong,
  checkResponds: checkResponds,
};
