// Carpathron Remote — ready-made, read-only check scripts the AI technician (and the technician by hand) can run on
// the remote computer: Windows (PowerShell) and Linux (bash). They only read; nothing is changed.
'use strict';

const PS = {
  overview: String.raw`
$o = Get-CimInstance Win32_OperatingSystem; $c = Get-CimInstance Win32_ComputerSystem; $p = Get-CimInstance Win32_Processor | Select-Object -First 1
"Computer: $env:COMPUTERNAME  User: $env:USERNAME  Admin: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"
"Windows: $($o.Caption) $($o.Version) build $($o.BuildNumber) ($($o.OSArchitecture)), installed $($o.InstallDate)"
"Model: $($c.Manufacturer) $($c.Model)  CPU: $($p.Name) ($($p.NumberOfCores) cores)  RAM: $([math]::Round($c.TotalPhysicalMemory/1GB,1)) GB, free $([math]::Round($o.FreePhysicalMemory/1MB,1)) GB"
"Up since: $($o.LastBootUpTime)"
"--- Disks"; Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "{0} {1,8:N1} GB free of {2,8:N1} GB ({3:N0}% free) {4}" -f $_.DeviceID, ($_.FreeSpace/1GB), ($_.Size/1GB), (100*$_.FreeSpace/[math]::Max(1,$_.Size)), $_.FileSystem }
"--- Busiest processes (CPU s, memory MB)"; Get-Process | Sort-Object CPU -Descending | Select-Object -First 8 | ForEach-Object { "{0,-28} {1,8:N0} {2,8:N0}" -f $_.ProcessName, $_.CPU, ($_.WorkingSet64/1MB) }`,
  disks: String.raw`
"--- Volumes"; Get-Volume | Where-Object DriveLetter | Sort-Object DriveLetter | ForEach-Object { "{0}: {1,-10} {2,-6} {3,9:N1} GB free of {4,9:N1} GB  health {5}" -f $_.DriveLetter, $_.FileSystemLabel, $_.FileSystem, ($_.SizeRemaining/1GB), ($_.Size/1GB), $_.HealthStatus }
"--- Physical disks"; Get-PhysicalDisk | ForEach-Object { "{0} {1} {2,7:N0} GB  {3}  health {4}  {5}" -f $_.DeviceId, $_.FriendlyName, ($_.Size/1GB), $_.MediaType, $_.HealthStatus, $_.OperationalStatus }
try { "--- Reliability (wear, temperature, errors)"; Get-PhysicalDisk | Get-StorageReliabilityCounter -ErrorAction Stop | ForEach-Object { "disk {0}: wear {1}% temp {2}C read errors {3} write errors {4}" -f $_.DeviceId, $_.Wear, $_.Temperature, $_.ReadErrorsTotal, $_.WriteErrorsTotal } } catch { "(needs administrator)" }
"--- Partitions"; Get-Partition | ForEach-Object { "disk {0} part {1} {2,-3} {3,8:N1} GB {4}" -f $_.DiskNumber, $_.PartitionNumber, $_.DriveLetter, ($_.Size/1GB), $_.Type }
"--- Largest folders in the user profile (GB)"; Get-ChildItem $env:USERPROFILE -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { $s = (Get-ChildItem $_.FullName -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; [pscustomobject]@{ N = $_.Name; G = [math]::Round($s/1GB,2) } } | Sort-Object G -Descending | Select-Object -First 10 | ForEach-Object { "{0,7} {1}" -f $_.G, $_.N }
"--- Temp + recycle bin (GB)"; "{0:N2} user temp, {1:N2} Windows temp" -f ((Get-ChildItem $env:TEMP -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1GB), ((Get-ChildItem "$env:SystemRoot\Temp" -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum/1GB)`,
  security: String.raw`
"--- Microsoft Defender"; try { $d = Get-MpComputerStatus -ErrorAction Stop; "Antivirus on: $($d.AntivirusEnabled)  Real-time: $($d.RealTimeProtectionEnabled)  Tamper protection: $($d.IsTamperProtected)"; "Signatures: $($d.AntivirusSignatureVersion) updated $($d.AntivirusSignatureLastUpdated) ($([int]((Get-Date)-$d.AntivirusSignatureLastUpdated).TotalDays) days)"; "Last quick scan: $($d.QuickScanEndTime)  Last full scan: $($d.FullScanEndTime)"; "Threats found recently:"; Get-MpThreatDetection -ErrorAction SilentlyContinue | Select-Object -First 5 | ForEach-Object { "  $($_.InitialDetectionTime) $($_.ThreatID) $($_.Resources -join ', ')" } } catch { "Defender status not available: $($_.Exception.Message)" }
"--- Other antivirus"; try { Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct -ErrorAction Stop | ForEach-Object { "$($_.displayName) (state $($_.productState))" } } catch { "(not available)" }
"--- Firewall"; Get-NetFirewallProfile | ForEach-Object { "{0,-8} enabled {1}  inbound {2}  outbound {3}" -f $_.Name, $_.Enabled, $_.DefaultInboundAction, $_.DefaultOutboundAction }
"--- Windows Update"; try { $s = New-Object -ComObject Microsoft.Update.Session; $r = $s.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0"); "Missing updates: $($r.Updates.Count)"; foreach ($u in $r.Updates) { "  $($u.Title)$(if ($u.MsrcSeverity) { ' [' + $u.MsrcSeverity + ']' })" } } catch { "Update search failed: $($_.Exception.Message)" }
"Last installed: " + ((Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 3 | ForEach-Object { "$($_.HotFixID) $($_.InstalledOn)" }) -join '; ')
"--- Accounts"; Get-LocalUser | ForEach-Object { "{0,-20} enabled {1}  password required {2}  last logon {3}" -f $_.Name, $_.Enabled, $_.PasswordRequired, $_.LastLogon }
"Administrators: " + ((Get-LocalGroupMember -SID S-1-5-32-544 -ErrorAction SilentlyContinue | ForEach-Object Name) -join ', ')
"--- Settings"; $uac = (Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -ErrorAction SilentlyContinue).EnableLUA; "UAC on: $([bool]$uac)"
"Remote Desktop (RDP) on: $(-not [bool](Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -ErrorAction SilentlyContinue).fDenyTSConnections)"
try { "SMBv1 on: $((Get-SmbServerConfiguration -ErrorAction Stop).EnableSMB1Protocol)" } catch { "SMBv1: (needs administrator)" }
try { Get-BitLockerVolume -ErrorAction Stop | ForEach-Object { "BitLocker $($_.MountPoint): $($_.ProtectionStatus) $($_.VolumeStatus)" } } catch { "BitLocker: (needs administrator or not available)" }
try { "Secure Boot: $(Confirm-SecureBootUEFI -ErrorAction Stop)" } catch { "Secure Boot: unknown" }
"--- Listening ports (outside this PC)"; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') } | Sort-Object LocalPort -Unique | ForEach-Object { "{0,-6} {1}" -f $_.LocalPort, (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName }`,
  software: String.raw`
$keys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*','HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
$apps = Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object DisplayName | Sort-Object DisplayName -Unique
"--- Installed programs ($($apps.Count))"; $apps | ForEach-Object { "{0} | {1} | {2}" -f $_.DisplayName, $_.DisplayVersion, $_.Publisher }
"--- Updates available (winget)"; if (Get-Command winget -ErrorAction SilentlyContinue) { winget upgrade --accept-source-agreements --disable-interactivity 2>&1 | Out-String -Width 200 } else { "winget is not installed (App Installer from the Microsoft Store)" }`,
  updates: String.raw`
try { $s = New-Object -ComObject Microsoft.Update.Session; $r = $s.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0"); "Windows updates missing: $($r.Updates.Count)"; foreach ($u in $r.Updates) { "  $($u.Title) $(if ($u.MsrcSeverity) { '[' + $u.MsrcSeverity + ']' }) $(if ($u.IsDownloaded) { '(downloaded)' })" } } catch { "Update search failed: $($_.Exception.Message)" }
"Reboot pending: $((Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'))"
"--- Program updates (winget)"; if (Get-Command winget -ErrorAction SilentlyContinue) { winget upgrade --accept-source-agreements --disable-interactivity 2>&1 | Out-String -Width 200 } else { "winget is not installed" }`,
  network: String.raw`
Get-NetIPConfiguration | ForEach-Object { "{0}: {1} gw {2} dns {3}" -f $_.InterfaceAlias, ($_.IPv4Address.IPAddress -join ','), ($_.IPv4DefaultGateway.NextHop -join ','), ($_.DNSServer.ServerAddresses -join ',') }
"--- Adapters"; Get-NetAdapter | ForEach-Object { "{0,-28} {1,-12} {2} {3}" -f $_.Name, $_.Status, $_.LinkSpeed, $_.MacAddress }
"--- Internet"; foreach ($h in 'dns.google','qubitpage.com') { try { $t = Test-NetConnection $h -Port 443 -WarningAction SilentlyContinue; "{0}: {1} ({2} ms)" -f $h, $t.TcpTestSucceeded, $t.PingReplyDetails.RoundtripTime } catch { "$!{h}: failed" } }
"--- Wi-Fi"; netsh wlan show interfaces 2>$null | Select-String 'SSID|Signal|Receive rate|Radio type' | ForEach-Object { $_.Line.Trim() }
"--- Proxy"; netsh winhttp show proxy 2>$null | Select-String 'Direct|Proxy' | ForEach-Object { $_.Line.Trim() }`,
  startup: String.raw`
"--- Startup programs"; Get-CimInstance Win32_StartupCommand | ForEach-Object { "{0} | {1} | {2}" -f $_.Name, $_.Command, $_.Location }
"--- Scheduled tasks (not Microsoft)"; Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' -and $_.State -ne 'Disabled' } | ForEach-Object { "{0}{1} | {2}" -f $_.TaskPath, $_.TaskName, (($_.Actions | ForEach-Object Execute) -join ' ') }
"--- Services set to start automatically but stopped"; Get-CimInstance Win32_Service -Filter "StartMode='Auto' and State<>'Running'" | ForEach-Object { "{0} ({1})" -f $_.Name, $_.DisplayName }`,
  events: String.raw`
"--- Errors in the last 3 days (System + Application)"; Get-WinEvent -FilterHashtable @{ LogName = 'System','Application'; Level = 1,2; StartTime = (Get-Date).AddDays(-3) } -MaxEvents 40 -ErrorAction SilentlyContinue | ForEach-Object { "{0:yyyy-MM-dd HH:mm} {1} [{2}] {3}" -f $_.TimeCreated, $_.LogName, $_.ProviderName, (($_.Message -split "\n")[0]) }
"--- Unexpected shutdowns and crashes"; Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41,6008,1001 } -MaxEvents 10 -ErrorAction SilentlyContinue | ForEach-Object { "{0:yyyy-MM-dd HH:mm} id {1} {2}" -f $_.TimeCreated, $_.Id, (($_.Message -split "\n")[0]) }`,
};

