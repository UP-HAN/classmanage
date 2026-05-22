import os

file_path = r"c:\Users\onizu\OneDrive\바탕 화면\Workspace_Antigravity\학급운영도구\app\app.js"
keyword = "avatarCustom"

with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
    for idx, line in enumerate(f, 1):
        if keyword in line:
            print(f"Line {idx}: {line.strip()}")
