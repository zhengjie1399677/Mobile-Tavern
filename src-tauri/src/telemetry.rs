use base64::Engine;
use hmac::{Hmac, Mac};
use sha1::Sha1;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tokio::sync::watch;

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
    #[serde(default)]
    pub app_version: String,
    pub __time__: Option<u64>,
}

#[derive(serde::Serialize, Clone, Debug)]
struct TelemetryPayload {
    __logs__: Vec<TelemetryLog>,
}

#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "PascalCase")]
struct StsCredentials {
    access_key_id: String,
    access_key_secret: String,
    security_token: String,
    sls_endpoint: String,
    sls_project: String,
    sls_logstore: String,
}

/// Get the queue file path in the app data directory
fn get_queue_file_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    // Ensure parent directory exists
    if !app_data.exists() {
        std::fs::create_dir_all(&app_data)
            .map_err(|e| format!("Failed to create app data dir: {}", e))?;
    }
    Ok(app_data.join("telemetry_queue.jsonl"))
}

/// Enqueue a log to local file disk (JSONL format)
pub fn enqueue_log(app_handle: &tauri::AppHandle, mut log: TelemetryLog) -> Result<(), String> {
    let _lock = FILE_MUTEX
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    let path = get_queue_file_path(app_handle)?;

    // Inject current app version
    log.app_version = app_handle.package_info().version.to_string();

    let log_line =
        serde_json::to_string(&log).map_err(|e| format!("Serialization error: {}", e))?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open queue file: {}", e))?;

    writeln!(file, "{}", log_line).map_err(|e| format!("Failed to write to queue file: {}", e))?;

    Ok(())
}

/// Retrieve and clear successfully sent logs from the queue file
fn read_and_split_queue(
    path: &PathBuf,
    batch_size: usize,
) -> Result<(Vec<TelemetryLog>, Vec<String>), String> {
    let _lock = FILE_MUTEX
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;
    if !path.exists() {
        return Ok((Vec::new(), Vec::new()));
    }

    let file = File::open(path).map_err(|e| format!("Failed to open file for read: {}", e))?;
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
    let _lock = FILE_MUTEX
        .lock()
        .map_err(|e| format!("Lock poisoned: {}", e))?;

    let mut file =
        File::create(path).map_err(|e| format!("Failed to truncate queue file: {}", e))?;

    for line in remaining_lines {
        writeln!(file, "{}", line).map_err(|e| format!("Failed to write remaining line: {}", e))?;
    }

    Ok(())
}

static STS_CACHE: Mutex<Option<(StsCredentials, Instant)>> = Mutex::new(None);

fn invalidate_sts_cache() {
    if let Ok(mut guard) = STS_CACHE.lock() {
        *guard = None;
    }
}

