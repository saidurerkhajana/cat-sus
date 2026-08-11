const fs = require('fs');
const { exec } = require('child_process');
const AdmZip = require('adm-zip');
const archiver = require('archiver');
const axios = require('axios');
require('dotenv').config();

const ENV_ZIP = './.env.zip';
const ENV_FILE = './.env';
const SOURCE_DIR = './cat-sus';
const ZIP_OUTPUT = './cat-sus.zip';
const LAST_MSG_ID_FILE = './last_msg_id.txt';
const LAST_FILE_ID_FILE = './last_file_id.txt';

function unzipEnv() {
  if (!fs.existsSync(ENV_ZIP)) throw new Error(`File not found: ${ENV_ZIP}`);
  new AdmZip(ENV_ZIP).extractAllTo('./', true);
  console.log('.env.zip extracted');
}

function loadEnv() {
  const result = require('dotenv').config({ path: ENV_FILE });
  if (result.error) throw new Error('Failed to load .env: ' + result.error.message);
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHANNEL_ID)
    throw new Error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID');
  console.log('Environment loaded');
}

async function downloadPreviousZip() {
  const fileId = (() => {
    try { return fs.readFileSync(LAST_FILE_ID_FILE, 'utf8').trim(); } catch { return null; }
  })();
  if (!fileId) {
    console.log('No previous file ID found, skipping download.');
    return;
  }
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const getFileResp = await axios.get(`https://api.telegram.org/bot${token}/getFile`, {
      params: { file_id: fileId }
    });
    if (!getFileResp.data.ok) throw new Error(getFileResp.data.description);
    const filePath = getFileResp.data.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const writer = fs.createWriteStream(ZIP_OUTPUT);
    const response = await axios({ url: downloadUrl, method: 'GET', responseType: 'stream' });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    console.log('Previous cat-sus.zip downloaded from channel');
    const zip = new AdmZip(ZIP_OUTPUT);
    zip.extractAllTo(SOURCE_DIR, true);
    console.log('Extracted into cat-sus/');
  } catch (err) {
    console.warn('Could not download/extract previous zip:', err.message);
    if (fs.existsSync(ZIP_OUTPUT)) fs.unlinkSync(ZIP_OUTPUT);
  }
}

function runNpmInstall() {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOURCE_DIR)) {
      console.log('cat-sus/ directory missing, skipping npm install');
      return resolve();
    }
    console.log('Running npm install in cat-sus/');
    exec('npm install', { cwd: SOURCE_DIR }, (error, stdout, stderr) => {
      if (error) console.warn('npm install error:', stderr || error.message);
      else console.log('npm install completed');
      resolve();
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createCatSusZip() {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(ZIP_OUTPUT);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => {
      console.log(`cat-sus.zip created (${archive.pointer()} bytes)`);
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.glob('**/*', {
      cwd: SOURCE_DIR,
      ignore: ['node_modules/**', 'package-lock.json'],
      dot: true
    });
    archive.finalize();
  });
}

function getPreviousMessageId() {
  try { return Number(fs.readFileSync(LAST_MSG_ID_FILE, 'utf8').trim()) || null; } catch { return null; }
}

function saveMessageId(msgId) { fs.writeFileSync(LAST_MSG_ID_FILE, String(msgId)); }
function saveFileId(fileId) { fs.writeFileSync(LAST_FILE_ID_FILE, String(fileId)); }

async function deleteMessage(messageId) {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/deleteMessage`;
  try {
    await axios.post(url, { chat_id: process.env.TELEGRAM_CHANNEL_ID, message_id: messageId });
    console.log(`Previous message ${messageId} deleted`);
  } catch (err) {
    console.warn(`Could not delete message ${messageId}:`, err.response?.data || err.message);
  }
}

async function uploadZip() {
  const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendDocument`;
  const form = new FormData();
  form.append('chat_id', process.env.TELEGRAM_CHANNEL_ID);
  form.append('document', fs.createReadStream(ZIP_OUTPUT), 'cat-sus.zip');
  const response = await axios.post(url, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });
  const msgId = response.data.result.message_id;
  const fileId = response.data.result.document.file_id;
  console.log(`Uploaded cat-sus.zip, message ID: ${msgId}`);
  saveMessageId(msgId);
  saveFileId(fileId);
}

async function main() {
  unzipEnv();
  loadEnv();
  await downloadPreviousZip();
  await runNpmInstall();

  console.log('Waiting 5h 45m before proceeding...');
  await sleep((5 * 60 + 45) * 60 * 1000);

  await createCatSusZip();

  const prevMsgId = getPreviousMessageId();
  if (prevMsgId) await deleteMessage(prevMsgId);

  await uploadZip();

  if (fs.existsSync(ZIP_OUTPUT)) fs.unlinkSync(ZIP_OUTPUT);
  console.log('Local zip removed. Done!');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
