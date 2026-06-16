import urllib.request
import json

url = "http://127.0.0.1:3000/api/catbot"
payload = {
    "content": "你好，帮我查查怎么导入角色卡？",
    "history": [],
    "clientContext": {
        "deviceId": "test_local_device",
        "userName": "测试用户"
    }
}

headers = {
    "Content-Type": "application/json"
}

try:
    print(f"Sending POST request to {url}...")
    req = urllib.request.Request(
        url, 
        data=json.dumps(payload).encode("utf-8"), 
        headers=headers, 
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        status_code = response.getcode()
        body = response.read().decode("utf-8")
        print(f"Status Code: {status_code}")
        print("Response Body:")
        print(json.dumps(json.loads(body), ensure_ascii=False, indent=2))
except urllib.error.URLError as e:
    print("Failed to connect to local server. Make sure it is running. Error:", e)
except Exception as e:
    print("Error:", e)
