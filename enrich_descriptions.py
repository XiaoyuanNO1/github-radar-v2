#!/usr/bin/env python3
# ===== 深度分析数据注入脚本 =====
import json

DATA_FILE = "radar_history.json"
ENRICHED_FILE = "enriched_data.json"
TARGET_DATE = "2026-03-22"

def main():
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    with open(ENRICHED_FILE, "r", encoding="utf-8") as f:
        enriched_list = json.load(f)

    enriched = {item["title"]: item for item in enriched_list}

    updated = 0
    for project in data:
        if project["date"] != TARGET_DATE:
            continue
        title = project["title"]
        if title not in enriched:
            continue
        e = enriched[title]
        project["description"] = e["description"]
        project["metaphor"] = e["metaphor"]
        project["usage_scene"] = e["usage_scene"]
        updated += 1
        print(f"✅ {title}")

    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    total = len([p for p in data if p["date"] == TARGET_DATE])
    print(f"\n🎉 完成！共更新 {updated}/{total} 个项目的深度描述")

if __name__ == "__main__":
    main()
