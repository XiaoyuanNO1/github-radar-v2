#!/bin/bash
# ===== GitHub AI 雷达 v2 · 每日完整更新脚本 =====
# 1. 抓取 GitHub Trending + AI 评分
# 2. 抓取 Reddit 三大子版块 + AI 分析
# 3. 推送数据到 GitHub Pages

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "🚀 [$(date '+%Y-%m-%d %H:%M:%S')] GitHub AI 雷达 v2 每日更新开始..."

# 安装依赖（如果需要）
if ! python3 -c "import requests, bs4" 2>/dev/null; then
  echo "📦 安装依赖..."
  pip3 install requests beautifulsoup4 -q
fi

# 执行 GitHub 抓取和评分
echo "📡 [1/2] 开始抓取 GitHub Trending..."
python3 "${REPO_DIR}/fetch_and_score.py"

# 执行 Reddit 抓取和分析
echo "👾 [2/2] 开始抓取 Reddit 黑马榜..."
python3 "${REPO_DIR}/fetch_reddit.py"

# 配置 git
git config user.email "radar-bot@github.com"
git config user.name "GitHub Radar Bot"

# 检查是否有变更
CHANGED=0
git diff --quiet radar_history.json 2>/dev/null || CHANGED=1
git diff --quiet reddit_history.json 2>/dev/null || CHANGED=1

if [ "$CHANGED" -eq 0 ]; then
  echo "ℹ️  数据文件无变更，跳过推送"
  exit 0
fi

# 获取今日日期和新增项目数
TODAY=$(date '+%Y-%m-%d')
GITHUB_COUNT=$(python3 -c "
import json
with open('radar_history.json') as f:
    data = json.load(f)
today = [p for p in data if p['date'] == '${TODAY}']
print(len(today))
" 2>/dev/null || echo "?")

REDDIT_COUNT=$(python3 -c "
import json
with open('reddit_history.json') as f:
    data = json.load(f)
today = [p for p in data if p['date'] == '${TODAY}']
print(len(today))
" 2>/dev/null || echo "?")

# 提交并推送
git add radar_history.json reddit_history.json
git commit -m "🤖 每日雷达更新 ${TODAY}：GitHub ${GITHUB_COUNT} 个 + Reddit ${REDDIT_COUNT} 条"

# 使用 token 推送（从环境变量读取）
PUSH_TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$PUSH_TOKEN" ]; then
  echo "❌ 未设置 GITHUB_TOKEN 环境变量，无法推送"
  exit 1
fi
git push "https://${PUSH_TOKEN}@github.com/XiaoyuanNO1/github-radar-v2.git" main

echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] 推送成功！GitHub ${GITHUB_COUNT} 个 + Reddit ${REDDIT_COUNT} 条已上线"
echo "🌐 预览地址：https://xiaoyuanno1.github.io/github-radar-v2/"
