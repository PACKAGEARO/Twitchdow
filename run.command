#!/bin/bash
cd "$(dirname "$0")"
lsof -ti:9876 -ti:19876 2>/dev/null | xargs kill -9 2>/dev/null
npm start
