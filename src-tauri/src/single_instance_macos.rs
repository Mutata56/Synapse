//! Atomic ownership before Tauri startup, with a local activation signal.
//! The lock file stays in place: unlinking it would allow two different inodes
//! to be locked simultaneously. The OS releases the lock even after a crash.

use std::fs::{File, OpenOptions};
use std::io::{self, ErrorKind};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

pub enum Claim {
    Primary(SingleInstance),
    Forwarded,
}

pub struct SingleInstance {
    _lock: File,
    listener: UnixListener,
    socket_path: PathBuf,
}

pub fn claim(data_dir: PathBuf, identifier: &str) -> io::Result<Claim> {
    std::fs::create_dir_all(&data_dir)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(data_dir.join("instance.lock"))?;
    // Stable identifier hash keeps the Unix socket below macOS's path limit.
    let hash = identifier
        .bytes()
        .fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
        });
    let uid = lock.metadata()?.uid();
    let socket_path = PathBuf::from(format!("/tmp/synapse-{uid}-{hash:016x}.sock"));
    let started = Instant::now();

    loop {
        match fs2::FileExt::try_lock_exclusive(&lock) {
            Ok(()) => {
                // Only the owner can remove a stale socket and bind a new one.
                match std::fs::remove_file(&socket_path) {
                    Ok(()) => {}
                    Err(e) if e.kind() == ErrorKind::NotFound => {}
                    Err(e) => return Err(e),
                }
                let listener = UnixListener::bind(&socket_path)?;
                std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))?;
                return Ok(Claim::Primary(SingleInstance {
                    _lock: lock,
                    listener,
                    socket_path,
                }));
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                // A connection is the activation signal; no arguments or paths
                // are sent. Signals queue even before the first window is ready.
                match UnixStream::connect(&socket_path) {
                    Ok(_) => return Ok(Claim::Forwarded),
                    Err(e)
                        if matches!(
                            e.kind(),
                            ErrorKind::NotFound | ErrorKind::ConnectionRefused
                        ) =>
                    {
                        // The owner may still be binding, or may have crashed.
                        // Retry ownership too, so a stale socket cannot block restart.
                        if started.elapsed() >= Duration::from_secs(5) {
                            return Err(io::Error::new(
                                ErrorKind::TimedOut,
                                "existing Synapse instance did not respond",
                            ));
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(e) => return Err(e),
                }
            }
            Err(e) => return Err(e),
        }
    }
}

impl SingleInstance {
    pub fn on_launch(&self, callback: impl Fn() + Send + 'static) -> io::Result<()> {
        let listener = self.listener.try_clone()?;
        std::thread::Builder::new()
            .name("synapse-activation".into())
            .spawn(move || {
                for connection in listener.incoming() {
                    if connection.is_ok() {
                        callback();
                    }
                }
            })?;
        Ok(())
    }
}

impl Drop for SingleInstance {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    fn fixture(name: &str) -> (PathBuf, String) {
        let id = format!("synapse-test-{}-{name}", std::process::id());
        (std::env::temp_dir().join(&id), id)
    }

    #[test]
    fn concurrent_cold_claims_keep_one_owner_and_queue_activation() {
        let (dir, id) = fixture("concurrent");
        let barrier = Arc::new(Barrier::new(6));
        let children: Vec<_> = (0..6)
            .map(|_| {
                let (dir, id, barrier) = (dir.clone(), id.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    claim(dir, &id).unwrap()
                })
            })
            .collect();
        let claims: Vec<_> = children
            .into_iter()
            .map(|child| child.join().unwrap())
            .collect();
        let owners: Vec<_> = claims
            .iter()
            .filter_map(|claim| match claim {
                Claim::Primary(owner) => Some(owner),
                Claim::Forwarded => None,
            })
            .collect();
        assert_eq!(owners.len(), 1);
        owners[0].listener.set_nonblocking(true).unwrap();
        // All secondary launches arrived before a UI activation handler existed.
        for _ in 0..5 {
            owners[0].listener.accept().unwrap();
        }
        drop(claims);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn released_lock_and_stale_socket_allow_restart() {
        let (dir, id) = fixture("restart");
        let Claim::Primary(owner) = claim(dir.clone(), &id).unwrap() else {
            panic!("first launch must own the lock");
        };
        let socket = owner.socket_path.clone();
        drop(owner);
        // A killed process leaves a socket pathname with no listening process.
        drop(UnixListener::bind(&socket).unwrap());
        assert!(socket.exists());
        let Claim::Primary(restarted) = claim(dir.clone(), &id).unwrap() else {
            panic!("restart must reclaim the lock and stale socket");
        };
        drop(restarted);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
