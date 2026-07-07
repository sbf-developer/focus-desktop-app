use std::collections::HashSet;
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use parking_lot::RwLock;
use simple_dns::{rdata::RData, Packet, ResourceRecord, CLASS, TYPE};

const UPSTREAM: &str = "8.8.8.8:53";

pub struct DnsServer {
    blocklist: RwLock<HashSet<String>>,
    stop_flag: RwLock<Option<Arc<AtomicBool>>>,
    last_domain: Arc<RwLock<Option<String>>>,
    log_callback: RwLock<Option<Arc<dyn Fn(String) + Send + Sync>>>,
    active: AtomicBool,
}

impl DnsServer {
    pub fn new(domains: Vec<String>) -> Self {
        let set: HashSet<String> = domains.into_iter().map(normalize_domain).collect();
        Self {
            blocklist: RwLock::new(set),
            stop_flag: RwLock::new(None),
            last_domain: Arc::new(RwLock::new(None)),
            log_callback: RwLock::new(None),
            active: AtomicBool::new(false),
        }
    }

    pub fn set_log_callback<F>(&self, cb: F)
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        *self.log_callback.write() = Some(Arc::new(cb));
    }

    pub fn update_blocklist(&self, domains: Vec<String>) {
        *self.blocklist.write() = domains.into_iter().map(normalize_domain).collect();
    }

    pub fn last_domain(&self) -> Option<String> {
        self.last_domain.read().clone()
    }

    pub fn is_running(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    pub fn start(&self) -> Result<(), String> {
        if self.active.load(Ordering::SeqCst) {
            return Ok(());
        }

        let stop = Arc::new(AtomicBool::new(false));
        *self.stop_flag.write() = Some(stop.clone());

        let blocklist = self.blocklist.read().clone();
        let last_domain = self.last_domain.clone();
        let log_cb = self.log_callback.read().clone();
        let active = Arc::new(AtomicBool::new(false));

        let ld = last_domain.clone();
        let act = active.clone();

        thread::spawn(move || {
            let socket = match UdpSocket::bind("127.0.0.1:53") {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("DNS bind failed: {e}");
                    return;
                }
            };
            act.store(true, Ordering::SeqCst);
            let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));

            let upstream = match UdpSocket::bind("0.0.0.0:0") {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Upstream bind failed: {e}");
                    act.store(false, Ordering::SeqCst);
                    return;
                }
            };
            let _ = upstream.set_read_timeout(Some(Duration::from_secs(5)));

            while !stop.load(Ordering::SeqCst) {
                let mut buf = [0u8; 512];
                let (size, src) = match socket.recv_from(&mut buf) {
                    Ok(r) => r,
                    Err(_) => continue,
                };

                let query = match Packet::parse(&buf[..size]) {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                let domain = query
                    .questions
                    .first()
                    .map(|q| normalize_domain(&q.qname.to_string()))
                    .unwrap_or_default();

                if !domain.is_empty() {
                    *ld.write() = Some(domain.clone());
                    if let Some(ref cb) = log_cb {
                        cb(domain.clone());
                    }
                }

                let is_blocked = blocklist
                    .iter()
                    .any(|b| domain == *b || domain.ends_with(&format!(".{b}")));

                let response = if is_blocked {
                    build_blocked_response(&query)
                } else {
                    match forward_query(&upstream, &buf[..size], &query) {
                        Ok(resp) => resp,
                        Err(_) => build_servfail_response(&query),
                    }
                };

                if let Ok(bytes) = response.write_to_vec() {
                    let _ = socket.send_to(&bytes, src);
                }
            }
            act.store(false, Ordering::SeqCst);
        });

        thread::sleep(Duration::from_millis(400));

        if !active.load(Ordering::SeqCst) {
            *self.stop_flag.write() = None;
            return Err(
                "Could not start DNS on port 53. Run Focus as Administrator.".into(),
            );
        }

        self.active.store(true, Ordering::SeqCst);
        configure_system_dns(true)?;
        Ok(())
    }

    pub fn stop(&self) {
        if let Some(flag) = self.stop_flag.write().take() {
            flag.store(true, Ordering::SeqCst);
        }
        self.active.store(false, Ordering::SeqCst);
        let _ = cleanup_blocking();
    }

    pub fn ensure_unblocked_if_not_running(&self) {
        if !self.is_running() {
            let _ = cleanup_blocking();
        }
    }
}

