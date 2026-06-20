# BLOCKERS — 막혔거나 보류한 것

밤샘 자율 작업 중 막힌 항목을 기록합니다. 멈추지 않고 다른 작업으로 넘어가되, 여기에 남겨 둡니다.

---

- **AI Hub 제공 아바타 직접 사용 불가 (보류)**
  - 제공된 `AI 모델 소스코드.zip` 내부 `..._player.zip`은 **Unity 빌드 윈도우 실행파일**(`player.exe`
    + `player_Data/resources.assets` 625MB)로, 3D 아바타가 Unity 직렬화 에셋에 임베드돼 있음.
  - 웹(Three.js) 사용하려면 AssetStudio/AssetRipper(주로 윈도우)로 메시·리그·텍스처를 추출 →
    glTF 변환 → 리그 재정비 필요. 이 맥엔 해당 툴·brew 없음.
  - 추출 모델을 공개 레포에 재배포하는 것은 **라이선스 불명확**(리스크).
  - → 우선 VRM 샘플로 진행. 추후 (a) 윈도우에서 추출하거나 (b) VRoid로 자체 제작해 교체 가능.

- **프리뷰 스크린샷 도구 간헐적 desync (영향 적음)**
  - dev 서버에 여러 탭/클라이언트가 붙어 eval과 screenshot이 가끔 다른 상태를 잡음.
    기능 검증은 eval(WebGL 캔버스·픽셀·콘솔)로 보완. 앱 자체 문제 아님.
