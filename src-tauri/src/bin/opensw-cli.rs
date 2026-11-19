// opensw-cli: the editor's commands from a terminal or a script (see src/cli.rs).
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(opensw_lib::cli::run(&args));
}
