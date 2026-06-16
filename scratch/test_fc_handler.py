import sys
import os
import json

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Add serverless/aliyun-fc-sts to the sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "../serverless/aliyun-fc-sts")))

from index import handler

class MockContext:
    def __init__(self, path, method, headers):
        self.path = path
        self.method = method
        self.headers = headers

# 尝试手动加载根目录下的 .env，以便获取必要的密钥来进行测试
def load_env():
    env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.env"))
    if os.path.exists(env_path):
        print("Loading environment from .env...")
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.strip().split("=", 1)
                    os.environ[k.strip()] = v.strip().strip('"').strip("'")
    else:
        print(".env file not found, using existing environment variables.")

load_env()

# 打印当前环境变量的存在状态（不泄露密钥内容）
print("Environment checks:")
print("ALIBABA_CLOUD_ACCESS_KEY_ID exists:", "ALIBABA_CLOUD_ACCESS_KEY_ID" in os.environ)
print("ALIBABA_CLOUD_ACCESS_KEY_SECRET exists:", "ALIBABA_CLOUD_ACCESS_KEY_SECRET" in os.environ)
print("DASHSCOPE_API_KEY exists:", "DASHSCOPE_API_KEY" in os.environ)

# ----------------- 测试函数一：get_sts_token -----------------
print("\n================================================")
print("Testing get_sts_token via handler...")
print("================================================")

headers_sts = {
    "x-device-id": "test_device_python_sts"
}
context_sts = MockContext(path="/get_sts_token", method="GET", headers=headers_sts)
resp_sts = handler(event=b"", context=context_sts)

print(f"Status Code: {resp_sts.get('statusCode')}")
print("Response Body:")
try:
    body_data = json.loads(resp_sts.get("body", "{}"))
    print(json.dumps(body_data, ensure_ascii=False, indent=2))
except Exception as e:
    print(resp_sts.get("body"), f"(failed to parse json: {e})")

# ----------------- 测试函数二：handle_catbot -----------------
print("\n================================================")
print("Testing handle_catbot via handler...")
print("================================================")

headers_catbot = {
    "x-device-id": "test_device_python_catbot"
}
context_catbot = MockContext(path="/api/catbot", method="POST", headers=headers_catbot)

# 构建符合 handle_catbot 要求的 request body
body_catbot = {
    "content": "你好，帮我测试一下软件报错时本喵会怎么做喵？",
    "history": [],
    "clientContext": {
        "deviceId": "test_device_python_catbot",
        "platform": "Android-Test",
        "language": "zh-CN"
    }
}
event_data = json.dumps(body_catbot).encode("utf-8")
resp_catbot = handler(event=event_data, context=context_catbot)

print(f"Status Code: {resp_catbot.get('statusCode')}")
print("Response Body:")
try:
    body_data_catbot = json.loads(resp_catbot.get("body", "{}"))
    print(json.dumps(body_data_catbot, ensure_ascii=False, indent=2))
except Exception as e:
    print(resp_catbot.get("body"), f"(failed to parse json: {e})")
