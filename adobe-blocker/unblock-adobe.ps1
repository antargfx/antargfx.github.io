Write-Host ""
Write-Host "Removing Adobe firewall blocks..." -ForegroundColor Cyan

Get-NetFirewallRule -DisplayName "AdobeBlock_*" | Remove-NetFirewallRule

Write-Host ""
Write-Host "All Adobe firewall rules removed." -ForegroundColor Green

pause