/// Request STS Credentials from Aliyun FC
async fn fetch_sts_credentials() -> Result<StsCredentials, String> {
    {
        if let Ok(guard) = STS_CACHE.lock() {
            if let Some((ref creds, fetch_time)) = *guard {
                // 缓存 50 分钟（3000 秒），提前 10 分钟在 1 小时过期前自动刷新
                if fetch_time.elapsed().as_secs() < 3000 {
                    return Ok(creds.clone());
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build http client: {}", e))?;

    let res = client
        .get("https://mobile-xmkoxkjshe.cn-hangzhou.fcapp.run")
        .send()
        .await
        .map_err(|e| format!("STS Fetch request error: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("STS Fetch returned status: {}", res.status()));
    }

    let credentials = res
        .json::<StsCredentials>()
        .await
        .map_err(|e| format!("STS Parse json error: {}", e))?;

    if let Ok(mut guard) = STS_CACHE.lock() {
        *guard = Some((credentials.clone(), Instant::now()));
    }

    Ok(credentials)
}

/// Send a payload of logs to Aliyun SLS using STS Signature
async fn send_payload_to_sls(
    credentials: &StsCredentials,
    logs: &[TelemetryLog],
) -> Result<(), String> {
    if logs.is_empty() {
        return Ok(());
    }

    let now_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
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

    let body_str =
        serde_json::to_string(&payload).map_err(|e| format!("Serialize payload error: {}", e))?;

    let body_bytes = body_str.as_bytes();
    let body_len = body_bytes.len();

    // Calculate Content-MD5 Header
    let md5_digest = md5::compute(body_bytes);
    let md5_str = format!("{:X}", md5_digest);

    // Calculate Date Header (RFC 1123)
    let date_str = chrono::Utc::now()
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string();

    // Canonicalized SLS Headers (Sorted alphabetically)
    let canonicalized_headers = format!(
        "x-acs-security-token:{}\nx-log-apiversion:0.6.0\nx-log-bodyrawsize:{}\nx-log-signaturemethod:hmac-sha1",
        credentials.security_token, body_len
    );

    // Canonicalized Resource
    let canonicalized_resource = format!("/logstores/{}", credentials.sls_logstore);

    // Construct StringToSign
    let string_to_sign = format!(
        "POST\n{}\napplication/json\n{}\n{}\n{}",
        md5_str, date_str, canonicalized_headers, canonicalized_resource
    );

    // Compute HMAC-SHA1
    let mut mac = HmacSha1::new_from_slice(credentials.access_key_secret.as_bytes())
        .map_err(|e| format!("HMAC key init error: {}", e))?;
    mac.update(string_to_sign.as_bytes());
    let sig_bytes = mac.finalize().into_bytes();
    let signature = base64::prelude::BASE64_STANDARD.encode(sig_bytes);

    let sls_endpoint = credentials
        .sls_endpoint
        .trim_start_matches("http://")
        .trim_start_matches("https://");
    let url = format!(
        "https://{}.{}/logstores/{}",
        credentials.sls_project, sls_endpoint, credentials.sls_logstore
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client for SLS: {}", e))?;

    let res = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Content-MD5", &md5_str)
        .header("Date", &date_str)
        .header("x-acs-security-token", &credentials.security_token)
        .header("x-log-apiversion", "0.6.0")
        .header("x-log-bodyrawsize", body_len.to_string())
        .header("x-log-signaturemethod", "hmac-sha1")
        .header(
            "Authorization",
            format!("LOG {}:{}", credentials.access_key_id, signature),
        )
        .body(body_str)
        .send()
        .await
        .map_err(|e| format!("SLS Post request error: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("SLS Post failed ({}): {}", status, err_text));
    }

    Ok(())
}

async fn wait_for_shutdown(shutdown: &mut watch::Receiver<bool>) {
    if *shutdown.borrow() {
        return;
    }
    loop {
        if shutdown.changed().await.is_err() || *shutdown.borrow() {
            return;
        }
    }
}

async fn wait_for_delay_or_shutdown(
    shutdown: &mut watch::Receiver<bool>,
    duration: tokio::time::Duration,
) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(duration) => false,
        _ = wait_for_shutdown(shutdown) => true,
    }
}

/// Loop to process unsent local logs and send them to Aliyun SLS.
/// `shutdown` 由 Tauri 生命周期事件驱动，可同时打断退避等待与进行中的网络请求。
pub async fn start_telemetry_loop(
    app_handle: tauri::AppHandle,
    mut shutdown: watch::Receiver<bool>,
) {
    if *shutdown.borrow() {
        return;
    }
    let path = match get_queue_file_path(&app_handle) {
        Ok(p) => p,
        Err(e) => {
            println!("[Telemetry] Initialize loop path failed: {}", e);
            return;
        }
    };

    println!("[Telemetry] Background loop started. File: {:?}", path);

    let base_delay_secs = 15;
    let max_delay_secs = 300;
    let mut current_delay_secs = base_delay_secs;

    loop {
        if wait_for_delay_or_shutdown(
            &mut shutdown,
            tokio::time::Duration::from_secs(current_delay_secs),
        )
        .await
        {
            println!("[Telemetry] Background loop stopped by app shutdown.");
            break;
        }

        // Check if there are logs in the file
        if !path.exists() {
            current_delay_secs = base_delay_secs;
            continue;
        }

        let file_metadata = match std::fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => {
                current_delay_secs = base_delay_secs;
                continue;
            }
        };

        if file_metadata.len() == 0 {
            current_delay_secs = base_delay_secs;
            continue;
        }

        // Read batch of logs (limit to 20 logs per batch to prevent huge body payload)
        let (batch, remaining) = match read_and_split_queue(&path, 20) {
            Ok(res) => res,
            Err(e) => {
                println!("[Telemetry] Split queue failed: {}", e);
                current_delay_secs = base_delay_secs;
                continue;
            }
        };

        if batch.is_empty() {
            current_delay_secs = base_delay_secs;
            continue;
        }

        println!(
            "[Telemetry] Found {} pending logs. Fetching STS...",
            batch.len()
        );

        let send_result = tokio::select! {
            result = async {
                let credentials = fetch_sts_credentials().await?;
                send_payload_to_sls(&credentials, &batch).await?;
                Ok::<(), String>(())
            } => result,
            _ = wait_for_shutdown(&mut shutdown) => {
                println!("[Telemetry] Upload cancelled by app shutdown.");
                break;
            }
        };

        match send_result {
            Ok(_) => {
                println!("[Telemetry] Successfully sent {} logs to SLS.", batch.len());
                if let Err(e) = rewrite_queue_file(&path, &remaining) {
                    println!("[Telemetry] Failed to update local queue: {}", e);
                }
                current_delay_secs = base_delay_secs;
            }
            Err(e) => {
                println!("[Telemetry] Telemetry upload failed (will retry): {}", e);
                invalidate_sts_cache();
                current_delay_secs = std::cmp::min(current_delay_secs * 2, max_delay_secs);
                println!(
                    "[Telemetry] Increased backoff retry delay to {}s",
                    current_delay_secs
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::wait_for_delay_or_shutdown;
    use tokio::sync::watch;

    #[test]
    fn shutdown_interrupts_backoff_wait() {
        let runtime = tokio::runtime::Runtime::new().expect("create Tokio test runtime");
        runtime.block_on(async {
            let (shutdown_tx, mut shutdown_rx) = watch::channel(false);
            let waiter = tokio::spawn(async move {
                wait_for_delay_or_shutdown(&mut shutdown_rx, tokio::time::Duration::from_secs(60))
                    .await
            });

            tokio::task::yield_now().await;
            shutdown_tx.send(true).expect("send shutdown signal");

            let interrupted = tokio::time::timeout(tokio::time::Duration::from_millis(200), waiter)
                .await
                .expect("shutdown should interrupt the wait promptly")
                .expect("wait task should finish cleanly");
            assert!(interrupted);
        });
    }
}
