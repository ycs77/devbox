#!/bin/sh
set -eu

if [ $# -gt 0 ]; then
  exec gosu devbox "$@"
else
  exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
