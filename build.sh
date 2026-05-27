#!/bin/bash
# 构建服务端 Docker 镜像
# 1. 同步客户端引擎模块到 server/client/
# 2. 编译 TypeScript
# 3. 构建 Docker 镜像

set -e
cd "$(dirname "$0")"

# 检查是否在项目根目录（有 engine/ 等目录）
PROJECT_ROOT="$(cd .. && pwd)"

if [ -d "$PROJECT_ROOT/engine" ]; then
  echo "同步客户端引擎模块..."
  rm -rf client
  mkdir -p client/engine client/ai client/core client/utils

  cp "$PROJECT_ROOT/engine/game.js" client/engine/
  cp "$PROJECT_ROOT/engine/player.js" client/engine/
  cp "$PROJECT_ROOT/engine/state.js" client/engine/
  cp "$PROJECT_ROOT/engine/action.js" client/engine/
  cp "$PROJECT_ROOT/ai/strategy.js" client/ai/
  cp "$PROJECT_ROOT/ai/evaluator.js" client/ai/
  cp "$PROJECT_ROOT/core/tile.js" client/core/
  cp "$PROJECT_ROOT/core/deck.js" client/core/
  cp "$PROJECT_ROOT/core/general.js" client/core/
  cp "$PROJECT_ROOT/core/hand.js" client/core/
  cp "$PROJECT_ROOT/core/rules.js" client/core/
  cp "$PROJECT_ROOT/core/scorer.js" client/core/
  cp "$PROJECT_ROOT/utils/constants.js" client/utils/

  echo "已同步 13 个客户端模块到 client/"
else
  echo "未找到项目根目录的 engine/，跳过同步（client/ 应已包含引擎文件）"
fi

echo "检查 client/engine/game.js..."
if [ ! -f "client/engine/game.js" ]; then
  echo "错误: client/engine/game.js 不存在！"
  echo "请先运行 build.sh 从项目根目录同步，或确保 client/ 目录已包含引擎文件。"
  exit 1
fi

# 编译 TypeScript
npx tsc
echo "TypeScript 编译完成"

# 构建 Docker 镜像（可选）
if [ "$1" = "--docker" ]; then
  docker build -t nt-cp-server:latest .
  echo "Docker 镜像构建完成: nt-cp-server:latest"
fi

echo ""
echo "构建完成。"
echo "  本地运行: npm run dev"
echo "  Docker:   ./build.sh --docker"
