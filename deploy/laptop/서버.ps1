# SignBridge 정적 서버 — 윈도우에 **기본으로 있는** PowerShell만 쓴다.
#
# 왜 이게 필요한가. 예전 `.bat`은 파이썬을 요구했다. 파이썬이 없는 노트북에서는
# 검은 창에 안내만 뜨고 사이트가 안 열린다 — 발표 당일에 설치를 시킬 수는 없다.
#
# HttpListener는 관리자 권한(urlacl)이 필요할 수 있어서 **TcpListener로 직접** 받는다.
# 필요한 것만 구현한다: GET · 파일 전송 · MIME · URL 디코딩(한글 파일명) · 404.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8000

$mime = @{
  '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'
  '.css'='text/css; charset=utf-8';   '.json'='application/json; charset=utf-8'
  '.svg'='image/svg+xml';             '.png'='image/png'
  '.jpg'='image/jpeg';                '.jpeg'='image/jpeg'
  '.gif'='image/gif';                 '.ico'='image/x-icon'
  '.wasm'='application/wasm';         '.woff2'='font/woff2'
  '.woff'='font/woff';                '.ttf'='font/ttf'
  '.glb'='model/gltf-binary';         '.bin'='application/octet-stream'
  '.webmanifest'='application/manifest+json'
  '.onnx'='application/octet-stream'; '.txt'='text/plain; charset=utf-8'
  '.mp4'='video/mp4';                 '.data'='application/octet-stream'
}

try {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
  $listener.Start()
} catch {
  Write-Host ""
  Write-Host "  [!] 포트 $port 를 못 씁니다. 이미 다른 창에서 켜져 있는지 보세요." -ForegroundColor Red
  Write-Host "      켜져 있다면 브라우저에서 http://localhost:$port 로 바로 들어가면 됩니다."
  Read-Host "  엔터를 누르면 닫힙니다"
  exit 1
}

Write-Host ""
Write-Host "  SignBridge 준비됨 --> http://localhost:$port" -ForegroundColor Green
Write-Host "  (이 창을 닫으면 사이트도 닫힙니다)"
Write-Host ""
Start-Process "http://localhost:$port"

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII)
    $line = $reader.ReadLine()
    if (-not $line) { $client.Close(); continue }

    $parts = $line -split ' '
    $url = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
    $url = ($url -split '\?')[0]
    $url = ($url -split '#')[0]
    $path = [System.Uri]::UnescapeDataString($url)
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    # 상위 경로 탈출 막기
    $path = $path -replace '\.\.', ''
    $file = Join-Path $root ($path.TrimStart('/') -replace '/', '\')

    if (Test-Path -LiteralPath $file -PathType Leaf) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      $ct = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $head = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`n" +
              "Cache-Control: no-cache`r`nConnection: close`r`n`r`n"
    } else {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('not found')
      $head = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain`r`n" +
              "Content-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    }
    $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
    $stream.Write($hb, 0, $hb.Length)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } catch {
    # 브라우저가 먼저 끊는 것은 흔한 일이라 조용히 넘어간다
  } finally {
    $client.Close()
  }
}
