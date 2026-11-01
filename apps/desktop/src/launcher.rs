use std::fs::OpenOptions;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::api::HistorianClient;

const DEFAULT_SERVICE: &str = "yunmai-noble.service";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Autostart {
    Auto,
    Systemd,
    Dev,
    None,
}

impl Autostart {
    pub fn from_env() -> Self {
        Self::parse(std::env::var("YUNMAI_AUTOSTART").ok().as_deref())
    }

    pub fn parse(value: Option<&str>) -> Self {
        match value
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "systemd" => Self::Systemd,
            "dev" => Self::Dev,
            "none" | "off" | "0" | "false" => Self::None,
            _ => Self::Auto,
        }
    }
}

/// Best-effort startup preflight. It never prevents the window from opening;
/// the dashboard shows the offline state if the historian stays down.
pub fn preflight(url: &str, mode: Autostart) -> String {
    if probe(url) {
        return format!("historian reachable at {url}");
    }

    if mode == Autostart::None {
        return format!("historian unreachable at {url}; autostart disabled");
    }

    if !is_loopback_url(url) {
        return format!(
            "historian unreachable at {url}; not starting a local service for a remote host"
        );
    }

    let started = match mode {
        Autostart::Systemd => start_systemd(),
        Autostart::Dev => start_dev(),
        Autostart::Auto => {
            if systemd_unit_available() {
                start_systemd()
            } else {
                start_dev()
            }
        }
        Autostart::None => false,
    };

    if !started {
        return format!("historian unreachable at {url}; could not start a service");
    }

    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(200));
        if probe(url) {
            return format!("started historian; reachable at {url}");
        }
    }

    format!("started historian but {url} is still unreachable")
}

fn probe(url: &str) -> bool {
    HistorianClient::with_timeout(url, Duration::from_millis(500)).reachable()
}

pub fn is_loopback_url(url: &str) -> bool {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let authority = without_scheme.split('/').next().unwrap_or("");
    let host = if let Some(rest) = authority.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        authority
            .rsplit_once(':')
            .map(|(host, _)| host)
            .unwrap_or(authority)
    };

    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// Unit started by autostart. The simulator package overrides this with
/// `YUNMAI_SERVICE=yunmai-noble-simulator.service`.
fn service_name() -> String {
    service_name_from(std::env::var("YUNMAI_SERVICE").ok().as_deref())
}

fn service_name_from(value: Option<&str>) -> String {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SERVICE)
        .to_string()
}

fn user_unit_available() -> bool {
    Command::new("systemctl")
        .args(["--user", "cat", &service_name()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn system_unit_available() -> bool {
    Command::new("systemctl")
        .args(["cat", &service_name()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn systemd_unit_available() -> bool {
    user_unit_available() || system_unit_available()
}

fn start_systemd() -> bool {
    let service = service_name();
    let user = Command::new("systemctl")
        .args(["--user", "start", &service])
        .status()
        .is_ok_and(|status| status.success());

    user || Command::new("systemctl")
        .args(["start", &service])
        .status()
        .is_ok_and(|status| status.success())
}

const SIMULATOR_UI: &str = "yunmai-noble-simulator-ui";

/// Launch the standalone simulator control app against the same suite. The
/// child is detached so closing the main window leaves the simulator running.
pub fn launch_simulator_ui(base_url: &str) -> Result<(), String> {
    let binary = std::env::var_os("YUNMAI_SIMULATOR_UI")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|parent| parent.join(SIMULATOR_UI)))
                .filter(|path| path.is_file())
        })
        .or_else(|| find_binary(SIMULATOR_UI))
        .ok_or_else(|| {
            "simulator UI is not built; run cargo build -p yunmai-noble-simulator-ui".to_string()
        })?;

    let mut command = Command::new(binary);
    command
        .arg("--historian")
        .arg(base_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("could not launch the simulator UI: {error}"))
}

fn start_dev() -> bool {
    let Some(root) = find_repo_root() else {
        eprintln!("desktop: no repository checkout found for dev autostart");
        return false;
    };

    std::fs::create_dir_all(root.join("data")).ok();
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join("data/desktop-suite.log"))
        .ok();

    let mut command = if let Ok(custom) = std::env::var("YUNMAI_SUITE_COMMAND") {
        let mut command = Command::new("sh");
        command.arg("-c").arg(custom);
        command
    } else {
        let Some(bun) = find_binary("bun") else {
            eprintln!("desktop: bun is not on PATH");
            return false;
        };
        let mut command = Command::new(bun);
        command
            .arg("run")
            .arg(root.join("packages/suite/src/main.ts"));

        if let Ok(config) = std::env::var("YUNMAI_CONFIG") {
            command.arg("--config").arg(config);
        } else if !root.join("yunmai-noble.toml").exists() && root.join("lab.toml").exists() {
            command.arg("--config").arg("lab.toml");
        }

        command
    };

    command
        .current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(log) = log {
        if let (Ok(stdout), Ok(stderr)) = (log.try_clone(), log.try_clone()) {
            command.stdout(stdout).stderr(stderr);
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    eprintln!("desktop: starting the suite from {}", root.display());
    command.spawn().is_ok()
}

fn find_repo_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.extend(parent.ancestors().map(Path::to_path_buf));
        }
    }

    candidates
        .into_iter()
        .find(|directory| directory.join("packages/suite/src/main.ts").is_file())
}

fn find_binary(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_loopback_historian_urls() {
        assert!(is_loopback_url("http://127.0.0.1:3000"));
        assert!(is_loopback_url("http://localhost:3000"));
        assert!(is_loopback_url("http://[::1]:3000"));
        assert!(!is_loopback_url("http://pi.local:3000"));
        assert!(!is_loopback_url("https://example.com"));
    }

    #[test]
    fn selects_service_unit_from_env() {
        assert_eq!(service_name_from(None), "yunmai-noble.service");
        assert_eq!(service_name_from(Some("  ")), "yunmai-noble.service");
        assert_eq!(
            service_name_from(Some("yunmai-noble-simulator.service")),
            "yunmai-noble-simulator.service"
        );
    }

    #[test]
    fn parses_autostart_modes() {
        assert_eq!(Autostart::parse(None), Autostart::Auto);
        assert_eq!(Autostart::parse(Some("auto")), Autostart::Auto);
        assert_eq!(Autostart::parse(Some("systemd")), Autostart::Systemd);
        assert_eq!(Autostart::parse(Some("DEV")), Autostart::Dev);
        assert_eq!(Autostart::parse(Some("none")), Autostart::None);
        assert_eq!(Autostart::parse(Some("off")), Autostart::None);
    }
}
