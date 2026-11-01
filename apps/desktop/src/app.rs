use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use gpui::{
    Context, CursorStyle, Decorations, Div, FontWeight, MouseButton, Render, ResizeEdge,
    ScrollHandle, SharedString, Stateful, Window, div, prelude::*, px, rgb,
};

use crate::api::{DriverStatus, HistorianClient, Measurement, SuiteState};
use crate::format::{format_age, format_timestamp, format_weight};

const BG: u32 = 0xfafaf9;
const CARD: u32 = 0xffffff;
const BORDER: u32 = 0xe7e5e4;
const TEXT: u32 = 0x1c1917;
const MUTED: u32 = 0x78716c;
const AMBER: u32 = 0xd97706;
const GREEN: u32 = 0x10b981;
const RED: u32 = 0xe11d48;

/// Drivers exposed by the suite, in display order.
const DRIVERS: [(&str, &str, &str); 3] = [
    ("simulator", "Simulator", "Built-in virtual scale"),
    ("dbus", "D-Bus", "BlueZ over the system bus"),
    ("noble", "Node bindings", "Noble HCI driver, needs Node 22"),
];

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

    fn settings_dialog(&mut self, cx: &mut Context<Self>) -> Stateful<Div> {
        let panel = div()
            .id("settings-panel")
            .w(px(560.))
            .rounded_2xl()
            .border_1()
            .border_color(rgb(BORDER))
            .bg(rgb(CARD))
            .shadow_2xl()
            .p_6()
            .flex()
            .flex_col()
            .gap_5()
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
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
            .child(self.driver_settings(cx));

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
            Some(measurement) => div()
                .flex_1()
                .flex()
                .flex_col()
                .justify_center()
                .gap_4()
                .child(
                    div()
                        .text_sm()
                        .text_color(rgb(MUTED))
                        .child("Latest reading"),
                )
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_6()
                        .child(metric(
                            "Measured",
                            format_timestamp(&measurement.scale_date),
                        ))
                        .child(metric("User", measurement.user_id.to_string()))
                        .child(metric("Device", measurement.device_id.clone()))
                        .child(metric("Resistance", measurement.resistance.to_string()))
                        .child(metric("Fat %", measurement.fat_percentage.to_string()))
                        .child(metric(
                            "Firmware",
                            measurement
                                .firmware_version
                                .map(|version| version.to_string())
                                .unwrap_or_else(|| "—".to_string()),
                        )),
                ),
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

    fn history_card(&self) -> Div {
        let measurements = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.measurements.as_slice())
            .unwrap_or(&[]);
        let rows: Vec<Div> = measurements.iter().take(12).map(history_row).collect();

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
                            .text_xs()
                            .text_color(rgb(MUTED))
                            .child(format!("{} readings", measurements.len())),
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

        div()
            .id("window")
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(BG))
            .text_color(rgb(TEXT))
            .child(self.titlebar(client_decorations, cx))
            .child(
                div()
                    .flex_1()
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
                                    .child(self.history_card())
                                    .child(self.footer()),
                            ),
                    )
                    .child(self.scrollbar()),
            )
            .children(client_decorations.then(resize_handles))
            .children(settings)
    }
}

impl Dashboard {
    fn scrollbar(&self) -> Div {
        let viewport = self.scroll_handle.bounds().size.height;
        let max_y = self.scroll_handle.max_offset().y;
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
        let offset_px = (-(self.scroll_handle.offset().y / px(1.))).max(0.0);
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
                    .child(div().text_xs().text_color(rgb(MUTED)).child("dashboard")),
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
                            .on_click(cx.listener(|state, _, _, cx| {
                                state.settings_open = true;
                                cx.notify();
                            }))
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

fn metric(label: &'static str, value: String) -> Div {
    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(div().text_xs().text_color(rgb(MUTED)).child(label))
        .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(value))
}

fn history_row(measurement: &Measurement) -> Div {
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
                .child(div().text_xs().text_color(rgb(MUTED)).child(format!(
                    "{} · user {} · {}",
                    format_timestamp(&measurement.scale_date),
                    measurement.user_id,
                    measurement.device_id
                ))),
        )
        .children(measurement.historical.then(|| badge("historical", MUTED)))
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
}
