use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, SystemTime};

use gpui::{
    Context, CursorStyle, Decorations, Div, FontWeight, MouseButton, Render, ResizeEdge,
    ScrollHandle, SharedString, Stateful, Window, div, prelude::*, px, rgb,
};

use crate::api::{DriverStatus, HistorianClient, Measurement, SuiteSettings, SuiteState};
use crate::format::{format_age, format_timestamp, format_weight, format_weight_range};
use crate::history::{HistoryGroup, group_consecutive};

const BG: u32 = 0xfafaf9;
const CARD: u32 = 0xffffff;
const BORDER: u32 = 0xe7e5e4;
const TEXT: u32 = 0x1c1917;
// Secondary text. Stone-600 sits at roughly 7:1 on the card background, which
// keeps 12 px metadata readable.
const MUTED: u32 = 0x57534e;
const AMBER: u32 = 0xd97706;
const GREEN: u32 = 0x10b981;
const RED: u32 = 0xe11d48;

/// Drivers exposed by the suite, in display order.
const DRIVERS: [(&str, &str, &str); 3] = [
    ("simulator", "Simulator", "Built-in virtual scale"),
    ("dbus", "D-Bus", "BlueZ over the system bus"),
    ("noble", "Node bindings", "Noble HCI driver, needs Node 22"),
];

/// Measurements requested per history page; the API caps this at 500.
const HISTORY_PAGE: usize = 100;

/// Rows in the dashboard history card; the full list is one click away.
const RECENT_ROWS: usize = 5;

#[derive(Clone, Copy, PartialEq, Eq)]
enum View {
    Dashboard,
    History,
}

#[derive(Default)]
struct HistoryState {
    items: Vec<Measurement>,
    next: Option<String>,
    loading: bool,
    error: Option<String>,
    /// The clear button asks for a second click before deleting.
    confirm_clear: bool,
    /// Bumped on every reload so a late response cannot append to a new list.
    generation: u64,
}

pub struct Dashboard {
    historian_url: String,
    snapshot: Option<crate::api::Snapshot>,
    error: Option<String>,
    last_updated: Option<SystemTime>,
    loading: bool,
    driver_error: Option<String>,
    driver_pending: bool,
    preferred_driver: Option<String>,
    driver_synced: bool,
    settings_open: bool,
    scroll_handle: ScrollHandle,
    view: View,
    history: HistoryState,
    history_scroll: ScrollHandle,
    settings: Option<SuiteSettings>,
    settings_error: Option<String>,
    settings_loading: bool,
}

