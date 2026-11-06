#!/bin/sh
echo "Hello from Docksmith sample app"
echo "APP_NAME=${APP_NAME}"
if [ -f /app/build.txt ]; then
  echo "BUILD_MARKER=$(cat /app/build.txt)"
fi
# demo change
# demo change
# demo change
