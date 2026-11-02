mod api;
mod app;

use gpui::{
    App, AppContext, Bounds, KeyBinding, TitlebarOptions, WindowBackgroundAppearance, WindowBounds,
    WindowDecorations, WindowOptions, actions, px, size,
};
use gpui_platform::application;

use crate::app::SimulatorApp;
use yunmai_noble_ui_kit::window_icon;

actions!(yunmai_noble_simulator, [Quit]);

fn historian_url() -> String {
    let mut args = std::env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument == "--historian" {
            if let Some(url) = args.next() {
                return url;
            }
        } else if let Some(url) = argument.strip_prefix("--historian=") {
            return url.to_string();
        }
    }

    std::env::var("YUNMAI_HISTORIAN_URL").unwrap_or_else(|_| "http://127.0.0.1:3000".to_string())
}

fn main() {
    let historian_url = historian_url();

    application().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(760.), px(880.)), cx);

        cx.bind_keys([
            KeyBinding::new("ctrl-q", Quit, None),
            KeyBinding::new("cmd-q", Quit, None),
        ]);
        cx.on_action(|_: &Quit, cx| cx.quit());
        cx.on_window_closed(|cx, _| {
            if cx.windows().is_empty() {
                cx.quit();
            }
        })
        .detach();

        cx.open_window(
            WindowOptions {
                titlebar: Some(TitlebarOptions {
                    title: Some("Yunmai simulator".into()),
                    ..Default::default()
                }),
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_background: WindowBackgroundAppearance::Opaque,
                window_decorations: Some(WindowDecorations::Client),
                // Match the window to `yunmai-noble-simulator.desktop` so the
                // desktop environment can pick up the application icon.
                app_id: Some("yunmai-noble-simulator".into()),
                icon: Some(window_icon()),
                ..Default::default()
            },
            move |_, cx| cx.new(|cx| SimulatorApp::new(historian_url.clone(), cx)),
        )
        .expect("failed to open the simulator window");

        cx.activate(true);
    });
}
