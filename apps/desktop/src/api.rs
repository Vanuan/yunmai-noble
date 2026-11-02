use std::time::Duration;

use serde::Deserialize;
use serde::de::DeserializeOwned;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub id: i64,
    pub device_id: String,
    pub scale_date: String,
    pub user_id: i64,
    pub weight_kg: f64,
    pub resistance: i64,
    pub fat_percentage: i64,
    pub historical: bool,
    pub firmware_version: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MeasurementsResponse {
    pub measurements: Vec<Measurement>,
    /// Cursor for the next page: the oldest `scaleDate` in this page, present
    /// only when the page was full.
    pub next: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ClearedMeasurements {
    pub deleted: u64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DatabaseHealth {
    pub ok: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamHealth {
    pub configured: bool,
    pub connected: bool,
    pub last_message_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Health {
    pub status: String,
    pub database: DatabaseHealth,
    pub upstream: UpstreamHealth,
    /// One entry per attached driver; empty for a standalone historian.
    #[serde(default)]
    pub upstreams: Vec<UpstreamStatus>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamStatus {
    pub id: String,
    pub url: String,
    pub configured: bool,
    pub connected: bool,
    pub last_message_at: Option<String>,
    pub last_error: Option<String>,
}

/// Effective suite configuration, as resolved from the TOML file, the
/// environment, and the built-in defaults.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteSettings {
    pub config_path: Option<String>,
    pub historian: HistorianSettings,
    pub drivers: DriverSettings,
    pub simulator: SimulatorSettings,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorianSettings {
    pub host: String,
    pub port: u16,
    pub database_path: String,
    pub cors_origin: String,
    pub sse_heartbeat_ms: u64,
    pub reconnect_min_ms: u64,
    pub reconnect_max_ms: u64,
    pub upstream_urls: Vec<String>,
    pub device_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverSettings {
    pub initial: Vec<String>,
    pub node_id_prefix: String,
    pub restart_ms: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorSettings {
    pub name: String,
    pub weight_kg: f64,
    pub steps: u32,
    pub interval_ms: u32,
    pub cycle_delay_ms: u32,
    pub scan_delay_ms: u32,
    pub auto_start: bool,
    pub repeat: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SuiteState {
    pub available: Vec<String>,
    pub drivers: Vec<DriverStatus>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverStatus {
    pub driver: String,
    pub desired: bool,
    pub state: String,
    #[serde(default)]
    pub restarts: u64,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub health: Health,
    pub latest: Option<Measurement>,
    pub measurements: Vec<Measurement>,
    /// Present when the historian is hosted by the suite.
    pub suite: Option<SuiteState>,
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Deserialize)]
struct ErrorBody {
    message: String,
}

#[derive(Clone, Debug)]
pub struct HistorianClient {
    base_url: String,
    agent: ureq::Agent,
}

impl HistorianClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self::with_timeout(base_url, Duration::from_secs(3))
    }

    pub fn with_timeout(base_url: impl Into<String>, timeout: Duration) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let agent = ureq::AgentBuilder::new().timeout(timeout).build();

        Self { base_url, agent }
    }

    pub fn reachable(&self) -> bool {
        self.get_health().is_ok()
    }

    pub fn snapshot(&self) -> Result<Snapshot, String> {
        let health = self.get_health()?;
        let latest = self.get_optional::<Measurement>("/api/measurements/latest")?;
        let measurements = self.measurements(20, None)?;
        // A standalone historian does not mount the suite control API.
        let suite = self.get_optional::<SuiteState>("/api/suite")?;

        Ok(Snapshot {
            health,
            latest,
            measurements: measurements.measurements,
            suite,
        })
    }

    /// One page of stored measurements, newest first. `before` is the `next`
    /// cursor of the previous page.
    pub fn measurements(
        &self,
        limit: usize,
        before: Option<&str>,
    ) -> Result<MeasurementsResponse, String> {
        let mut path = format!("/api/measurements?limit={limit}");
        if let Some(cursor) = before {
            path.push_str("&before=");
            path.push_str(&encode_query(cursor));
        }
        self.get_json(&path)
    }

    /// Delete every stored measurement and report how many were removed.
    pub fn clear_measurements(&self) -> Result<u64, String> {
        let path = "/api/measurements";
        let url = format!("{}{path}", self.base_url);

        match self.agent.delete(&url).call() {
            Ok(response) => response
                .into_json::<ClearedMeasurements>()
                .map(|body| body.deleted)
                .map_err(|error| format!("invalid response from {path}: {error}")),
            Err(ureq::Error::Status(code, _)) => Err(format!("{path} failed: HTTP {code}")),
            Err(ureq::Error::Transport(error)) => Err(format!("cannot reach historian: {error}")),
        }
    }

    pub fn suite(&self) -> Result<SuiteState, String> {
        self.get_json::<SuiteState>("/api/suite")
    }

    /// Effective suite configuration. Absent when the historian runs on its own.
    pub fn settings(&self) -> Result<Option<SuiteSettings>, String> {
        self.get_optional("/api/suite/settings")
    }

    /// Start or stop one driver. The caller is responsible for stopping the
    /// other drivers when it wants an exclusive selection.
    pub fn driver_action(&self, driver: &str, action: &str) -> Result<SuiteState, String> {
        if !matches!(action, "start" | "stop") {
            return Err(format!("unsupported driver action: {action}"));
        }

        let path = format!("/api/suite/drivers/{driver}/{action}");
        let url = format!("{}{path}", self.base_url);

        match self.agent.post(&url).call() {
            Ok(response) => response
                .into_json::<SuiteState>()
                .map_err(|error| format!("invalid response from {path}: {error}")),
            Err(ureq::Error::Status(code, response)) => Err(format!(
                "{path} failed: HTTP {code} ({})",
                api_message(response)
            )),
            Err(ureq::Error::Transport(error)) => Err(format!("cannot reach historian: {error}")),
        }
    }

    fn get_health(&self) -> Result<Health, String> {
        let url = format!("{}/health", self.base_url);
        match self.agent.get(&url).call() {
            Ok(response) => response
                .into_json::<Health>()
                .map_err(|error| format!("invalid health response: {error}")),
            // A degraded service answers 503 with the same JSON shape.
            Err(ureq::Error::Status(503, response)) => response
                .into_json::<Health>()
                .map_err(|error| format!("invalid health response: {error}")),
            Err(ureq::Error::Status(code, _)) => Err(format!("health request failed: HTTP {code}")),
            Err(ureq::Error::Transport(error)) => Err(format!("cannot reach historian: {error}")),
        }
    }

    fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let url = format!("{}{}", self.base_url, path);
        match self.agent.get(&url).call() {
            Ok(response) => response
                .into_json::<T>()
                .map_err(|error| format!("invalid response from {path}: {error}")),
            Err(ureq::Error::Status(code, _)) => Err(format!("{path} failed: HTTP {code}")),
            Err(ureq::Error::Transport(error)) => Err(format!("cannot reach historian: {error}")),
        }
    }

    fn get_optional<T: DeserializeOwned>(&self, path: &str) -> Result<Option<T>, String> {
        let url = format!("{}{}", self.base_url, path);
        match self.agent.get(&url).call() {
            Ok(response) => response
                .into_json::<T>()
                .map(Some)
                .map_err(|error| format!("invalid response from {path}: {error}")),
            Err(ureq::Error::Status(404, _)) => Ok(None),
            Err(ureq::Error::Status(code, _)) => Err(format!("{path} failed: HTTP {code}")),
            Err(ureq::Error::Transport(error)) => Err(format!("cannot reach historian: {error}")),
        }
    }
}

/// Percent-encode a query value. Date cursors contain `:` and `+`, which must
/// not reach the historian raw.
fn encode_query(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn api_message(response: ureq::Response) -> String {
    let body = response.into_string().unwrap_or_default();
    let message = serde_json::from_str::<ErrorEnvelope>(&body)
        .map(|envelope| envelope.error.message)
        .unwrap_or_else(|_| body.trim().to_string());

    if message.is_empty() {
        "no details".to_string()
    } else {
        message
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserializes_a_measurement() {
        let measurement: Measurement = serde_json::from_str(
            r#"{
                "id": 42,
                "deviceId": "pi-scale-1",
                "scaleDate": "2026-11-01T13:35:26.000Z",
                "receivedAt": "2026-11-01T13:35:27.120Z",
                "userId": 1,
                "weightKg": 71.4,
                "resistance": 0,
                "fatPercentage": 0,
                "historical": false,
                "firmwareVersion": 1
            }"#,
        )
        .unwrap();

        assert_eq!(measurement.id, 42);
        assert_eq!(measurement.device_id, "pi-scale-1");
        assert_eq!(measurement.weight_kg, 71.4);
        assert_eq!(measurement.firmware_version, Some(1));
        assert!(!measurement.historical);
    }

    #[test]
    fn deserializes_a_degraded_health_response() {
        let health: Health = serde_json::from_str(
            r#"{
                "status": "degraded",
                "database": { "ok": true },
                "upstream": {
                    "configured": true,
                    "connected": false,
                    "lastMessageAt": null,
                    "lastError": "connection refused"
                }
            }"#,
        )
        .unwrap();

        assert_eq!(health.status, "degraded");
        assert!(!health.upstream.connected);
        assert_eq!(
            health.upstream.last_error.as_deref(),
            Some("connection refused")
        );
    }

    #[test]
    fn deserializes_suite_drivers() {
        let suite: SuiteState = serde_json::from_str(
            r#"{
                "available": ["dbus", "simulator", "noble"],
                "drivers": [
                    {
                        "driver": "dbus",
                        "nodeId": "scale-dbus",
                        "url": "ws://127.0.0.1:4000",
                        "controlUrl": null,
                        "desired": true,
                        "state": "running",
                        "pid": 42,
                        "restarts": 0,
                        "startedAt": null,
                        "lastExit": null,
                        "error": null,
                        "upstream": null
                    }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(suite.available, ["dbus", "simulator", "noble"]);
        assert_eq!(suite.drivers[0].driver, "dbus");
        assert!(suite.drivers[0].desired);
        assert_eq!(suite.drivers[0].state, "running");
    }

    #[test]
    fn posts_driver_actions_to_the_suite() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 2048];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(
                request.starts_with("POST /api/suite/drivers/simulator/start "),
                "unexpected request: {request}"
            );

            let body = r#"{"available":["dbus","simulator","noble"],"drivers":[]}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });

        let client = HistorianClient::new(format!("http://{address}"));
        let suite = client.driver_action("simulator", "start").unwrap();
        server.join().unwrap();

        assert!(suite.available.iter().any(|name| name == "simulator"));
    }

    #[test]
    fn requests_the_next_page_with_the_cursor() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 2048];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(
                request.starts_with(
                    "GET /api/measurements?limit=2&before=2026-11-01T13%3A35%3A26.000Z "
                ),
                "unexpected request: {request}"
            );

            let body = r#"{"measurements":[],"next":null}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });

        let client = HistorianClient::new(format!("http://{address}"));
        let page = client
            .measurements(2, Some("2026-11-01T13:35:26.000Z"))
            .unwrap();
        server.join().unwrap();

        assert!(page.measurements.is_empty());
        assert!(page.next.is_none());
    }

    #[test]
    fn deletes_measurements() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 2048];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(
                request.starts_with("DELETE /api/measurements "),
                "unexpected request: {request}"
            );

            let body = r#"{"deleted":3}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });

        let client = HistorianClient::new(format!("http://{address}"));
        assert_eq!(client.clear_measurements().unwrap(), 3);
        server.join().unwrap();
    }

    #[test]
    fn deserializes_suite_settings() {
        let settings: SuiteSettings = serde_json::from_str(
            r#"{
                "configPath": "/etc/yunmai-noble/config.toml",
                "historian": {
                    "host": "127.0.0.1",
                    "port": 3100,
                    "databasePath": "/var/lib/yunmai-noble/historian.sqlite",
                    "corsOrigin": "*",
                    "sseHeartbeatMs": 15000,
                    "reconnectMinMs": 1000,
                    "reconnectMaxMs": 30000,
                    "upstreamUrls": [],
                    "deviceId": "yunmai-noble"
                },
                "drivers": { "initial": ["simulator"], "nodeIdPrefix": "sim", "restartMs": 2000 },
                "simulator": {
                    "name": "YUNMAI-SIM",
                    "weightKg": 72.4,
                    "steps": 8,
                    "intervalMs": 250,
                    "cycleDelayMs": 5000,
                    "scanDelayMs": 200,
                    "autoStart": false,
                    "repeat": false
                }
            }"#,
        )
        .unwrap();

        assert_eq!(
            settings.config_path.as_deref(),
            Some("/etc/yunmai-noble/config.toml")
        );
        assert_eq!(settings.historian.port, 3100);
        assert_eq!(settings.simulator.weight_kg, 72.4);
        assert!(!settings.simulator.repeat);
    }

    #[test]
    fn deserializes_health_upstreams() {
        let health: Health = serde_json::from_str(
            r#"{
                "status": "ok",
                "database": { "ok": true },
                "upstream": { "configured": true, "connected": true, "lastMessageAt": null, "lastError": null },
                "upstreams": [
                    { "id": "simulator", "url": "ws://127.0.0.1:8081", "configured": true, "connected": true, "lastMessageAt": "2026-11-01T10:00:01.000Z", "lastError": null }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(health.upstreams.len(), 1);
        assert_eq!(health.upstreams[0].id, "simulator");
        assert!(health.upstreams[0].connected);
    }

    #[test]
    fn treats_a_missing_settings_endpoint_as_standalone() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 2048];
            let read = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]);
            assert!(
                request.starts_with("GET /api/suite/settings "),
                "unexpected request: {request}"
            );

            write!(
                stream,
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
        });

        let client = HistorianClient::new(format!("http://{address}"));
        assert!(client.settings().unwrap().is_none());
        server.join().unwrap();
    }

    #[test]
    fn trims_trailing_slashes_from_the_base_url() {
        let client = HistorianClient::new("http://127.0.0.1:3000/");
        assert_eq!(client.base_url, "http://127.0.0.1:3000");
    }

    #[test]
    fn encodes_measurement_cursors() {
        assert_eq!(
            encode_query("2026-11-01T13:35:26.000Z"),
            "2026-11-01T13%3A35%3A26.000Z"
        );
        assert_eq!(
            encode_query("2026-11-01T13:35:26+02:00"),
            "2026-11-01T13%3A35%3A26%2B02%3A00"
        );
    }
}
