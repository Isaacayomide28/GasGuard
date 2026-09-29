# Scheduled Repository Scans

GasGuard supports automated, scheduled security and gas optimization scans to ensure continuous monitoring of smart contracts without manual intervention.

## Configuration
Scheduled scans are managed via GitHub Actions workflow (`.github/workflows/scheduled-scan.yml`). 

### Customizing the Schedule
To modify the cron schedule, edit the cron expression in `.github/workflows/scheduled-scan.yml`:
```yaml
on:
  schedule:
    - cron: '0 2 * * *' # Runs daily at 02:00 UTC