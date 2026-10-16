# Records docs/demo.gif with vhs (https://github.com/charmbracelet/vhs).
#   1. DEMO_MODEL=<provider/model you can use> demo/setup.sh
#      builds a clean agent dir, a sample project with AGENTS.md/CLAUDE.md files,
#      and a long work session with heavy tool results
#   2. run pi once in that agent dir so it installs the packages
#   3. vhs demo/xray.tape
Output docs/demo.gif
Set Shell "bash"
Set FontSize 16
Set Width 1300
Set Height 780
Set Padding 18
Set Framerate 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 70ms

Hide
Type "cd /tmp/pi-xray-demo-work/notes-app && PI_OFFLINE=1 PI_CODING_AGENT_DIR=/tmp/pi-xray-demo pi --continue" Enter
Sleep 7s
Show

# mid-session: a long afternoon of work in one conversation
Sleep 1.5s
Type "/xray" Sleep 500ms Enter
Sleep 3s
# the conversation itself, and which tool results weigh the most
Right Sleep 3.5s
Left Sleep 500ms
# the memory files pi loaded: global, workspace and project
Type "/" Sleep 300ms Type "agents.md" Sleep 400ms Enter
Sleep 3.5s
Escape Sleep 600ms
# find a package and mark it off
Type "/" Sleep 300ms Type "pi-sub" Sleep 400ms Enter
Sleep 800ms
Type "g" Sleep 400ms Space
Sleep 2.5s
Escape Sleep 500ms
# apply: writes settings.json and reloads pi
Type "a" Sleep 3s
Type "/xray" Sleep 500ms Enter
Sleep 4.5s
