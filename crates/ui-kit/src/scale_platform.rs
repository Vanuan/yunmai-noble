use gpui::{Div, FontWeight, div, prelude::*, px, rgb};

const PLATFORM: u32 = 0xf5f5f4;
const PLATFORM_EDGE: u32 = 0xd6d3d1;
const ELECTRODE: u32 = 0xded9d6;
const ELECTRODE_EDGE: u32 = 0xcfc9c4;
const DISPLAY: u32 = 0x78716c;
const DISC: u32 = 0xd6d3d1;
const DISC_EDGE: u32 = 0xa8a29e;
const BRAND: u32 = 0xa8a29e;
const RUNNING: u32 = 0x10b981;
const KG_TO_LB: f64 = 2.204_622_621_848_776;

/// Convert a canonical kilogram value to the display unit. Storage and the v1
/// wire contract stay in kilograms; this is presentation only.
pub fn weight_in_unit(weight_kg: f64, unit: &str) -> f64 {
    if unit.eq_ignore_ascii_case("lb") {
        weight_kg * KG_TO_LB
    } else {
        weight_kg
    }
}

/// Convert a value in the display unit back to kilograms.
pub fn kg_from_unit(value: f64, unit: &str) -> f64 {
    if unit.eq_ignore_ascii_case("lb") {
        value / KG_TO_LB
    } else {
        value
    }
}

pub fn format_weight(weight_kg: f64, unit: &str) -> String {
    format!(
        "{:.2} {}",
        weight_in_unit(weight_kg, unit),
        unit.to_uppercase()
    )
}

/// The physical-scale platform used by both the dashboard and the simulator.
/// The caller supplies the display state; callers that want a button wrap it
/// in a clickable container.
pub fn scale_platform(
    weight_kg: f64,
    unit: &str,
    powered: bool,
    running: bool,
    status: &str,
    tone: u32,
    size: f32,
) -> Div {
    let scale = size / 400.0;
    let display = if powered {
        format!("{:.2}", weight_in_unit(weight_kg, unit))
    } else {
        "--.--".to_string()
    };
    let edge = if running {
        rgb(RUNNING).opacity(0.5)
    } else {
        rgb(PLATFORM_EDGE)
    };

    div()
        .w(px(size))
        .h(px(size))
        .relative()
        .rounded_3xl()
        .border_1()
        .border_color(edge)
        .bg(rgb(PLATFORM))
        .shadow_2xl()
        .child(
            div()
                .absolute()
                .top(px(34. * scale))
                .left_0()
                .right_0()
                .flex()
                .flex_col()
                .items_center()
                .gap_1()
                .child(
                    div()
                        .text_size(px(52. * scale))
                        .font_weight(FontWeight::SEMIBOLD)
                        .text_color(rgb(DISPLAY))
                        .child(display),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .text_size(px(12. * scale))
                        .text_color(rgb(DISPLAY))
                        .child(unit.to_uppercase())
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_1()
                                .child(div().size(px(6. * scale)).rounded_full().bg(rgb(tone)))
                                .child(status.to_string()),
                        ),
                ),
        )
        .child(electrode(66., 252., false, scale))
        .child(electrode(66., 252., true, scale))
        .child(
            div()
                .absolute()
                .top(px(173. * scale))
                .left(px(173. * scale))
                .size(px(54. * scale))
                .rounded_full()
                .border_1()
                .border_color(rgb(DISC_EDGE))
                .bg(rgb(DISC)),
        )
        .child(
            div()
                .absolute()
                .bottom(px(34. * scale))
                .left_0()
                .right_0()
                .text_center()
                .text_size(px(12. * scale))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(rgb(BRAND))
                .child("YUNMAI"),
        )
}

fn electrode(left: f32, top: f32, right: bool, scale: f32) -> Div {
    let base = div()
        .absolute()
        .top(px(top * scale))
        .w(px(112. * scale))
        .h(px(30. * scale))
        .rounded_full()
        .border_1()
        .border_color(rgb(ELECTRODE_EDGE))
        .bg(rgb(ELECTRODE));
    if right {
        base.right(px(left * scale))
    } else {
        base.left(px(left * scale))
    }
}

#[cfg(test)]
mod tests {
    use super::{format_weight, kg_from_unit, weight_in_unit};

    fn close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {expected}, got {actual}"
        );
    }

    #[test]
    fn kilograms_pass_through() {
        close(weight_in_unit(75.0, "kg"), 75.0);
        close(weight_in_unit(75.0, "KG"), 75.0);
        close(kg_from_unit(75.0, "kg"), 75.0);
    }

    #[test]
    fn pounds_convert_both_ways() {
        close(weight_in_unit(75.0, "lb"), 165.346_696_638_658_2);
        close(kg_from_unit(165.346_696_638_658_2, "lb"), 75.0);
    }

    #[test]
    fn formats_with_unit_suffix() {
        assert_eq!(format_weight(75.0, "kg"), "75.00 KG");
        assert_eq!(format_weight(75.0, "lb"), "165.35 LB");
    }
}
