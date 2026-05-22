import re

path_app = r"C:\Users\onizu\OneDrive\바탕 화면\Workspace_Antigravity\학급운영도구\app\app.js"

with open(path_app, "r", encoding="utf-8") as f:
    content = f.read()

term = "prompt"
count = content.count(term)
print(f"'{term}': found {count} times")
if count > 0:
    lines = content.splitlines()
    for idx, line in enumerate(lines):
        if term in line:
            safe_line = line.strip().encode('ascii', errors='replace').decode('ascii')
            print(f"  Line {idx+1}: {safe_line[:120]}")