impl Dashboard {
    pub fn new(historian_url: String, cx: &mut Context<Self>) -> Self {
        let poll_url = historian_url.clone();
        let preferred_driver = load_preferred_driver();
        let driver_synced = preferred_driver.is_none();

        // The first render has no scroll metrics yet; re-render once after
        // layout so the custom scrollbar can size itself.
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(Duration::from_millis(100))
                .await;
            this.update(cx, |_, cx| cx.notify()).ok();
        })
        .detach();

        cx.spawn(async move |this, cx| {
            loop {
                let url = poll_url.clone();
                let result = cx
                    .background_spawn(async move { HistorianClient::new(url).snapshot() })
                    .await;

                let alive = this
                    .update(cx, |state, cx| {
                        state.loading = false;
                        match result {
                            Ok(snapshot) => {
                                state.snapshot = Some(snapshot);
                                state.error = None;
                                state.last_updated = Some(SystemTime::now());
                                state.maybe_apply_preferred(cx);
                            }
                            Err(message) => state.error = Some(message),
                        }
                        cx.notify();
                    })
                    .is_ok();

                if !alive {
                    break;
                }

                cx.background_executor().timer(Duration::from_secs(2)).await;
            }
        })
        .detach();

        Self {
            historian_url,
            snapshot: None,
            error: None,
            last_updated: None,
            loading: true,
            driver_error: None,
            driver_pending: false,
            preferred_driver,
            driver_synced,
            settings_open: false,
            scroll_handle: ScrollHandle::new(),
            view: View::Dashboard,
            history: HistoryState::default(),
            history_scroll: ScrollHandle::new(),
            settings: None,
            settings_error: None,
            settings_loading: false,
        }
    }

    fn status(&self) -> (&'static str, u32) {
        match (&self.snapshot, &self.error) {
            (Some(snapshot), _) if !snapshot.health.database.ok => ("Database error", RED),
            (Some(snapshot), _) if snapshot.health.status == "ok" => ("Live", GREEN),
            (Some(_), _) => ("Degraded", AMBER),
            (None, Some(_)) => ("Offline", RED),
            (None, None) => ("Connecting", MUTED),
        }
    }

    fn upstream_error(&self) -> Option<&str> {
        let upstream = &self.snapshot.as_ref()?.health.upstream;
        if upstream.configured && !upstream.connected {
            upstream.last_error.as_deref()
        } else {
            None
        }
    }

    fn driver_badge(&self) -> Option<Div> {
        let suite = self.snapshot.as_ref()?.suite.as_ref()?;
        let Some(entry) = suite.drivers.iter().find(|entry| entry.desired) else {
            return Some(badge("No driver", MUTED));
        };
        let (state, tone) = driver_state(entry);
        Some(badge(
            format!("{} · {state}", driver_label(&entry.driver)),
            tone,
        ))
    }

    fn driver_active(&self, driver: &str) -> bool {
        self.snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.suite.as_ref())
            .map(|suite| {
                suite
                    .drivers
                    .iter()
                    .any(|entry| entry.driver == driver && entry.desired)
            })
            .unwrap_or(false)
    }

    fn maybe_apply_preferred(&mut self, cx: &mut Context<Self>) {
        if self.driver_synced || self.driver_pending {
            return;
        }

        let Some(suite) = self
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.suite.as_ref())
        else {
            return;
        };
        self.driver_synced = true;

        let Some(preferred) = self.preferred_driver.clone() else {
            return;
        };
        if !suite.available.iter().any(|driver| driver == &preferred) {
            self.driver_error = Some(format!(
                "{} is not available on this service",
                driver_label(&preferred)
            ));
            return;
        }
        if suite
            .drivers
            .iter()
            .any(|entry| entry.driver == preferred && entry.desired)
        {
            return;
        }

        self.apply_driver(preferred, cx);
    }

    fn choose_driver(&mut self, driver: &'static str, cx: &mut Context<Self>) {
        if self.driver_pending {
            return;
        }

        // Clicking the active driver stops it and forgets the preference;
        // clicking another one switches exclusively.
        if self.driver_active(driver) {
            self.preferred_driver = None;
            clear_preferred_driver();
            self.driver_synced = true;
            self.stop_driver(driver.to_string(), cx);
        } else {
            self.preferred_driver = Some(driver.to_string());
            save_preferred_driver(driver);
            self.driver_synced = true;
            self.apply_driver(driver.to_string(), cx);
        }
    }

    fn apply_driver(&mut self, driver: String, cx: &mut Context<Self>) {
        if self.driver_pending {
            return;
        }

        self.driver_pending = true;
        self.driver_error = None;
        let url = self.historian_url.clone();

        cx.spawn(async move |this, cx| {
            let target = driver.clone();
            let result = cx
                .background_spawn(async move {
                    let client = HistorianClient::new(url);
                    let suite = client.suite()?;
                    for entry in &suite.drivers {
                        if entry.desired && entry.driver != target {
                            // A stuck or failed driver should not prevent the
                            // newly selected one from starting.
                            let _ = client.driver_action(&entry.driver, "stop");
                        }
                    }
                    client.driver_action(&target, "start")
                })
                .await;

            this.update(cx, |state, cx| state.finish_driver_action(result, cx))
                .ok();
        })
        .detach();
    }

    fn stop_driver(&mut self, driver: String, cx: &mut Context<Self>) {
        if self.driver_pending {
            return;
        }

        self.driver_pending = true;
        self.driver_error = None;
        let url = self.historian_url.clone();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move {
                    HistorianClient::new(url).driver_action(&driver, "stop")
                })
                .await;

            this.update(cx, |state, cx| state.finish_driver_action(result, cx))
                .ok();
        })
        .detach();
    }

    fn finish_driver_action(&mut self, result: Result<SuiteState, String>, cx: &mut Context<Self>) {
        self.driver_pending = false;
        match result {
            Ok(suite) => {
                self.driver_error = None;
                if let Some(snapshot) = self.snapshot.as_mut() {
                    snapshot.suite = Some(suite);
                }
            }
            Err(message) => self.driver_error = Some(message),
        }
        cx.notify();
    }

    fn driver_settings(&mut self, cx: &mut Context<Self>) -> Div {
        let suite = self
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.suite.as_ref());
        let selected = suite.and_then(|suite| suite.drivers.iter().find(|entry| entry.desired));
        let pending = self.driver_pending;
        let driver_error = self.driver_error.clone().or_else(|| {
            let suite = suite?;
            self.preferred_driver
                .as_deref()
                .and_then(|name| suite.drivers.iter().find(|entry| entry.driver == name))
                .and_then(|entry| entry.error.clone())
        });

        let summary = if self.snapshot.is_none() {
            "Waiting for the historian...".to_string()
        } else {
            match suite {
                None => "Driver control is not available from this historian.".to_string(),
                Some(_) => match selected {
                    Some(entry) => {
                        let (state, _) = driver_state(entry);
                        let restarts = entry.restarts;
                        if restarts > 0 {
                            format!(
                                "{} · {state} · {restarts} restart{}",
                                driver_label(&entry.driver),
                                if restarts == 1 { "" } else { "s" }
                            )
                        } else {
                            format!("{} · {state}", driver_label(&entry.driver))
                        }
                    }
                    None => "No driver selected".to_string(),
                },
            }
        };

        let simulator_selected = suite
            .map(|suite| {
                suite
                    .drivers
                    .iter()
                    .any(|entry| entry.driver == "simulator" && entry.desired)
            })
            .unwrap_or(false);

        let simulator_button = simulator_selected.then(|| {
            div()
                .id("open-simulator")
                .flex()
                .items_center()
                .justify_center()
                .w_full()
                .rounded_lg()
                .bg(rgb(TEXT))
                .px_4()
                .py_2()
                .text_sm()
                .font_weight(FontWeight::MEDIUM)
                .text_color(rgb(0xffffff))
                .cursor(CursorStyle::PointingHand)
                .hover(|this| this.bg(rgb(0x292524)))
                .on_click(cx.listener(|state, _, _, cx| {
                    match crate::launcher::launch_simulator_ui(&state.historian_url) {
                        Ok(()) => state.settings_open = false,
                        Err(error) => state.driver_error = Some(error),
                    }
                    cx.notify();
                }))
                .child("Open simulator")
        });

        let options: Vec<Stateful<Div>> = DRIVERS
            .iter()
            .map(|(name, label, detail)| {
                let entry = suite
                    .and_then(|suite| suite.drivers.iter().find(|entry| entry.driver == *name));
                let active = entry.map(|entry| entry.desired).unwrap_or(false);
                let available = suite
                    .map(|suite| {
                        suite
                            .available
                            .iter()
                            .any(|candidate| candidate.as_str() == *name)
                    })
                    .unwrap_or(false);
                let (state, tone) = match suite {
                    Some(_) if !available => ("Unavailable", MUTED),
                    _ => entry.map(driver_state).unwrap_or(("Unknown", MUTED)),
                };
                let enabled = available && !pending;
                let id = *name;

                div()
                    .id(id)
                    .rounded_lg()
                    .border_1()
                    .border_color(rgb(if active { AMBER } else { BORDER }))
                    .bg(rgb(if active { AMBER } else { BG }).opacity(if active {
                        0.10
                    } else {
                        1.0
                    }))
                    .p_3()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_4()
                    .when(enabled, |this| this.cursor(CursorStyle::PointingHand))
                    .when(enabled, |this| {
                        this.hover(|this| {
                            this.border_color(rgb(AMBER).opacity(0.6))
                                .bg(rgb(AMBER).opacity(0.06))
                        })
                    })
                    .when(enabled, |this| {
                        this.on_click(cx.listener(move |state, _, _, cx| {
                            state.choose_driver(id, cx);
                        }))
                    })
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(*label),
                            )
                            .child(div().text_xs().text_color(rgb(MUTED)).child(*detail)),
                    )
                    .child(driver_dot(state, tone))
            })
            .collect();

        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(div().text_xs().text_color(rgb(MUTED)).child(summary))
            .child(div().flex().flex_col().gap_2().children(options))
            .children(simulator_button)
            .children(driver_error.as_deref().map(error_banner))
    }

    fn open_settings(&mut self, cx: &mut Context<Self>) {
        self.settings_open = true;
        self.load_settings(cx);
        cx.notify();
    }

    /// The dialog reports the configuration the suite resolved at startup, so
    /// refetch it whenever the dialog opens rather than polling it.
    fn load_settings(&mut self, cx: &mut Context<Self>) {
        if self.settings_loading {
            return;
        }
        self.settings_loading = true;
        self.settings_error = None;

        let url = self.historian_url.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move { HistorianClient::new(url).settings() })
                .await;

            this.update(cx, |state, cx| {
                state.settings_loading = false;
                match result {
                    Ok(settings) => {
                        state.settings = settings;
                        state.settings_error = None;
                    }
                    Err(message) => state.settings_error = Some(message),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Server, database, bridge, and driver states in one list.
    fn status_section(&self) -> Div {
        let (status, tone) = self.status();
        let health = self.snapshot.as_ref().map(|snapshot| &snapshot.health);
        let database = self
            .settings
            .as_ref()
            .map(|settings| settings.historian.database_path.clone())
            .unwrap_or_else(|| "-".to_string());

        let mut rows = vec![
            status_row("server", self.historian_url.clone(), status, tone),
            match health {
                Some(health) if health.database.ok => status_row("database", database, "ok", GREEN),
                Some(_) => status_row("database", database, "error", RED),
                None => status_row("database", database, "unknown", MUTED),
            },
        ];

        match health {
            Some(health) if !health.upstreams.is_empty() => {
                for upstream in health
                    .upstreams
                    .iter()
                    .filter(|upstream| upstream.configured)
                {
                    let (label, tone) = if upstream.connected {
                        ("connected", GREEN)
                    } else {
                        ("disconnected", AMBER)
                    };
                    let detail = if upstream.connected {
                        match upstream.last_message_at.as_deref() {
                            Some(at) => {
                                format!(
                                    "{} · {} · last message {}",
                                    upstream.id,
                                    upstream.url,
                                    format_timestamp(at)
                                )
                            }
                            None => format!("{} · {} · no messages yet", upstream.id, upstream.url),
                        }
                    } else {
                        match upstream.last_error.as_deref() {
                            Some(error) => format!("{} · {error}", upstream.id),
                            None => format!("{} · {}", upstream.id, upstream.url),
                        }
                    };
                    rows.push(status_row("bridge", detail, label, tone));
                }
            }
            Some(health) if health.upstream.configured => {
                let (label, tone) = if health.upstream.connected {
                    ("connected", GREEN)
                } else {
                    ("disconnected", AMBER)
                };
                let detail = health
                    .upstream
                    .last_message_at
                    .as_deref()
                    .map(format_timestamp)
                    .unwrap_or_else(|| "no messages yet".to_string());
                rows.push(status_row("bridge", detail, label, tone));
            }
            _ => rows.push(status_row(
                "bridge",
                "no upstream configured".to_string(),
                "local",
                MUTED,
            )),
        }

        if let Some(suite) = self
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.suite.as_ref())
        {
            let running: Vec<&str> = suite
                .drivers
                .iter()
                .filter(|entry| entry.state == "running")
                .map(|entry| driver_label(&entry.driver))
                .collect();
            rows.push(status_row(
                "drivers",
                if running.is_empty() {
                    "none running".to_string()
                } else {
                    running.join(", ")
                },
                format!("{} attached", suite.drivers.len()),
                MUTED,
            ));
        }

        for device in self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.devices.as_slice())
            .unwrap_or(&[])
        {
            let detail = match device.model.as_deref() {
                Some(model) => format!(
                    "{model} · {} · last seen {}",
                    device.id,
                    format_timestamp(&device.last_seen_at)
                ),
                None => format!(
                    "{} · last seen {}",
                    device.id,
                    format_timestamp(&device.last_seen_at)
                ),
            };
            let firmware = device
                .firmware_version
                .map(|version| format!("fw {version}"))
                .unwrap_or_else(|| "fw -".to_string());
            rows.push(status_row("scale", detail, firmware, MUTED));
        }

        div().flex().flex_col().children(rows)
    }

    /// The TOML-backed settings the suite resolved, plus where they came from.
    fn config_section(&self) -> Div {
        let mut section = div()
            .flex()
            .flex_col()
            .gap_5()
            .child(section_title("Configuration"));

        let Some(settings) = self.settings.as_ref() else {
            return section.child(div().text_xs().text_color(rgb(MUTED)).child(
                if self.settings_loading {
                    "Reading the configuration..."
                } else if self.settings_error.is_some() {
                    "The configuration could not be read."
                } else {
                    "This historian runs on its own, so it has no suite configuration."
                },
            ));
        };

        section = section.child(config_row(
            "file",
            settings
                .config_path
                .clone()
                .unwrap_or_else(|| "built-in defaults".to_string()),
        ));

        for (label, value) in config_rows(settings) {
            section = section.child(config_row(label, value));
        }

        section
    }

    fn settings_dialog(&mut self, cx: &mut Context<Self>) -> Stateful<Div> {
        let panel = div()
            .id("settings-panel")
            .w(px(640.))
            .max_h(px(680.))
            .rounded_2xl()
            .border_1()
            .border_color(rgb(BORDER))
            .bg(rgb(CARD))
            .shadow_2xl()
            .flex()
            .flex_col()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_6()
                    .pt_6()
                    .pb_3()
                    .child(
                        div()
                            .text_lg()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Settings"),
                    )
                    .child(
                        div()
                            .id("close-settings")
                            .flex()
                            .items_center()
                            .justify_center()
                            .h(px(24.))
                            .w(px(24.))
                            .rounded_md()
                            .text_lg()
                            .text_color(rgb(MUTED))
                            .cursor(CursorStyle::PointingHand)
                            .hover(|this| this.bg(rgb(RED).opacity(0.14)).text_color(rgb(RED)))
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .on_click(cx.listener(|state, _, _, cx| {
                                state.settings_open = false;
                                cx.notify();
                            }))
                            .child("×"),
                    ),
            )
            .child(
                div()
                    .id("settings-body")
                    .flex_1()
                    .min_h(px(0.))
                    .overflow_y_scroll()
                    .px_6()
                    .pb_6()
                    .flex()
                    .flex_col()
                    .gap_5()
                    .child(section_title("Status"))
                    .child(self.status_section())
                    .child(section_title("Drivers"))
                    .child(self.driver_settings(cx))
                    .child(self.config_section()),
            );

        div()
            .id("settings-backdrop")
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(rgb(TEXT).opacity(0.35))
            .occlude()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|state, _, _, cx| {
                    state.settings_open = false;
                    cx.notify();
                }),
            )
            .child(panel)
    }

    fn latest_card(&self) -> Div {
        let latest = self
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.latest.as_ref());
        let connected = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.health.upstream.connected)
            .unwrap_or(false);
        let powered = latest.is_some();
        let (status, tone) = if latest.is_none() {
            ("off", MUTED)
        } else if connected {
            ("ready", AMBER)
        } else {
            ("offline", RED)
        };
        let platform = yunmai_noble_ui_kit::scale_platform(
            latest
                .map(|measurement| measurement.weight_kg)
                .unwrap_or(0.0),
            "kg",
            powered,
            false,
            status,
            tone,
            320.,
        );

        let details = match latest {
            Some(measurement) => {
                let model = self
                    .snapshot
                    .as_ref()
                    .and_then(|snapshot| snapshot.device_model(&measurement.device_id));
                let body_composition = measurement.has_body_composition();

                let mut rows = vec![
                    detail_row("Measured", format_timestamp(&measurement.scale_date)),
                    detail_row("User", measurement.user_id.to_string()),
                ];
                if let Some(model) = model {
                    rows.push(detail_row("Model", model.to_string()));
                }
                rows.push(detail_row("Device", measurement.device_id.clone()));
                if body_composition {
                    rows.push(detail_row(
                        "Fat %",
                        format!("{}%", measurement.fat_percentage),
                    ));
                    rows.push(detail_row("Resistance", measurement.resistance.to_string()));
                }
                rows.push(detail_row(
                    "Firmware",
                    measurement
                        .firmware_version
                        .map(|version| version.to_string())
                        .unwrap_or_else(|| "-".to_string()),
                ));

                div()
                    .flex_1()
                    .min_w(px(0.))
                    .flex()
                    .flex_col()
                    .justify_center()
                    .gap_3()
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(MUTED))
                            .child("Latest reading"),
                    )
                    .child(
                        div()
                            .w_full()
                            .max_w(px(380.))
                            .flex()
                            .flex_col()
                            .gap_2()
                            .children(rows),
                    )
            }
            None => div()
                .flex_1()
                .flex()
                .flex_col()
                .justify_center()
                .gap_2()
                .child(
                    div()
                        .text_sm()
                        .text_color(rgb(MUTED))
                        .child("Latest reading"),
                )
                .child(
                    div()
                        .text_sm()
                        .text_color(rgb(MUTED))
                        .child(if self.loading {
                            "Connecting to the historian..."
                        } else {
                            "No measurements yet."
                        }),
                ),
        };

        div()
            .rounded_2xl()
            .border_1()
            .border_color(rgb(BORDER))
            .bg(rgb(CARD))
            .shadow_sm()
            .p_6()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_6()
                    .child(platform)
                    .child(details),
            )
    }

    fn open_history(&mut self, cx: &mut Context<Self>) {
        self.view = View::History;
        self.history = HistoryState {
            generation: self.history.generation + 1,
            ..HistoryState::default()
        };
        // Start at the newest reading again, not at the previous offset.
        self.history_scroll = ScrollHandle::new();
        self.load_history(self.history.generation, cx);
        cx.notify();
    }

    fn close_history(&mut self, cx: &mut Context<Self>) {
        self.view = View::Dashboard;
        cx.notify();
    }

    /// Fetch one page. A response from before the last reload is dropped, so
    /// reopening the view cannot interleave two lists.
    fn load_history(&mut self, generation: u64, cx: &mut Context<Self>) {
        if self.history.loading {
            return;
        }
        self.history.loading = true;
        self.history.error = None;

        let url = self.historian_url.clone();
        let cursor = self.history.next.clone();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move {
                    HistorianClient::new(url).measurements(HISTORY_PAGE, cursor.as_deref())
                })
                .await;

            this.update(cx, |state, cx| {
                if state.history.generation != generation {
                    return;
                }

                state.history.loading = false;
                match result {
                    Ok(page) => {
                        state.history.next = page.next;
                        for measurement in page.measurements {
                            if state
                                .history
                                .items
                                .iter()
                                .all(|item| item.id != measurement.id)
                            {
                                state.history.items.push(measurement);
                            }
                        }
                    }
                    Err(message) => state.history.error = Some(message),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// Page in as the list approaches its end.
    fn maybe_load_more(&mut self, cx: &mut Context<Self>) {
        if self.view != View::History || self.history.loading || self.history.next.is_none() {
            return;
        }

        let offset = -(self.history_scroll.offset().y / px(1.));
        let max = self.history_scroll.max_offset().y / px(1.);
        if max - offset < 160.0 {
            self.load_history(self.history.generation, cx);
        }
    }

    /// Delete every measurement. The first click only arms the button, because
    /// the historian has no undo.
    fn clear_history(&mut self, cx: &mut Context<Self>) {
        if !self.history.confirm_clear {
            self.history.confirm_clear = true;
            cx.notify();
            return;
        }

        let url = self.historian_url.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move { HistorianClient::new(url).clear_measurements() })
                .await;

            this.update(cx, |state, cx| {
                state.history = HistoryState {
                    generation: state.history.generation + 1,
                    ..HistoryState::default()
                };

                match result {
                    Ok(_) => {
                        if let Some(snapshot) = state.snapshot.as_mut() {
                            snapshot.measurements.clear();
                            snapshot.latest = None;
                        }
                    }
                    Err(message) => state.history.error = Some(message),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn open_historian(&mut self, cx: &mut Context<Self>) {
        let url = format!("{}/", self.historian_url.trim_end_matches('/'));
        if let Err(error) = open_in_browser(&url) {
            self.history.error = Some(error);
        }
        cx.notify();
    }

    /// Weight trend over the readings the dashboard already polls for.
    fn trend_card(&self) -> Option<Div> {
        let measurements = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.measurements.as_slice())
            .unwrap_or(&[]);
        let chart = crate::chart::weight_trend(measurements, AMBER, BORDER, 180.)?;
        let oldest = measurements.last()?;
        let newest = measurements.first()?;
        let min = measurements
            .iter()
            .map(|measurement| measurement.weight_kg)
            .fold(f64::INFINITY, f64::min);
        let max = measurements
            .iter()
            .map(|measurement| measurement.weight_kg)
            .fold(f64::NEG_INFINITY, f64::max);

        Some(
            div()
                .rounded_2xl()
                .border_1()
                .border_color(rgb(BORDER))
                .bg(rgb(CARD))
                .shadow_sm()
                .p_6()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(div().text_sm().text_color(rgb(MUTED)).child("Weight trend"))
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(MUTED))
                                .child(format_weight_range(min, max)),
                        ),
                )
                .child(chart)
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .text_xs()
                        .text_color(rgb(MUTED))
                        .child(format_timestamp(&oldest.scale_date))
                        .child(format_timestamp(&newest.scale_date)),
                ),
        )
    }

    fn history_card(&self, cx: &mut Context<Self>) -> Div {
        let measurements = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.measurements.as_slice())
            .unwrap_or(&[]);
        let groups = group_consecutive(measurements);
        let shown: Vec<&HistoryGroup> = groups.iter().take(RECENT_ROWS).collect();
        let rows: Vec<Div> = shown.iter().map(|group| history_row(group)).collect();
        let count_label = if groups.len() > shown.len() {
            format!("{} of {}", shown.len(), groups.len())
        } else {
            format!("{} readings", measurements.len())
        };

        div()
            .rounded_2xl()
            .border_1()
            .border_color(rgb(BORDER))
            .bg(rgb(CARD))
            .shadow_sm()
            .p_6()
            .flex()
            .flex_col()
            .gap_2()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(div().text_sm().text_color(rgb(MUTED)).child("History"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(MUTED))
                                    .child(count_label.clone()),
                            )
                            .child(
                                div()
                                    .id("open-history")
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .h(px(24.))
                                    .px_2()
                                    .rounded_md()
                                    .text_xs()
                                    .text_color(rgb(MUTED))
                                    .cursor(CursorStyle::PointingHand)
                                    .hover(|this| this.bg(rgb(BORDER)).text_color(rgb(TEXT)))
                                    .on_mouse_down(MouseButton::Left, |_, _, cx| {
                                        cx.stop_propagation()
                                    })
                                    .on_click(cx.listener(|state, _, _, cx| state.open_history(cx)))
                                    .child("View history"),
                            ),
                    ),
            )
            .child(if rows.is_empty() {
                div()
                    .py_6()
                    .text_sm()
                    .text_color(rgb(MUTED))
                    .child("No measurements yet. Step on the scale to get started.")
            } else {
                div().flex().flex_col().children(rows)
            })
    }

    fn footer(&self) -> Div {
        let updated = self
            .last_updated
            .and_then(|time| time.elapsed().ok())
            .map(|elapsed| format_age(elapsed.as_secs()))
            .unwrap_or_else(|| "waiting".to_string());
        let upstream = self
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.health.upstream.last_message_at.as_deref())
            .map(format_timestamp);

        div()
            .flex()
            .justify_between()
            .text_xs()
            .text_color(rgb(MUTED))
            .child(match upstream {
                Some(upstream) => {
                    format!(
                        "{} · updated {updated} · upstream {upstream}",
                        self.historian_url
                    )
                }
                None => format!("{} · updated {updated}", self.historian_url),
            })
    }
}

