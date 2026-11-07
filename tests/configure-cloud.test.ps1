$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testRoot=Join-Path $root ('.private/setup-test-'+[guid]::NewGuid().ToString('N'))
$boundary=[IO.Path]::GetFullPath((Join-Path $root '.private'))+[IO.Path]::DirectorySeparatorChar
if(-not $testRoot.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe test directory'}
New-Item -ItemType Directory -Path (Join-Path $testRoot 'tools') -Force | Out-Null
try {
  Copy-Item -LiteralPath (Join-Path $root 'tools/configure-cloud.ps1') -Destination (Join-Path $testRoot 'tools/configure-cloud.ps1')
  [IO.File]::WriteAllText((Join-Path $testRoot '.env.example'),"NODE_ENV=development`nGEMINI_API_KEY=`nGEMINI_MODEL=`nALLOW_SYNTHETIC_PROVIDER_DATA=false`n")
  # Fixture input exists only in this automated test; it is not a working provider credential.
  function Read-Host { param([string]$Prompt,[switch]$AsSecureString) if($AsSecureString){return ConvertTo-SecureString 'fixture-not-a-provider-key-123456' -AsPlainText -Force}; return '' }
  & (Join-Path $testRoot 'tools/configure-cloud.ps1') -Service Gemini -Model 'test-model'
  $envFile=Join-Path $testRoot '.env'
  $contents=[IO.File]::ReadAllText($envFile)
  if(-not $contents.Contains('ENABLE_REAL_PROVIDER="true"') -or -not $contents.Contains('ALLOW_SYNTHETIC_PROVIDER_DATA="false"')){throw 'Expected safe runtime flags were not configured'}
  if(-not (Get-Acl -LiteralPath $envFile).AreAccessRulesProtected){throw 'Credentials file did not receive a protected ACL'}
  function Read-Host { throw 'Existing-key mode must not prompt when a model was specified' }
  & (Join-Path $testRoot 'tools/configure-cloud.ps1') -Service Gemini -Model 'test-model-next' -UseExistingKey
  $updated=[IO.File]::ReadAllText($envFile)
  if(-not $updated.Contains('GEMINI_MODEL="test-model-next"') -or -not $updated.Contains('fixture-not-a-provider-key-123456')){throw 'Existing-key model selection failed'}
  New-Item -ItemType Directory -Path (Join-Path $testRoot 'config') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $root 'config/supabase-target.json') -Destination (Join-Path $testRoot 'config/supabase-target.json')
  Add-Content -LiteralPath $envFile -Value 'SUPABASE_PUBLISHABLE_KEY="sb_publishable_fixture_only"'
  & (Join-Path $testRoot 'tools/configure-cloud.ps1') -Service Supabase -UseExistingKey
  $cloud=[IO.File]::ReadAllText($envFile)
  if(-not $cloud.Contains('PERSISTENCE_MODE="supabase"') -or -not $cloud.Contains('ENABLE_SUPABASE_GUEST="false"')){throw 'Supabase existing-key configuration failed'}
  $beforeRejected=[IO.File]::ReadAllText($envFile)
  $denied=$false
  try { & (Join-Path $testRoot 'tools/configure-cloud.ps1') -Service Supabase -UseExistingKey -ProjectRef 'aaaaaaaaaaaaaaaaaaaa' } catch { $denied=$true }
  if(-not $denied -or [IO.File]::ReadAllText($envFile) -ne $beforeRejected){throw 'Wrong-project configuration was not rejected without changes'}
  Add-Content -LiteralPath $envFile -Value @('GROQ_API_KEY="fixture-groq-key-only"','TAVILY_API_KEY="fixture-tavily-key-only"')
  & (Join-Path $testRoot 'tools/configure-cloud.ps1') -Service RuntimePolicy -EnableResearch -EnableGuest
  $policy=[IO.File]::ReadAllText($envFile)
  foreach($expected in @('MODEL_PROVIDER="gemini"','GROQ_MODEL="openai/gpt-oss-20b"','FALLBACK_PROVIDERS="groq"','ENABLE_OPENROUTER_RUNTIME="false"','PROVIDER_RETRIES="0"','ENABLE_TRAVEL_RESEARCH="true"','ENABLE_SUPABASE_GUEST="true"')) { if(-not $policy.Contains($expected)){throw 'Runtime policy was not applied'} }
  if([IO.File]::ReadAllText((Join-Path $root '.env.example')).Contains('fixture-not-a-provider-key')){throw 'Fixture leaked into project template'}
  Write-Output 'Secure local setup test: PASS (fixture only; real project .env untouched)'
} finally { if(Test-Path -LiteralPath $testRoot){Remove-Item -LiteralPath $testRoot -Recurse -Force} }
