# B안 — 노트북에서 직접 GitHub에 올리기

워크스페이스에서 시험해 본 절차입니다. 그대로 따라 하시면 됩니다.

## 1. 파일 내려받기

파일 브라우저에서 **`~/deploy/signbridge-full.bundle`** (207MB) 을 내려받습니다.
바탕화면처럼 찾기 쉬운 곳에 두세요.

> 이 파일 하나에 **커밋 325개 전부**가 들어 있습니다. 코드·문서·판단 기록까지 전부.

## 2. 터미널(윈도우는 Git Bash)을 열고

내려받은 폴더로 이동합니다. 예를 들어 바탕화면이면:

```bash
cd ~/Desktop          # 윈도우 Git Bash도 같습니다
```

## 3. 복원

```bash
git clone signbridge-full.bundle signbridge
cd signbridge
```

확인 — 이렇게 나오면 성공입니다:

```bash
git log --oneline | wc -l      # 303
git branch                     # * claude/sign-language-translation-system-a0mzqi
```

## 4. 원격을 GitHub으로 바꾸기

지금은 원격이 번들 파일을 가리키고 있습니다. 진짜 저장소로 바꿉니다.

```bash
git remote set-url origin https://github.com/BioCode67/signbridge.git
```

## 5. 올리기

```bash
git push origin claude/sign-language-translation-system-a0mzqi
```

### 로그인 창이 뜨면

- **윈도우** — 브라우저 창이 열립니다. GitHub 로그인 → 승인. 끝입니다.
- **맥/리눅스** — `Username`과 `Password`를 묻습니다.
  - Username: `BioCode67`
  - Password: **계정 비밀번호가 아닙니다.** 토큰을 넣어야 합니다.
    github.com → Settings → Developer settings → Personal access tokens
    → Tokens (classic) → Generate new token → 체크는 **repo** 하나만 → 복사해서 붙여넣기

## 6. 확인

https://github.com/BioCode67/signbridge/tree/claude/sign-language-translation-system-a0mzqi

커밋 325개가 보이면 끝입니다.

---

## 이미 노트북에 저장소가 있다면

새로 클론하지 않고 번들에서 당겨올 수도 있습니다.

```bash
cd 기존_signbridge_폴더
git fetch ~/Desktop/signbridge-full.bundle claude/sign-language-translation-system-a0mzqi
git checkout claude/sign-language-translation-system-a0mzqi
git merge FETCH_HEAD          # 또는 git reset --hard FETCH_HEAD
git push origin claude/sign-language-translation-system-a0mzqi
```

---

## 자주 막히는 곳

| 증상 | 해결 |
|---|---|
| `git: command not found` | git-scm.com 에서 Git 설치 |
| `Authentication failed` | 비밀번호 대신 **토큰**을 넣어야 합니다(5번 참고) |
| `Updates were rejected` | 원격에 다른 작업이 있습니다. `git pull --rebase origin 브랜치` 후 다시 push |
| 용량이 커서 느림 | 정상입니다. 207MB에 학습 산출물 이력이 들어 있습니다 |