impl Render for Dashboard {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let client_decorations = matches!(window.window_decorations(), Decorations::Client { .. });
        let settings = self.settings_open.then(|| self.settings_dialog(cx));
        let body = match self.view {
            View::Dashboard => self.dashboard_body(cx),
            View::History => self.history_body(cx),
        };

        div()
            .id("window")
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(BG))
            .text_color(rgb(TEXT))
            .child(self.titlebar(client_decorations, cx))
            .child(body)
            .children(client_decorations.then(resize_handles))
            .children(settings)
    }
}

impl Dashboard {
    fn dashboard_body(&self, cx: &mut Context<Self>) -> Div {
        div()
            .flex_1()
            .min_h(px(0.))
            .relative()
            .child(
                div()
                    .id("content")
                    .size_full()
                    .overflow_y_scroll()
                    .track_scroll(&self.scroll_handle)
                    .on_scroll(cx.listener(|_, _, _, cx| cx.notify()))
                    .p(px(28.))
                    .child(
                        div()
                            .w_full()
                            .max_w(px(860.))
                            .mx_auto()
                            .flex()
                            .flex_col()
                            .gap_6()
                            .children(
                                self.error
                                    .as_deref()
                                    .or_else(|| self.upstream_error())
                                    .map(error_banner),
                            )
                            .child(self.latest_card())
                            .children(self.trend_card())
                            .child(self.history_card(cx))
                            .child(self.footer()),
                    ),
            )
            .child(scrollbar(&self.scroll_handle))
    }