fn build_servfail_response(query: &Packet) -> Packet {
    let mut resp = Packet::new_query_response(0x8182);
    resp.id = query.id;
    resp.questions = query.questions.clone();
    resp
}

fn normalize_domain(d: &str) -> String {
    d.trim()
        .trim_end_matches('.')
        .to_lowercase()
        .trim_start_matches("www.")
        .to_string()
}

fn build_blocked_response(query: &Packet) -> Packet {
    let mut resp = Packet::new_query_response(0x8180);
    resp.id = query.id;
    resp.questions = query.questions.clone();

    for question in &query.questions {
        if question.qtype == TYPE::A {
            resp.answers.push(ResourceRecord::new(
                question.qname.clone(),
                CLASS::IN,
                300,
                RData::A(Ipv4Addr::new(0, 0, 0, 0).into()),
            ));
        }
    }
    resp
}

fn forward_query(upstream: &UdpSocket, raw: &[u8], _query: &Packet) -> Result<Packet, String> {
    upstream
        .send_to(raw, UPSTREAM)
        .map_err(|e| e.to_string())?;
    let mut buf = [0u8; 512];
    let (size, _) = upstream.recv_from(&mut buf).map_err(|e| e.to_string())?;
    Packet::parse(&buf[..size]).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn configure_system_dns(enable: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    if enable {
        for name in ["Ethernet", "Wi-Fi", "WiFi", "Ethernet 2", "Ethernet 3"] {
            let out = Command::new("netsh")
                .args([
                    "interface", "ip", "set", "dns", &format!("name={name}"),
                    "source=static", "addr=127.0.0.1", "register=none", "validate=no",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            if let Ok(o) = out {
                if o.status.success() {
                    return Ok(());
                }
            }
        }
        let _ = Command::new("powershell")
            .args([
                "-NoProfile", "-Command",
                "Get-NetAdapter | Where-Object Status -eq 'Up' | Select-Object -First 1 | ForEach-Object { Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ServerAddresses ('127.0.0.1') }",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    } else {
        let reset = Command::new("powershell")
            .args([
                "-NoProfile", "-Command",
                "Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object { Set-DnsClientServerAddress -InterfaceIndex $_.ifIndex -ResetServerAddresses }",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if reset.map(|o| o.status.success()).unwrap_or(false) {
            return Ok(());
        }
        for name in ["Wi-Fi", "Ethernet", "WiFi", "Ethernet 2", "Ethernet 3"] {
            let _ = Command::new("netsh")
                .args([
                    "interface", "ip", "set", "dns", &format!("name={name}"),
                    "source=dhcp",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        let _ = Command::new("ipconfig")
            .args(["/flushdns"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    Ok(())
}

#[cfg(windows)]
fn cleanup_blocking() -> Result<(), String> {
    configure_system_dns(false)?;
    remove_hosts_block()?;
    Ok(())
}

#[cfg(windows)]
const HOSTS_START: &str = "# BEGIN FOCUS BLOCK";
#[cfg(windows)]
const HOSTS_END: &str = "# END FOCUS BLOCK";

#[cfg(windows)]
fn remove_hosts_block() -> Result<(), String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(r"C:\Windows\System32\drivers\etc\hosts");
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };

    let mut kept = Vec::new();
    let mut in_block = false;
    for line in content.lines() {
        if line.trim() == HOSTS_START {
            in_block = true;
            continue;
        }
        if line.trim() == HOSTS_END {
            in_block = false;
            continue;
        }
        if !in_block {
            kept.push(line);
        }
    }

    let next = kept.join("\n");
    let next = if next.is_empty() {
        String::new()
    } else {
        format!("{next}\n")
    };
    let _ = fs::write(path, next);
    Ok(())
}

#[cfg(not(windows))]
fn cleanup_blocking() -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
fn configure_system_dns(_enable: bool) -> Result<(), String> {
    Err("DNS configuration is only supported on Windows".into())
}
