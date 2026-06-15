use std::fs::{OpenOptions, File};
use std::io::{Write, BufRead, BufReader};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use base64::Engine;

type HmacSha1 = Hmac<Sha1>;

// Thread-safe mutex to avoid concurrent access conflicts to the file queue
static FILE_MUTEX: Mutex<()> = Mutex::new(());

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct TelemetryLog {
    pub action: String,
    pub device_id: String,
    pub player_name: String,
    pub character_name: String,
    pub model: String,
    pub tokens_used: String,
    pub generation_time_ms: String,
    pub detail: String,
    pub session_id: String,
    pub session_start_time: String,
    pub session_duration_sec: String,
    pub platform: String,
    pub user_agent: String,
    pub language: String,
    pub timezone: String,
    pub __time__: Option<u64>,
}

#[derive(serde::Serialize, Clone, Debug)]
struct TelemetryPayload {
    __logs__: Vec<TelemetryLog>,
}

#[derive(serde::Deserialize, Debug)]
struct StsCredentials {
    AccessKeyId: String,
    AccessKeySecret: String,
    SecurityToken: String,
    SlsEndpoint: String,
    SlsProject: String,
    SlsLogstore: String,
}

/// Get the queue file path in the app data directory
fn get_queue_file_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    // Ensure parent directory exists
    if !app_data.exists() {
        std::fs::create_dir_all(&app_data)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    }
    Ok(app_data.join("telemetry_queue.jsonl"))
}

/// Enqueue a log to local file disk (JSONL format)
pub fn enqueue_log(app_handle: &tauri::AppHandle, log: TelemetryLog) -> Result<(), String> {
    let _lock = FILE_MUTEX.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    let path = get_queue_file_path(app_handle)?;
    
    let log_line = serde_json::to_string(&log)
        .map_err(|e| format!("Serialization error: {}", e))?;
        
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open queue file: {}", e))?;
        
    writeln!(file, "{}", log_line)
        .map_err(|e| format!("Failed to write to queue file: {}", e))?;
        
    Ok(())
}

/// Retrieve and clear successfully sent logs from the queue file
fn read_and_split_queue(path: &PathBuf, batch_size: usize) -> Result<(Vec<TelemetryLog>, Vec<String>), String> {
    let _lock = FILE_MUTEX.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    if !path.exists() {
        return Ok((Vec::new(), Vec::new()));
    }
    
    let file = File::open(path)
        .map_err(|e| format!("Failed to open file for read: {}", e))?;
    let reader = BufReader::new(file);
    
    let mut batch = Vec::new();
    let mut remaining_lines = Vec::new();
    
    for (idx, line_res) in reader.lines().enumerate() {
        let line = line_res.map_err(|e| format!("Failed to read line: {}", e))?;
        if line.trim().is_empty() {
            continue;
        }
        
        if idx < batch_size {
            if let Ok(log) = serde_json::from_str::<TelemetryLog>(&line) {
                batch.push(log);
            } else {
                // Skip malformed JSON but do not block the queue
                println!("[Telemetry] Skipped corrupted log: {}", line);
            }
        } else {
            remaining_lines.push(line);
        }
    }
    
    Ok((batch, remaining_lines))
}

/// Rewrite the queue file with remaining unsent lines
fn rewrite_queue_file(path: &PathBuf, remaining_lines: &[String]) -> Result<(), String> {
    let _lock = FILE_MUTEX.lock().map_err(|e| format!("Lock poisoned: {}", e))?;
    
    let mut file = File::create(path)
        .map_err(|e| format!("Failed to truncate queue file: {}", e))?;
        
    for line in remaining_lines {
        writeln!(file, "{}", line)
            .map_err(|e| format!("Failed to write remaining line: {}", e))?;
    }
    
    Ok(())
}

/// Request STS Credentials from Aliyun FC
async fn fetch_sts_credentials() -> Result<StsCredentials, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build http client: {}", e))?;
        
    let res = client.get("https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run")
        .send()
        .await
        .map_err(|e| format!("STS Fetch request error: {}", e))?;
        
    if !res.status().is_success() {
        return Err(format!("STS Fetch returned status: {}", res.status()));
    }
    
    let credentials = res.json::<StsCredentials>()
        .await
        .map_err(|e| format!("STS Parse json error: {}", e))?;
        
    Ok(credentials)
}