    fn history_body(&mut self, cx: &mut Context<Self>) -> Div {
        let rows: Vec<Div> = group_consecutive(&self.history.items)
            .iter()
            .map(history_detail_row)
            .collect();
        let loaded = self.history.items.len();
        let more = self.history.next.is_some();

        div()
            .flex_1()
            .min_h(px(0.))
            .flex()
            .flex_col()
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_end()
                    .justify_between()
                    .gap_4()
                    .px(px(28.))
                    .pt(px(20.))
                    .pb_3()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_lg()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("History"),
                            )
                            .child(
                                div().text_xs().text_color(rgb(MUTED)).child(format!(
                                    "{loaded} readings · {}",
                                    self.historian_url
                                )),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .children((loaded > 0).then(|| {
                                button(
                                    "clear-history",
                                    if self.history.confirm_clear {
                                        "Confirm clear"
                                    } else {
                                        "Clear history"
                                    },
                                    cx,
                                    |state, cx| state.clear_history(cx),
                                )
                                .when(self.history.confirm_clear, |this| this.text_color(rgb(RED)))
                            }))
                            .child(button("open-historian", "Open historian", cx, |state, cx| {
                                state.open_historian(cx)
                            }))
                            .child(button("close-history", "Back", cx, |state, cx| {
                                state.close_history(cx)
                            })),
                    ),
            )
            .children(self.history.error.as_deref().map(|message| {
                div()
                    .flex_none()
                    .px(px(28.))
                    .child(error_banner(message))
            }))
            .child(
                div()
                    .flex_1()
                    .min_h(px(0.))
                    .relative()
                    .child(
                        div()
                            .id("history-list")
                            .size_full()
                            .overflow_y_scroll()
                            .track_scroll(&self.history_scroll)
                            .on_scroll(cx.listener(|state, _, _, cx| {
                                state.maybe_load_more(cx);
                                cx.notify();
                            }))
                            .p(px(28.))
                            .child(
                                div()
                                    .w_full()
                                    .max_w(px(860.))
                                    .mx_auto()
                                    .overflow_hidden()
                                    .rounded_2xl()
                                    .border_1()
                                    .border_color(rgb(BORDER))
                                    .bg(rgb(CARD))
                                    .shadow_sm()
                                    .children(rows)
                                    .children((loaded == 0).then(|| {
                                        div()
                                            .p_6()
                                            .text_sm()
                                            .text_color(rgb(MUTED))
                                            .child(if self.history.error.is_some() {
                                                "Could not load the history."
                                            } else if self.history.loading {
                                                "Loading history..."
                                            } else {
                                                "No measurements yet. Step on the scale to get started."
                                            })
                                    })),
                            ),
                    )
                    .child(scrollbar(&self.history_scroll)),
            )
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px(px(28.))
                    .py_2()
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(MUTED))
                            .child(format!("{loaded} readings")),
                    )
                    .child(if more {
                        button(
                            "load-more",
                            if self.history.loading {
                                "Loading..."
                            } else {
                                "Load more"
                            },
                            cx,
                            |state, cx| state.load_history(state.history.generation, cx),
                        )
                        .into_any_element()
                    } else {
                        div().into_any_element()
                    }),
            )
    }
}

