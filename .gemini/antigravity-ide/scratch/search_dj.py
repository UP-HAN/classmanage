import re

path_app = r"C:\Users\onizu\OneDrive\바탕 화면\Workspace_Antigravity\학급운영도구\app\app.js"

with open(path_app, "r", encoding="utf-8") as f:
    content = f.read()

terms = [
    "dj",
    "신청",
    "곡",
    "노래",
    "음악",
    "music",
    "song"
]

for term in terms:
    count = content.count(term)
    print(f"'{term}': found {count} times")
    if count > 0:
        lines = content.splitlines()
        found = 0
        for idx, line in enumerate(lines):
            if term in line.lower():
                try:
                    # replace emojis or non-ascii with ?
                    safe_line = line.strip().encode('ascii', errors='replace').decode('ascii')
                    print(f"  Line {idx+1}: {safe_line[:100]}")
                    found += 1
                    if found >= 5:
                        break
                except Exception as e:
                    print(f"  Line {idx+1}: [printing failed due to {e}]")
