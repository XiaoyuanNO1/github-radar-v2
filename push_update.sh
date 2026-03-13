#!/bin/bash
# ===== GitHub AI 雷达 · 自动推送脚本 =====
# 每日雷达任务完成后调用此脚本，自动将最新数据推送到 GitHub Pages

set -e

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

echo "📡 [$(date '+%Y-%m-%d %H:%M:%S')] 开始推送雷达数据..."

# 检查是否有变更
if git diff --quiet radar_history.json 2>/dev/null; then
  echo "ℹ️  radar_history.json 无变更，跳过推送"
  exit 0
fi

# 获取今日日期和新增项目数
TODAY=$(date '+%Y-%m-%d')
NEW_COUNT=$(python3 -c "
import json
with open('radar_history.json') as f:
    data = json.load(f)
today = [p for p in data if p['date'] == '${TODAY}']
print(len(today))
" 2>/dev/null || echo "?")

# 提交并推送
git add radar_history.json
git commit -m "🤖 每日雷达更新 ${TODAY}：新增 ${NEW_COUNT} 个项目"
git push origin main

echo "✅ [$(date '+%Y-%m-%d %H:%M:%S')] 推送成功！新增 ${NEW_COUNT} 个项目已上线"
echo "🌐 预览地址：https://xiaoyuanno1.github.io/github-radar-site/"