fn scrollbar(handle: &ScrollHandle) -> Div {
    let viewport = handle.bounds().size.height;
    let max_y = handle.max_offset().y;
    let viewport_px = viewport / px(1.);
    let max_px = max_y / px(1.);

    if max_px <= 0.5 || viewport_px <= 0.0 {
        return div();
    }

    let track_px = (viewport_px - 20.0).max(0.0);
    if track_px <= 0.0 {
        return div();
    }

    let content_px = viewport_px + max_px;
    let thumb_px = (track_px * viewport_px / content_px)
        .max(24.0)
        .min(track_px);
    let offset_px = (-(handle.offset().y / px(1.))).max(0.0);
    let ratio = (offset_px / max_px).clamp(0.0, 1.0);
    let top_px = ratio * (track_px - thumb_px);

    div()
        .absolute()
        .top(px(10.))
        .right(px(6.))
        .w(px(6.))
        .h(px(track_px))
        .rounded_full()
        .bg(rgb(BORDER).opacity(0.7))
        .child(
            div()
                .absolute()
                .top(px(top_px))
                .left(px(1.))
                .w(px(4.))
                .h(px(thumb_px))
                .rounded_full()
                .bg(rgb(MUTED).opacity(0.55)),
        )
}

impl Dashboard {
    fn titlebar(&self, client_decorations: bool, cx: &mut Context<Self>) -> Stateful<Div> {
        let (status, tone) = self.status();
        let bar = div()
            .id("titlebar")
            .flex_none()
            .h(px(40.))
            .w_full()
            .flex()
            .items_center()
            .justify_between()
            .px_4()
            .bg(rgb(BG))
            .border_b_1()
            .border_color(rgb(BORDER))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .text_xs()
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(AMBER))
                            .child("YUNMAI SCALE"),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(MUTED))
                            .child(match self.view {
                                View::Dashboard => "dashboard",
                                View::History => "history",
                            }),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(badge(status, tone))
                    .children(self.driver_badge())
                    .child(
                        div()
                            .id("open-settings")
                            .flex()
                            .items_center()
                            .justify_center()
                            .h(px(24.))
                            .px_2()
                            .rounded_md()
                            .text_xs()
                            .text_color(rgb(MUTED))
                            .cursor(CursorStyle::PointingHand)
                            .hover(|this| this.bg(rgb(BORDER)).text_color(rgb(TEXT)))
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .on_click(cx.listener(|state, _, _, cx| state.open_settings(cx)))
                            .child("Settings"),
                    )
                    .child(
                        div()
                            .id("close-window")
                            .flex()
                            .items_center()
                            .justify_center()
                            .h(px(24.))
                            .w(px(24.))
                            .rounded_md()
                            .text_lg()
                            .text_color(rgb(MUTED))
                            .cursor(CursorStyle::PointingHand)
                            .hover(|this| this.bg(rgb(RED).opacity(0.14)).text_color(rgb(RED)))
                            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                            .on_click(|_, window, _| window.remove_window())
                            .child("×"),
                    ),
            );

        if client_decorations {
            bar.on_mouse_down(MouseButton::Left, |_, window, _| window.start_window_move())
        } else {
            bar
        }
    }
}