/// Send a payload of logs to Aliyun SLS using STS Signature
async fn send_payload_to_sls(credentials: &StsCredentials, logs: &[TelemetryLog]) -> Result<(), String> {
    if logs.is_empty() {
        return Ok(());
    }
    
    let now_epoch = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|e| format!("SystemTime error: {}", e))?
        .as_secs();
        
    // Inject __time__ inside each log object
    let mut signed_logs = logs.to_vec();
    for log in &mut signed_logs {
        if log.__time__.is_none() {
            log.__time__ = Some(now_epoch);
        }
    }
        
    let payload = TelemetryPayload {
        __logs__: signed_logs,
    };
    
    let body_str = serde_json::to_string(&payload)
        .map_err(|e| format!("Serialize payload error: {}", e))?;
        
    let body_bytes = body_str.as_bytes();
    let body_len = body_bytes.len();
    
    // Calculate Content-MD5 Header
    let md5_digest = md5::compute(body_bytes);
    let md5_str = format!("{:X}", md5_digest);
    
    // Calculate Date Header (RFC 1123)
    let date_str = chrono::Utc::now().format("%a, %d %b %Y %H:%M:%S GMT").to_string();
    
    // Canonicalized SLS Headers (Sorted alphabetically)
    let canonicalized_headers = format!(
        "x-acs-security-token:{}\nx-log-apiversion:0.6.0\nx-log-bodyrawsize:{}\nx-log-signaturemethod:hmac-sha1",
        credentials.SecurityToken, body_len
    );
    
    // Canonicalized Resource
    let canonicalized_resource = format!("/logstores/{}", credentials.SlsLogstore);
    
    // Construct StringToSign
    let string_to_sign = format!(
        "POST\n{}\napplication/json\n{}\n{}\n{}",
        md5_str, date_str, canonicalized_headers, canonicalized_resource
    );
    
    // Compute HMAC-SHA1
    let mut mac = HmacSha1::new_from_slice(credentials.AccessKeySecret.as_bytes())
        .map_err(|e| format!("HMAC key init error: {}", e))?;
    mac.update(string_to_sign.as_bytes());
    let sig_bytes = mac.finalize().into_bytes();
    let signature = base64::prelude::BASE64_STANDARD.encode(sig_bytes);
    
    let sls_endpoint = credentials.SlsEndpoint.trim_start_matches("http://").trim_start_matches("https://");
    let url = format!("https://{}.{}/logstores/{}", credentials.SlsProject, sls_endpoint, credentials.SlsLogstore);
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client for SLS: {}", e))?;
        
    let res = client.post(&url)
        .header("Content-Type", "application/json")
        .header("Content-MD5", &md5_str)
        .header("Date", &date_str)
        .header("x-acs-security-token", &credentials.SecurityToken)
        .header("x-log-apiversion", "0.6.0")
        .header("x-log-bodyrawsize", body_len.to_string())
        .header("x-log-signaturemethod", "hmac-sha1")
        .header("Authorization", format!("LOG {}:{}", credentials.AccessKeyId, signature))
        .body(body_str)
        .send()
        .await
        .map_err(|e| format!("SLS Post request error: {}", e))?;
        
    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("SLS Post failed ({}): {}", res.status(), err_text));
    }
    
    Ok(())
}

/// Loop to process unsent local logs and send them to Aliyun SLS
pub async fn start_telemetry_loop(app_handle: tauri::AppHandle) {
    let path = match get_queue_file_path(&app_handle) {
        Ok(p) => p,
        Err(e) => {
            println!("[Telemetry] Initialize loop path failed: {}", e);
            return;
        }
    };
    
    println!("[Telemetry] Background loop started. File: {:?}", path);
    
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
        
        // Check if there are logs in the file
        if !path.exists() {
            continue;
        }
        
        let file_metadata = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        
        if file_metadata.len() == 0 {
            continue;
        }
        
        // Read batch of logs (limit to 20 logs per batch to prevent huge body payload)
        let (batch, remaining) = match read_and_split_queue(&path, 20) {
            Ok(res) => res,
            Err(e) => {
                println!("[Telemetry] Split queue failed: {}", e);
                continue;
            }
        };
        
        if batch.is_empty() {
            continue;
        }
        
        println!("[Telemetry] Found {} pending logs. Fetching STS...", batch.len());
        
        match fetch_sts_credentials().await {
            Ok(credentials) => {
                println!("[Telemetry] STS credentials fetched. Sending logs...");
                match send_payload_to_sls(&credentials, &batch).await {
                    Ok(_) => {
                        println!("[Telemetry] Successfully sent {} logs to SLS.", batch.len());
                        if let Err(e) = rewrite_queue_file(&path, &remaining) {
                            println!("[Telemetry] Failed to update local queue: {}", e);
                        }
                    }
                    Err(e) => {
                        println!("[Telemetry] Failed to send logs to SLS (will retry): {}", e);
                    }
                }
            }
            Err(e) => {
                println!("[Telemetry] Failed to fetch STS credentials (will retry): {}", e);
            }
        }
    }
}
