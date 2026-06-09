const dns = require("dns");
const { promisify } = require("util");
const dnsLookup = promisify(dns.lookup);

function isPrivateIp(ip) {
  // IPv4 checks
  if (/^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.\d+\.\d+\.\d+)$/.test(ip)) {
    return true;
  }
  const match172 = ip.match(/^172\.(\d+)\.\d+\.\d+$/);
  if (match172) {
    const octet = parseInt(match172[1], 10);
    if (octet >= 16 && octet <= 31) {
      return true;
    }
  }

  // IPv6 checks
  const ipv6 = ip.toLowerCase().trim();
  if (
    ipv6 === "::1" ||
    ipv6 === "::" ||
    ipv6.startsWith("fe80:") ||
    ipv6.startsWith("fc00:") ||
    ipv6.startsWith("fd00:") ||
    ipv6.startsWith("fc") ||
    ipv6.startsWith("fd")
  ) {
    return true;
  }

  return false;
}

async function validateBaseUrlSecurity(baseUrl) {
  if (!baseUrl) {
    throw new Error("baseUrl is required");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch (err) {
    throw new Error("Invalid URL format for baseUrl");
  }

  const hostname = parsedUrl.hostname;
  if (!hostname) {
    throw new Error("Host cannot be empty");
  }

  // If host is a direct IP address, check it immediately
  const isIP = /^[0-9a-fA-F.:]+$/.test(hostname);
  if (isIP) {
    if (isPrivateIp(hostname)) {
      throw new Error("Forbidden target IP: Loopback, private, or link-local addresses are restricted.");
    }
    return;
  }

  // Perform DNS resolution to get all associated IP addresses
  try {
    const lookupResult = await dnsLookup(hostname, { all: true });
    for (const addr of lookupResult) {
      if (isPrivateIp(addr.address)) {
        throw new Error(`Forbidden target IP resolved (${addr.address}): Loopback, private, or link-local addresses are restricted.`);
      }
    }
  } catch (err) {
    if (err.message && err.message.includes("Forbidden target IP")) {
      throw err;
    }
    throw new Error(`Failed to resolve host ${hostname}: ${err.message}`);
  }
}

// Run test cases
const testCases = [
  "http://127.0.0.1",
  "http://localhost",
  "http://10.0.0.1",
  "http://192.168.1.1",
  "http://172.16.0.1",
  "http://172.31.255.255",
  "http://172.32.0.1", // should be allowed
  "http://[::1]",
  "http://[fe80::1]",
  "http://[fd00::1]",
  "http://[::ffff:127.0.0.1]", // potential bypass?
  "http://[::ffff:7f00:0001]", // potential bypass?
  "http://[::ffff:10.0.0.1]", // potential bypass?
  "http://0177.0.0.01", // octal
  "http://0x7f.0.0.1", // partial hex
  "http://0x7f000001", // full hex
  "http://2130706433", // decimal
  "http://017700000001", // full octal
  "http://8.8.8.8", // should be allowed
  "https://github.com", // should be allowed
];

async function runTests() {
  console.log("=== Testing SSRF Guard Logic ===");
  for (const tc of testCases) {
    try {
      await validateBaseUrlSecurity(tc);
      console.log(`[ALLOWED] ${tc}`);
    } catch (err) {
      console.log(`[BLOCKED] ${tc} - Reason: ${err.message}`);
    }
  }
}

runTests();
