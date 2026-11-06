@echo off
echo Hello from Docksmith sample app
echo APP_NAME=%APP_NAME%
if exist build.txt (
  set /p BUILD_MARKER=<build.txt
  call echo BUILD_MARKER=%%BUILD_MARKER%%
)
