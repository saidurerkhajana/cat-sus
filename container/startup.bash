#!/bin/bash
set -e
sudo npm i -g adm-zip archiver axios dotenv pm2
sudo pm2 start data.js --name "data-app"
exit 0
