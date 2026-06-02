const ALY = require('aliyun-sdk');
var sts = new ALY.STS({
  accessKeyId: "YOUR_ALIYUN_ACCESS_KEY_ID",
  secretAccessKey: "YOUR_ALIYUN_ACCESS_KEY_SECRET",
  endpoint: "https://sts.cn-beijing.aliyuncs.com",
  apiVersion: "2015-04-01"
});
sts.assumeRole({
  RoleArn: 'acs:ram::1362007603262188:role/slslogwriter',
  RoleSessionName: 'webClientSession'
}, function(err, data){
  if(err) console.log(err);
  else console.log(data);
});
