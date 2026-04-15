#!/usr/bin/env python3
# ===== Reddit 黑马榜 · 数据抓取 + AI 分析脚本 =====
# 每日北京时间 07:00 执行，抓取 Reddit 三个子版块并用 AI 分析

import json
import os
import re
import sys
import time
import uuid
import datetime
import subprocess
import requests

# ===== 配置 =====
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

DATA_FILE = os.path.join(os.path.dirname(__file__), "reddit_history.json")
TODAY = datetime.date.today().strftime("%Y-%m-%d")

# Reddit 子版块配置
SUBREDDITS = [
    {"name": "SomebodyMakeThis", "sort": "best",   "label": "SomebodyMakeThis"},
    {"name": "AppIdeas",         "sort": "rising", "label": "AppIdeas"},
    {"name": "Startup_Ideas",    "sort": "rising", "label": "Startup_Ideas"},
]
MAX_PER_SUBREDDIT = 20  # 每个子版块取前20条

# Reddit RSS 脚本路径（使用已安装的 reddit-reader skill）
REDDIT_SCRIPT = os.path.join(
    os.path.dirname(__file__), "..", ".agent", "skills", "reddit-reader", "scripts", "reddit-rss.py"
)
if not os.path.exists(REDDIT_SCRIPT):
    REDDIT_SCRIPT = "/data/workspace/.agent/skills/reddit-reader/scripts/reddit-rss.py"

# ===== AI 分析提示词（含翻译 + 四维评分 + 观点结论）=====
ANALYZE_PROMPT = """你是一位专注于产品机会挖掘的 VC 分析师，擅长从 Reddit 社区需求帖中发现真实的市场机会。

请对以下 Reddit 帖子（含评论）进行深度分析，**全部用中文输出**。

请返回 JSON 格式（只返回 JSON，不要其他文字）：
{{
  "title_zh": "<将帖子标题翻译为中文，保留原意，20字以内>",
  "content_zh": "<将帖子正文翻译为中文，如无正文则写「作者未填写正文」，100-200字>",
  "comments_summary": "<用2-3句话总结评论区的主要观点：①社区对这个想法的态度（支持/质疑/补充）②有没有人提到竞品或已有解决方案③有没有特别有价值的补充建议。如无评论则写「暂无评论数据」，80-120字>",
  "summary": "<用2-3句话概括这个帖子的核心诉求：①作者遇到了什么问题/想要什么 ②为什么这个需求有价值 ③目前市场上是否有解决方案，100-150字>",
  "opportunity": "<从产品/创业视角分析市场机会：①目标用户群体 ②潜在变现路径 ③竞争格局简析，100-150字>",
  "scores": {{
    "vibecoding": <1-3分，用 AI/vibe coding 实现这个需求的难易度：1=需要复杂技术栈，3=用 AI 工具几天内可完成原型>,
    "moat": <1-3分，这个产品方向的逻辑护城河：1=极易被复制，3=有数据/网络效应/独特算法壁垒>,
    "track_fit": <1-2分，赛道契合度：1=普通赛道，2=AI/SaaS/消费互联网等热门赛道>,
    "growth": <1-2分，增长潜力：1=小众需求，2=百万级以上潜在用户>
  }},
  "verdict": "<【最重要的字段】给出你的明确观点：这个需求是否值得关注/动手做？理由是什么？要有立场，不要模棱两可。参考格式：「✅ 值得关注：...」或「⚠️ 谨慎观望：...」或「❌ 不建议：...」，60-100字>",
  "tags": ["<标签1>", "<标签2>", "<标签3>"],
  "heat_score": <1-5的热度评分，综合需求普遍性、评论活跃度和市场规模打分>,
  "heat_reason": "<一句话说明热度评分理由>"
}}

帖子信息：
标题：{title}
正文：{content}
子版块：r/{subreddit}
发布时间：{published}

评论区摘要（前5条）：
{comments}
"""


