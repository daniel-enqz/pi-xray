# Records docs/demo.gif with vhs (https://github.com/charmbracelet/vhs).
#   1. demo/setup.sh       builds a clean agent dir in /tmp/pi-xray-demo
#   2. run pi once with PI_CODING_AGENT_DIR=/tmp/pi-xray-demo so it installs the packages
#   3. vhs demo/xray.tape
Output docs/demo.gif
Set Shell "bash"
Set FontSize 16
Set Width 1300
Set Height 760
Set Padding 18
Set Framerate 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 70ms

Hide
Type "PI_CODING_AGENT_DIR=/tmp/pi-xray-demo pi --no-session" Enter
Sleep 7s
Show

# the overview: every group, biggest first
Type "/xray" Sleep 500ms Enter
Sleep 3s
# open the heaviest package down to its tools
Right Sleep 700ms
Down Sleep 500ms Right Sleep 2.5s
# back to the package row and mark it off
Left Sleep 400ms Left Sleep 400ms Left Sleep 700ms
Space Sleep 3s
# apply: writes settings.json and reloads pi
Type "a" Sleep 3s
# the same view after the reload: the package is off, the total dropped
Type "/xray" Sleep 500ms Enter
Sleep 4.5s
