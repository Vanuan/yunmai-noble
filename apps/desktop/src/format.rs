use chrono::{DateTime, Local};

pub fn format_weight(weight_kg: f64) -> String {
    format!("{weight_kg:.2} kg")
}

/// A weight span, with the unit appearing once: `72.10 – 72.40 kg`.
pub fn format_weight_range(min_kg: f64, max_kg: f64) -> String {
    format!("{min_kg:.2} – {max_kg:.2} kg")
}

pub fn format_timestamp(iso: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|time| {
            time.with_timezone(&Local)
                .format("%b %-d, %Y, %-I:%M %p")
                .to_string()
        })
        .unwrap_or_else(|_| iso.to_string())
}

pub fn format_age(seconds: u64) -> String {
    match seconds {
        0 | 1 => "just now".to_string(),
        seconds if seconds < 60 => format!("{seconds}s ago"),
        seconds if seconds < 3600 => format!("{}m ago", seconds / 60),
        seconds => format!("{}h ago", seconds / 3600),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_weight_with_two_decimals() {
        assert_eq!(format_weight(71.4), "71.40 kg");
        assert_eq!(format_weight(100.0), "100.00 kg");
    }

    #[test]
    fn formats_weight_ranges_with_one_unit() {
        assert_eq!(format_weight_range(72.1, 72.45), "72.10 – 72.45 kg");
    }

    #[test]
    fn keeps_invalid_timestamps_verbatim() {
        assert_eq!(format_timestamp("not-a-date"), "not-a-date");
    }

    #[test]
    fn formats_relative_ages() {
        assert_eq!(format_age(0), "just now");
        assert_eq!(format_age(1), "just now");
        assert_eq!(format_age(12), "12s ago");
        assert_eq!(format_age(120), "2m ago");
        assert_eq!(format_age(7200), "2h ago");
    }
}
