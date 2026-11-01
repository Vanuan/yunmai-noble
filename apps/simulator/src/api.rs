use std::time::Duration;

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimulatorState {
    pub powered: bool,
    pub subscribed: bool,
    pub running: bool,
    pub weight_kg: f64,
    pub last_weight_kg: Option<f64>,
    pub user: u64,
    pub unit: String,
    pub step: u64,
    pub steps: u64,
    pub repeat: bool,
    pub interval_ms: u64,
    pub history: u64,
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
pub struct SimulatorClient {
    base_url: String,
    agent: ureq::Agent,
}

impl SimulatorClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(3))
            .build();
        Self { base_url, agent }
    }

    /// A stopped or missing simulator driver answers 409; treat that as an
    /// empty state rather than an error.
    pub fn state(&self) -> Result<Option<SimulatorState>, String> {
        let path = "/api/suite/simulator";
        match self.agent.get(&format!("{}{path}", self.base_url)).call() {
            Ok(response) => response
                .into_json::<SimulatorState>()
                .map(Some)
                .map_err(|error| format!("invalid simulator state: {error}")),
            Err(ureq::Error::Status(409, _)) => Ok(None),
            Err(ureq::Error::Status(code, response)) => Err(format!(
                "{path} failed: HTTP {code} ({})",
                api_message(response)
            )),
            Err(ureq::Error::Transport(error)) => {
                Err(format!("cannot reach the historian: {error}"))
            }
        }
    }

    pub fn start_driver(&self) -> Result<(), String> {
        let path = "/api/suite/drivers/simulator/start";
        match self.agent.post(&format!("{}{path}", self.base_url)).call() {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(code, response)) => Err(format!(
                "{path} failed: HTTP {code} ({})",
                api_message(response)
            )),
            Err(ureq::Error::Transport(error)) => {
                Err(format!("cannot reach the historian: {error}"))
            }
        }
    }

    pub fn command(&self, action: &str, body: serde_json::Value) -> Result<SimulatorState, String> {
        let path = format!("/api/suite/simulator/{action}");
        let url = format!("{}{path}", self.base_url);
        let body = serde_json::to_string(&body).map_err(|error| error.to_string())?;

        match self
            .agent
            .post(&url)
            .set("Content-Type", "application/json")
            .send_string(&body)
        {
            Ok(response) => response
                .into_json::<SimulatorState>()
                .map_err(|error| format!("invalid simulator state: {error}")),
            Err(ureq::Error::Status(code, response)) => Err(format!(
                "{path} failed: HTTP {code} ({})",
                api_message(response)
            )),
            Err(ureq::Error::Transport(error)) => {
                Err(format!("cannot reach the historian: {error}"))
            }
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
    fn deserializes_simulator_state() {
        let state: SimulatorState = serde_json::from_str(
            r#"{
                "powered": true,
                "subscribed": true,
                "running": false,
                "weightKg": 72.4,
                "lastWeightKg": null,
                "user": 1,
                "unit": "kg",
                "step": 0,
                "steps": 8,
                "repeat": false,
                "intervalMs": 250,
                "history": 3
            }"#,
        )
        .unwrap();

        assert!(state.powered);
        assert_eq!(state.weight_kg, 72.4);
        assert_eq!(state.user, 1);
        assert_eq!(state.unit, "kg");
        assert_eq!(state.history, 3);
    }

    #[test]
    fn posts_simulator_commands() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut data = Vec::new();
            let mut buffer = [0u8; 1024];
            let header_end = loop {
                let read = stream.read(&mut buffer).unwrap();
                assert!(read > 0, "client closed before sending headers");
                data.extend_from_slice(&buffer[..read]);
                if let Some(position) = data.windows(4).position(|window| window == b"\r\n\r\n") {
                    break position + 4;
                }
            };

            let headers = String::from_utf8_lossy(&data[..header_end]).to_string();
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then_some(value.trim())
                })
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(0);
            while data.len() < header_end + content_length {
                let read = stream.read(&mut buffer).unwrap();
                assert!(read > 0, "client closed before sending the body");
                data.extend_from_slice(&buffer[..read]);
            }

            let request = String::from_utf8_lossy(&data);
            assert!(
                request.starts_with("POST /api/suite/simulator/weight "),
                "unexpected request: {request}"
            );
            assert!(
                request.contains(r#"{"kg":72.5}"#),
                "missing body: {request}"
            );

            let body = r#"{
                "powered": true, "subscribed": true, "running": false,
                "weightKg": 72.5, "lastWeightKg": null, "user": 1,
                "unit": "kg", "step": 0, "steps": 8, "repeat": false,
                "intervalMs": 250, "history": 3
            }"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });

        let client = SimulatorClient::new(format!("http://{address}"));
        let state = client
            .command("weight", serde_json::json!({ "kg": 72.5 }))
            .unwrap();
        server.join().unwrap();

        assert_eq!(state.weight_kg, 72.5);
    }

    #[test]
    fn trims_trailing_slashes() {
        let client = SimulatorClient::new("http://127.0.0.1:3000/");
        assert_eq!(client.base_url, "http://127.0.0.1:3000");
    }
}
