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

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub health: Health,
    pub latest: Option<Measurement>,
    pub measurements: Vec<Measurement>,
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

        Ok(Snapshot {
            health,
            latest,
            measurements: measurements.measurements,
        })
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
    fn trims_trailing_slashes_from_the_base_url() {
        let client = HistorianClient::new("http://127.0.0.1:3000/");
        assert_eq!(client.base_url, "http://127.0.0.1:3000");
    }
}
