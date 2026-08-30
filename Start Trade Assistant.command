#!/bin/bash
cd "$(dirname "$0")"
npm start &
sleep 3
open http://localhost:3847
