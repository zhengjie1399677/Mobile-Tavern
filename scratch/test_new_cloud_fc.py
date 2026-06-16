import urllib.request
import json
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# ----------------- 接口一：测试 STS 凭证获取 -----------------
sts_url = "https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run"
print("\n================================================")
print(f"Sending GET request to STS URL: {sts_url}...")
print("================================================")

try:
    req = urllib.request.Request(sts_url, headers={"User-Agent": "Mozilla/5.0", "X-Device-Id": "mobile_test_device"})
    with urllib.request.urlopen(req, timeout=10) as response:
        status_code = response.getcode()
        body = response.read().decode("utf-8")
        print(f"Status Code: {status_code}")
        print("Response Body:")
        print(json.dumps(json.loads(body), ensure_ascii=False, indent=2))
except urllib.error.HTTPError as e:
    print(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
except Exception as e:
    print("Error:", e)

# ----------------- 接口二：测试新 Catbot 客服对话 -----------------
catbot_url = "https://catbot-gmkodirnhh.cn-hangzhou.fcapp.run/api/catbot"
payload = {
    "content": "你好喵！请问世界书功能应该怎么使用喵？",
    "history": [],
    "clientContext": {
        "device_id": "mobile_test_device",
        "platform": "Android-Client",
        "language": "zh-CN"
    }
}
headers = {
    "Content-Type": "application/json",
    "X-Device-Id": "mobile_test_device"
}

print("\n================================================")
print(f"Sending POST request to Catbot URL: {catbot_url}...")
print("================================================")

try:
    req = urllib.request.Request(
        catbot_url, 
        data=json.dumps(payload).encode("utf-8"), 
        headers=headers, 
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        status_code = response.getcode()
        body = response.read().decode("utf-8")
        print(f"Status Code: {status_code}")
        print("Response Body:")
        print(json.dumps(json.loads(body), ensure_ascii=False, indent=2))
except urllib.error.HTTPError as e:
    print(f"HTTP Error {e.code}: {e.read().decode('utf-8')}")
except Exception as e:
    print("Error:", e)
