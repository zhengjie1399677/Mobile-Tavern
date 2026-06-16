import urllib.request
import json

try:
    print("Fetching STS...")
    req = urllib.request.Request("https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run", headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=5) as response:
        html = response.read().decode('utf-8')
        print("Success:")
        print(html)
except Exception as e:
    print("Error:", e)
