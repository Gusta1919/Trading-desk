set appPath to POSIX path of (path to me)
set projectDir to do shell script "dirname " & quoted form of appPath
set launchScript to projectDir & "/scripts/launch.sh"
do shell script "export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; bash " & quoted form of launchScript
