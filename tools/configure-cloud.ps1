[CmdletBinding()]
param(
  [ValidateSet('Gemini','Supabase','RuntimePolicy')][string]$Service = 'Gemini',
  [string]$ProjectRef = '',
  [string]$Model = '',
  [switch]$UseExistingKey,
  [switch]$EnableResearch,
  [switch]$EnableGuest
)
$ErrorActionPreference = 'Stop'
$projectDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envFile = Join-Path $projectDirectory '.env'
$template = Join-Path $projectDirectory '.env.example'
$script:envLines = [System.Collections.Generic.List[string]]::new()
$sourceFile = if (Test-Path -LiteralPath $envFile) { $envFile } else { $template }
foreach($line in [System.IO.File]::ReadAllLines($sourceFile)) { $script:envLines.Add($line) }
function Set-EnvValue([string]$Name,[string]$Value) {
  if($Value -match '[\r\n\x00]' -or $Value.Contains('"') -or $Value.Contains('\')) { throw "Unsupported characters in $Name" }
  $pattern = '^'+[regex]::Escape($Name)+'='
  for($i=$script:envLines.Count-1;$i -ge 0;$i--) { if($script:envLines[$i] -match $pattern) { $script:envLines.RemoveAt($i) } }
  $script:envLines.Add($Name+'="'+$Value+'"')
}
function Read-PrivateValue([string]$Name) {
  $protected = Read-Host "$Name (hidden; leave blank to preserve an existing value)" -AsSecureString
  $pointer = [IntPtr]::Zero
  try { $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($protected); return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { if($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }; $protected.Dispose() }
}
Set-EnvValue 'NODE_ENV' 'development'
Set-EnvValue 'ALLOW_SYNTHETIC_PROVIDER_DATA' 'false'
if($Service -eq 'RuntimePolicy') {
  foreach($requiredKey in @('GEMINI_API_KEY','GROQ_API_KEY')) {
    $keyLine=$script:envLines | Where-Object { $_ -match ('^'+$requiredKey+'=') } | Select-Object -Last 1
    if(-not $keyLine -or ($keyLine -split '=',2)[1].Trim().Trim('"').Length -eq 0) { throw 'A verified provider key is missing locally; nothing was saved' }
    $keyLine=$null
  }
  Set-EnvValue 'MODEL_PROVIDER' 'gemini'
  Set-EnvValue 'GEMINI_MODEL' 'gemini-3.5-flash-lite'
  Set-EnvValue 'GROQ_MODEL' 'openai/gpt-oss-20b'
  Set-EnvValue 'OPENROUTER_MODEL' 'google/gemma-4-26b-a4b-it:free'
  Set-EnvValue 'ENABLE_REAL_PROVIDER' 'true'
  Set-EnvValue 'ENABLE_PROVIDER_STREAMING' 'true'
  Set-EnvValue 'FALLBACK_PROVIDERS' 'groq'
  Set-EnvValue 'ENABLE_OPENROUTER_RUNTIME' 'false'
  Set-EnvValue 'PROVIDER_RETRIES' '0'
  Set-EnvValue 'PROVIDER_QUOTA_COOLDOWN_MS' '60000'
  if($EnableResearch) {
    $keyLine=$script:envLines | Where-Object { $_ -match '^TAVILY_API_KEY=' } | Select-Object -Last 1
    if(-not $keyLine -or ($keyLine -split '=',2)[1].Trim().Trim('"').Length -eq 0) { throw 'Tavily key missing locally; nothing was saved' }
    $keyLine=$null
    Set-EnvValue 'ENABLE_TRAVEL_RESEARCH' 'true'
    Set-EnvValue 'MAX_SEARCH_CALLS_PER_TURN' '2'
    Set-EnvValue 'MAX_SEARCH_REQUESTS_PER_HOUR' '20'
  }
  if($EnableGuest) {
    $target=[IO.File]::ReadAllText((Join-Path $projectDirectory 'config/supabase-target.json')) | ConvertFrom-Json
    $refLine=$script:envLines | Where-Object { $_ -match '^SUPABASE_PROJECT_REF=' } | Select-Object -Last 1
    if(-not $refLine -or ($refLine -split '=',2)[1].Trim().Trim('"') -ne $target.projectRef) { throw 'Guest entry requires the verified Sadeeman ref; nothing was saved' }
    Set-EnvValue 'ENABLE_SUPABASE_GUEST' 'true'
  }
} elseif($Service -eq 'Gemini') {
  if($UseExistingKey) {
    $existingKeyLine = $script:envLines | Where-Object { $_ -match '^GEMINI_API_KEY=' } | Select-Object -Last 1
    if(-not $existingKeyLine -or ($existingKeyLine -split '=',2)[1].Trim().Trim('"').Length -eq 0) { throw 'No existing Gemini key; nothing was saved' }
    $existingKeyLine = $null
    $privateValue = $null
  } else { $privateValue = Read-PrivateValue 'GEMINI_API_KEY' }
  try { if($privateValue) { if($privateValue -notmatch '^[A-Za-z0-9_-]{16,512}$') { throw 'Invalid Gemini key format; nothing was saved' }; Set-EnvValue 'GEMINI_API_KEY' $privateValue } }
  finally { $privateValue=$null }
  if(-not $Model) { $Model=Read-Host 'GEMINI_MODEL (exact model ID; leave blank to list models before selecting)' }
  if($Model) {
    if($Model -notmatch '^[a-zA-Z0-9._-]+$' -or $Model.Contains('CHECK_')) { throw 'Invalid model ID; nothing was saved' }
    Set-EnvValue 'GEMINI_MODEL' $Model
  }
  Set-EnvValue 'MODEL_PROVIDER' 'gemini'
  Set-EnvValue 'ENABLE_REAL_PROVIDER' ([bool]$Model).ToString().ToLowerInvariant()
  Set-EnvValue 'ENABLE_PROVIDER_STREAMING' 'true'
  Set-EnvValue 'FALLBACK_PROVIDERS' ''
} else {
  $targetFile=Join-Path $projectDirectory 'config/supabase-target.json'
  $verifiedTarget=[IO.File]::ReadAllText($targetFile) | ConvertFrom-Json
  if(-not $ProjectRef) { $ProjectRef=$verifiedTarget.projectRef }
  if(-not $ProjectRef) { $ProjectRef=Read-Host 'Verified Sadeeman project ref (public, 20 lowercase letters/digits)' }
  if($ProjectRef -notmatch '^[a-z0-9]{20}$') { throw 'Invalid project ref; nothing was saved' }
  if($ProjectRef -ne $verifiedTarget.projectRef) { throw 'Project ref differs from the verified Sadeeman target; nothing was saved' }
  if($UseExistingKey) {
    $existingKeyLine = $script:envLines | Where-Object { $_ -match '^SUPABASE_PUBLISHABLE_KEY=' } | Select-Object -Last 1
    if(-not $existingKeyLine) { throw 'No existing Supabase publishable key; nothing was saved' }
    $privateValue = ($existingKeyLine -split '=',2)[1].Trim().Trim('"')
    $existingKeyLine = $null
    if(-not $privateValue) { throw 'No existing Supabase publishable key; nothing was saved' }
  } else { $privateValue=Read-PrivateValue 'SUPABASE_PUBLISHABLE_KEY' }
  try {
    if($privateValue) {
      if($privateValue -notmatch '^sb_publishable_[A-Za-z0-9_=-]+$') { throw 'Use a publishable key, never a secret/service-role key; nothing was saved' }
      Set-EnvValue 'SUPABASE_PUBLISHABLE_KEY' $privateValue
    }
  } finally { $privateValue=$null }
  Set-EnvValue 'SUPABASE_PROJECT_REF' $ProjectRef
  Set-EnvValue 'SUPABASE_URL' ('https://'+$ProjectRef+'.supabase.co')
  Set-EnvValue 'PERSISTENCE_MODE' 'supabase'
  Set-EnvValue 'ENABLE_SUPABASE_GUEST' 'false'
}
$temporaryFile=Join-Path $projectDirectory ('.env.setup-'+[guid]::NewGuid().ToString('N'))
try {
  [System.IO.File]::WriteAllLines($temporaryFile,$script:envLines,[System.Text.UTF8Encoding]::new($false))
  # Codex may run as a sandbox account. Retain the workspace owner's access as well.
  $acl=[System.Security.AccessControl.FileSecurity]::new()
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','Allow'))
  $workspaceOwner=(Get-Acl -LiteralPath $projectDirectory).GetOwner([System.Security.Principal.SecurityIdentifier])
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($workspaceOwner,'FullControl','Allow'))
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl','Allow'))
  Set-Acl -LiteralPath $temporaryFile -AclObject $acl
  Move-Item -LiteralPath $temporaryFile -Destination $envFile -Force
  Write-Host 'Saved local .env with restricted access. No credentials were printed. No remote database was changed.'
} finally {
  if(Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force }
  $script:envLines.Clear()
}
