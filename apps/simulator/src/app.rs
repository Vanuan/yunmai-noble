use std::time::Duration;

use gpui::{
    Context, CursorStyle, Decorations, Div, FontWeight, MouseButton, Render, SharedString,
    Stateful, Window, div, prelude::*, px, rgb,
};

use crate::api::{SimulatorClient, SimulatorState};

const BG: u32 = 0xfafaf9;
const CARD: u32 = 0xffffff;
const BORDER: u32 = 0xe7e5e4;
const TEXT: u32 = 0x1c1917;
const MUTED: u32 = 0x78716c;
const AMBER: u32 = 0xd97706;
const GREEN: u32 = 0x10b981;
const RED: u32 = 0xe11d48;

pub struct SimulatorApp {
    base_url: String,
    state: Option<SimulatorState>,
    driver_stopped: bool,
    error: Option<String>,
    busy: bool,
}

impl SimulatorApp {
    pub fn new(base_url: String, cx: &mut Context<Self>) -> Self {
        let poll_url = base_url.clone();

        cx.spawn(async move |this, cx| {
            loop {
                let url = poll_url.clone();
                let result = cx
                    .background_spawn(async move { SimulatorClient::new(url).state() })
                    .await;

                let alive = this
                    .update(cx, |state, cx| state.apply_state(result, cx))
                    .is_ok();
                if !alive {
                    break;
                }

                cx.background_executor()
                    .timer(Duration::from_millis(1000))
                    .await;
            }
        })
        .detach();

        Self {
            base_url,
            state: None,
            driver_stopped: false,
            error: None,
            busy: false,
        }
    }

