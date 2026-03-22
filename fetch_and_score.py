#!/usr/bin/env python3
# ===== GitHub AI 雷达 · 数据抓取 + AI 评分脚本 =====
# 每日北京时间 07:00 执行，抓取 GitHub Trending 并用 AI 评分

import json
import os
import re
import time
import uuid
import datetime
import requests
from bs4 import BeautifulSoup

# ===== 配置 =====
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

DATA_FILE = os.path.join(os.path.dirname(__file__), "radar_history.json")
TODAY = datetime.date.today().strftime("%Y-%m-%d")

# 抓取语言列表（多语言扫描）
TRENDING_LANGS = ["python", "javascript", "typescript", "go"]
MAX_PER_LANG = 10  # 每种语言取前10

# ===== 评分提示词 =====
SCORE_PROMPT = """你是一位专注于 Vibecoding 副业变现的 VC 分析师。
请从以下4个维度对 GitHub 项目进行评分，总分 10 分：

1. **vibecoding_ease**（0-3）：用 Cursor/Claude 能多快复刻 MVP
   - 3分：纯 UI/配置/文档类，1天内可复刻
   - 2分：有一定逻辑，1周内可复刻
   - 1分：需要算法/模型，较难复刻
   - 0分：高度专业化，非 AI 辅助几乎无法复刻

2. **logic_moat**（0-3）：业务逻辑/技术壁垒深度
   - 3分：有深度算法、专有数据或独特工程
   - 2分：有一定壁垒但可被替代
   - 1分：逻辑简单，同质化严重
   - 0分：无任何壁垒

3. **track_fit**（0-2）：是否命中高潜力赛道（宠物经济/银发经济/玄学命理/个人金融/K12教育）
   - 2分：强烈命中其中一个赛道
   - 1分：部分相关或可延伸
   - 0分：完全不相关

4. **growth_potential**（0-2）：传播潜力和副业变现路径
   - 2分：有明确的付费场景、社交传播性强
   - 1分：有一定变现路径但不明显
   - 0分：纯工具/基础设施，难以直接变现

请返回 JSON 格式（只返回 JSON，不要其他文字）：
{
  "scores": {
    "vibecoding_ease": <0-3>,
    "logic_moat": <0-3>,
    "track_fit": <0-2>,
    "growth_potential": <0-2>,
    "total": <总分>
  },
  "score_reasons": {
    "vibecoding_ease": "<一句话说明>",
    "logic_moat": "<一句话说明>",
    "track_fit": "<一句话说明>",
    "growth_potential": "<一句话说明>"
  },
  "description": "<用中文写项目简介，要求：①说清楚这是什么团队/背景出品（如有知名背景必须提）②核心功能是什么③支持哪些关键特性④有什么独特价值。参考示例：'微软 AutoGen 团队出品的全格式文档转 Markdown 神器，91K Star 的顶流工具。支持 PDF、Word、Excel、PPT、图片、音频（自动语音转录）、HTML、YouTube 视频字幕等几乎所有格式一键转换，并内置 MCP 服务器，可直接接入任何 AI Agent 工作流。是构建企业级文档 AI 处理流水线的最强基础组件。' 字数100-200字，要有信息量，不要废话>",
  "metaphor": "<用一个生动形象的中文比喻解释这个项目的本质价值，要求：①有具体的比喻对象②解释清楚它解决了什么问题③说明为什么这个比喻贴切。参考示例：'它是 AI 世界的「万能翻译插头」——无论你拿来的是 PDF、PPT 还是一段 YouTube 视频，plugging in 就能输出整洁的 Markdown，让下游的 LLM 读得懂、用得上，彻底打通「人类文档」和「AI 理解」之间的最后一公里。' 字数60-120字，要生动有画面感>",
  "is_top": <true/false，总分>=8且vibecoding_ease>=2则为true>
}

项目信息：
名称：{name}
原始描述：{raw_desc}
语言：{language}
Stars：{stars}
"""


def fetch_trending(lang="python", since="daily"):
    """抓取 GitHub Trending 页面"""
    url = f"https://github.com/trending/{lang}?since={since}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"  ⚠️ 抓取 {lang} trending 失败: {e}")
        return ""


def parse_trending(html, lang):
    """解析 Trending 页面，返回项目列表"""
    soup = BeautifulSoup(html, "html.parser")
    repos = []

    for idx, article in enumerate(soup.select("article.Box-row"), start=1):
        try:
            # 项目名
            h2 = article.select_one("h2.h3 a")
            if not h2:
                continue
            full_name = h2.get("href", "").strip("/")  # owner/repo
            if not full_name or "/" not in full_name:
                continue

            # 描述
            p = article.select_one("p")
            raw_desc = p.get_text(strip=True) if p else ""

            # Stars
            stars_el = article.select_one("a[href$='/stargazers']")
            stars_text = stars_el.get_text(strip=True) if stars_el else "0"
            stars = int(re.sub(r"[^\d]", "", stars_text) or "0")

            # 今日新增 Stars
            stars_today_el = article.select_one("span.d-inline-block.float-sm-right")
            stars_today_text = stars_today_el.get_text(strip=True) if stars_today_el else ""
            stars_today = int(re.sub(r"[^\d]", "", stars_today_text) or "0")

            # 编程语言
            lang_el = article.select_one("span[itemprop='programmingLanguage']")
            repo_lang = lang_el.get_text(strip=True) if lang_el else lang

            # Forks
            forks_el = article.select_one("a[href$='/forks']")
            forks_text = forks_el.get_text(strip=True) if forks_el else "0"
            forks = int(re.sub(r"[^\d]", "", forks_text) or "0")

            repos.append({
                "full_name": full_name,
                "url": f"https://github.com/{full_name}",
                "raw_description": raw_desc,
                "language": repo_lang,
                "stars": stars,
                "stars_today": stars_today,
                "forks": forks,
                "trending_rank": idx,
            })
        except Exception:
            continue

    return repos


