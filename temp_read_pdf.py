import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from pypdf import PdfReader
try:
    reader = PdfReader('참고자료/햇반김자반 특정직업 장부.pdf')
    for i, page in enumerate(reader.pages):
        print(f"--- Page {i+1} ---")
        print(page.extract_text())
except Exception as e:
    print("Error reading PDF:", e)
