import sys
import os
sys.stdout.reconfigure(encoding='utf-8')

file_path = r"c:\Users\onizu\OneDrive\바탕 화면\Workspace_Antigravity\학급운영도구\app\app.js"

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

search_terms = ["bankPayrollRequests"]
for idx, line in enumerate(lines, 1):
    for term in search_terms:
        if term in line:
            print(f"{idx}: {line.strip()}")
            break
