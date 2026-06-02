# Aliyun Function Compute STS Issuer

这个独立的项目是用于部署在 **阿里云函数计算 (FC)** 上的 HTTP 函数。它将作为您的前端（例如 Tauri Android APK、Web 应用）获取阿里云 SLS 直写凭证 (STS) 的安全代理。

## 部署步骤

1. **准备角色与策略 (RAM 控制台)**:
   - 先创建一个 **自定义策略 (Policy)**，仅赋予 `PutLogs` 权限给您的 Logstore：
     ```json
     {
       "Version": "1",
       "Statement": [
         {
           "Action": [
             "log:PostLogStoreLogs"
           ],
           "Resource": [
             "acs:log:*:*:project/您的Project名称/logstore/您的Logstore名称"
           ],
           "Effect": "Allow"
         }
       ]
     }
     ```
   - 创建一个 **RAM 角色 (RAM Role)**，比如叫 `SlsWebTrackingRole`。
   - 将上一步创建的**自定义策略**授权给这个 `SlsWebTrackingRole`。
   - 在角色的详情页，您会看到一个 `ARN`（例如：`acs:ram::1234567890:role/slswebtrackingrole`）。请保存它。

2. **部署代码到云端**:
   - 在阿里云控制台开通 **函数计算 FC**。
   - 新建一个 **Web 函数 (HTTP Trigger)**，运行环境选择 **Node.js (16/18均可)**。
   - 将外层大目录中的这三个文件 (`index.js`、`package.json`) 打包为 `.zip` 上传，或者在集成在线编辑器中直接复制粘贴 `index.js`，并运行 `npm install @alicloud/pop-core`。

3. **配置环境变量 (FC 控制台)**:
   - 在函数的配置 -> 环境变量中，添加以下三项：
     - `ALIYUN_ACCESS_KEY_ID`: 您的阿里云主账户/具备 AssumeRole 权限子账户的 AK ID。
     - `ALIYUN_ACCESS_KEY_SECRET`: 您的阿里云 AK Secret。
     - `STS_ROLE_ARN`: 您在第 1 步中拿到的角色 ARN (形如 `acs:ram::*:role/slswebtrackingrole`)。

4. **完成测试**:
   - FC 部署成功后，会分配给您一个公网触发器 URL (例如 `https://sls-issuer-xxx.cn-beijing.fcapp.run`)。
   - 打开浏览器访问这个 URL，如果返回 `{"error":"Too Many Requests..."}` 或一段 JSON 的 `AccessKeyId` / `SecurityToken`，说明部署成功。
   - 将这个 URL 填入到您主项目的前端环境变量 `.env` 中的 `VITE_ALIYUN_FC_STS_URL` 即可。