fn resize_handles() -> Div {
    div()
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .child(resize_handle(
            "resize-top",
            ResizeEdge::Top,
            CursorStyle::ResizeUpDown,
            |div| div.top_0().left(px(10.)).right(px(10.)).h(px(6.)),
        ))
        .child(resize_handle(
            "resize-bottom",
            ResizeEdge::Bottom,
            CursorStyle::ResizeUpDown,
            |div| div.bottom_0().left(px(10.)).right(px(10.)).h(px(6.)),
        ))
        .child(resize_handle(
            "resize-left",
            ResizeEdge::Left,
            CursorStyle::ResizeLeftRight,
            |div| div.left_0().top(px(10.)).bottom(px(10.)).w(px(6.)),
        ))
        .child(resize_handle(
            "resize-right",
            ResizeEdge::Right,
            CursorStyle::ResizeLeftRight,
            |div| div.right_0().top(px(10.)).bottom(px(10.)).w(px(6.)),
        ))
        .child(resize_handle(
            "resize-top-left",
            ResizeEdge::TopLeft,
            CursorStyle::ResizeUpLeftDownRight,
            |div| div.top_0().left_0().size(px(10.)),
        ))
        .child(resize_handle(
            "resize-top-right",
            ResizeEdge::TopRight,
            CursorStyle::ResizeUpRightDownLeft,
            |div| div.top_0().right_0().size(px(10.)),
        ))
        .child(resize_handle(
            "resize-bottom-left",
            ResizeEdge::BottomLeft,
            CursorStyle::ResizeUpRightDownLeft,
            |div| div.bottom_0().left_0().size(px(10.)),
        ))
        .child(resize_handle(
            "resize-bottom-right",
            ResizeEdge::BottomRight,
            CursorStyle::ResizeUpLeftDownRight,
            |div| div.bottom_0().right_0().size(px(10.)),
        ))
}

