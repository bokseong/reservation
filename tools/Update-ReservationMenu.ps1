# 메뉴를 저장한 뒤 이 파일을 실행하면 서버 검증 메뉴와 예약 화면을 함께 갱신합니다.
# 기본 저장소 경로가 다른 컴퓨터에서는 RESERVATION_REPOSITORY 환경 변수를 설정하거나 실행 중 입력하세요.

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = 'Stop'

function Invoke-Step {
  param([string]$Name, [scriptblock]$Command)
  Write-Host "`n[$Name]" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "$Name 단계가 실패했습니다. (종료 코드: $LASTEXITCODE)" }
}

function Stop-WithMessage {
  param([string]$Message)
  Write-Host "`n중단: $Message" -ForegroundColor Red
  Read-Host 'Enter를 누르면 종료합니다'
  exit 1
}

$defaultRepository = 'C:\Users\user\Documents\ChatGPT\학교\reservation'
$repository = if ($env:RESERVATION_REPOSITORY) { $env:RESERVATION_REPOSITORY } else { $defaultRepository }

if (-not (Test-Path -LiteralPath (Join-Path $repository '.git'))) {
  Write-Host "기본 저장소를 찾지 못했습니다: $repository" -ForegroundColor Yellow
  $repository = Read-Host 'reservation 저장소의 전체 경로를 입력하세요'
}
if (-not (Test-Path -LiteralPath (Join-Path $repository '.git'))) {
  Stop-WithMessage '올바른 reservation Git 저장소 경로가 아닙니다.'
}

foreach ($command in @('git', 'npm', 'npx.cmd')) {
  if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
    Stop-WithMessage "$command 명령을 찾지 못했습니다. Node.js와 Git 설치 상태를 확인하세요."
  }
}

Push-Location $repository
try {
  # 메뉴 파일 외의 변경은 자동으로 건드리지 않습니다.
  $initialStatus = @(& git status --porcelain)
  $unexpected = @($initialStatus | Where-Object {
    $_ -notmatch '^( M|M |MM|A |AM|\?\?) (public/js/menu\.js|functions/menu\.js)$'
  })
  if ($unexpected.Count -gt 0) {
    Stop-WithMessage "메뉴 파일 이외의 저장되지 않은 변경이 있습니다.`n$($unexpected -join "`n")"
  }

  Invoke-Step '원격 변경 확인' { git fetch origin }
  $counts = ((& git rev-list --left-right --count HEAD...origin/main).Trim() -split '\s+')
  $ahead = [int]$counts[0]
  $behind = [int]$counts[1]
  if ($behind -gt 0 -and $initialStatus.Count -gt 0) {
    Stop-WithMessage 'GitHub에 새 메뉴 변경이 있으면서 이 컴퓨터에도 메뉴 변경이 있습니다. 둘 중 무엇을 사용할지 확인한 뒤 수동으로 합쳐 주세요.'
  }
  if ($behind -gt 0) {
    Invoke-Step 'GitHub 메뉴 내려받기' { git pull --ff-only origin main }
  }
  if ($ahead -gt 0) {
    Stop-WithMessage '이 컴퓨터에 아직 푸시되지 않은 커밋이 있습니다. 먼저 일반 Git 작업을 정리한 뒤 다시 실행하세요.'
  }

  Invoke-Step '서버 메뉴 동기화' { npm run sync:menu }
  Invoke-Step '메뉴·코드 검사' { npm run check }

  $finalStatus = @(& git status --porcelain)
  $unexpected = @($finalStatus | Where-Object {
    $_ -notmatch '^( M|M |MM|A |AM|\?\?) (public/js/menu\.js|functions/menu\.js)$'
  })
  if ($unexpected.Count -gt 0) {
    Stop-WithMessage "자동 동기화 뒤 예상하지 못한 파일 변경이 감지되었습니다.`n$($unexpected -join "`n")"
  }
  if ($finalStatus.Count -eq 0) {
    Write-Host "`n변경된 메뉴가 없습니다. 배포하지 않았습니다." -ForegroundColor Yellow
    return
  }

  Invoke-Step '메뉴 변경 커밋' {
    git add -- public/js/menu.js functions/menu.js
    git commit -m 'Update reservation menu'
  }
  Invoke-Step 'GitHub Pages 배포 시작' { git push origin main }
  Invoke-Step 'Firebase Functions 메뉴 배포' {
    npx.cmd firebase-tools deploy --only functions:reservation:createReservation,functions:reservation:getPublicSettings --project jw-astro09
  }

  Write-Host "`n완료: 메뉴 화면과 서버 가격 검증이 함께 배포되었습니다." -ForegroundColor Green
  Write-Host 'GitHub Pages 반영에는 보통 1~2분이 걸릴 수 있습니다.' -ForegroundColor Green
}
catch {
  Write-Host "`n오류: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Pop-Location
  Read-Host 'Enter를 누르면 종료합니다'
}
