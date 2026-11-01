mod api;
mod app;
mod format;

use gpui::{
    App, AppContext, Bounds, KeyBinding, TitlebarOptions, WindowBounds, WindowOptions, actions, px,
    size,
};
use gpui_platform::application;

use crate::app::Dashboard;

actions!(yunmai_noble, [Quit]);

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
        let bounds = Bounds::centered(None, size(px(980.), px(760.)), cx);

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
                    title: Some("yunmai-noble".into()),
                    ..Default::default()
                }),
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            move |_, cx| cx.new(|cx| Dashboard::new(historian_url.clone(), cx)),
        )
        .expect("failed to open the yunmai-noble window");

        cx.activate(true);
    });
}
