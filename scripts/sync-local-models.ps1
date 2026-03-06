param(
  [string]$ConfigPath = "",
  [string]$ProviderId = "local",
  [switch]$QwenOnly = $true,
  [switch]$UpdateAgentModels = $true,
  [string]$PreferredModel = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

function Set-OrAddProperty {
  param(
    [object]$Object,
    [string]$Name,
    $Value
  )

  if ($null -eq $Object -or [string]::IsNullOrWhiteSpace($Name)) {
    return
  }

  $member = $Object | Get-Member -Name $Name -ErrorAction SilentlyContinue
  if ($null -ne $member) {
    $Object.$Name = $Value
  } else {
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value -Force
  }
}

function Sync-AgentRuntimeModelsFiles {
  param(
    [object]$Config,
    [string]$Provider
  )

  if ($null -eq $Config -or $null -eq $Config.models -or $null -eq $Config.models.providers) {
    return 0
  }

  $providerConfig = $Config.models.providers.$Provider
  if ($null -eq $providerConfig) {
    return 0
  }

  $agentsRoot = Join-Path $repoRoot ".openclaw-state\agents"
  if (-not (Test-Path -LiteralPath $agentsRoot)) {
    return 0
  }

  $files = Get-ChildItem -LiteralPath $agentsRoot -Recurse -File -Filter "models.json" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\agent\\models\.json$' }

  $updated = 0
  foreach ($file in $files) {
    try {
      $agentModels = Get-Content -Raw -LiteralPath $file.FullName | ConvertFrom-Json
      if ($null -eq $agentModels.providers) {
        $agentModels | Add-Member -MemberType NoteProperty -Name providers -Value ([PSCustomObject]@{}) -Force
      }

      $agentProvider = $agentModels.providers.$Provider
      if ($null -eq $agentProvider) {
        $agentProvider = [PSCustomObject]@{}
        $agentModels.providers | Add-Member -MemberType NoteProperty -Name $Provider -Value $agentProvider -Force
        if ($providerConfig.models) {
          Set-OrAddProperty -Object $agentProvider -Name "models" -Value $providerConfig.models
        }
      }

      Set-OrAddProperty -Object $agentProvider -Name "baseUrl" -Value $providerConfig.baseUrl
      Set-OrAddProperty -Object $agentProvider -Name "api" -Value $providerConfig.api
      Set-OrAddProperty -Object $agentProvider -Name "apiKey" -Value $providerConfig.apiKey

      $json = $agentModels | ConvertTo-Json -Depth 100
      [System.IO.File]::WriteAllText($file.FullName, $json + [Environment]::NewLine)
      $updated += 1
    } catch {
      Write-Warning ("Failed to sync agent runtime models file {0}: {1}" -f $file.FullName, $_.Exception.Message)
    }
  }

  return $updated
}

function Resolve-ConfigPath {
  param([string]$PathArg)
  if (-not [string]::IsNullOrWhiteSpace($PathArg)) {
    return (Resolve-Path -LiteralPath $PathArg).Path
  }
  $defaultPath = Join-Path $repoRoot ".openclaw-state\openclaw.windows.json"
  return $defaultPath
}

function Resolve-ProviderApiKey {
  param([object]$RawApiKey)

  if ($null -eq $RawApiKey) {
    return ""
  }
  if (-not ($RawApiKey -is [string])) {
    return ""
  }

  $value = $RawApiKey.Trim()
  if ($value -eq "") {
    return ""
  }

  if ($value -match '^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$') {
    $envName = $matches[1]
    $fromEnv = [Environment]::GetEnvironmentVariable($envName)
    if ($null -eq $fromEnv) {
      return ""
    }
    return $fromEnv
  }

  if ($value -match '^[A-Z][A-Z0-9_]+$') {
    $fromEnv = [Environment]::GetEnvironmentVariable($value)
    if (-not [string]::IsNullOrWhiteSpace($fromEnv)) {
      return $fromEnv
    }
  }

  return $value
}

function Resolve-ModelsEndpoint {
  param([string]$BaseUrl)

  $trimmedBase = ""
  if ($null -ne $BaseUrl) {
    $trimmedBase = $BaseUrl
  }
  $trimmed = $trimmedBase.Trim().TrimEnd("/")
  if ($trimmed -eq "") {
    throw "Provider baseUrl is empty."
  }

  if ($trimmed -match '/v1$') {
    return "$trimmed/models"
  }

  return "$trimmed/v1/models"
}

function Normalize-Ref {
  param([string]$Provider, [string]$ModelId)
  return "$Provider/$ModelId"
}

function Resolve-PreferredPrimary {
  param(
    [string[]]$ModelIds,
    [string]$Provider,
    [object]$CurrentPrimaryRaw,
    [string]$PreferredRaw
  )

  if ($ModelIds.Count -eq 0) {
    throw "No discovered model ids were provided."
  }

  $candidateRefs = @($ModelIds | ForEach-Object { Normalize-Ref -Provider $Provider -ModelId $_ })

  if (-not [string]::IsNullOrWhiteSpace($PreferredRaw)) {
    $preferred = $PreferredRaw.Trim()
    $preferredRef = if ($preferred.Contains("/")) { $preferred } else { Normalize-Ref -Provider $Provider -ModelId $preferred }
    if ($candidateRefs -contains $preferredRef) {
      return $preferredRef
    }
  }

  $currentPrimary = ""
  if ($CurrentPrimaryRaw -is [string]) {
    $currentPrimary = $CurrentPrimaryRaw.Trim()
  }
  if ($currentPrimary -ne "" -and ($candidateRefs -contains $currentPrimary)) {
    return $currentPrimary
  }

  $preferredByName = $ModelIds | Where-Object { $_ -match '(?i)qwen.*35b.*a3b' } | Select-Object -First 1
  if (-not [string]::IsNullOrWhiteSpace($preferredByName)) {
    return (Normalize-Ref -Provider $Provider -ModelId $preferredByName)
  }

  return $candidateRefs[0]
}

$resolvedConfigPath = Resolve-ConfigPath -PathArg $ConfigPath
if (-not (Test-Path -LiteralPath $resolvedConfigPath)) {
  throw "Config path not found: $resolvedConfigPath"
}

$cfg = Get-Content -Raw -LiteralPath $resolvedConfigPath | ConvertFrom-Json
if ($null -eq $cfg.models -or $null -eq $cfg.models.providers) {
  throw "Config is missing models.providers."
}

$provider = $cfg.models.providers.$ProviderId
if ($null -eq $provider) {
  throw "Config does not define models.providers.$ProviderId."
}

$endpoint = Resolve-ModelsEndpoint -BaseUrl $provider.baseUrl
$apiKey = Resolve-ProviderApiKey -RawApiKey $provider.apiKey

$headers = @{}
if (-not [string]::IsNullOrWhiteSpace($apiKey)) {
  $headers["Authorization"] = "Bearer $apiKey"
}

$response = Invoke-RestMethod -Method Get -Uri $endpoint -Headers $headers -TimeoutSec 12

$ids = @()
if ($response -and $response.data) {
  $ids = @(
    $response.data |
      Where-Object { $_ -and ($_.id -is [string]) -and (-not [string]::IsNullOrWhiteSpace($_.id)) } |
      ForEach-Object { $_.id.Trim() }
  )
}

$ids = @($ids | Sort-Object -Unique)
if ($QwenOnly) {
  $ids = @($ids | Where-Object { $_ -match '^(?i)qwen' })
}

if ($ids.Count -eq 0) {
  throw "No matching models discovered from $endpoint (QwenOnly=$QwenOnly)."
}

$provider.models = @(
  $ids | ForEach-Object {
    [PSCustomObject]@{
      id = $_
      name = $_
    }
  }
)

if ($null -eq $cfg.agents) {
  $cfg | Add-Member -MemberType NoteProperty -Name agents -Value ([PSCustomObject]@{}) -Force
}
if ($null -eq $cfg.agents.defaults) {
  $cfg.agents | Add-Member -MemberType NoteProperty -Name defaults -Value ([PSCustomObject]@{}) -Force
}
if ($null -eq $cfg.agents.defaults.model) {
  $cfg.agents.defaults | Add-Member -MemberType NoteProperty -Name model -Value ([PSCustomObject]@{}) -Force
}

$currentPrimaryRaw = $cfg.agents.defaults.model.primary
$chosenPrimary = Resolve-PreferredPrimary -ModelIds $ids -Provider $ProviderId -CurrentPrimaryRaw $currentPrimaryRaw -PreferredRaw $PreferredModel
$cfg.agents.defaults.model.primary = $chosenPrimary

$allowedRefs = @($ids | ForEach-Object { Normalize-Ref -Provider $ProviderId -ModelId $_ })
if ($UpdateAgentModels -and $cfg.agents.list) {
  foreach ($agent in $cfg.agents.list) {
    if ($null -eq $agent) {
      continue
    }
    $agentModel = ""
    if ($agent.model -is [string]) {
      $agentModel = $agent.model.Trim()
    }
    if ($agentModel -eq "" -or -not ($allowedRefs -contains $agentModel)) {
      $hasModelProperty = $null -ne ($agent | Get-Member -Name "model" -ErrorAction SilentlyContinue)
      if ($hasModelProperty) {
        $agent.model = $chosenPrimary
      } else {
        $agent | Add-Member -MemberType NoteProperty -Name model -Value $chosenPrimary -Force
      }
    }
  }
}

$json = $cfg | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($resolvedConfigPath, $json + [Environment]::NewLine)

$runtimeModelsUpdated = 0
if ($UpdateAgentModels) {
  $runtimeModelsUpdated = Sync-AgentRuntimeModelsFiles -Config $cfg -Provider $ProviderId
}

Write-Output ("RESULT status=ok provider={0} endpoint={1} models={2} primary={3}" -f $ProviderId, $endpoint, $ids.Count, $chosenPrimary)
Write-Output ("RESULT runtimeModelsUpdated={0}" -f $runtimeModelsUpdated)
