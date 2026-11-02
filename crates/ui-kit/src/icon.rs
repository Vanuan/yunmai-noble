use std::sync::{Arc, OnceLock};

use image::RgbaImage;

/// Window icon for the GPUI apps, rasterized from the packaging SVG at
/// `packaging/deb/yunmai-noble-desktop/yunmai-noble.svg`.
///
/// Wayland has no window-icon protocol: the compositor resolves the icon of a
/// running app by matching the window's app id to a `.desktop` file. X11
/// desktops also read `_NET_WM_ICON`, which is what this image feeds.
pub fn window_icon() -> Arc<RgbaImage> {
    static ICON: OnceLock<Arc<RgbaImage>> = OnceLock::new();

    ICON.get_or_init(|| {
        let pixels = image::load_from_memory(include_bytes!("../assets/yunmai-noble.png"))
            .expect("bundled window icon is a valid PNG")
            .into_rgba8();
        Arc::new(pixels)
    })
    .clone()
}

#[cfg(test)]
mod tests {
    use super::window_icon;

    #[test]
    fn icon_is_a_square_png() {
        let icon = window_icon();
        assert_eq!(icon.dimensions(), (256, 256));
        assert!(icon.pixels().any(|pixel| pixel.0[3] > 0));
    }
}
