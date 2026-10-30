; Muse Carpathron installer extras
; Lets phones / the Quest on the SAME local network reach the app (pairing page, Quest VR, phone camera).
; The app only listens on the network when "Allow phones and Quest on this network" is switched on in
; Settings (off by default: this PC only), and pairing needs a PIN shown on the PC. Home Wi-Fi is often
; marked "Public" by Windows, so the rule covers every profile but only accepts the local subnet.
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Muse Carpathron"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Muse Carpathron (port 8443)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Muse Carpathron"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Muse Carpathron (port 8443)"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Muse Carpathron" dir=in action=allow program="$INSTDIR\Carpathron.exe" enable=yes profile=any remoteip=localsubnet'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Muse Carpathron (port 8443)" dir=in action=allow protocol=TCP localport=8443 enable=yes profile=any remoteip=localsubnet'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Muse Carpathron"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Muse Carpathron (port 8443)"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Muse Carpathron"'
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Muse Carpathron (port 8443)"'
!macroend
