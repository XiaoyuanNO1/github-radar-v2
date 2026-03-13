# GitHub AI 雷达

每日自动扫描 GitHub Python 趋势榜，从 VC 视角深度分析，筛选最具 Vibecoding 变现潜力的项目。

## 🌐 在线访问

部署后通过 GitHub Pages 访问：`https://<your-username>.github.io/<repo-name>/`

## 📁 文件结构

```
├── index.html          # 主页面
├── style.css           # 样式
├── app.js              # 前端逻辑
└── radar_history.json  # 数据文件（由每日任务自动更新）
```

## 🚀 部署到 GitHub Pages

1. 在 GitHub 创建新仓库（如 `github-radar`）
2. 将本目录所有文件上传到仓库
3. 进入仓库 **Settings → Pages**
4. Source 选择 `main` 分支 / `root` 目录
5. 保存后等待约 1 分钟即可通过外部链接访问

## 🔄 数据更新

每日任务运行后，将新的 `radar_history.json` 推送到仓库，页面自动展示最新数据。
