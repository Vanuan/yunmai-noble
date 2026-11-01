use std::time::{Duration, SystemTime};

use gpui::{Context, Div, FontWeight, Render, SharedString, Window, div, prelude::*, px, rgb};

use crate::api::{HistorianClient, Measurement};
use crate::format::{format_age, format_timestamp, format_weight};

const BG: u32 = 0x0c0a09;
const CARD: u32 = 0x1c1917;
const BORDER: u32 = 0x292524;
const TEXT: u32 = 0xe7e5e4;
const MUTED: u32 = 0xa8a29e;
const AMBER: u32 = 0xf59e0b;
const GREEN: u32 = 0x10b981;
const RED: u32 = 0xf43f5e;

pub struct Dashboard {
    historian_url: String,
    snapshot: Option<crate::api::Snapshot>,
    error: Option<String>,
    last_updated: Option<SystemTime>,
    loading: bool,
}

impl Dashboard {
    pub fn new(historian_url: String, cx: &mut Context<Self>) -> Self {
        let poll_url = historian_url.clone();

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

    fn upstream_badge(&self) -> Option<Div> {
        let upstream = &self.snapshot.as_ref()?.health.upstream;
        if !upstream.configured {
            return None;
        }

        Some(badge(
            if upstream.connected {
                "Upstream connected"
            } else {
                "Upstream offline"
            },
            if upstream.connected { GREEN } else { RED },
        ))
    }

    fn header(&self) -> Div {
        let (status, tone) = self.status();

        div()
            .flex()
            .items_end()
            .justify_between()
            .gap_6()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .text_xs()
                            .font_weight(FontWeight::BOLD)
                            .text_color(rgb(AMBER))
                            .child("YUNMAI SCALE"),
                    )
                    .child(
                        div()
                            .text_size(px(32.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("yunmai-noble"),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(MUTED))
                            .child("Live readings and measurement history"),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .justify_end()
                    .gap_2()
                    .child(badge(status, tone))
                    .children(self.upstream_badge())
                    .child(badge(
                        if self.loading {
                            "Connecting"
                        } else {
                            "Polling 2s"
                        },
                        MUTED,
                    )),
            )
    }

    fn latest_card(&self) -> Div {
        let latest = self
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.latest.as_ref());
        let card = div()
            .rounded_xl()
            .border_1()
            .border_color(rgb(BORDER))
            .bg(rgb(CARD))
            .p_6()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(MUTED))
                    .child("Latest weight"),
            )
            .child(
                div()
                    .text_size(px(48.))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(
                        latest
                            .map(|measurement| format_weight(measurement.weight_kg))
                            .unwrap_or_else(|| "—".to_string()),
                    ),
            );

        match latest {
            Some(measurement) => card.child(
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
            None => card.child(
                div()
                    .text_sm()
                    .text_color(rgb(MUTED))
                    .child(if self.loading {
                        "Connecting to the historian..."
                    } else {
                        "No measurements yet."
                    }),
            ),
        }
    }

    fn history_card(&self) -> Div {
        let measurements = self
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.measurements.as_slice())
            .unwrap_or(&[]);
        let rows: Vec<Div> = measurements.iter().take(12).map(history_row).collect();

        div()
            .rounded_xl()
            .border_1()
            .border_color(rgb(BORDER))
            .bg(rgb(CARD))
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
            .child("Rust + GPUI")
    }
}

impl Render for Dashboard {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("dashboard")
            .size_full()
            .overflow_y_scroll()
            .bg(rgb(BG))
            .text_color(rgb(TEXT))
            .p(px(28.))
            .flex()
            .flex_col()
            .gap_6()
            .child(self.header())
            .children(
                self.error
                    .as_deref()
                    .or_else(|| self.upstream_error())
                    .map(error_banner),
            )
            .child(self.latest_card())
            .child(self.history_card())
            .child(self.footer())
    }
}

fn badge(label: impl Into<SharedString>, tone: u32) -> Div {
    div()
        .px_3()
        .py_1()
        .rounded_full()
        .bg(rgb(tone).opacity(0.16))
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

fn error_banner(message: &str) -> Div {
    div()
        .rounded_lg()
        .border_1()
        .border_color(rgb(RED).opacity(0.4))
        .bg(rgb(RED).opacity(0.12))
        .px_4()
        .py_3()
        .text_sm()
        .text_color(rgb(0xfda4af))
        .child(message.to_string())
}
