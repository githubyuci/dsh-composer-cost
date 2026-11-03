<#
.SYNOPSIS
  Publish dsh-composer-cost to a GitHub repository.

.DESCRIPTION
  Commits are already made. This script only wires the remote and pushes.
  Auth: leave -Token empty and Git Credential Manager (installed with Git for
  Windows) opens a browser sign-in; pass a PAT when you want a headless push.

.EXAMPLE
  .\push.ps1 -Repo https://github.com/yourname/dsh-composer-cost.git

.EXAMPLE
  .\push.ps1 -Repo https://github.com/yourname/dsh-composer-cost.git -Token ghp_xxx
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Repo,

  [string]$Branch = 'main',

  [string]$Token,

  [string]$GitPath = 'C:\Program Files\Git\cmd\git.exe'
)

$ErrorActionPreference = 'Stop'

function Resolve-Git {
  param([string]$Candidate)
  $onPath = Get-Command git -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  if (Test-Path $Candidate) { return $Candidate }
  $probe = @(
    'C:\Program Files\Git\cmd\git.exe',
    'C:\Program Files (x86)\Git\cmd\git.exe',
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\cmd\git.exe')
  ) | Where-Object { Test-Path $_ }
  if ($probe) { return $probe[0] }
  throw "git not found. Install it with: winget install --id Git.Git -e --source winget"
}

$git = Resolve-Git -Candidate $GitPath
Write-Host "git    : $git"
$env:PATH = (Split-Path $git) + ';' + $env:PATH

Set-Location -LiteralPath $PSScriptRoot

$clean = $Repo.TrimEnd('/')
if ($clean -notmatch '\.git$') { $clean = "$clean.git" }
$slug = ($clean -replace '^https://github\.com/', '' -replace '\.git$', '')

Write-Host "repo   : $clean"
Write-Host "branch : $Branch"

$remotes = & $git remote
if ($remotes -contains 'origin') {
  & $git remote set-url origin $clean
} else {
  & $git remote add origin $clean
}

if ($Token) {
  $authUrl = "https://x-access-token:$Token@github.com/$slug.git"
  & $git push $authUrl "HEAD:refs/heads/$Branch"
  $code = $LASTEXITCODE
  & $git remote set-url origin $clean
} else {
  & $git push -u origin $Branch
  $code = $LASTEXITCODE
}

if ($code -ne 0) {
  Write-Host ''
  Write-Host "push failed (git exit $code)." -ForegroundColor Yellow
  Write-Host 'check: repo exists and is empty, branch name, and your GitHub sign-in / PAT scope (repo).'
  exit $code
}

& $git remote -v
Write-Host ''
Write-Host 'pushed. next steps on GitHub:' -ForegroundColor Green
Write-Host '  1. Releases -> Draft a new release -> tag v1.0.0'
Write-Host '  2. attach the built dsh-composer-cost-<version>.tgz as a release asset'