def fetch_reddit_posts(subreddit, sort, limit=25):
    """通过 reddit-rss.py 脚本抓取 Reddit 帖子"""
    try:
        result = subprocess.run(
            [
                "python3", REDDIT_SCRIPT,
                "posts", subreddit,
                "--sort", sort,
                "--limit", str(limit),
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            print(f"  ⚠️ 抓取 r/{subreddit} 失败: {result.stderr[:200]}")
            return []

        data = json.loads(result.stdout)
        if not data.get("ok"):
            print(f"  ⚠️ r/{subreddit} 返回错误: {data.get('error', {}).get('message', '未知错误')}")
            return []

        return data["data"]["posts"]
    except subprocess.TimeoutExpired:
        print(f"  ⚠️ 抓取 r/{subreddit} 超时")
        return []
    except Exception as e:
        print(f"  ⚠️ 抓取 r/{subreddit} 异常: {e}")
        return []


def fetch_comments(permalink):
    """抓取帖子评论，返回前5条评论的文本摘要"""
    try:
        result = subprocess.run(
            [
                "python3", REDDIT_SCRIPT,
                "comments", permalink,
                "--max-chars", "1500",
            ],
            capture_output=True,
            text=True,
            timeout=45,
        )
        if result.returncode != 0:
            return ""

        data = json.loads(result.stdout)
        if not data.get("ok"):
            return ""

        comments = data.get("data", {}).get("comments", [])
        if not comments:
            return "（无评论）"

        # 取前5条，每条截取150字（评论字段为 content_snippet）
        snippets = []
        for c in comments[:5]:
            body = (c.get("content_snippet") or c.get("body") or c.get("content") or "").strip()
            if body and len(body) > 10:
                snippets.append(f"- {body[:150]}")

        return "\n".join(snippets) if snippets else "（无有效评论）"
    except Exception as e:
        return ""


def analyze_with_ai(post, subreddit, comments_text=""):
    """调用 AI 分析帖子（含翻译 + 评论 + 四维评分 + 观点）"""
    if not OPENAI_API_KEY:
        return rule_based_analyze(post, subreddit)

    content_snippet = post.get("content_snippet", "") or ""
    if len(content_snippet) > 600:
        content_snippet = content_snippet[:600] + "..."

    prompt = ANALYZE_PROMPT.format(
        title=post.get("title", ""),
        content=content_snippet or "（无正文内容）",
        subreddit=subreddit,
        published=post.get("published", ""),
        comments=comments_text or "（未能获取评论）",
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
                "temperature": 0.4,
                "max_tokens": 900,
            },
            timeout=30,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            result = json.loads(match.group())
            # 确保 scores 字段存在且完整
            if "scores" not in result:
                result["scores"] = {"vibecoding": 2, "moat": 1, "track_fit": 1, "growth": 1}
            return result
    except Exception as e:
        print(f"  ⚠️ AI 分析失败 ({post.get('title', '')[:30]}): {e}")

    return rule_based_analyze(post, subreddit)


def rule_based_analyze(post, subreddit):
    """规则分析（无 AI 时的兜底方案）"""
    title = post.get("title", "")
    content = post.get("content_snippet", "") or ""
    text = (title + " " + content).lower()

    # 标签推断
    tags = []
    tag_map = {
        "AI/机器学习": ["ai", "machine learning", "ml", "llm", "gpt", "claude", "chatgpt"],
        "移动应用": ["app", "mobile", "ios", "android", "iphone"],
        "社交产品": ["social", "community", "network", "dating", "friend"],
        "金融科技": ["finance", "money", "payment", "invest", "crypto", "budget"],
        "教育": ["education", "learn", "course", "tutor", "school", "student"],
        "健康医疗": ["health", "medical", "symptom", "doctor", "fitness", "mental"],
        "生产力工具": ["productivity", "tool", "automation", "workflow", "organize"],
        "电商": ["ecommerce", "shop", "sell", "marketplace", "product"],
        "创业": ["startup", "business", "entrepreneur", "founder", "saas"],
    }
    for tag, keywords in tag_map.items():
        if any(k in text for k in keywords):
            tags.append(tag)
        if len(tags) >= 3:
            break
    if not tags:
        tags = ["创意想法", "待开发", "市场需求"]

    # 热度评分
    heat = 3
    high_value = ["ai", "health", "finance", "education", "social"]
    if any(k in text for k in high_value):
        heat = 4

    return {
        "title_zh": f"（待翻译）{title[:30]}",
        "content_zh": "（需 AI 分析，当前为规则兜底）",
        "comments_summary": "（需 AI 分析，当前为规则兜底）",
        "summary": f"用户在 r/{subreddit} 提出了关于「{title[:50]}」的需求或想法。这是一个来自真实用户的产品创意，反映了特定场景下的痛点或机会。",
        "opportunity": f"该帖子反映了真实的市场需求，可以考虑构建针对性的解决方案。目标用户为有类似痛点的人群，具备一定的产品化潜力。",
        "scores": {
            "vibecoding": 2,
            "moat": 1,
            "track_fit": 1,
            "growth": 1,
        },
        "verdict": "⚠️ 谨慎观望：当前为规则兜底分析，建议配置 AI API Key 获取深度观点。",
        "tags": tags[:3],
        "heat_score": heat,
        "heat_reason": "基于关键词和主题类别自动评估",
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
    print(f"\n📡 Reddit 黑马榜 - {TODAY}")
    print("=" * 50)

    # 加载已有数据，用于去重
    existing = load_existing_data()
    existing_urls_today = {
        p["permalink"] for p in existing
        if p.get("date") == TODAY
    }

    new_posts = []
    seen_urls = set(existing_urls_today)

    for sr_config in SUBREDDITS:
        subreddit = sr_config["name"]
        sort = sr_config["sort"]
        label = sr_config["label"]

        print(f"\n🔍 抓取 r/{subreddit} ({sort})...")
        posts = fetch_reddit_posts(subreddit, sort, limit=MAX_PER_SUBREDDIT + 5)

        if not posts:
            print(f"  ⚠️ 未获取到帖子，跳过")
            continue

        print(f"  找到 {len(posts)} 个帖子，取前 {MAX_PER_SUBREDDIT} 个")

        count = 0
        for post in posts[:MAX_PER_SUBREDDIT]:
            permalink = post.get("permalink", "")
            if not permalink:
                continue
            if permalink in seen_urls:
                print(f"  ⏭️  跳过（已存在）: {post.get('title', '')[:40]}")
                continue
            seen_urls.add(permalink)

            title = post.get("title", "")
            print(f"  💬 抓取评论: {title[:40]}")
            comments_text = fetch_comments(permalink)

            print(f"  🤖 AI 分析中: {title[:40]}")
            analysis = analyze_with_ai(post, subreddit, comments_text)

            scores = analysis.get("scores", {})
            # 计算总分（满分10分，与 GitHub 榜单一致）
            total = (
                scores.get("vibecoding", 2) +
                scores.get("moat", 1) +
                scores.get("track_fit", 1) +
                scores.get("growth", 1)
            )

            new_post = {
                "id": str(uuid.uuid4())[:8],
                "date": TODAY,
                "fetched_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "subreddit": label,
                "title": title,
                "title_zh": analysis.get("title_zh", ""),
                "author": post.get("author", ""),
                "permalink": permalink,
                "url": post.get("url", permalink),
                "published": post.get("published", ""),
                "content_snippet": (post.get("content_snippet", "") or "")[:500],
                "content_zh": analysis.get("content_zh", ""),
                "comments_summary": analysis.get("comments_summary", ""),
                "summary": analysis.get("summary", ""),
                "opportunity": analysis.get("opportunity", ""),
                "verdict": analysis.get("verdict", ""),
                "scores": {
                    "vibecoding": scores.get("vibecoding", 2),
                    "moat": scores.get("moat", 1),
                    "track_fit": scores.get("track_fit", 1),
                    "growth": scores.get("growth", 1),
                    "total": total,
                },
                "tags": analysis.get("tags", []),
                "heat_score": analysis.get("heat_score", 3),
                "heat_reason": analysis.get("heat_reason", ""),
            }
            new_posts.append(new_post)
            count += 1

            # 避免 API 频率限制
            time.sleep(1.5 if OPENAI_API_KEY else 0.5)

        print(f"  ✅ r/{subreddit}: 新增 {count} 个帖子")

    if new_posts:
        all_data = existing + new_posts
        save_data(all_data)
        print(f"\n✅ 完成！今日新增 {len(new_posts)} 个帖子，累计 {len(all_data)} 个")
    else:
        print(f"\nℹ️  今日无新增帖子（可能已全部抓取）")

    return len(new_posts)


if __name__ == "__main__":
    main()