fn resize_handle(
    id: &'static str,
    edge: ResizeEdge,
    cursor: CursorStyle,
    style: impl FnOnce(Div) -> Div,
) -> Stateful<Div> {
    style(div()).id(id).absolute().cursor(cursor).on_mouse_down(
        MouseButton::Left,
        move |_, window, _| {
            window.start_window_resize(edge);
        },
    )
}

fn badge(label: impl Into<SharedString>, tone: u32) -> Div {
    div()
        .px_3()
        .py_1()
        .rounded_full()
        .bg(rgb(tone).opacity(0.14))
        .text_color(rgb(tone))
        .text_xs()
        .font_weight(FontWeight::MEDIUM)
        .child(label.into())
}

/// Label/value line for the latest-reading details.
fn detail_row(label: &'static str, value: String) -> Div {
    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_6()
        .py_1()
        .border_b_1()
        .border_color(rgb(BORDER))
        .child(div().text_xs().text_color(rgb(MUTED)).child(label))
        .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(value))
}

fn history_row(group: &HistoryGroup) -> Div {
    let measurement = group.newest;
    let detail = match group.repeat_label() {
        Some(repeat) => format!(
            "{} · {repeat} · user {} · {}",
            format_timestamp(&measurement.scale_date),
            measurement.user_id,
            measurement.device_id
        ),
        None => format!(
            "{} · user {} · {}",
            format_timestamp(&measurement.scale_date),
            measurement.user_id,
            measurement.device_id
        ),
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .py_3()
        .border_b_1()
        .border_color(rgb(BORDER))
        .child(
            div()
                .flex()
                .flex_col()
                .gap_1()
                .child(
                    div()
                        .text_base()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(format_weight(measurement.weight_kg)),
                )
                .child(div().text_xs().text_color(rgb(MUTED)).child(detail)),
        )
        .children(measurement.historical.then(|| badge("historical", MUTED)))
}

/// Small text button shared by the history view controls.
fn button(
    id: &'static str,
    label: impl Into<SharedString>,
    cx: &mut Context<Dashboard>,
    on_click: impl Fn(&mut Dashboard, &mut Context<Dashboard>) + 'static,
) -> Stateful<Div> {
    div()
        .id(id)
        .flex()
        .items_center()
        .justify_center()
        .h(px(24.))
        .px_2()
        .rounded_md()
        .text_xs()
        .text_color(rgb(MUTED))
        .cursor(CursorStyle::PointingHand)
        .hover(|this| this.bg(rgb(BORDER)).text_color(rgb(TEXT)))
        .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
        .on_click(cx.listener(move |state, _, _, cx| on_click(state, cx)))
        .child(label.into())
}

/// A row in the full history view. The dashboard card uses the compact
/// `history_row` instead.
fn history_detail_row(group: &HistoryGroup) -> Div {
    let measurement = group.newest;
    let occurred = match group.repeat_label() {
        Some(repeat) => format!(
            "{} · {repeat} since {}",
            format_timestamp(&measurement.scale_date),
            format_timestamp(&group.oldest.scale_date)
        ),
        None => format_timestamp(&measurement.scale_date),
    };

    div()
        .flex()
        .items_center()
        .justify_between()
        .gap_4()
        .px_6()
        .py_3()
        .border_b_1()
        .border_color(rgb(BORDER))
        .child(
            div()
                .flex()
                .items_center()
                .gap_4()
                .child(
                    div()
                        .w(px(96.))
                        .text_base()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(format_weight(measurement.weight_kg)),
                )
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .child(div().text_sm().child(occurred))
                        .child(div().text_xs().text_color(rgb(MUTED)).child(format!(
                            "user {} · {}",
                            measurement.user_id, measurement.device_id
                        ))),
                ),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_4()
                .children(measurement.has_body_composition().then(|| {
                    div()
                        .flex()
                        .items_center()
                        .gap_4()
                        .text_xs()
                        .text_color(rgb(MUTED))
                        .child(format!("{}% fat", measurement.fat_percentage))
                        .child(format!("resistance {}", measurement.resistance))
                }))
                .children(measurement.historical.then(|| badge("historical", MUTED))),
        )
}

fn section_title(label: &str) -> Div {
    div()
        .text_xs()
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(rgb(MUTED))
        .child(label.to_string())
}

fn status_row(
    label: &'static str,
    detail: String,
    value: impl Into<SharedString>,
    tone: u32,
) -> Div {
    div()
        .flex()
        .items_center()
        .gap_3()
        .py_2()
        .border_b_1()
        .border_color(rgb(BORDER))
        .child(
            div()
                .w(px(72.))
                .text_xs()
                .text_color(rgb(MUTED))
                .child(label),
        )
        .child(div().flex_1().text_xs().child(detail))
        .child(badge(value, tone))
}

fn config_row(label: &'static str, value: String) -> Div {
    div()
        .flex()
        .items_start()
        .gap_4()
        .py_1()
        .child(
            div()
                .w(px(220.))
                .flex_none()
                .text_xs()
                .text_color(rgb(MUTED))
                .child(label),
        )
        .child(div().flex_1().text_xs().child(value))
}

fn join_or(values: &[String], empty: &str) -> String {
    if values.is_empty() {
        empty.to_string()
    } else {
        values.join(", ")
    }
}

