import re

path_app = r"C:\Users\onizu\OneDrive\바탕 화면\Workspace_Antigravity\학급운영도구\app\app.js"

with open(path_app, "r", encoding="utf-8") as f:
    content = f.read()

term = "dj"
lines = content.splitlines()
for idx, line in enumerate(lines):
    if "djSongRequests" in line or "djDailyLogs" in line or "function" in line.lower() and "dj" in line.lower():
        safe_line = line.strip().encode('ascii', errors='replace').decode('ascii')
        print(f"Line {idx+1}: {safe_line[:120]}")
