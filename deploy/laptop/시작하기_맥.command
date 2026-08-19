#!/bin/bash
# 더블클릭하면 사이트가 열립니다. 이 창을 닫으면 사이트도 닫힙니다.
cd "$(dirname "$0")"
echo ""
echo "  SignBridge 를 시작합니다..."
echo "  브라우저가 안 열리면 주소창에 직접:  http://localhost:8000"
echo ""
(sleep 2; open http://localhost:8000 2>/dev/null || xdg-open http://localhost:8000 2>/dev/null) &
python3 -m http.server 8000
