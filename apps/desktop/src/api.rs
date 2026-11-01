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
    /// Pagination cursor; kept for the next API step.
    #[allow(dead_code)]
    pub next: Option<String>,
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
        let measurements = self.get_json::<MeasurementsResponse>("/api/measurements?limit=20")?;
        // A standalone historian does not mount the suite control API.
        let suite = self.get_optional::<SuiteState>("/api/suite")?;

        Ok(Snapshot {
            health,
            latest,
            measurements: measurements.measurements,
            suite,
        })
    }

    pub fn suite(&self) -> Result<SuiteState, String> {
        self.get_json::<SuiteState>("/api/suite")
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
    fn trims_trailing_slashes_from_the_base_url() {
        let client = HistorianClient::new("http://127.0.0.1:3000/");
        assert_eq!(client.base_url, "http://127.0.0.1:3000");
    }
}
