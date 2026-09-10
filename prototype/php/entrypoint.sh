#!/usr/bin/env bash

if [ "$SUPERVISOR_PHP_USER" != "root" ] && [ "$SUPERVISOR_PHP_USER" != "devbox" ]; then
  echo "You should set SUPERVISOR_PHP_USER to either 'devbox' or 'root'."
  exit 1
fi

if [ ! -d /.composer ]; then
  mkdir /.composer
fi

chmod -R ugo+rw /.composer

if [ $# -gt 0 ]; then
  if [ "$SUPERVISOR_PHP_USER" = "root" ]; then
    exec "$@"
  else
    exec gosu "$SUPERVISOR_PHP_USER" "$@"
  fi
else
  exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
fi
