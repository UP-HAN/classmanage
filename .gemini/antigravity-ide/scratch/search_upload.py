import os

file_path = r"c:\Users\onizu\OneDrive\바탕 화면\Workspace_Antigravity\학급운영도구\app\app.js"
out_path = r"C:\Users\onizu\.gemini\antigravity-ide\brain\a6e0c3a1-3488-4c32-a1c1-9231f6bfb928\scratch\search_avatar_upload_results.txt"

keywords = ["FileReader", "avatarUpload", "200KB", "200 * 1024", "1024 * 1024", "bindStudentAvatarUpload"]

matches = []
with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
    for idx, line in enumerate(f, 1):
        for kw in keywords:
            if kw.lower() in line.lower():
                matches.append(f"Line {idx} ({kw}): {line.strip()}")
                break

with open(out_path, "w", encoding="utf-8") as out:
    for m in matches:
        out.write(m + "\n")

print(f"Found {len(matches)} matches. Results written to {out_path}")
