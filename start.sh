#!/bin/sh
cd "$(dirname "$0")"
exec python3 puppe_server.py "$@"