/// Every TOML-backed setting, in config-file order.
fn config_rows(settings: &SuiteSettings) -> Vec<(&'static str, String)> {
    let historian = &settings.historian;
    let drivers = &settings.drivers;
    let simulator = &settings.simulator;

    vec![
        ("historian.host", historian.host.clone()),
        ("historian.port", historian.port.to_string()),
        ("historian.database_path", historian.database_path.clone()),
        ("historian.device_id", historian.device_id.clone()),
        ("historian.cors_origin", historian.cors_origin.clone()),
        (
            "historian.sse_heartbeat_ms",
            historian.sse_heartbeat_ms.to_string(),
        ),
        (
            "historian.reconnect_min_ms",
            historian.reconnect_min_ms.to_string(),
        ),
        (
            "historian.reconnect_max_ms",
            historian.reconnect_max_ms.to_string(),
        ),
        (
            "historian.upstream_urls",
            join_or(&historian.upstream_urls, "none"),
        ),
        ("drivers.initial", join_or(&drivers.initial, "default")),
        ("drivers.node_id_prefix", drivers.node_id_prefix.clone()),
        ("drivers.restart_ms", drivers.restart_ms.to_string()),
        ("simulator.name", simulator.name.clone()),
        ("simulator.weight_kg", format!("{:.2}", simulator.weight_kg)),
        ("simulator.steps", simulator.steps.to_string()),
        ("simulator.interval_ms", simulator.interval_ms.to_string()),
        (
            "simulator.cycle_delay_ms",
            simulator.cycle_delay_ms.to_string(),
        ),
        (
            "simulator.scan_delay_ms",
            simulator.scan_delay_ms.to_string(),
        ),
        ("simulator.auto_start", simulator.auto_start.to_string()),
        ("simulator.repeat", simulator.repeat.to_string()),
    ]
}

fn open_in_browser(url: &str) -> Result<(), String> {
    let (program, prefix): (&str, &[&str]) = if cfg!(target_os = "macos") {
        ("open", &[])
    } else if cfg!(target_os = "windows") {
        ("cmd", &["/C", "start", ""])
    } else {
        ("xdg-open", &[])
    };

    Command::new(program)
        .args(prefix)
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("cannot open {url}: {error}"))
}

fn driver_label(name: &str) -> &'static str {
    DRIVERS
        .iter()
        .find(|(candidate, _, _)| *candidate == name)
        .map(|(_, label, _)| *label)
        .unwrap_or("Unknown")
}

fn driver_state(entry: &DriverStatus) -> (&'static str, u32) {
    match entry.state.as_str() {
        "running" => ("Running", GREEN),
        "starting" => ("Starting", AMBER),
        "restarting" => ("Restarting", AMBER),
        "stopping" => ("Stopping", AMBER),
        "failed" => ("Failed", RED),
        "stopped" => ("Stopped", MUTED),
        _ => ("Unknown", MUTED),
    }
}

fn driver_dot(label: &'static str, tone: u32) -> Div {
    div()
        .flex()
        .items_center()
        .gap_1()
        .child(div().size(px(6.)).rounded_full().bg(rgb(tone)))
        .child(div().text_xs().text_color(rgb(tone)).child(label))
}

#[derive(serde::Serialize, serde::Deserialize)]
struct DesktopPrefs {
    driver: String,
}

fn desktop_prefs_path() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(base.join("yunmai-noble").join("desktop.json"))
}

fn load_preferred_driver() -> Option<String> {
    let path = desktop_prefs_path()?;
    let body = fs::read_to_string(path).ok()?;
    let prefs: DesktopPrefs = serde_json::from_str(&body).ok()?;
    DRIVERS
        .iter()
        .any(|(name, _, _)| *name == prefs.driver)
        .then_some(prefs.driver)
}

fn save_preferred_driver(driver: &str) {
    let Some(path) = desktop_prefs_path() else {
        return;
    };
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(body) = serde_json::to_string(&DesktopPrefs {
        driver: driver.to_string(),
    }) else {
        return;
    };

    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, body).is_ok() {
        let _ = fs::rename(tmp, path);
    }
}

fn clear_preferred_driver() {
    if let Some(path) = desktop_prefs_path() {
        let _ = fs::remove_file(path);
    }
}

fn error_banner(message: &str) -> Div {
    div()
        .rounded_lg()
        .border_1()
        .border_color(rgb(RED).opacity(0.35))
        .bg(rgb(RED).opacity(0.08))
        .px_4()
        .py_3()
        .text_sm()
        .text_color(rgb(RED))
        .child(message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_known_drivers() {
        assert_eq!(driver_label("simulator"), "Simulator");
        assert_eq!(driver_label("dbus"), "D-Bus");
        assert_eq!(driver_label("noble"), "Node bindings");
        assert_eq!(driver_label("usb"), "Unknown");
    }

    #[test]
    fn maps_driver_states_to_tones() {
        let entry = |state: &str| DriverStatus {
            driver: "dbus".to_string(),
            desired: true,
            state: state.to_string(),
            restarts: 0,
            error: None,
        };

        assert_eq!(driver_state(&entry("running")), ("Running", GREEN));
        assert_eq!(driver_state(&entry("restarting")), ("Restarting", AMBER));
        assert_eq!(driver_state(&entry("failed")), ("Failed", RED));
        assert_eq!(driver_state(&entry("stopped")), ("Stopped", MUTED));
    }

    #[test]
    fn lists_every_toml_backed_setting() {
        let settings = SuiteSettings {
            config_path: Some("/etc/yunmai-noble/config.toml".to_string()),
            historian: crate::api::HistorianSettings {
                host: "127.0.0.1".to_string(),
                port: 3100,
                database_path: "/var/lib/yunmai-noble/historian.sqlite".to_string(),
                cors_origin: "*".to_string(),
                sse_heartbeat_ms: 15000,
                reconnect_min_ms: 1000,
                reconnect_max_ms: 30000,
                upstream_urls: Vec::new(),
                device_id: "yunmai-noble".to_string(),
            },
            drivers: crate::api::DriverSettings {
                initial: vec!["simulator".to_string()],
                node_id_prefix: "sim".to_string(),
                restart_ms: 2000,
            },
            simulator: crate::api::SimulatorSettings {
                name: "YUNMAI-SIM".to_string(),
                weight_kg: 72.4,
                steps: 8,
                interval_ms: 250,
                cycle_delay_ms: 5000,
                scan_delay_ms: 200,
                auto_start: false,
                repeat: false,
            },
        };

        let rows = config_rows(&settings);
        let value = |label: &str| {
            rows.iter()
                .find(|(key, _)| *key == label)
                .map(|(_, value)| value.as_str())
        };

        assert_eq!(value("historian.port"), Some("3100"));
        assert_eq!(value("historian.upstream_urls"), Some("none"));
        assert_eq!(value("drivers.initial"), Some("simulator"));
        assert_eq!(value("simulator.weight_kg"), Some("72.40"));
        assert_eq!(value("simulator.repeat"), Some("false"));
    }
}
