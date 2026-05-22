# AWS Lightsail 실서버 SSH 접속 및 관리 가이드

이 문서는 AWS Lightsail 서버(`IP: 3.35.13.249`)에 SSH로 안전하게 접속하여 서버를 모니터링하고 코드를 배포 및 관리하는 방법을 안내합니다.

---

## 🌐 서버 기본 정보
* **서버 IP**: `3.35.13.249`
* **접속 사용자 계정 (Username)**: `ubuntu`
* **웹 루트 경로**: `/home/ubuntu/app`
* **백엔드 실행 방식**: PM2 (`class-backend`)
* **웹 서버**: Nginx (리버스 프록시 및 정적 파일 호스팅)

---

## 🛠️ 방법 1: AWS Lightsail 브라우저 콘솔 사용 (가장 간편한 방법)
API 키나 별도의 인증서 키 설치 없이 웹 브라우저를 통해 즉시 터미널에 접속하는 방법입니다.

1. **[AWS Lightsail 콘솔](https://lightsail.aws.amazon.com/)**에 로그인합니다.
2. 실행 중인 인스턴스 목록에서 `class-server` 인스턴스를 찾습니다.
3. 인스턴스 우측 상단의 **`>_` (터미널 아이콘)** 버튼을 누르거나, 상세 페이지로 이동해 **[SSH를 사용하여 연결]** 버튼을 누릅니다.
4. 브라우저에서 바로 우분투 터미널 창이 열리며 접속이 완료됩니다.

---

## 🔑 방법 2: PC 터미널에서 SSH 키(`PEM` 파일)로 접속하기
기본 터미널(Windows PowerShell, Command Prompt, macOS Terminal)에서 SSH 키를 활용해 접속하는 전문적인 방법입니다.

### 1단계: SSH 프라이빗 키(Default Key) 다운로드
1. AWS Lightsail 콘솔 우측 상단의 **[계정(Account)]** 메뉴 -> **[계정(Account)]** 탭을 클릭합니다.
2. 좌측 메뉴에서 **[키 페어(SSH keys)]**를 선택합니다.
3. 사용 중인 리전(일반적으로 서울 리전: `ap-northeast-2`)의 **기본 키(Default Key)**를 찾아 **다운로드(.pem)**합니다.
   * 다운로드받은 키 이름을 예를 들어 `LightsailDefaultKey-ap-northeast-2.pem`이라고 가정합니다.

### 2단계: 키 파일 권한 설정 (보안 경고 해결)
프라이빗 키 파일은 타인에게 노출되면 접속이 거부됩니다. 터미널 권한을 소유자 전용으로 수정해야 합니다.

#### 💻 Windows (PowerShell)
다운로드 경로로 이동한 후, 아래 명령어를 복사하여 실행합니다 (키 파일명은 본인 파일명에 맞게 수정):
```powershell
# 상속된 권한을 제거하고 현재 로그인한 사용자에게만 읽기 권한을 부여합니다.
icacls.exe .\LightsailDefaultKey-ap-northeast-2.pem /inheritance:r
icacls.exe .\LightsailDefaultKey-ap-northeast-2.pem /grant:r "$($env:USERNAME):(R)"
```

#### 🍏 macOS / Linux
터미널에서 아래 명령어로 소유자만 읽을 수 있도록 설정합니다:
```bash
chmod 400 LightsailDefaultKey-ap-northeast-2.pem
```

### 3단계: SSH 접속 실행
터미널에서 다운로드받은 PEM 키 경로로 이동하여 아래 명령어로 접속합니다:
```bash
ssh -i .\LightsailDefaultKey-ap-northeast-2.pem ubuntu@3.35.13.249
```
* 최초 접속 시 `Are you sure you want to continue connecting (yes/no/[fingerprint])?` 라고 물어보면 **`yes`**를 입력하고 엔터를 누릅니다.

---

## 🚀 접속 후 자주 사용하는 서버 관리 명령어

접속 성공 후 서버 상황 확인 및 모의주식 API 환경 설정을 위해 주로 사용하는 필수 명령어 모음입니다.

### 📂 프로젝트 폴더로 이동
```bash
cd /home/ubuntu/app
```

### ⚙️ 서버 환경변수(.env) 설정 및 수정
백엔드 서버의 KIS API 키, 데이터베이스 패스워드 등을 수정할 때 사용합니다:
```bash
# nano 에디터로 .env 파일 열기
nano server/.env
```
* **nano 팁**:
  - 파일 내용을 수정한 후 **`Ctrl + O`** -> **`Enter`** 를 눌러 저장합니다.
  - **`Ctrl + X`** 를 눌러 에디터를 빠져나옵니다.

### 🔄 백엔드 서비스(PM2) 관리 및 재시작
코드를 업데이트하거나 `.env` 설정을 바꾼 후 반드시 실행해야 합니다:
```bash
# 실행 중인 모든 Node.js 서버 상태 요약 보기
pm2 status

# 백엔드 서버(Express) 재시작 (소스 수정 반영)
pm2 restart class-backend

# 실시간 백엔드 서버 로그 확인 (에러 추적용)
pm2 logs class-backend
```

### 📥 최신 코드 배포 (Git Pull)
GitHub 등에 푸시한 최신 코드를 운영 서버에 반영할 때 사용합니다:
```bash
# 최신 소스 가져오기
git pull

# 소스를 가져온 후 반영을 위해 반드시 백엔드 재시작 필요
pm2 restart class-backend
```

### 🌐 Nginx 웹서버 관리
Nginx 설정을 재시작하거나 웹 서버 에러 로그를 볼 때 사용합니다:
```bash
# Nginx 웹 서버 재시작
sudo systemctl restart nginx

# Nginx의 에러 로그 실시간 감시 (웹 접속 오류 시)
sudo tail -f /var/log/nginx/error.log
```
