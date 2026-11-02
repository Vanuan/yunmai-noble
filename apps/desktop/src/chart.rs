use gpui::{
    BorderStyle, Bounds, Div, PathBuilder, Window, canvas, div, point, prelude::*, px, quad, rgb,
    size, transparent_black,
};

use crate::api::Measurement;

/// Plot heights below this many points would draw a single dot, so the
/// dashboard hides the chart instead.
pub const MIN_POINTS: usize = 2;

/// Map measurements (newest first) onto unit coordinates: `x` runs 0..1 from
/// oldest to newest, `y` runs 0..1 from the top of the band to the bottom. The
/// band surrounds the value range with padding so a flat series is still a
/// visible line instead of a collapsed one.
pub fn plot_points(measurements: &[Measurement]) -> Vec<(f32, f32)> {
    let values: Vec<f64> = measurements
        .iter()
        .rev()
        .map(|measurement| measurement.weight_kg)
        .collect();
    let count = values.len();
    if count < MIN_POINTS {
        return Vec::new();
    }

    let min = values.iter().copied().fold(f64::INFINITY, f64::min);
    let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let pad = if max - min < 0.2 {
        0.5
    } else {
        (max - min) * 0.15
    };
    let (low, high) = (min - pad, max + pad);

    values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let x = index as f32 / (count - 1) as f32;
            let y = ((high - value) / (high - low)) as f32;
            (x, y)
        })
        .collect()
}

/// Weight over time: grid lines, a filled area, the series line, and a dot per
/// reading. Returns `None` when there is nothing worth plotting.
pub fn weight_trend(
    measurements: &[Measurement],
    line: u32,
    grid: u32,
    height: f32,
) -> Option<Div> {
    let points = plot_points(measurements);
    if points.is_empty() {
        return None;
    }

    let line_color = rgb(line);
    let fill_color = rgb(line).opacity(0.12);
    let grid_color = rgb(grid);

    Some(
        div().relative().w_full().h(px(height)).child(
            canvas(
                |_, _, _| {},
                move |bounds, _, window, _| {
                    paint_trend(bounds, &points, line_color, fill_color, grid_color, window);
                },
            )
            .size_full(),
        ),
    )
}

fn paint_trend(
    bounds: Bounds<gpui::Pixels>,
    points: &[(f32, f32)],
    line_color: gpui::Rgba,
    fill_color: gpui::Rgba,
    grid_color: gpui::Rgba,
    window: &mut Window,
) {
    let width = bounds.size.width / px(1.);
    let height = bounds.size.height / px(1.);
    if width <= 0.0 || height <= 0.0 {
        return;
    }

    let at = |x: f32, y: f32| {
        point(
            bounds.origin.x + px(x * width),
            bounds.origin.y + px(y * height),
        )
    };

    for step in 0..=2 {
        let y = height * step as f32 / 2.0;
        window.paint_quad(quad(
            Bounds {
                origin: point(bounds.origin.x, bounds.origin.y + px(y)),
                size: size(px(width), px(1.)),
            },
            px(0.),
            grid_color,
            px(0.),
            transparent_black(),
            BorderStyle::default(),
        ));
    }

    let mut area = PathBuilder::fill();
    area.move_to(at(0.0, 1.0));
    for &(x, y) in points {
        area.line_to(at(x, y));
    }
    area.line_to(at(1.0, 1.0));
    area.close();
    if let Ok(path) = area.build() {
        window.paint_path(path, fill_color);
    }

    let mut stroke = PathBuilder::stroke(px(2.));
    for (index, &(x, y)) in points.iter().enumerate() {
        let position = at(x, y);
        if index == 0 {
            stroke.move_to(position);
        } else {
            stroke.line_to(position);
        }
    }
    if let Ok(path) = stroke.build() {
        window.paint_path(path, line_color);
    }

    for &(x, y) in points {
        let center = at(x, y);
        window.paint_quad(quad(
            Bounds {
                origin: point(center.x - px(3.), center.y - px(3.)),
                size: size(px(6.), px(6.)),
            },
            px(3.),
            line_color,
            px(0.),
            transparent_black(),
            BorderStyle::default(),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::plot_points;

    fn measurement(weight_kg: f64) -> crate::api::Measurement {
        crate::api::Measurement {
            id: weight_kg as i64,
            device_id: "scale".to_string(),
            scale_date: "2026-11-01T10:00:00.000Z".to_string(),
            user_id: 1,
            weight_kg,
            resistance: 0,
            fat_percentage: 0,
            historical: false,
            firmware_version: Some(1),
        }
    }

    #[test]
    fn needs_two_points() {
        assert!(plot_points(&[]).is_empty());
        assert!(plot_points(&[measurement(70.0)]).is_empty());
    }

    #[test]
    fn plots_newest_last_from_oldest_to_newest() {
        // Newest first in the API response: 72.0 was measured last.
        let points = plot_points(&[measurement(72.0), measurement(71.0), measurement(70.0)]);

        assert_eq!(points.len(), 3);
        assert_eq!(points[0].0, 0.0);
        assert_eq!(points[2].0, 1.0);
        // A rising weight moves up the plot, so y decreases.
        assert!(points[0].1 > points[1].1);
        assert!(points[1].1 > points[2].1);
    }

    #[test]
    fn keeps_a_flat_series_visible() {
        let points = plot_points(&[measurement(70.0), measurement(70.0)]);
        assert!((points[0].1 - 0.5).abs() < 0.001);
        assert!((points[1].1 - 0.5).abs() < 0.001);
    }
}
