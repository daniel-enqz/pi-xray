# Records docs/demo.gif with https://github.com/charmbracelet/vhs
# 1. demo/setup.sh   2. vhs demo/xray.tape
Output docs/demo.gif
Set Shell "bash"
Set FontSize 15
Set Width 1280
Set Height 760
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 60ms

Hide
Type "PI_CODING_AGENT_DIR=/tmp/pi-xray-demo pi --no-session" Enter
Sleep 8s
Show

Type "/xray" Sleep 400ms Enter
Sleep 2.5s
# open the biggest package, then its first extension
Down Sleep 500ms Right Sleep 1.2s
Down Sleep 500ms Right Sleep 1.5s
# expand everything, then search
Type "e" Sleep 1.5s
Type "e" Sleep 800ms
Type "/" Sleep 300ms Type "sql" Sleep 600ms Enter Sleep 1s
Down Sleep 400ms Space Sleep 1.5s
Escape Sleep 800ms
# apply: writes settings.json and reloads pi
Type "a" Sleep 6s
Type "/xray" Sleep 400ms Enter
Sleep 3s
Escape
