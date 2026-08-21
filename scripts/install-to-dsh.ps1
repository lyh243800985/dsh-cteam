param(
  [string]$DshHome = "",
  [string]$Profile = "web",
  [string]$ProfileDir = "",
  [string]$PluginPath = "",
  [switch]$InstallDependencies,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$PathValue) {
  return [System.IO.Path]::GetFullPath($PathValue)
}

function To-LinkPath([string]$PathValue) {
  return (Resolve-FullPath $PathValue).Replace('\', '/')
}

function Ensure-ObjectProperty($Object, [string]$Name, $DefaultValue) {
  if (-not ($Object.PSObject.Properties.Name -contains $Name) -or $null -eq $Object.$Name) {
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $DefaultValue
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pluginRoot = Resolve-FullPath (Join-Path $scriptDir "..")
if ($PluginPath) {
  $pluginRoot = Resolve-FullPath $PluginPath
}

$harnessRoot = Resolve-FullPath (Join-Path $pluginRoot "..\..")
if (-not $DshHome) {
  if ($env:DSH_HOME) {
    $DshHome = $env:DSH_HOME
  } else {
    $DshHome = Join-Path $harnessRoot "dsh-home"
  }
}

if (-not $ProfileDir) {
  $ProfileDir = Join-Path (Resolve-FullPath $DshHome) (Join-Path "profiles" $Profile)
}
$ProfileDir = Resolve-FullPath $ProfileDir

$pluginPackagePath = Join-Path $pluginRoot "package.json"
if (-not (Test-Path -LiteralPath $pluginPackagePath)) {
  throw "Plugin package.json not found: $pluginPackagePath"
}
$pluginPackage = Get-Content -LiteralPath $pluginPackagePath -Raw | ConvertFrom-Json
$pluginName = [string]$pluginPackage.name
if (-not $pluginName) {
  throw "Plugin package.json is missing name"
}

$profilePackagePath = Join-Path $ProfileDir "package.json"
if (-not (Test-Path -LiteralPath $profilePackagePath)) {
  throw "DSH profile package.json not found: $profilePackagePath"
}

$profilePackage = Get-Content -LiteralPath $profilePackagePath -Raw | ConvertFrom-Json
Ensure-ObjectProperty $profilePackage "dependencies" ([pscustomobject]@{})
Ensure-ObjectProperty $profilePackage "dsh" ([pscustomobject]@{})
Ensure-ObjectProperty $profilePackage.dsh "profile" ([pscustomobject]@{})
Ensure-ObjectProperty $profilePackage.dsh.profile "bundles" @()

$dependencySpecifier = "link:$(To-LinkPath $pluginRoot)"
if ($profilePackage.dependencies.PSObject.Properties.Name -contains $pluginName) {
  $profilePackage.dependencies.$pluginName = $dependencySpecifier
} else {
  $profilePackage.dependencies | Add-Member -MemberType NoteProperty -Name $pluginName -Value $dependencySpecifier
}

$bundles = @($profilePackage.dsh.profile.bundles)
if ($bundles -notcontains $pluginName) {
  $profilePackage.dsh.profile.bundles = @($bundles + $pluginName)
}

$nextJson = $profilePackage | ConvertTo-Json -Depth 32
if ($DryRun) {
  Write-Output "Would update: $profilePackagePath"
  Write-Output "Dependency: $pluginName = $dependencySpecifier"
  Write-Output "Bundle: $pluginName"
} else {
  Set-Content -LiteralPath $profilePackagePath -Value $nextJson -Encoding UTF8
  Write-Output "Updated DSH profile package: $profilePackagePath"
  Write-Output "Dependency: $pluginName = $dependencySpecifier"
  Write-Output "Bundle: $pluginName"
}

if ($InstallDependencies) {
  if ($DryRun) {
    Write-Output "Would run: pnpm install --dir `"$ProfileDir`""
  } else {
    pnpm install --dir $ProfileDir
  }
} else {
  Write-Output "Next step: run pnpm install --dir `"$ProfileDir`", then restart DSH."
}
