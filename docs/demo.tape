# agentmeter demo — render with:  vhs docs/demo.tape   (https://github.com/charmbracelet/vhs)
# First build the sample data:  node docs/build-demo-fixture.mjs   (creates ~/agent-demo-projects)
# Runs against that synthetic transcript root — no real spend or private data.
# Produces docs/demo.gif, embedded in the README.
Output docs/demo.gif

Set FontSize 14
Set Width 1180
Set Height 1240
Set Padding 24
Set Theme "Dracula"
Set TypingSpeed 45ms

Type "agentmeter ~/agent-demo-projects"
Sleep 500ms
Enter
Sleep 5s
