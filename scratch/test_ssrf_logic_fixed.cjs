const dns = require("dns");
const { promisify } = require("util");
const dnsLookup = promisify(dns.lookup);

function parseIpAddress(ip) {
  const cleanIp = ip.toLowerCase().trim();
  
  // Check if it's IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(cleanIp)) {
    const parts = cleanIp.split(".").map(x => parseInt(x, 10));
    if (parts.some(isNaN) || parts.some(p => p < 0 || p > 255)) return null;
    return [0, 0, 0, 0, 0, 0xffff, (parts[0] << 8) + parts[1], (parts[2] << 8) + parts[3]];
  }

  // IPv6 parsing (could contain a dotted-decimal IPv4 suffix, e.g. ::ffff:127.0.0.1)
  let ipv6Str = cleanIp;
  let ipv4Parts = [];
  const ipv4Match = ipv6Str.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const parts = ipv4Match[1].split(".").map(x => parseInt(x, 10));
    if (parts.some(isNaN) || parts.some(p => p < 0 || p > 255)) return null;
    ipv4Parts = parts;
    ipv6Str = ipv6Str.substring(0, ipv4Match.index + 1) + "0:0";
  }

  const parts = ipv6Str.split(":");
  if (parts.length > 8) return null;
  
  const doubleColonIndex = parts.indexOf("");
  const expectedLength = 8;
  const result = [];

  if (doubleColonIndex !== -1) {
    const left = [];
    const right = [];
    let isLeft = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "") {
        if (isLeft) {
          isLeft = false;
          while (parts[i + 1] === "") i++;
        } else {
          return null;
        }
      } else {
        if (isLeft) {
          left.push(parts[i]);
        } else {
          right.push(parts[i]);
        }
      }
    }
    
    for (const p of left) {
      const val = parseInt(p, 16);
      if (isNaN(val) || val < 0 || val > 0xffff) return null;
      result.push(val);
    }
    const zeroCount = expectedLength - left.length - right.length;
    for (let i = 0; i < zeroCount; i++) {
      result.push(0);
    }
    for (const p of right) {
      const val = parseInt(p, 16);
      if (isNaN(val) || val < 0 || val > 0xffff) return null;
      result.push(val);
    }
  } else {
    if (parts.length !== 8) return null;
    for (const p of parts) {
      const val = parseInt(p, 16);
      if (isNaN(val) || val < 0 || val > 0xffff) return null;
      result.push(val);
    }
  }

  if (ipv4Parts.length === 4) {
    result[6] = (ipv4Parts[0] << 8) + ipv4Parts[1];
    result[7] = (ipv4Parts[2] << 8) + ipv4Parts[3];
  }

  return result;
}

function isPrivateIp(ip) {
  const w = parseIpAddress(ip);
  if (!w) return false; // Not a valid IP, so not classified as private

  // 1. Check native IPv6 loopback (::1) and unspecified (::)
  if (w.every((val, idx) => idx === 7 ? val === 1 || val === 0 : val === 0)) {
    return true;
  }
  
  // 2. Check native IPv6 Link-local (fe80::/10)
  if ((w[0] & 0xffc0) === 0xfe80) {
    return true;
  }
  
  // 3. Check native IPv6 Unique Local (fc00::/7)
  if ((w[0] & 0xfe00) === 0xfc00) {
    return true;
  }
  
  // 4. Check if it's an IPv4-mapped (::ffff:x.x.x.x) or IPv4-compatible (::x.x.x.x) address
  const isIPv4Mapped = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0xffff;
  const isIPv4Compatible = w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0 && (w[6] !== 0 || w[7] > 1);
  
  if (isIPv4Mapped || isIPv4Compatible) {
    const o0 = w[6] >> 8;
    const o1 = w[6] & 0xff;
    const o2 = w[7] >> 8;
    const o3 = w[7] & 0xff;
    
    // Loopback (127.0.0.0/8)
    if (o0 === 127) return true;
    
    // Private Class A (10.0.0.0/8)
    if (o0 === 10) return true;
    
    // Private Class B (172.16.0.0/12)
    if (o0 === 172 && o1 >= 16 && o1 <= 31) return true;
    
    // Private Class C (192.168.0.0/16)
    if (o0 === 192 && o1 === 168) return true;
    
    // Link-local (169.254.0.0/16)
    if (o0 === 169 && o1 === 254) return true;
    
    // Broadcast / Local (0.0.0.0/8)
    if (o0 === 0) return true;
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

  // If host is a direct IP address (which includes bracketed IPv6), check it immediately
  // Regex matches standard IPv4 dotted or hex/colon characters inside hostname (bracketed IPv6 hostname doesn't contain brackets in URL hostname property)
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
  "http://[::ffff:127.0.0.1]", 
  "http://[::ffff:7f00:0001]", 
  "http://[::ffff:10.0.0.1]", 
  "http://0177.0.0.01", 
  "http://0x7f.0.0.1", 
  "http://0x7f000001", 
  "http://2130706433", 
  "http://017700000001", 
  "http://8.8.8.8", // should be allowed
  "https://github.com", // should be allowed
];

async function runTests() {
  console.log("=== Testing Fixed SSRF Guard Logic ===");
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
