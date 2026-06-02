const Sts20150401 = require('@alicloud/sts20150401');
const OpenApi = require('@alicloud/openapi-client');

async function main() {
  let config = new OpenApi.Config({
    accessKeyId: 'YOUR_ALIYUN_ACCESS_KEY_ID',
    accessKeySecret: 'YOUR_ALIYUN_ACCESS_KEY_SECRET',
  });
  config.endpoint = 'sts.cn-beijing.aliyuncs.com';
  let client = new Sts20150401.default(config);
  
  let assumeRoleRequest = new Sts20150401.AssumeRoleRequest({
    roleArn: 'acs:ram::1362007603262188:role/slslogwriter',
    roleSessionName: 'webClientSession',
    durationSeconds: 3600
  });

  try {
    let result = await client.assumeRole(assumeRoleRequest);
    console.log(result.body.credentials);
  } catch (error) {
    console.log(error.message);
  }
}
main();