const SH = {
  overview: String.raw`
echo "Host: $(hostname)  User: $(id -un)  root: $([ "$(id -u)" = 0 ] && echo yes || echo no)  sudo without password: $(sudo -n true 2>/dev/null && echo yes || echo no)"
. /etc/os-release 2>/dev/null; echo "System: $!{PRETTY_NAME:-$(uname -s)} kernel $(uname -r) ($(uname -m))"
echo "CPU: $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs) ($(nproc) cores)  load: $(cut -d' ' -f1-3 /proc/loadavg)"
free -h | sed -n '1,3p'; echo "Up: $(uptime -p 2>/dev/null)"
echo "--- Disks"; df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null
echo "--- Busiest processes"; ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu | head -9
echo "--- Services that failed"; systemctl --failed --no-legend 2>/dev/null | head -20`,
  disks: String.raw`
df -hT -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null; echo "--- Inodes"; df -i -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | awk 'NR==1||$5+0>50'
echo "--- Block devices"; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL 2>/dev/null
echo "--- SMART"; if command -v smartctl >/dev/null; then for d in $(lsblk -dno NAME 2>/dev/null); do sudo -n smartctl -H /dev/$d 2>/dev/null | grep -i 'result\|status' | sed "s|^|$d: |"; done; else echo "smartctl not installed (apt install smartmontools)"; fi
echo "--- Biggest folders in /var, /home, /opt, /tmp"; timeout 45 du -xsh /var/* /home/* /opt/* /tmp 2>/dev/null | sort -rh | head -15
echo "--- Journal size"; journalctl --disk-usage 2>/dev/null; echo "--- Docker"; command -v docker >/dev/null && docker system df 2>/dev/null`,
  security: String.raw`
. /etc/os-release 2>/dev/null; echo "System: $!{PRETTY_NAME:-?} kernel $(uname -r)"
echo "--- Firewall"; (sudo -n ufw status verbose 2>/dev/null || sudo -n firewall-cmd --list-all 2>/dev/null || sudo -n nft list ruleset 2>/dev/null | head -40 || echo "firewall status needs sudo / no firewall tool found")
echo "--- Listening ports"; (ss -tulpn 2>/dev/null || netstat -tulpn 2>/dev/null) | head -40
echo "--- SSH settings"; sshd -T 2>/dev/null | grep -Ei '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|x11forwarding) ' || grep -Ei '^(Port|PermitRootLogin|PasswordAuthentication|PubkeyAuthentication)' /etc/ssh/sshd_config 2>/dev/null
echo "--- fail2ban"; (sudo -n fail2ban-client status 2>/dev/null || echo "fail2ban not running")
echo "--- Security updates"; if command -v apt >/dev/null; then apt list --upgradable 2>/dev/null | grep -i security | head -40; echo "all upgradable: $(apt list --upgradable 2>/dev/null | grep -c upgradable)"; echo "unattended-upgrades: $(dpkg -l unattended-upgrades 2>/dev/null | grep -c ^ii)"; elif command -v dnf >/dev/null; then dnf -q updateinfo list security 2>/dev/null | head -40; fi
echo "--- Reboot needed"; [ -f /var/run/reboot-required ] && cat /var/run/reboot-required || echo no
echo "--- Users with a login shell"; awk -F: '$7 !~ /(nologin|false)$/ {print $1" uid="$3" "$7}' /etc/passwd
echo "--- sudo group"; getent group sudo wheel 2>/dev/null
echo "--- Last logins"; last -n 8 2>/dev/null | head -8; echo "--- Failed logins (24 h)"; (journalctl -u ssh -u sshd --since "24 hours ago" 2>/dev/null | grep -ci 'failed\|invalid') || true
echo "--- Antivirus"; (command -v clamscan >/dev/null && clamscan --version) || echo "ClamAV not installed"`,
  software: String.raw`
if command -v dpkg >/dev/null; then echo "--- Packages: $(dpkg -l | grep -c ^ii)"; apt list --upgradable 2>/dev/null | head -60; elif command -v rpm >/dev/null; then echo "--- Packages: $(rpm -qa | wc -l)"; dnf -q check-update 2>/dev/null | head -60; fi
echo "--- Snap / Flatpak"; command -v snap >/dev/null && snap list 2>/dev/null | head -20; command -v flatpak >/dev/null && flatpak list 2>/dev/null | head -20
echo "--- Services running"; systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | head -60
echo "--- Docker"; command -v docker >/dev/null && docker ps --format '{{.Names}}  {{.Image}}  {{.Status}}' 2>/dev/null`,
  updates: String.raw`
if command -v apt >/dev/null; then echo "upgradable: $(apt list --upgradable 2>/dev/null | grep -c upgradable)"; apt list --upgradable 2>/dev/null | head -80; elif command -v dnf >/dev/null; then dnf -q check-update 2>/dev/null | head -80; fi
echo "Reboot needed: $([ -f /var/run/reboot-required ] && echo yes || echo no)"`,
  network: String.raw`
ip -br addr 2>/dev/null; echo "--- Routes"; ip route 2>/dev/null | head; echo "--- DNS"; (resolvectl status 2>/dev/null | grep -i 'dns server' | head -4) || cat /etc/resolv.conf
echo "--- Internet"; for h in dns.google qubitpage.com; do (timeout 5 bash -c "</dev/tcp/$h/443" 2>/dev/null && echo "$h:443 ok") || echo "$h:443 failed"; done`,
  startup: String.raw`
systemctl list-unit-files --state=enabled --no-legend 2>/dev/null | head -80; echo "--- cron"; crontab -l 2>/dev/null; ls /etc/cron.d 2>/dev/null`,
  events: String.raw`
journalctl -p err -b --no-pager -n 50 2>/dev/null || dmesg --level=err,crit 2>/dev/null | tail -40; echo "--- Kernel OOM / disk errors"; dmesg 2>/dev/null | grep -Ei 'oom|i/o error|ext4-fs error|xfs.*error' | tail -15`,
};

const KINDS = ['overview', 'disks', 'security', 'software', 'updates', 'network', 'startup', 'events'];
// (inside the templates above ${ is written $!{ so JavaScript does not read it; it is put back here)
function script(kind, os) { const set = /win/i.test(String(os || '')) ? PS : SH; return set[kind] ? set[kind].replace(/\$!\{/g, '${') : null; }

module.exports = { PS, SH, KINDS, script };
