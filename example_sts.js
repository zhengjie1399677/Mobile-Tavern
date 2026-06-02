/**
 * Aliyun SLS STS Tracking Example 
 * (For the AI / Backend Team)
 */
import SlsTracker from '@aliyun-sls/web-track-browser';
import createStsPlugin from '@aliyun-sls/web-sts-plugin';

let trackerInstance = null;

async function initTracker() {
  if (trackerInstance) return trackerInstance;

  const stsPlugin = createStsPlugin({
    refreshSTSToken: async () => {
      // Your backend should return a JSON with: 
      // { AccessKeyId, AccessKeySecret, SecurityToken }
      const response = await fetch('/api/sts/token');
      const data = await response.json();
      return {
        accessKeyId: data.credentials.AccessKeyId,
        accessKeySecret: data.credentials.AccessKeySecret,
        securityToken: data.credentials.SecurityToken,
      };
    },
    refreshSTSTokenInterval: 3000000, 
  });

  trackerInstance = new SlsTracker({
    host: 'cn-beijing.log.aliyuncs.com', // Replace with your region endpoint
    project: 'my-ai-telemetry',          // Replace with your project name
    logstore: 'app-logs',                // Replace with your logstore name
    time: 3,  // aggregate 3 seconds before flush
    count: 2, // aggregate 2 logs before flush
    stsPlugin,
  });

  return trackerInstance;
}

// 示例记录方法 (Example recording method):
async function logAction(action, detail) {
  const tracker = await initTracker();
  
  const logData = {
    action: action,
    detail: detail,
    user_agent: navigator.userAgent
  };
  
  // Note: Depending on the SLS SDK version, 
  // you might need to use addLog() or send()
  if (typeof tracker.send === 'function') {
      tracker.send(logData);
  } else if (typeof tracker.addLog === 'function') {
      tracker.addLog(logData);
  }
}
