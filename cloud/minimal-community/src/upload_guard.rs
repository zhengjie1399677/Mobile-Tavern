use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::Path,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

pub struct UploadGuard {
    attempts: Mutex<HashMap<String, VecDeque<Instant>>>,
    current_storage_bytes: AtomicU64,
    max_storage_bytes: u64,
    max_uploads_per_window: usize,
    window: Duration,
}

impl UploadGuard {
    pub fn new(
        cards_dir: &Path,
        max_storage_bytes: u64,
        max_uploads_per_window: usize,
        window_seconds: u64,
    ) -> std::io::Result<Self> {
        Ok(Self {
            attempts: Mutex::new(HashMap::new()),
            current_storage_bytes: AtomicU64::new(directory_size(cards_dir)?),
            max_storage_bytes,
            max_uploads_per_window,
            window: Duration::from_secs(window_seconds),
        })
    }

    pub fn check_rate_limit(&self, client_key: &str) -> Result<(), u64> {
        let now = Instant::now();
        let mut attempts = self
            .attempts
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let entries = attempts.entry(client_key.to_owned()).or_default();
        while entries
            .front()
            .is_some_and(|started| now.duration_since(*started) >= self.window)
        {
            entries.pop_front();
        }
        if entries.len() >= self.max_uploads_per_window {
            let retry_after = entries
                .front()
                .map(|started| {
                    self.window
                        .saturating_sub(now.duration_since(*started))
                        .as_secs()
                })
                .unwrap_or(1)
                .max(1);
            return Err(retry_after);
        }
        entries.push_back(now);
        Ok(())
    }

    pub fn reserve_storage(&self, bytes: u64) -> bool {
        let mut current = self.current_storage_bytes.load(Ordering::Relaxed);
        loop {
            let Some(next) = current.checked_add(bytes) else {
                return false;
            };
            if next > self.max_storage_bytes {
                return false;
            }
            match self.current_storage_bytes.compare_exchange_weak(
                current,
                next,
                Ordering::SeqCst,
                Ordering::Relaxed,
            ) {
                Ok(_) => return true,
                Err(actual) => current = actual,
            }
        }
    }

    pub fn release_storage(&self, bytes: u64) {
        let _ = self.current_storage_bytes.fetch_update(
            Ordering::SeqCst,
            Ordering::Relaxed,
            |current| Some(current.saturating_sub(bytes)),
        );
    }
}

fn directory_size(path: &Path) -> std::io::Result<u64> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            total = total.saturating_add(entry.metadata()?.len());
        }
    }
    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_rate_and_storage_limits() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("existing.card"), [0_u8; 4]).unwrap();
        let guard = UploadGuard::new(directory.path(), 10, 2, 600).unwrap();

        assert!(guard.check_rate_limit("127.0.0.1").is_ok());
        assert!(guard.check_rate_limit("127.0.0.1").is_ok());
        assert!(guard.check_rate_limit("127.0.0.1").is_err());
        assert!(guard.check_rate_limit("198.51.100.1").is_ok());

        assert!(guard.reserve_storage(6));
        assert!(!guard.reserve_storage(1));
        guard.release_storage(3);
        assert!(guard.reserve_storage(3));
    }
}