    fn apply_state(
        &mut self,
        result: Result<Option<SimulatorState>, String>,
        cx: &mut Context<Self>,
    ) {
        match result {
            Ok(Some(state)) => {
                self.state = Some(state);
                self.driver_stopped = false;
                self.error = None;
            }
            Ok(None) => {
                self.state = None;
                self.driver_stopped = true;
                self.error = None;
            }
            Err(error) => self.error = Some(error),
        }
        cx.notify();
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.error = None;
        let url = self.base_url.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move { SimulatorClient::new(url).state() })
                .await;
            this.update(cx, |state, cx| state.apply_state(result, cx))
                .ok();
        })
        .detach();
    }

    fn start_driver(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.error = None;
        let url = self.base_url.clone();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move { SimulatorClient::new(url).start_driver() })
                .await;
            this.update(cx, |state, cx| {
                state.busy = false;
                match result {
                    Ok(()) => {
                        state.driver_stopped = false;
                        state.error = None;
                        state.refresh(cx);
                    }
                    Err(error) => state.error = Some(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn run_command(
        &mut self,
        action: &'static str,
        body: serde_json::Value,
        cx: &mut Context<Self>,
    ) {
        if self.busy {
            return;
        }
        self.busy = true;
        self.error = None;
        let url = self.base_url.clone();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_spawn(async move { SimulatorClient::new(url).command(action, body) })
                .await;
            this.update(cx, |state, cx| {
                state.busy = false;
                match result {
                    Ok(state_value) => {
                        state.state = Some(state_value);
                        state.driver_stopped = false;
                        state.error = None;
                    }
                    Err(error) => state.error = Some(error),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn toggle_power(&mut self, cx: &mut Context<Self>) {
        let Some(state) = self.state.as_ref() else {
            return;
        };
        let on = !state.powered;
        self.run_command("power", serde_json::json!({ "on": on }), cx);
    }

    fn press_scale(&mut self, cx: &mut Context<Self>) {
        let Some(state) = self.state.as_ref() else {
            return;
        };
        if !state.powered {
            self.run_command("power", serde_json::json!({ "on": true }), cx);
        } else if !state.running && state.subscribed {
            self.run_command("start", serde_json::json!({}), cx);
        }
    }

    fn adjust_weight(&mut self, delta: f64, cx: &mut Context<Self>) {
        let Some(state) = self.state.as_ref() else {
            return;
        };
        // The buttons step by 0.5 in whatever unit is on the display, but the
        // API and the wire protocol always carry kilograms.
        let display = yunmai_noble_ui_kit::weight_in_unit(state.weight_kg, &state.unit) + delta;
        let kg = yunmai_noble_ui_kit::kg_from_unit(display, &state.unit);
        let kg = ((kg * 100.0).round() / 100.0).clamp(0.1, 655.35);
        self.run_command("weight", serde_json::json!({ "kg": kg }), cx);
    }

    fn adjust_user(&mut self, delta: i64, cx: &mut Context<Self>) {
        let Some(state) = self.state.as_ref() else {
            return;
        };
        let id = (state.user as i64 + delta).clamp(0, u32::MAX as i64) as u64;
        self.run_command("user", serde_json::json!({ "id": id }), cx);
    }

    fn toggle_unit(&mut self, cx: &mut Context<Self>) {
        let Some(state) = self.state.as_ref() else {
            return;
        };
        let unit = if state.unit == "kg" { "lb" } else { "kg" };
        self.run_command("unit", serde_json::json!({ "unit": unit }), cx);
    }

    fn status(&self) -> (&'static str, u32) {
        if self.driver_stopped {
            return ("driver stopped", RED);
        }
        match self.state.as_ref() {
            None => ("connecting", MUTED),
            Some(state) if state.running => ("measuring", GREEN),
            Some(state) if state.powered => ("ready", AMBER),
            Some(_) => ("off", MUTED),
        }
    }

    fn status_line(&self) -> Div {
        let (label, tone) = self.status();
        let details = self.state.as_ref().map(|state| {
            format!(
                "{} steps · {} ms · repeat {} · {} in history",
                state.steps,
                state.interval_ms,
                if state.repeat { "on" } else { "off" },
                state.history
            )
        });

        div()
            .w(px(400.))
            .flex()
            .items_center()
            .justify_between()
            .gap_4()
            .child(status_pill(label, tone))
            .children(details.map(|details| div().text_xs().text_color(rgb(MUTED)).child(details)))
    }

    fn scale_platform(&mut self, cx: &mut Context<Self>) -> Stateful<Div> {
        let Some(state) = self.state.as_ref() else {
            return self.stopped_card(cx);
        };

        let (status, tone) = if state.running {
            ("measuring", GREEN)
        } else if state.powered {
            ("ready", AMBER)
        } else {
            ("off", MUTED)
        };
        let busy = self.busy;
        let weight = state.last_weight_kg.unwrap_or(state.weight_kg);

        div()
            .id("scale-platform")
            .when(busy, |this| this.opacity(0.9))
            .cursor(CursorStyle::PointingHand)
            .on_click(cx.listener(|state, _, _, cx| state.press_scale(cx)))
            .child(yunmai_noble_ui_kit::scale_platform(
                weight,
                &state.unit,
                state.powered,
                state.running,
                status,
                tone,
                400.,
            ))
    }

    fn stopped_card(&mut self, cx: &mut Context<Self>) -> Stateful<Div> {
        let busy = self.busy;
        let can_start = self.driver_stopped && !busy;

        div()
            .id("stopped-card")
            .w(px(400.))
            .rounded_2xl()
            .border_1()
            .border_color(rgb(BORDER))
            .bg(rgb(CARD))
            .p_6()
            .flex()
            .flex_col()
            .gap_3()
            .child(div().text_sm().font_weight(FontWeight::SEMIBOLD).child(
                if self.driver_stopped {
                    "Simulator driver is stopped"
                } else {
                    "Looking for the simulator..."
                },
            ))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(MUTED))
                    .child(if self.driver_stopped {
                        "Start the simulator driver to control a virtual scale."
                    } else {
                        "Waiting for the suite control API."
                    }),
            )
            .child(
                div()
                    .flex()
                    .gap_2()
                    .children(can_start.then(|| {
                        primary_button("start-driver", "Start simulator")
                            .on_click(cx.listener(|state, _, _, cx| state.start_driver(cx)))
                    }))
                    .child(action_button("retry", "Retry", !busy).when(!busy, |this| {
                        this.on_click(cx.listener(|state, _, _, cx| state.refresh(cx)))
                    })),
            )
    }

    fn controls(&mut self, cx: &mut Context<Self>) -> Div {
        let Some(state) = self.state.as_ref() else {
            return div();
        };
        let busy = self.busy;
        let weight_label = yunmai_noble_ui_kit::format_weight(state.weight_kg, &state.unit);
        let user_label = format!("User {}", state.user);
        let unit_label = state.unit.to_uppercase();
        let power_label = if state.powered { "Turn off" } else { "Turn on" };
        let can_step_on = state.powered && state.subscribed && !state.running;
        let can_step_off = state.running;

        div()
            .w(px(400.))
            .rounded_2xl()
            .border_1()
            .border_color(rgb(BORDER))
            .bg(rgb(CARD))
            .p_5()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("Power"),
                            )
                            .child(div().text_xs().text_color(rgb(MUTED)).child(
                                if state.powered {
                                    "scale is on"
                                } else {
                                    "scale is off"
                                },
                            )),
                    )
                    .child(
                        action_button("power", power_label, !busy).when(!busy, |this| {
                            this.on_click(cx.listener(|state, _, _, cx| state.toggle_power(cx)))
                        }),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("Weight"),
                            )
                            .child(div().text_xs().text_color(rgb(MUTED)).child(weight_label)),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(round_button("weight-down", "−", !busy).when(!busy, |this| {
                                this.on_click(
                                    cx.listener(|state, _, _, cx| state.adjust_weight(-0.5, cx)),
                                )
                            }))
                            .child(round_button("weight-up", "+", !busy).when(!busy, |this| {
                                this.on_click(
                                    cx.listener(|state, _, _, cx| state.adjust_weight(0.5, cx)),
                                )
                            })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .child(
                                div()
                                    .text_sm()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child("User"),
                            )
                            .child(div().text_xs().text_color(rgb(MUTED)).child(user_label)),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(round_button("user-down", "−", !busy).when(!busy, |this| {
                                this.on_click(
                                    cx.listener(|state, _, _, cx| state.adjust_user(-1, cx)),
                                )
                            }))
                            .child(round_button("user-up", "+", !busy).when(!busy, |this| {
                                this.on_click(
                                    cx.listener(|state, _, _, cx| state.adjust_user(1, cx)),
                                )
                            })),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Unit"),
                    )
                    .child(
                        action_button("unit", unit_label, !busy).when(!busy, |this| {
                            this.on_click(cx.listener(|state, _, _, cx| state.toggle_unit(cx)))
                        }),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_2()
                    .child(
                        action_button("step-on", "Step on", !busy && can_step_on).when(
                            !busy && can_step_on,
                            |this| {
                                this.on_click(cx.listener(|state, _, _, cx| {
                                    state.run_command("start", serde_json::json!({}), cx)
                                }))
                            },
                        ),
                    )
                    .child(
                        action_button("step-off", "Step off", !busy && can_step_off).when(
                            !busy && can_step_off,
                            |this| {
                                this.on_click(cx.listener(|state, _, _, cx| {
                                    state.run_command("stop", serde_json::json!({}), cx)
                                }))
                            },
                        ),
                    )
                    .child(
                        action_button("history", "Replay history", !busy && state.powered).when(
                            !busy && state.powered,
                            |this| {
                                this.on_click(cx.listener(|state, _, _, cx| {
                                    state.run_command("history", serde_json::json!({}), cx)
                                }))
                            },
                        ),
                    ),
            )
    }

    fn titlebar(&self, client_decorations: bool) -> Stateful<Div> {
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
                            .child("YUNMAI SIMULATOR"),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(MUTED))
                            .child("virtual scale"),
                    ),
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
            );

        if client_decorations {
            bar.on_mouse_down(MouseButton::Left, |_, window, _| window.start_window_move())
        } else {
            bar
        }
    }
}

