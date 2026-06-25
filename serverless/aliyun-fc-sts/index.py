# -*- coding: utf-8 -*-
"""
FC 函数 - STS 凭证签发（仅包含 SLS 遥测鉴权功能）
"""
import os
import re
import json
import time
import hmac
import hashlib
import base64
import urllib.parse
import urllib.request
import urllib.error
import uuid
import logging

logger = logging.getLogger(__name__)

def handler(event, context):
    """FC 3.0 Web 函数标准入口"""
    try:
        # context 包含 path, method, headers 等信息
        path = getattr(context, 'path', '/')
        method = getattr(context, 'method', 'GET')
        headers = getattr(context, 'headers', {})
        
        # 1. 响应 CORS 预检请求 (OPTIONS)
        if method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Device-Id'
                },
                'body': ''
            }
            
        # 2. 路由分发
        if path == '/get_sts_token' or path == '/':
            status_code, body = get_sts_token(headers)
        elif path == '/health':
            status_code, body = 200, {'status': 'ok'}
        else:
            status_code, body = 404, {'error': 'Not found'}
        
        return {
            'statusCode': status_code,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(body, ensure_ascii=False)
        }
        
    except Exception as e:
        logger.error(f"Error in handler: {e}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)}, ensure_ascii=False)
        }


def get_sts_token(headers):
    """获取 STS 临时凭证"""
    ak = os.environ.get('ALIBABA_CLOUD_ACCESS_KEY_ID')
    sk = os.environ.get('ALIBABA_CLOUD_ACCESS_KEY_SECRET')
    
    if not ak or not sk:
        return 500, {'error': 'Server missing credentials'}
    
    ROLE_ARN = 'acs:ram::1362007603262188:role/mobile'
    REGION = 'cn-beijing'
    
    # 兼容不同 header 格式
    device_id = headers.get('X-Device-Id') or headers.get('x-device-id') or 'unknown'
    device_id = re.sub(r'[^a-zA-Z0-9_]', '_', str(device_id))
    
    timestamp = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    params = {
        'Action': 'AssumeRole',
        'Version': '2015-04-01',
        'Format': 'JSON',
        'RegionId': REGION,
        'AccessKeyId': ak,
        'SignatureMethod': 'HMAC-SHA1',
        'Timestamp': timestamp,
        'SignatureVersion': '1.0',
        'SignatureNonce': str(uuid.uuid4()),
        'RoleArn': ROLE_ARN,
        'RoleSessionName': f'app-{device_id}'[:64],
        'DurationSeconds': '3600',
    }
    
    def percent_encode(string):
        res = urllib.parse.quote(str(string), safe='')
        res = res.replace('+', '%20').replace('*', '%2A').replace('%7E', '~')
        return res

    sorted_params = sorted(params.items())
    query_string = '&'.join([f"{percent_encode(k)}={percent_encode(v)}" for k, v in sorted_params])
    string_to_sign = f"GET&{percent_encode('/')}&{percent_encode(query_string)}"
    
    key = sk + '&'
    signature = hmac.new(key.encode('utf-8'), string_to_sign.encode('utf-8'), hashlib.sha1).digest()
    signature_str = base64.b64encode(signature).decode('utf-8')
    
    url = f'https://sts.{REGION}.aliyuncs.com/?Signature={percent_encode(signature_str)}&{query_string}'
    
    try:
        req = urllib.request.Request(url, method='GET')
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            
        creds = data['Credentials']
        return 200, {
            'AccessKeyId': creds['AccessKeyId'],
            'AccessKeySecret': creds['AccessKeySecret'],
            'SecurityToken': creds['SecurityToken'],
            'Expiration': creds['Expiration'],
            'SlsEndpoint': f'https://{REGION}.log.aliyuncs.com',
            'SlsProject': 'my-ai-telemetry',
            'SlsLogstore': 'app-logs'
        }
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode('utf-8')
        logger.error(f"STS API Error: {e.code} - {err_msg}")
        return 400, {'error': f'STS API error: {e.code}'}
    except Exception as e:
        logger.error(f"STS Error: {e}")
        return 500, {'error': str(e)}
