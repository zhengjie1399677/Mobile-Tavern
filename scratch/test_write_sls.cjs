const https = require('https');
const crypto = require('crypto');

async function getSts() {
  return new Promise((resolve, reject) => {
    https.get("https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run", (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function computeSignature(secret, verb, contentMd5, contentType, date, canonicalizedHeaders, canonicalizedResource) {
  const stringToSign = `${verb}\n${contentMd5}\n${contentType}\n${date}\n${canonicalizedHeaders}\n${canonicalizedResource}`;
  return crypto.createHmac('sha1', secret).update(Buffer.from(stringToSign, 'utf-8')).digest('base64');
}

async function postToLogstore(creds, logstore, message) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const logData = {
    action: "catbot_test_log",
    device_id: "node_tester_id",
    player_name: "测试玩家",
    character_name: "Stitch",
    model: "qwen-plus",
    tokens_used: "100",
    generation_time_ms: "150",
    detail: message,
    session_id: "session_test",
    platform: "NodeTest",
    user_agent: "NodeJS Test Client",
    language: "zh-CN",
    timezone: "Asia/Shanghai",
    __time__: nowEpoch
  };

  const payload = {
    __logs__: [logData]
  };

  const bodyStr = JSON.stringify(payload);
  const bodyBuffer = Buffer.from(bodyStr, 'utf-8');
  const bodyLen = bodyBuffer.length;

  // MD5
  const md5Str = crypto.createHash('md5').update(bodyBuffer).digest('hex').toUpperCase();

  // Date
  const dateStr = new Date().toUTCString();

  // Headers
  const canonicalizedHeaders = `x-acs-security-token:${creds.SecurityToken}\nx-log-apiversion:0.6.0\nx-log-bodyrawsize:${bodyLen}\nx-log-signaturemethod:hmac-sha1`;
  const canonicalizedResource = `/logstores/${logstore}`;

  const signature = computeSignature(
    creds.AccessKeySecret,
    'POST',
    md5Str,
    'application/json',
    dateStr,
    canonicalizedHeaders,
    canonicalizedResource
  );

  const endpoint = creds.SlsEndpoint.replace('https://', '').replace('http://', '');
  const path = `/logstores/${logstore}`;
  const host = `${creds.SlsProject}.${endpoint}`;

  return new Promise((resolve) => {
    const options = {
      hostname: host,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-MD5': md5Str,
        'Date': dateStr,
        'x-acs-security-token': creds.SecurityToken,
        'x-log-apiversion': '0.6.0',
        'x-log-bodyrawsize': bodyLen.toString(),
        'x-log-signaturemethod': 'hmac-sha1',
        'Authorization': `LOG ${creds.AccessKeyId}:${signature}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          logstore,
          statusCode: res.statusCode,
          data: data
        });
      });
    });

    req.on('error', (e) => {
      resolve({
        logstore,
        statusCode: 500,
        error: e.message
      });
    });

    req.write(bodyBuffer);
    req.end();
  });
}

async function main() {
  try {
    const creds = await getSts();
    console.log("Creds loaded for project:", creds.SlsProject);
    console.log("Default Logstore in STS token is:", creds.SlsLogstore);

    const candidates = [
      creds.SlsLogstore, // app-logs
      'catbot-logs'
    ];

    console.log("Testing write to logstores:", candidates);

    for (const store of candidates) {
      console.log(`\n--- Sending '猫咪客服测试日志' to [${store}] ---`);
      const result = await postToLogstore(creds, store, "猫咪客服测试日志");
      console.log(`Result for [${store}]: Status ${result.statusCode}`);
      console.log("Response:", result.data || result.error);
    }

  } catch (e) {
    console.error("Failed in main execution:", e);
  }
}

main();