impl Render for SimulatorApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let client_decorations = matches!(window.window_decorations(), Decorations::Client { .. });

        div()
            .id("window")
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .bg(rgb(BG))
            .text_color(rgb(TEXT))
            .child(self.titlebar(client_decorations))
            .child(
                div()
                    .id("content")
                    .flex_1()
                    .overflow_y_scroll()
                    .px(px(28.))
                    .py(px(24.))
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_5()
                    .child(self.status_line())
                    .children(self.error.as_deref().map(error_banner))
                    .child(self.scale_platform(cx))
                    .child(self.controls(cx))
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(MUTED))
                            .child(format!("{} · /api/suite/simulator", self.base_url)),
                    ),
            )
    }
}

fn status_pill(label: &'static str, tone: u32) -> Div {
    div()
        .px_3()
        .py_1()
        .rounded_full()
        .bg(rgb(tone).opacity(0.14))
        .text_color(rgb(tone))
        .text_xs()
        .font_weight(FontWeight::MEDIUM)
        .child(label)
}

fn action_button(id: &'static str, label: impl Into<SharedString>, enabled: bool) -> Stateful<Div> {
    div()
        .id(id)
        .px_3()
        .py_2()
        .rounded_lg()
        .border_1()
        .border_color(rgb(BORDER))
        .bg(rgb(BG))
        .text_sm()
        .text_color(rgb(TEXT))
        .when(enabled, |this| {
            this.cursor(CursorStyle::PointingHand)
                .hover(|this| this.bg(rgb(0xf5f5f4)))
        })
        .when(!enabled, |this| this.opacity(0.45))
        .child(label.into())
}

fn primary_button(id: &'static str, label: impl Into<SharedString>) -> Stateful<Div> {
    div()
        .id(id)
        .px_3()
        .py_2()
        .rounded_lg()
        .bg(rgb(TEXT))
        .text_sm()
        .font_weight(FontWeight::MEDIUM)
        .text_color(rgb(0xffffff))
        .cursor(CursorStyle::PointingHand)
        .hover(|this| this.bg(rgb(0x292524)))
        .child(label.into())
}

fn round_button(id: &'static str, label: &'static str, enabled: bool) -> Stateful<Div> {
    div()
        .id(id)
        .size(px(32.))
        .flex()
        .items_center()
        .justify_center()
        .rounded_full()
        .border_1()
        .border_color(rgb(BORDER))
        .bg(rgb(BG))
        .text_sm()
        .text_color(rgb(TEXT))
        .when(enabled, |this| {
            this.cursor(CursorStyle::PointingHand)
                .hover(|this| this.bg(rgb(0xf5f5f4)))
        })
        .when(!enabled, |this| this.opacity(0.45))
        .child(label)
}

fn error_banner(message: &str) -> Div {
    div()
        .w(px(400.))
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