def score_project_with_ai(project):
    """调用 AI 对项目评分"""
    if not OPENAI_API_KEY:
        # 无 API Key 时使用规则评分
        return rule_based_score(project)

    prompt = SCORE_PROMPT.format(
        name=project["full_name"],
        raw_desc=project["raw_description"] or "（无描述）",
        language=project["language"],
        stars=project["stars"],
    )

    try:
        resp = requests.post(
            f"{OPENAI_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": OPENAI_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 600,
            },
            timeout=30,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        # 提取 JSON
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            return json.loads(match.group())
    except Exception as e:
        print(f"  ⚠️ AI 评分失败 ({project['full_name']}): {e}")

    return rule_based_score(project)


def rule_based_score(project):
    """规则评分（无 AI 时的兜底方案）"""
    desc = (project.get("raw_description") or "").lower()
    name = project["full_name"].lower()
    stars = project.get("stars", 0)

    # Vibecoding 难度
    easy_keywords = ["dashboard", "ui", "template", "starter", "boilerplate", "portfolio", "blog", "landing"]
    hard_keywords = ["compiler", "kernel", "database", "ml", "llm", "model", "neural", "algorithm"]
    vibe = 2
    if any(k in desc or k in name for k in easy_keywords):
        vibe = 3
    elif any(k in desc or k in name for k in hard_keywords):
        vibe = 1

    # 逻辑护城河
    moat_keywords = ["proprietary", "patent", "unique", "novel", "research", "dataset"]
    moat = 2 if any(k in desc for k in moat_keywords) else 1

    # 赛道契合
    track_keywords = {
        "宠物": ["pet", "dog", "cat", "animal"],
        "银发": ["elder", "senior", "aging", "老人"],
        "玄学": ["astro", "tarot", "fortune", "zodiac", "horoscope"],
        "金融": ["finance", "invest", "stock", "crypto", "budget", "money"],
        "教育": ["learn", "education", "course", "study", "tutor", "school"],
    }
    track = 0
    for track_name, keywords in track_keywords.items():
        if any(k in desc or k in name for k in keywords):
            track = 2
            break

    # 增长潜力
    growth = 1
    if stars > 500:
        growth = 2
    elif stars < 50:
        growth = 0

    total = vibe + moat + track + growth

    return {
        "scores": {
            "vibecoding_ease": vibe,
            "logic_moat": moat,
            "track_fit": track,
            "growth_potential": growth,
            "total": total,
        },
        "score_reasons": {
            "vibecoding_ease": "基于项目名称和描述关键词判断",
            "logic_moat": "基于描述复杂度估算",
            "track_fit": "基于关键词匹配五大赛道",
            "growth_potential": f"基于 Stars 数量（{stars}）估算",
        },
        "description": project.get("raw_description", "") or "暂无描述",
        "metaphor": f"这是一个用 {project['language']} 构建的开源工具，专注于解决开发者日常工作中的效率问题",
        "is_top": total >= 8 and vibe >= 2,
    }


def load_existing_data():
    """加载已有数据"""
    if os.path.exists(DATA_FILE):
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_data(data):
    """保存数据"""
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main():
    print(f"\n📡 GitHub AI 雷达 v2 - {TODAY}")
    print("=" * 50)

    # 加载已有数据，用于去重
    existing = load_existing_data()
    existing_ids = {p["id"] for p in existing}
    existing_urls_today = {p["url"] for p in existing if p["date"] == TODAY}

    new_projects = []
    seen_urls = set(existing_urls_today)

    for lang in TRENDING_LANGS:
        print(f"\n🔍 抓取 {lang} Trending...")
        html = fetch_trending(lang)
        if not html:
            continue

        repos = parse_trending(html, lang)
        print(f"  找到 {len(repos)} 个项目，取前 {MAX_PER_LANG} 个")

        count = 0
        for repo in repos[:MAX_PER_LANG]:
            if repo["url"] in seen_urls:
                print(f"  ⏭️  跳过（已存在）: {repo['full_name']}")
                continue
            seen_urls.add(repo["url"])

            print(f"  🤖 评分中: {repo['full_name']} ⭐{repo['stars']}")
            result = score_project_with_ai(repo)

            project = {
                "id": str(uuid.uuid4())[:8],
                "date": TODAY,
                "fetched_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "title": repo["full_name"],
                "url": repo["url"],
                "raw_description": repo.get("raw_description", ""),
                "description": result.get("description", repo.get("raw_description", "")[:40]),
                "metaphor": result.get("metaphor", ""),
                "language": repo["language"],
                "stars": repo["stars"],
                "stars_today": repo.get("stars_today", 0),
                "forks": repo.get("forks", 0),
                "trending_rank": repo.get("trending_rank", 0),
                "scores": result.get("scores", {}),
                "score_reasons": result.get("score_reasons", {}),
                "is_top": result.get("is_top", False),
            }
            new_projects.append(project)
            count += 1

            # 避免 API 频率限制
            if OPENAI_API_KEY:
                time.sleep(1)

        print(f"  ✅ {lang}: 新增 {count} 个项目")

    if new_projects:
        all_data = existing + new_projects
        save_data(all_data)
        print(f"\n✅ 完成！今日新增 {len(new_projects)} 个项目，累计 {len(all_data)} 个")
    else:
        print(f"\nℹ️  今日无新增项目（可能已全部抓取）")

    return len(new_projects)


if __name__ == "__main__":
    main()
