use chrono::DateTime;

use crate::api::Measurement;

/// Consecutive readings with the same weight are folded into one row. A scale
/// that retransmits, or a simulator repeating a cycle, would otherwise fill the
/// list with identical entries.
const GROUP_WINDOW_SECS: i64 = 300;

#[derive(Debug, PartialEq)]
pub struct HistoryGroup<'a> {
    /// Newest reading of the run, which the row displays.
    pub newest: &'a Measurement,
    /// Oldest reading of the run.
    pub oldest: &'a Measurement,
    pub count: usize,
}

impl HistoryGroup<'_> {
    /// `None` when the run holds a single reading.
    pub fn repeat_label(&self) -> Option<String> {
        (self.count > 1).then(|| format!("{} readings", self.count))
    }
}

/// Group a newest-first slice into runs of the same reading. Runs only merge
/// within [`GROUP_WINDOW_SECS`], so the same weight on another day stays its
/// own entry.
pub fn group_consecutive(measurements: &[Measurement]) -> Vec<HistoryGroup<'_>> {
    let mut groups: Vec<HistoryGroup<'_>> = Vec::new();

    for measurement in measurements {
        if let Some(group) = groups.last_mut()
            && same_reading(group.newest, measurement)
            && within_window(group.oldest, measurement)
        {
            group.oldest = measurement;
            group.count += 1;
            continue;
        }

        groups.push(HistoryGroup {
            newest: measurement,
            oldest: measurement,
            count: 1,
        });
    }

    groups
}

fn same_reading(left: &Measurement, right: &Measurement) -> bool {
    left.device_id == right.device_id
        && left.user_id == right.user_id
        && (left.weight_kg - right.weight_kg).abs() < 0.005
        && left.fat_percentage == right.fat_percentage
        && left.resistance == right.resistance
}

fn within_window(oldest: &Measurement, candidate: &Measurement) -> bool {
    let (Ok(oldest), Ok(candidate)) = (
        DateTime::parse_from_rfc3339(&oldest.scale_date),
        DateTime::parse_from_rfc3339(&candidate.scale_date),
    ) else {
        return false;
    };

    (oldest - candidate).num_seconds().abs() <= GROUP_WINDOW_SECS
}

#[cfg(test)]
mod tests {
    use super::group_consecutive;

    fn measurement(weight_kg: f64, scale_date: &str) -> crate::api::Measurement {
        crate::api::Measurement {
            id: 0,
            device_id: "scale-simulator".to_string(),
            scale_date: scale_date.to_string(),
            user_id: 1,
            weight_kg,
            resistance: 0,
            fat_percentage: 0,
            historical: false,
            firmware_version: Some(1),
        }
    }

    #[test]
    fn folds_repeated_readings_into_one_row() {
        let readings = vec![
            measurement(72.4, "2026-11-01T10:01:00.000Z"),
            measurement(72.4, "2026-11-01T10:00:30.000Z"),
            measurement(72.4, "2026-11-01T10:00:00.000Z"),
        ];

        let groups = group_consecutive(&readings);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].count, 3);
        assert_eq!(groups[0].newest.scale_date, "2026-11-01T10:01:00.000Z");
        assert_eq!(groups[0].oldest.scale_date, "2026-11-01T10:00:00.000Z");
        assert_eq!(groups[0].repeat_label().as_deref(), Some("3 readings"));
    }

    #[test]
    fn keeps_different_weights_apart() {
        let readings = vec![
            measurement(72.4, "2026-11-01T10:01:00.000Z"),
            measurement(72.6, "2026-11-01T10:00:00.000Z"),
        ];

        let groups = group_consecutive(&readings);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].repeat_label(), None);
    }

    #[test]
    fn does_not_merge_distant_readings() {
        let readings = vec![
            measurement(72.4, "2026-11-02T10:00:00.000Z"),
            measurement(72.4, "2026-11-01T10:00:00.000Z"),
        ];

        assert_eq!(group_consecutive(&readings).len(), 2);
    }

    #[test]
    fn ignores_unparsable_dates() {
        let readings = vec![
            measurement(72.4, "not-a-date"),
            measurement(72.4, "2026-11-01T10:00:00.000Z"),
        ];

        assert_eq!(group_consecutive(&readings).len(), 2);
    }
}
