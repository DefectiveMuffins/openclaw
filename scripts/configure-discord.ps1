param(
  [Parameter(Mandatory = $true)]
  [string]$ConfigPath,
  [string]$RequireMention = "true"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ensure-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)]$Parent,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $property = $Parent.PSObject.Properties[$Name]
  if ($null -eq $property -or $null -eq $property.Value) {
    $obj = [pscustomobject]@{}
    if ($null -eq $property) {
      $Parent | Add-Member -NotePropertyName $Name -NotePropertyValue $obj
    } else {
      $Parent.$Name = $obj
    }
    return $obj
  }

  if ($property.Value -isnot [pscustomobject]) {
    $obj = [pscustomobject]@{}
    $Parent.$Name = $obj
    return $obj
  }

  return $property.Value
}

function Set-ObjectProperty {
  param(
    [Parameter(Mandatory = $true)]$Parent,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)]$Value
  )

  $property = $Parent.PSObject.Properties[$Name]
  if ($null -eq $property) {
    $Parent | Add-Member -NotePropertyName $Name -NotePropertyValue $Value
  } else {
    $Parent.$Name = $Value
  }
}

$requireMentionValue = $true
switch -Regex ($RequireMention.Trim().ToLowerInvariant()) {
  "^(false|0|no|n)$" { $requireMentionValue = $false; break }
  default { $requireMentionValue = $true; break }
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Config file not found: $ConfigPath"
}

$raw = Get-Content -LiteralPath $ConfigPath -Raw
$cfg = $raw | ConvertFrom-Json

$channels = Ensure-ObjectProperty -Parent $cfg -Name "channels"
$discord = Ensure-ObjectProperty -Parent $channels -Name "discord"

Set-ObjectProperty -Parent $discord -Name "enabled" -Value $true
Set-ObjectProperty -Parent $discord -Name "groupPolicy" -Value "allowlist"

if (-not $discord.PSObject.Properties["streaming"]) {
  $discord | Add-Member -NotePropertyName "streaming" -NotePropertyValue "off"
}

$token = [string]$env:OC_DISCORD_TOKEN
if (-not [string]::IsNullOrWhiteSpace($token)) {
  Set-ObjectProperty -Parent $discord -Name "token" -Value $token.Trim()
}

$guildId = [string]$env:OC_DISCORD_GUILD_ID
$userId = [string]$env:OC_DISCORD_USER_ID

if (-not [string]::IsNullOrWhiteSpace($guildId)) {
  $guildId = $guildId.Trim()
  $guilds = Ensure-ObjectProperty -Parent $discord -Name "guilds"
  $guildProperty = $guilds.PSObject.Properties[$guildId]
  if ($null -eq $guildProperty -or $guildProperty.Value -isnot [pscustomobject]) {
    $guildObj = [pscustomobject]@{}
    if ($null -eq $guildProperty) {
      $guilds | Add-Member -NotePropertyName $guildId -NotePropertyValue $guildObj
    } else {
      $guilds.$guildId = $guildObj
    }
  } else {
    $guildObj = $guildProperty.Value
  }

  Set-ObjectProperty -Parent $guildObj -Name "requireMention" -Value $requireMentionValue

  if (-not [string]::IsNullOrWhiteSpace($userId)) {
    Set-ObjectProperty -Parent $guildObj -Name "users" -Value @($userId.Trim())
  }
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$json = $cfg | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($ConfigPath, $json + [Environment]::NewLine, $utf8NoBom)

Write-Host "Discord config updated in $ConfigPath"
if (-not [string]::IsNullOrWhiteSpace($token)) {
  Write-Host "Token: set in channels.discord.token"
} else {
  Write-Host "Token: unchanged (none supplied)"
}
if (-not [string]::IsNullOrWhiteSpace($guildId)) {
  Write-Host "Guild allowlist: $guildId (requireMention=$requireMentionValue)"
  if (-not [string]::IsNullOrWhiteSpace($userId)) {
    Write-Host "Guild users allowlist: $userId"
  }
}
