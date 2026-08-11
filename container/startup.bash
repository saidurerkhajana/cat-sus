#!/bin/bash

# Install global npm packages
sudo npm i -g adm-zip archiver axios dotenv pm2

# Start the application with PM2 and assign a name
sudo pm2 start data.js --name "data"
