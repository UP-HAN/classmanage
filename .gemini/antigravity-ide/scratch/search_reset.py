import re

path_app = r"C:\Users\onizu\OneDrive\바탕 화면\Workspace_Antigravity\학급운영도구\app\app.js"

with open(path_app, "r", encoding="utf-8") as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if "reset" in line.lower() and ("function" in line or "var" in line or "const" in line or "let" in line or "id=" in line or "click" in line):
        safe_line = line.strip().encode('ascii', errors='replace').decode('ascii')
        print(f"Line {idx+1}: {safe_line[:100]}")
