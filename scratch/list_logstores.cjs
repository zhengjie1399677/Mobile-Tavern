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

async function main() {
  try {
    const creds = await getSts();
    console.log("Creds loaded:", {
      Project: creds.SlsProject,
      Endpoint: creds.SlsEndpoint,
      Logstore: creds.SlsLogstore
    });

    const dateStr = new Date().toUTCString();
    const headers = {
      'x-acs-security-token': creds.SecurityToken,
      'x-log-apiversion': '0.6.0',
      'x-log-signaturemethod': 'hmac-sha1'
    };
    
    const canonicalizedHeaders = `x-acs-security-token:${creds.SecurityToken}\nx-log-apiversion:0.6.0\nx-log-signaturemethod:hmac-sha1`;
    const canonicalizedResource = '/logstores';
    
    const signature = computeSignature(
      creds.AccessKeySecret,
      'GET',
      '', 
      '', 
      dateStr,
      canonicalizedHeaders,
      canonicalizedResource
    );

    const endpoint = creds.SlsEndpoint.replace('https://', '').replace('http://', '');
    const path = '/logstores';
    const host = `${creds.SlsProject}.${endpoint}`;
    
    console.log("Requesting:", `https://${host}${path}`);
    
    const options = {
      hostname: host,
      path: path,
      method: 'GET',
      headers: {
        'Date': dateStr,
        'x-acs-security-token': creds.SecurityToken,
        'x-log-apiversion': '0.6.0',
        'x-log-signaturemethod': 'hmac-sha1',
        'Authorization': `LOG ${creds.AccessKeyId}:${signature}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log("Status:", res.statusCode);
        console.log("Headers:", res.headers);
        console.log("Data:", data);
      });
    });

    req.on('error', (e) => console.error("Error on request:", e));
    req.end();
  } catch (e) {
    console.error("Failed:", e);
  }
}

main();
