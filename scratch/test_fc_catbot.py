import urllib.request
import json

url = "https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run/api/catbot"
payload = {
    "content": "你好喵！你叫什么名字喵？",
    "history": [],
    "clientContext": {
        "device_id": "test_device_antigravity",
        "platform": "Tauri-Test",
        "language": "zh-CN",
        "timezone": "Asia/Shanghai"
    }
}

headers = {
    "Content-Type": "application/json",
    "X-Device-Id": "test_device_antigravity"
}

try:
    print(f"Sending POST request to {url}...")
    req = urllib.request.Request(
        url, 
        data=json.dumps(payload).encode("utf-8"), 
        headers=headers, 
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=15) as response:
        status_code = response.getcode()
        body = response.read().decode("utf-8")
        print(f"Status Code: {status_code}")
        print("Response Body:")
        print(json.dumps(json.loads(body), ensure_ascii=False, indent=2))
except urllib.error.HTTPError as e:
    print(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
except Exception as e:
    print("Error:", e)
