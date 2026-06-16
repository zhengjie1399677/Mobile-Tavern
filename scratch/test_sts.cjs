const https = require('https');

console.log("Fetching STS via Node...");
const req = https.get("https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run", { timeout: 5000 }, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log("Success:", res.statusCode);
    console.log(data);
  });
});

req.on('error', (e) => {
  console.error("Error:", e.message);
});

req.on('timeout', () => {
  console.error("Timeout!");
  req.destroy();
});
